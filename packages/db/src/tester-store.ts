import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  fail,
  iso,
  normalize,
  Store,
  type CommandContext,
  type Row,
} from './store.js';

/**
 * ADR-0075 (P11 G1/G2): tester accounts for a private committee review, run by the operations
 * actor from `pnpm ops tester-*`. A tester signs in through the deployment's OIDC provider as
 * their own person actor, and sees only their own synthetic sample workspace, which the
 * operations actor owns. Reset retires the old workspace (kept, with its audit history, until a
 * retention decision) and seeds a fresh one. Nothing here reads the owner's studio data.
 */
export type TesterRole = 'editor' | 'viewer';
export type TesterAccount = {
  actor_id: string;
  display_name: string;
  issuer: string;
  subject: string;
  workspace_role: TesterRole;
  expires_at: string;
  disabled_at: string | null;
  disabled_reason: string | null;
  state: 'active' | 'expired' | 'disabled';
  workspace_id: string | null;
  retired_workspaces: number;
  created_at: string;
};
export type AddTesterRequest = {
  issuer: string;
  subject: string;
  display_name: string;
  expires_at: string;
  workspace_role?: TesterRole;
  /** Refused as a tester subject: the owner's own OIDC subject. */
  owner_subject?: string | null;
};

/** The synthetic sample a tester explores: every record is labelled as a fixture. */
export const SAMPLE_WORKSPACE_NAME = 'Sample review workspace (synthetic)';

const ACCOUNT_SQL = `select t.actor_id, a.display_name, t.issuer, t.subject, t.workspace_role,
    t.expires_at, t.disabled_at, t.disabled_reason, t.created_at,
    (t.disabled_at is null and t.expires_at > now()) as live,
    (select w.workspace_id from tester_workspaces w
      where w.actor_id = t.actor_id and w.retired_at is null) as workspace_id,
    (select count(*)::int from tester_workspaces w
      where w.actor_id = t.actor_id and w.retired_at is not null) as retired
  from tester_accounts t join actors a on a.id = t.actor_id`;

function toAccount(r: Row): TesterAccount {
  return {
    actor_id: String(r.actor_id),
    display_name: String(r.display_name),
    issuer: String(r.issuer),
    subject: String(r.subject),
    workspace_role: r.workspace_role as TesterRole,
    expires_at: iso(r.expires_at),
    disabled_at: r.disabled_at ? iso(r.disabled_at) : null,
    disabled_reason: (r.disabled_reason as string | null) ?? null,
    state: r.disabled_at ? 'disabled' : r.live ? 'active' : 'expired',
    workspace_id: (r.workspace_id as string | null) ?? null,
    retired_workspaces: Number(r.retired ?? 0),
    created_at: iso(r.created_at),
  };
}

const text = (v: unknown, max: number, what: string) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > max)
    throw fail('INVALID_CONTRACT', `${what} must be 1-${max} characters.`);
  return s;
};

export class TesterStore extends Store {
  async listTesters(): Promise<TesterAccount[]> {
    const { rows } = await this.pool.query(
      `${ACCOUNT_SQL} order by t.created_at, t.actor_id`,
    );
    return rows.map((r: Row) => toAccount(r));
  }

  async tester(actorId: string): Promise<TesterAccount> {
    const { rows } = await this.pool.query(
      `${ACCOUNT_SQL} where t.actor_id = $1`,
      [actorId],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Tester account not found.');
    return toAccount(rows[0] as Row);
  }

  /** Allow-lists one (issuer, subject), creates its own actor and seeds its sample workspace. */
  async addTester(ctxIn: CommandContext, req: AddTesterRequest) {
    const ctx = normalize(ctxIn);
    // Compared without a trailing slash, as the provider's `iss` may or may not carry one.
    const issuer = text(req.issuer, 500, 'The issuer').replace(/\/+$/, '');
    const subject = text(req.subject, 255, 'The subject');
    const name = text(req.display_name, 200, 'The display name');
    const role = req.workspace_role ?? 'editor';
    if (role !== 'editor' && role !== 'viewer')
      throw fail(
        'INVALID_CONTRACT',
        'The tester role must be editor or viewer.',
      );
    const expires = Date.parse(req.expires_at);
    if (!Number.isFinite(expires) || expires <= Date.now())
      throw fail(
        'INVALID_CONTRACT',
        'The expiry must be a future date and time.',
      );
    if (req.owner_subject && req.owner_subject === subject)
      throw fail(
        'INVALID_CONTRACT',
        "That subject is the owner's sign-in; it cannot be a tester account.",
      );
    const actorId = randomUUID();
    await this.tx(async (c) => {
      const taken = await c.query(
        'select 1 from tester_accounts where issuer = $1 and subject = $2',
        [issuer, subject],
      );
      if (taken.rowCount)
        throw fail('DUPLICATE', 'That identity already has a tester account.');
      await c.query(
        `insert into actors (id, kind, display_name) values ($1, 'human', $2)`,
        [actorId, name],
      );
      await c.query(
        `insert into tester_accounts (actor_id, issuer, subject, workspace_role, expires_at, created_by)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          actorId,
          issuer,
          subject,
          role,
          new Date(expires).toISOString(),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: null,
        action: 'tester.added',
        subjectKind: 'actor',
        subjectId: actorId,
        subjectVersion: null,
        contentHash: null,
        // The subject is an identifier at the provider; it stays out of the audit payload.
        payload: {
          workspace_role: role,
          expires_at: new Date(expires).toISOString(),
        },
      });
    });
    await this.seedSample(ctx, actorId);
    return this.tester(actorId);
  }

  /** Retires the tester's current sample workspace and seeds a fresh one. */
  async resetTester(ctxIn: CommandContext, actorId: string) {
    const ctx = normalize(ctxIn);
    const account = await this.tester(actorId);
    if (account.state === 'disabled')
      throw fail('INVALID_TRANSITION', 'This tester account is removed.');
    await this.tx((c) => this.retireCurrent(c, ctx, actorId, 'reset'));
    await this.seedSample(ctx, actorId);
    return this.tester(actorId);
  }

  /**
   * Disables the account, ends its sessions and takes it out of its workspace. Records stay
   * until Jordan's retention decision (D8); nothing is deleted here.
   */
  async removeTester(ctxIn: CommandContext, actorId: string, reason: string) {
    const ctx = normalize(ctxIn);
    const why = text(reason, 200, 'The reason');
    await this.tx(async (c) => {
      const { rows } = await c.query(
        `update tester_accounts set disabled_at = now(), disabled_reason = $2
         where actor_id = $1 and disabled_at is null returning actor_id`,
        [actorId, why],
      );
      if (!rows[0]) {
        const known = await c.query(
          'select 1 from tester_accounts where actor_id = $1',
          [actorId],
        );
        throw known.rowCount
          ? fail(
              'INVALID_TRANSITION',
              'This tester account is already removed.',
            )
          : fail('NOT_FOUND', 'Tester account not found.');
      }
      await c.query(
        `update auth_sessions set revoked_at = now()
         where actor_id = $1 and revoked_at is null`,
        [actorId],
      );
      await this.retireCurrent(c, ctx, actorId, 'removed');
      await this.append(c, ctx, {
        workspaceId: null,
        action: 'tester.removed',
        subjectKind: 'actor',
        subjectId: actorId,
        subjectVersion: null,
        contentHash: null,
        payload: { reason: why },
      });
    });
    return this.tester(actorId);
  }

  private async retireCurrent(
    c: PoolClient,
    ctx: CommandContext,
    actorId: string,
    why: 'reset' | 'removed',
  ) {
    // Serialises reset and remove for one tester.
    await c.query(
      'select 1 from tester_accounts where actor_id = $1 for update',
      [actorId],
    );
    const { rows } = await c.query<{ workspace_id: string }>(
      `update tester_workspaces set retired_at = now()
       where actor_id = $1 and retired_at is null returning workspace_id`,
      [actorId],
    );
    const ws = rows[0]?.workspace_id;
    if (!ws) return;
    await c.query(
      'delete from workspace_members where workspace_id = $1 and actor_id = $2',
      [ws, actorId],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'member.removed',
      subjectKind: 'actor',
      subjectId: actorId,
      subjectVersion: null,
      contentHash: null,
      payload: { reason: `Tester workspace retired (${why}).` },
    });
  }

  /**
   * Seeds a synthetic sample workspace owned by the operations actor, then adds the tester
   * with their role last, so a failed seed never shows a half-built workspace to anyone.
   * Every record is a labelled fixture; no research, model call or owner data is involved.
   */
  private async seedSample(ctx: CommandContext, actorId: string) {
    const ws = await this.createWorkspace(ctx, {
      name: SAMPLE_WORKSPACE_NAME,
      record_mode: 'fixture',
    });
    const base = ws.id;
    const make = (kind: string, title: string, body: unknown) =>
      this.createEntity(ctx, base, { kind, title, body });
    const link = (
      relation: string,
      from: { id: string; version: number },
      to: { id: string; version: number },
    ) =>
      this.createLink(ctx, base, {
        relation,
        from: { id: from.id, version: from.version },
        to: { id: to.id, version: to.version },
        rationale: 'Synthetic sample lineage',
      });
    const uncertainty = 'Synthetic sample for review; no research performed.';
    const source = await make('source', 'Sample volunteer report', {
      url: 'https://example.org/sample-report',
      retrieval_status: 'inaccessible',
      content_hash: null,
      retrieved_at: new Date().toISOString(),
      published_at: null,
      independent_origin: 'example.org (synthetic sample)',
      observation: 'Synthetic placeholder; not retrieved.',
      uncertainty,
    });
    const claim = await make('claim', 'Volunteers miss shifts', {
      statement: 'Volunteers miss shifts when schedules change.',
      basis: 'inference',
      uncertainty,
    });
    const problem = await make('problem', 'Shift coverage gaps', {
      statement: 'Shifts go uncovered after schedule changes.',
      affected_group: 'Food bank volunteers (synthetic sample)',
      uncertainty,
    });
    const roster = await make('idea', 'Shared roster', {
      summary: 'One shared roster everyone can see.',
      uncertainty,
    });
    const reminders = await make('idea', 'Reminder messages', {
      summary: 'Reminders before each shift.',
      uncertainty,
    });
    const product = await make('product', 'Roster with reminders', {
      stage: 'captured',
      summary: 'Combines both ideas.',
    });
    const kit = await make('product', 'Printable roster kit', {
      stage: 'captured',
      summary: 'A non-software option from the roster idea.',
    });
    await link('supports', source, claim);
    await link('supports', claim, problem);
    await link('derived_from', roster, problem);
    await link('derived_from', reminders, problem);
    await link('derived_from', product, roster);
    await link('derived_from', product, reminders);
    await link('derived_from', kit, roster);
    await this.tx(async (c) => {
      const { rows } = await c.query<{
        workspace_role: TesterRole;
        live: boolean;
      }>(
        `select workspace_role, disabled_at is null as live from tester_accounts
         where actor_id = $1 for update`,
        [actorId],
      );
      const t = rows[0];
      if (!t) throw fail('NOT_FOUND', 'Tester account not found.');
      if (!t.live)
        throw fail(
          'INVALID_TRANSITION',
          'This tester account was removed meanwhile.',
        );
      // A concurrent reset may have seeded first; retire that one so exactly one is current.
      await this.retireCurrent(c, ctx, actorId, 'reset');
      await c.query(
        'insert into tester_workspaces (workspace_id, actor_id) values ($1, $2)',
        [base, actorId],
      );
      await c.query(
        'insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, $3)',
        [base, actorId, t.workspace_role],
      );
      await this.append(c, ctx, {
        workspaceId: base,
        action: 'member.added',
        subjectKind: 'actor',
        subjectId: actorId,
        subjectVersion: null,
        contentHash: null,
        payload: { role: t.workspace_role, tester: true },
      });
    });
    return base;
  }
}
