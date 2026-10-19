import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DesktopChallengeRequestSchema,
  DesktopClaimSchema,
  DesktopControlSchema,
  DesktopHeartbeatSchema,
  DesktopChallengeSchema,
  DesktopDeviceSchema,
  parse,
  type DesktopChallenge,
  type DesktopDevice,
} from '@creator/contracts';
import { SearchStore } from './search-store.js';
import type { PoolClient } from 'pg';
import { fail, uuid, iso, type CommandContext, type Row } from './store.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
function challenge(r: Row): DesktopChallenge {
  return DesktopChallengeSchema.parse({
    id: r.id,
    kind: r.kind,
    label: r.label,
    workspace_id: r.workspace_id,
    capabilities: r.capabilities,
    comparison_code: String(r.proof_hash).slice(0, 8).toUpperCase(),
    expires_at: iso(r.expires_at),
    approved: r.approval_session_hash !== null,
  });
}
function device(r: Row): DesktopDevice {
  return DesktopDeviceSchema.parse({
    id: r.id,
    kind: r.kind,
    workspace_id: r.workspace_id,
    label: r.label,
    capabilities: r.capabilities,
    state: r.state,
    created_at: iso(r.created_at),
    expires_at: iso(r.expires_at),
    last_seen_at: r.last_seen_at === null ? null : iso(r.last_seen_at),
    lease_expires_at:
      r.lease_expires_at === null ? null : iso(r.lease_expires_at),
    fence: r.fence,
  });
}

export class DesktopStore extends SearchStore {
  protected async desktopControlChanged(
    _c: PoolClient,
    _deviceId: string,
    _state: string,
  ) {}
  async beginDesktop(input: unknown) {
    const v = parse(DesktopChallengeRequestSchema, input);
    return this.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(4310016)');
      const count = await c.query(
        `select count(*)::int n from desktop_challenges where created_at > clock_timestamp() - interval '5 minutes'`,
      );
      if (Number(count.rows[0]?.n) >= 20)
        throw fail(
          'LIMIT_EXCEEDED',
          'Too many pairing attempts; wait five minutes.',
        );
      const r = await c.query(
        `insert into desktop_challenges(id, kind, proof_hash, label, workspace_id, capabilities)
        values ($1,$2,$3,$4,$5,$6) returning *`,
        [
          randomUUID(),
          v.kind,
          v.proof_hash,
          v.label,
          v.workspace_id,
          JSON.stringify(v.capabilities),
        ],
      );
      return challenge(r.rows[0] as Row);
    });
  }
  async desktopChallenge(ctx: CommandContext, challengeId: string) {
    return this.tx(async (c) => {
      const r = await c.query(
        `select * from desktop_challenges where id=$1 and consumed_at is null and expires_at > clock_timestamp()`,
        [uuid(challengeId)],
      );
      if (!r.rows[0])
        throw fail('NOT_FOUND', 'Unknown or expired desktop request.');
      if (r.rows[0].workspace_id)
        await this.requireOwner(c, String(r.rows[0].workspace_id), ctx.actorId);
      return challenge(r.rows[0] as Row);
    });
  }
  async approveDesktop(
    ctx: CommandContext,
    challengeId: string,
    sessionHash: string,
  ) {
    return this.tx(async (c) => {
      const r = await c.query(
        `select * from desktop_challenges where id=$1 for update`,
        [uuid(challengeId)],
      );
      const row = r.rows[0] as Row | undefined;
      if (
        !row ||
        row.consumed_at ||
        Date.parse(iso(row.expires_at)) <= Date.now()
      )
        throw fail('EXPIRED', 'Desktop request expired or consumed.');
      const s = await c.query(
        `select actor_id from auth_sessions where token_hash=$1 and actor_id=$2 and revoked_at is null and expires_at>clock_timestamp() for share`,
        [sessionHash, ctx.actorId],
      );
      if (!s.rows[0]) throw fail('UNAUTHENTICATED', 'Sign-in session expired.');
      if (row.workspace_id)
        await this.requireOwner(c, String(row.workspace_id), ctx.actorId);
      if (row.approval_session_hash) {
        if (row.approval_session_hash !== sessionHash)
          throw fail(
            'VERSION_CONFLICT',
            'Request was already approved from another session.',
          );
        return challenge(row);
      }
      const updated = await c.query(
        `update desktop_challenges set approval_session_hash=$2 where id=$1 returning *`,
        [challengeId, sessionHash],
      );
      await this.append(c, ctx, {
        workspaceId: row.workspace_id as string | null,
        action: 'desktop.pairing_approved',
        subjectKind: 'desktop_challenge',
        subjectId: challengeId,
        subjectVersion: null,
        contentHash: null,
        payload: { kind: row.kind, capabilities: row.capabilities },
      });
      return challenge(updated.rows[0] as Row);
    });
  }
  /** Consumes the challenge and issues its credential in the same transaction; lost responses require re-pairing. */
  async claimDesktop(challengeId: string, input: unknown) {
    const { proof } = parse(DesktopClaimSchema, input);
    return this.tx(async (c) => {
      const r = await c.query(
        `select * from desktop_challenges where id=$1 and proof_hash=$2 for update`,
        [uuid(challengeId), hash(proof)],
      );
      const row = r.rows[0] as Row | undefined;
      if (
        !row ||
        row.consumed_at ||
        Date.parse(iso(row.expires_at)) <= Date.now()
      )
        throw fail('EXPIRED', 'Unknown, consumed or expired request.');
      if (!row.approval_session_hash) return { state: 'pending' as const };
      const s = await c.query(
        `select * from auth_sessions where token_hash=$1 and revoked_at is null and expires_at>clock_timestamp() for share`,
        [row.approval_session_hash],
      );
      const session = s.rows[0] as Row | undefined;
      if (!session)
        throw fail(
          'UNAUTHENTICATED',
          'Approving browser session has expired or been revoked.',
        );
      if (row.workspace_id)
        await this.requireOwner(
          c,
          String(row.workspace_id),
          String(session.actor_id),
        );
      const token = secret();
      const deviceId = randomUUID();
      if (row.kind === 'worker')
        await c.query(
          `insert into actors(id,kind,display_name) values($1,'agent',$2)`,
          [deviceId, `Paired worker: ${String(row.label).slice(0, 80)}`],
        );
      const expiresAt =
        row.kind === 'worker'
          ? new Date(Date.now() + 30 * 86400000).toISOString()
          : iso(session.expires_at);
      if (row.kind === 'desktop_login') {
        await c.query(
          `insert into auth_sessions(token_hash, actor_id, method, subject, csrf_token, expires_at)
          values ($1,$2,$3,$4,$5,$6)`,
          [
            hash(token),
            session.actor_id,
            session.method,
            session.subject,
            secret(),
            expiresAt,
          ],
        );
      }
      const d = await c.query(
        `insert into desktop_devices(id,kind,owner_id,workspace_id,label,capabilities,token_hash,session_hash,expires_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [
          deviceId,
          row.kind,
          session.actor_id,
          row.workspace_id,
          row.label,
          JSON.stringify(row.capabilities),
          row.kind === 'worker' ? hash(token) : null,
          row.kind === 'desktop_login' ? hash(token) : null,
          expiresAt,
        ],
      );
      await c.query(
        `update desktop_challenges set consumed_at=clock_timestamp() where id=$1`,
        [challengeId],
      );
      await this.append(
        c,
        { actorId: String(session.actor_id) },
        {
          workspaceId: row.workspace_id as string | null,
          action: 'desktop.paired',
          subjectKind: 'desktop_device',
          subjectId: deviceId,
          subjectVersion: null,
          contentHash: null,
          payload: { kind: row.kind, capabilities: row.capabilities },
        },
      );
      return {
        state: 'paired' as const,
        token,
        device: device(d.rows[0] as Row),
      };
    });
  }
  async desktopDevices(ctx: CommandContext) {
    const r = await this.pool.query(
      `select d.* from desktop_devices d where owner_id=$1 and
      (workspace_id is null or exists(select 1 from workspace_members m where m.workspace_id=d.workspace_id and m.actor_id=$1 and m.role='owner')) order by created_at desc limit 100`,
      [ctx.actorId],
    );
    return r.rows.map((r) => device(r as Row));
  }
  async controlDesktop(ctx: CommandContext, deviceId: string, input: unknown) {
    const { state } = parse(DesktopControlSchema, input);
    return this.tx(async (c) => {
      const r = await c.query(
        `select * from desktop_devices where id=$1 and owner_id=$2 for update`,
        [uuid(deviceId), ctx.actorId],
      );
      const row = r.rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Device not found.');
      if (row.workspace_id)
        await this.requireOwner(c, String(row.workspace_id), ctx.actorId);
      if (row.state === 'revoked' && state !== 'revoked')
        throw fail(
          'INVALID_TRANSITION',
          'A revoked device must be paired again.',
        );
      if (row.kind === 'desktop_login' && state !== 'revoked')
        throw fail(
          'INVALID_TRANSITION',
          'Desktop sessions support revocation only.',
        );
      if (row.session_hash)
        await c.query(
          `update auth_sessions set revoked_at=clock_timestamp() where token_hash=$1`,
          [row.session_hash],
        );
      const d = await c.query(
        `update desktop_devices set state=$2, lease_expires_at=null, fence=fence+1 where id=$1 returning *`,
        [deviceId, state],
      );
      await this.desktopControlChanged(c, deviceId, state);
      await this.append(c, ctx, {
        workspaceId: row.workspace_id as string | null,
        action: 'desktop.control_changed',
        subjectKind: 'desktop_device',
        subjectId: deviceId,
        subjectVersion: null,
        contentHash: null,
        payload: { state },
      });
      return device(d.rows[0] as Row);
    });
  }
  /** Presence lease only. It never authorizes model calls, artifact reads or generated-code dispatch. */
  async heartbeatDesktop(token: string, input: unknown) {
    const { fence } = parse(DesktopHeartbeatSchema, input);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw fail('UNAUTHENTICATED', 'Invalid worker credential.');
    return this.tx(async (c) => {
      const r = await c.query(
        `select * from desktop_devices where token_hash=$1 and kind='worker' for update`,
        [hash(token)],
      );
      const row = r.rows[0] as Row | undefined;
      if (
        !row ||
        row.state === 'revoked' ||
        Date.parse(iso(row.expires_at)) <= Date.now()
      )
        throw fail('UNAUTHENTICATED', 'Worker credential expired or revoked.');
      await this.requireOwner(
        c,
        String(row.workspace_id),
        String(row.owner_id),
      );
      // A control change invalidates the old lease; return the new fence without renewing it.
      if (Number(row.fence) !== fence)
        return { device: device(row), lease: null };
      const d = await c.query(
        `update desktop_devices set last_seen_at=clock_timestamp(),
        lease_expires_at=case when state='active' then clock_timestamp()+interval '30 seconds' else null end
        where id=$1 returning *`,
        [row.id],
      );
      const current = device(d.rows[0] as Row);
      return {
        device: current,
        lease:
          current.state === 'active'
            ? {
                workspace_id: current.workspace_id,
                capabilities: current.capabilities,
                fence: current.fence,
                expires_at: current.lease_expires_at,
                purpose: 'presence_only' as const,
              }
            : null,
      };
    });
  }
}
