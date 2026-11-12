import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import type { PoolClient } from 'pg';
import {
  ConfirmGateRequestSchema,
  GateChecklistItemSchema,
  RunCapabilityCheckRequestSchema,
  SaveGateChecklistRequestSchema,
  SaveTeamProfileRequestSchema,
  SetGateRuleRequestSchema,
  TeamProfileBodySchema,
  parse,
  type CapabilityCheck,
  type GateChecklist,
  type GateChecklistItem,
  type GateClearMode,
  type GateConfirmation,
  type GateRule,
  type TeamProfile,
  type TeamProfileBody,
} from '@creator/contracts';
import {
  EMPTY_TEAM_PROFILE,
  canonicalHash,
  checkedTeamProfile,
  checklistHash,
  packetChecklist,
  packetTeam,
  sameTeamProfile,
  savedTeamProfile,
  teamHash,
  verifiedCapabilities,
} from '@creator/domain';
import { DiscoveryStore } from './discovery-store.js';
import {
  fail,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** The computer the studio runs on (its host name). It never goes into a model packet. */
export const studioMachine = () => hostname().slice(0, 120) || 'this computer';

/** Where the studio runs: its host name, and whether built-in checks may run there. */
export interface StudioHost {
  machine: string;
  /** False in a hosted deployment, where a check would test the server, not the team. */
  checks: boolean;
}

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

  /**
   * What an assessment packet carries from the profile now, its version and its hash, and
   * (ADR-0097) the capabilities the app can vouch for on this computer.
   */
  protected async teamForPacket(c: PoolClient, ws: string) {
    const t = await this.latestTeamProfile(c, ws);
    const machine = studioMachine();
    const team = packetTeam(t.profile, t.version, machine);
    return {
      version: t.version,
      team,
      hash: teamHash(team),
      verified: verifiedCapabilities(t.profile, machine),
    };
  }

  // ---- The owner's gate checklist (ADR-0097) -------------------------------------------

  /** The latest saved checklist (version 0 and empty when none was saved). */
  protected async latestGateChecklist(
    c: PoolClient,
    ws: string,
  ): Promise<{
    version: number;
    items: GateChecklistItem[];
    at: string | null;
  }> {
    const { rows } = await c.query<{
      version: number;
      items: unknown;
      created_at: Date;
    }>(
      `select version, items, created_at from gate_checklist_versions
        where workspace_id = $1 order by version desc limit 1`,
      [ws],
    );
    const r = rows[0];
    if (!r) return { version: 0, items: [], at: null };
    return {
      version: Number(r.version),
      items: GateChecklistItemSchema.array().parse(r.items),
      at: iso(r.created_at),
    };
  }

  /** What an assessment packet carries from the checklist now, and its hash ('' for none). */
  protected async checklistForPacket(c: PoolClient, ws: string) {
    const l = await this.latestGateChecklist(c, ws);
    const checklist = packetChecklist(l.items, l.version);
    return { version: l.version, checklist, hash: checklistHash(checklist) };
  }

  private checklistView(
    l: { version: number; items: GateChecklistItem[]; at: string | null },
    owner: boolean,
  ): GateChecklist {
    return {
      version: l.version,
      items: l.items.map((x, i) => ({ ref: `K${i + 1}`, ...x })),
      updated_at: l.at,
      can_edit: owner,
    };
  }

  async gateChecklist(ctx: CommandContext, ws: string): Promise<GateChecklist> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.checklistView(
        await this.latestGateChecklist(c, ws),
        await this.ownsWorkspace(c, ws, ctx.actorId),
      );
    });
  }

  /** Saves the owner's checklist as a new version: an owner's action, audited. */
  async saveGateChecklist(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<GateChecklist> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SaveGateChecklistRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireTeamOwner(c, ws, ctx.actorId);
      await c.query(
        "select pg_advisory_xact_lock(hashtext('gate-checklist:' || $1::text))",
        [ws],
      );
      const cur = await this.latestGateChecklist(c, ws);
      if (cur.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'The gate checklist changed since this page loaded it; reload and decide again.',
        );
      const items = req.items.map((x) => ({ gate: x.gate, text: x.text }));
      const seen = new Set<string>();
      for (const x of items) {
        const k = `${x.gate}:${x.text.toLowerCase()}`;
        if (seen.has(k))
          throw fail(
            'INVALID_CONTRACT',
            `“${x.text}” is listed twice for the ${x.gate} gate.`,
          );
        seen.add(k);
      }
      if (canonicalHash(items) === canonicalHash(cur.items))
        throw fail(
          'INVALID_CONTRACT',
          'Nothing changed in the gate checklist.',
        );
      const version = cur.version + 1;
      const itemsHash = canonicalHash(items);
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: 'gate_checklist.saved',
        subjectKind: 'gate_checklist',
        subjectId: ws,
        subjectVersion: version,
        contentHash: itemsHash,
        payload: { version, items },
      });
      const { rows } = await c.query<{ created_at: Date }>(
        `insert into gate_checklist_versions (workspace_id, version, items, items_hash, actor_id,
           event_id)
         values ($1, $2, $3::jsonb, $4, $5, $6) returning created_at`,
        [ws, version, JSON.stringify(items), itemsHash, ctx.actorId, eventId],
      );
      return this.checklistView(
        { version, items, at: iso(rows[0]!.created_at) },
        true,
      );
    });
  }

  /** What the page gets: the host name (where checks ran and would run) only for the owner. */
  private profileView(
    t: { version: number; profile: TeamProfileBody; at: string | null },
    owner: boolean,
    host: StudioHost,
  ): TeamProfile {
    return {
      version: t.version,
      profile: owner
        ? t.profile
        : {
            ...t.profile,
            capabilities: t.profile.capabilities.map((x) =>
              x.check ? { ...x, check: { ...x.check, machine: '' } } : x,
            ),
          },
      updated_at: t.at,
      can_edit: owner,
      machine: owner && host.checks ? host.machine.slice(0, 120) : null,
      checks_available: host.checks,
    };
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
  protected async requireTeamOwner(c: PoolClient, ws: string, actorId: string) {
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
    host: StudioHost,
  ): Promise<TeamProfile> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.profileView(
        await this.latestTeamProfile(c, ws),
        await this.ownsWorkspace(c, ws, ctx.actorId),
        host,
      );
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
    host: StudioHost,
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
      throw fail(
        'INVALID_CONTRACT',
        change === 'checked'
          ? 'The check found what the team profile already says; nothing changed.'
          : 'Nothing changed in the team profile.',
      );
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
    return this.profileView(
      { version, profile, at: iso(rows[0]!.created_at) },
      true,
      host,
    );
  }

  async saveTeamProfile(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    host: StudioHost,
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
        host,
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
    host: StudioHost,
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
        host,
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

  // ---- The owner's gate rule: who clears a gate ---------------------------------------

  /** The rule in force (version 0, owner, when never set). */
  protected async latestGateRule(c: PoolClient, ws: string) {
    const { rows } = await c.query<{
      version: number;
      mode: GateClearMode;
      created_at: Date;
    }>(
      `select version, mode, created_at from gate_rule_versions
        where workspace_id = $1 order by version desc limit 1`,
      [ws],
    );
    const r = rows[0];
    return r
      ? { version: Number(r.version), mode: r.mode, at: iso(r.created_at) }
      : {
          version: 0,
          mode: 'owner' as GateClearMode,
          at: null as string | null,
        };
  }

  async gateRule(ctx: CommandContext, ws: string): Promise<GateRule> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const r = await this.latestGateRule(c, ws);
      return {
        version: r.version,
        mode: r.mode,
        updated_at: r.at,
        can_edit: await this.ownsWorkspace(c, ws, ctx.actorId),
      };
    });
  }

  /** Sets who clears gates: an owner's action, audited and versioned. */
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
          'Who clears gates changed since this page loaded it; reload and decide again.',
        );
      if (cur.mode === req.mode)
        throw fail('INVALID_CONTRACT', 'That is already how gates clear.');
      if (
        req.mode === 'checklist' &&
        !(await this.latestGateChecklist(c, ws)).items.length
      )
        throw fail(
          'INVALID_CONTRACT',
          'Save a gate checklist with at least one item first; until then nothing could clear by it.',
        );
      const version = cur.version + 1;
      const payload = { version, mode: req.mode, previous: cur.mode };
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: 'gate_rule.set',
        subjectKind: 'gate_rule',
        subjectId: ws,
        subjectVersion: version,
        contentHash: canonicalHash(payload),
        payload,
      });
      const { rows } = await c.query<{ created_at: Date }>(
        `insert into gate_rule_versions (workspace_id, version, mode, actor_id, event_id)
         values ($1, $2, $3, $4, $5) returning created_at`,
        [ws, version, req.mode, ctx.actorId, eventId],
      );
      return {
        version,
        mode: req.mode,
        updated_at: iso(rows[0]!.created_at),
        can_edit: true,
      };
    });
  }
}
