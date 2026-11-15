import type { PoolClient } from 'pg';
import { canonicalHash } from '@creator/domain';
import { LIVE_PREVIEW_SQL } from './artifact-store.js';
import { iso, Store, type CommandContext, type Row } from './store.js';

/** ADR-0121: the cleanup's audit events name this as their subject. */
export const STORAGE_SUBJECT_ID = '00000000-0000-4000-8000-000000000121';

export type StorageWorkspace = {
  workspace_id: string;
  name: string;
  fixture: boolean;
  files: number;
  previews_live: number;
  previews_ended: number;
  study: boolean;
};
export type VerifiedPackageRow = {
  artifact_id: string;
  product_id: string;
  workspace_id: string;
  task_id: string;
  commit: string;
  manifest_sha256: string;
  archive_sha256: string;
};
export type StorageCleanupEvent = {
  id: string;
  occurred_at: string;
  action: 'storage.cleanup.intent' | 'storage.cleanup.outcome';
  payload: Row;
};

/**
 * ADR-0121 (F10): what the Storage page reads from the database, and the cleanup's audit
 * events. Only workspaces the person owns are listed; packages are the recorded verified
 * manifests, whose hashes the cleanup checks on disk before and after.
 */
export class StorageStore extends Store {
  /** Workspaces where this person is an owner member, with file bytes and preview counts. */
  async ownedWorkspaces(ctx: CommandContext): Promise<StorageWorkspace[]> {
    const { rows } = await this.pool.query(
      `select w.id::text as workspace_id, w.name, w.fixture,
         coalesce((select sum(v.size_bytes) from workspace_file_versions v
                   where v.workspace_id = w.id), 0)::bigint as files,
         (select count(*) from artifact_previews p
           where p.workspace_id = w.id and ${LIVE_PREVIEW_SQL})::int as previews_live,
         (select count(*) from artifact_previews p where p.workspace_id = w.id)::int as previews_all,
         exists (select 1 from study_attempts s where s.workspace_id = w.id) as study
       from workspaces w
       join workspace_members m on m.workspace_id = w.id
       where m.actor_id = $1 and m.role = 'owner'
       order by w.created_at, w.id`,
      [ctx.actorId],
    );
    return rows.map((r: Row) => ({
      workspace_id: String(r.workspace_id),
      name: String(r.name),
      fixture: Boolean(r.fixture),
      files: Number(r.files),
      previews_live: Number(r.previews_live),
      previews_ended: Number(r.previews_all) - Number(r.previews_live),
      study: Boolean(r.study),
    }));
  }

  /** Workspaces with any thesis study attempt, whoever owns them: never cleaned. */
  async studyWorkspaces(): Promise<Set<string>> {
    const { rows } = await this.pool.query(
      'select distinct workspace_id::text as id from study_attempts',
    );
    return new Set(rows.map((r: Row) => String(r.id)));
  }

  /** Every verified package the studio recorded, with the hashes its files must still have. */
  async verifiedPackages(): Promise<VerifiedPackageRow[]> {
    const { rows } = await this.pool.query(
      `select id::text as artifact_id, product_id::text as product_id,
         workspace_id::text as workspace_id, manifest->'task'->>'id' as task_id,
         commit, manifest_sha256, archive_sha256
       from artifact_manifests where state = 'verified' order by created_at, id`,
    );
    return rows.map((r: Row) => ({
      artifact_id: String(r.artifact_id),
      product_id: String(r.product_id),
      workspace_id: String(r.workspace_id),
      task_id: String(r.task_id),
      commit: String(r.commit).trim(),
      manifest_sha256: String(r.manifest_sha256).trim(),
      archive_sha256: String(r.archive_sha256).trim(),
    }));
  }

  /** One hash-chained audit event: the intent before anything is removed, the outcome after. */
  async recordCleanup(
    ctx: CommandContext,
    action: StorageCleanupEvent['action'],
    payload: Row,
  ): Promise<string> {
    return this.tx(async (c: PoolClient) => {
      return this.append(c, ctx, {
        workspaceId: null,
        action,
        subjectKind: 'storage',
        subjectId: STORAGE_SUBJECT_ID,
        subjectVersion: null,
        contentHash: canonicalHash(payload),
        payload,
      });
    });
  }

  /** This person's recent cleanups, newest first. */
  async cleanupHistory(
    ctx: CommandContext,
    limit = 10,
  ): Promise<StorageCleanupEvent[]> {
    const { rows } = await this.pool.query(
      `select id::text as id, occurred_at, action, payload from audit_events
       where action in ('storage.cleanup.intent', 'storage.cleanup.outcome')
         and subject_id = $1 and actor_id = $2
       order by sequence desc limit $3`,
      [STORAGE_SUBJECT_ID, ctx.actorId, limit],
    );
    return rows.map((r: Row) => ({
      id: String(r.id),
      occurred_at: iso(r.occurred_at),
      action: r.action as StorageCleanupEvent['action'],
      payload: (r.payload ?? {}) as Row,
    }));
  }
}
