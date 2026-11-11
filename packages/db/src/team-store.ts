import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ConfirmGateRequestSchema,
  RunCapabilityCheckRequestSchema,
  SaveTeamProfileRequestSchema,
  SetGateRuleRequestSchema,
  TeamProfileBodySchema,
  parse,
  type CapabilityCheck,
  type GateConfirmation,
  type GateRule,
  type TeamProfile,
  type TeamProfileBody,
} from '@creator/contracts';
import {
  EMPTY_TEAM_PROFILE,
  canonicalHash,
  checkedTeamProfile,
  packetTeam,
  sameTeamProfile,
  savedTeamProfile,
} from '@creator/domain';
import { DiscoveryStore } from './discovery-store.js';
import {
  fail,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const iso = (v: unknown) => new Date(v as string | Date).toISOString();
const toConfirmation = (r: Row): GateConfirmation => ({
  id: String(r.id),
  alternative_id: String(r.alternative_id),
  alternative_version: Number(r.alternative_version),
  gate: r.gate as GateConfirmation['gate'],
  reason: String(r.reason),
  concerns: (r.concerns as string[]) ?? [],
  actor_id: String(r.actor_id),
  created_at: iso(r.created_at),
});

/**
 * ADR-0090: the team profile (migration 56) and the owner's gate confirmations. Only a workspace
 * owner signed in as a person writes either; every member reads the profile. Each save is a new
 * version, audited, and never changed afterwards.
 */
export class TeamStore extends DiscoveryStore {
  /** The latest saved profile (version 0 and empty when none was saved). */
  protected async latestTeamProfile(
    c: PoolClient,
    ws: string,
  ): Promise<{ version: number; profile: TeamProfileBody; at: string | null }> {
    const { rows } = await c.query<{
      version: number;
      profile: unknown;
      created_at: Date;
    }>(
      `select version, profile, created_at from team_profile_versions
        where workspace_id = $1 order by version desc limit 1`,
      [ws],
    );
    const r = rows[0];
    if (!r) return { version: 0, profile: EMPTY_TEAM_PROFILE, at: null };
    return {
      version: Number(r.version),
      profile: TeamProfileBodySchema.parse(r.profile),
      at: iso(r.created_at),
    };
  }

  /** What an assessment packet carries from the profile now, and its version. */
  protected async teamForPacket(c: PoolClient, ws: string) {
    const t = await this.latestTeamProfile(c, ws);
    return { version: t.version, team: packetTeam(t.profile, t.version) };
  }

  private async ownsWorkspace(c: PoolClient, ws: string, actorId: string) {
    try {
      await this.requireOwner(c, ws, actorId);
      return true;
    } catch (e) {
      if ((e as { code?: string }).code === 'ACCESS_DENIED') return false;
      throw e;
    }
  }
  private async requireTeamOwner(c: PoolClient, ws: string, actorId: string) {
    await this.role(c, ws, actorId, false);
    if (!(await this.ownsWorkspace(c, ws, actorId)))
      throw fail(
        'ACCESS_DENIED',
        'Only the workspace owner, signed in as a person, can change the team profile or confirm a gate.',
      );
  }

  async teamProfile(
    ctx: CommandContext,
    ws: string,
    machine: string,
  ): Promise<TeamProfile> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const t = await this.latestTeamProfile(c, ws);
      return {
        version: t.version,
        profile: t.profile,
        updated_at: t.at,
        can_edit: await this.ownsWorkspace(c, ws, ctx.actorId),
        machine: machine.slice(0, 120),
      };
    });
  }

  /** Refuses before anything runs when this person may not record a check here. */
  async requireTeamProfileOwner(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    await this.tx((c) => this.requireTeamOwner(c, ws, ctx.actorId));
  }

  private async writeTeamProfile(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    expected: number,
    next: (current: TeamProfileBody) => TeamProfileBody,
    change: 'saved' | 'checked',
    machine: string,
  ): Promise<TeamProfile> {
    await this.requireTeamOwner(c, ws, ctx.actorId);
    await c.query(
      "select pg_advisory_xact_lock(hashtext('team-profile:' || $1::text))",
      [ws],
    );
    const cur = await this.latestTeamProfile(c, ws);
    if (cur.version !== expected)
      throw fail(
        'VERSION_CONFLICT',
        'The team profile changed since this page loaded it; reload and decide again.',
      );
    const profile = next(cur.profile);
    if (cur.version > 0 && sameTeamProfile(profile, cur.profile))
      throw fail('INVALID_CONTRACT', 'Nothing changed in the team profile.');
    const version = cur.version + 1;
    const profileHash = canonicalHash(profile);
    const eventId = await this.append(c, ctx, {
      workspaceId: ws,
      action:
        change === 'saved' ? 'team_profile.saved' : 'team_profile.checked',
      subjectKind: 'team_profile',
      subjectId: ws,
      subjectVersion: version,
      contentHash: profileHash,
      payload: { version, change, profile },
    });
    const { rows } = await c.query<{ created_at: Date }>(
      `insert into team_profile_versions (workspace_id, version, profile, profile_hash, change,
         actor_id, event_id)
       values ($1, $2, $3::jsonb, $4, $5, $6, $7) returning created_at`,
      [
        ws,
        version,
        JSON.stringify(profile),
        profileHash,
        change,
        ctx.actorId,
        eventId,
      ],
    );
    return {
      version,
      profile,
      updated_at: iso(rows[0]!.created_at),
      can_edit: true,
      machine: machine.slice(0, 120),
    };
  }

  async saveTeamProfile(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    machine: string,
  ): Promise<TeamProfile> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SaveTeamProfileRequestSchema, raw);
    return this.tx((c) =>
      this.writeTeamProfile(
        c,
        ctx,
        ws,
        req.expected_version,
        (cur) => savedTeamProfile(cur, req),
        'saved',
        machine,
      ),
    );
  }

  /**
   * Records a passing built-in check: that capability becomes yes, found by the check, with what
   * ran, where, when and a hash of its output. A failed check changes nothing.
   */
  async recordCapabilityCheck(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    check: CapabilityCheck,
    machine: string,
  ): Promise<TeamProfile> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RunCapabilityCheckRequestSchema, raw);
    return this.tx((c) =>
      this.writeTeamProfile(
        c,
        ctx,
        ws,
        req.expected_version,
        (cur) => checkedTeamProfile(cur, req.capability, check),
        'checked',
        machine,
      ),
    );
  }

  // ---- Gate confirmations ---------------------------------------------------------------

  /** Every confirmation for these alternatives, oldest first. */
  protected async gateConfirmations(
    c: PoolClient,
    ws: string,
    alternatives: readonly string[],
  ): Promise<GateConfirmation[]> {
    if (!alternatives.length) return [];
    const { rows } = await c.query(
      `select * from gate_confirmations where workspace_id = $1 and alternative_id = any($2::uuid[])
        order by created_at, id`,
      [ws, [...alternatives]],
    );
    return rows.map((r: Row) => toConfirmation(r));
  }

  /**
   * Writes one confirmation after the caller (the selection store) has checked, under the same
   * transaction, that this gate's current concerns are exactly the ones the page showed.
   */
  protected async insertGateConfirmation(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    concerns: readonly string[],
  ): Promise<GateConfirmation> {
    const req = parse(ConfirmGateRequestSchema, raw);
    const id = randomUUID();
    const payload = {
      alternative: req.alternative,
      gate: req.gate,
      reason: req.reason,
      concerns,
    };
    const eventId = await this.append(c, ctx, {
      workspaceId: ws,
      action: 'gate.confirmed',
      subjectKind: 'alternative',
      subjectId: req.alternative.id.toLowerCase(),
      subjectVersion: req.alternative.version,
      contentHash: canonicalHash(payload),
      payload,
    });
    const { rows } = await c.query(
      `insert into gate_confirmations (id, workspace_id, alternative_id, alternative_version, gate,
         reason, concerns, actor_id, event_id)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) returning *`,
      [
        id,
        ws,
        req.alternative.id.toLowerCase(),
        req.alternative.version,
        req.gate,
        req.reason,
        JSON.stringify(concerns),
        ctx.actorId,
        eventId,
      ],
    );
    return toConfirmation(rows[0] as Row);
  }
  protected async requireGateOwner(c: PoolClient, ws: string, actorId: string) {
    await this.requireTeamOwner(c, ws, actorId);
  }

  // ---- The owner's auto-clear rule ------------------------------------------------------

  /** The rule in force (version 0, off, when never set). */
  protected async latestGateRule(c: PoolClient, ws: string) {
    const { rows } = await c.query<{
      version: number;
      auto_clear: boolean;
      created_at: Date;
    }>(
      `select version, auto_clear, created_at from gate_rule_versions
        where workspace_id = $1 order by version desc limit 1`,
      [ws],
    );
    const r = rows[0];
    return r
      ? {
          version: Number(r.version),
          auto_clear: r.auto_clear,
          at: iso(r.created_at),
        }
      : { version: 0, auto_clear: false, at: null as string | null };
  }

  async gateRule(ctx: CommandContext, ws: string): Promise<GateRule> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const r = await this.latestGateRule(c, ws);
      return {
        version: r.version,
        auto_clear: r.auto_clear,
        updated_at: r.at,
        can_edit: await this.ownsWorkspace(c, ws, ctx.actorId),
      };
    });
  }

  /** Turns the owner's auto-clear rule on or off: an owner's action, audited and versioned. */
  async setGateRule(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<GateRule> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SetGateRuleRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireTeamOwner(c, ws, ctx.actorId);
      await c.query(
        "select pg_advisory_xact_lock(hashtext('gate-rule:' || $1::text))",
        [ws],
      );
      const cur = await this.latestGateRule(c, ws);
      if (cur.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'The auto-clear rule changed since this page loaded it; reload and decide again.',
        );
      if (cur.auto_clear === req.auto_clear)
        throw fail(
          'INVALID_CONTRACT',
          `The auto-clear rule is already ${req.auto_clear ? 'on' : 'off'}.`,
        );
      const version = cur.version + 1;
      const payload = { version, auto_clear: req.auto_clear };
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: req.auto_clear ? 'gate_rule.enabled' : 'gate_rule.disabled',
        subjectKind: 'gate_rule',
        subjectId: ws,
        subjectVersion: version,
        contentHash: canonicalHash(payload),
        payload,
      });
      const { rows } = await c.query<{ created_at: Date }>(
        `insert into gate_rule_versions (workspace_id, version, auto_clear, actor_id, event_id)
         values ($1, $2, $3, $4, $5) returning created_at`,
        [ws, version, req.auto_clear, ctx.actorId, eventId],
      );
      return {
        version,
        auto_clear: req.auto_clear,
        updated_at: iso(rows[0]!.created_at),
        can_edit: true,
      };
    });
  }
}
