import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  BackupRunSchema,
  BackupSettingsInputSchema,
  ContractError,
  parse,
  type BackupRun,
  type BackupSettings,
} from '@creator/contracts';

/** ADR-0123 defaults while nothing is saved: daily on (while the app runs), keep 7. */
export const BACKUP_DEFAULTS = { daily_enabled: true, keep_daily: 7 } as const;

type RunRow = {
  id: string;
  trigger: BackupRun['trigger'];
  status: BackupRun['status'];
  backup_name: string | null;
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
  result: Record<string, unknown> | null;
};
const runOf = (r: RunRow): BackupRun =>
  parse(BackupRunSchema, {
    ...r,
    started_at: r.started_at.toISOString(),
    finished_at: r.finished_at?.toISOString() ?? null,
  });
const isUnique = (e: unknown, index: string) =>
  (e as { code?: string; constraint?: string }).code === '23505' &&
  (e as { constraint?: string }).constraint === index;

/**
 * ADR-0123 (F1): the owner's backup settings and the record of each backup, check and restore.
 * Who may use them is decided here, not in the page: the studio owner is the person recorded
 * as the studio spending manager (ADR-0113), a human who is not a tester account.
 */
export class BackupStore {
  constructor(private readonly pool: pg.Pool) {}

  async isStudioOwner(actorId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: boolean }>(
      `select exists(select 1 from studio_spending_manager s join actors a on a.id = s.actor_id
          where s.actor_id = $1 and a.kind = 'human'
            and not exists(select 1 from tester_accounts t where t.actor_id = a.id)) as ok`,
      [actorId],
    );
    return rows[0]?.ok === true;
  }
  async requireStudioOwner(actorId: string) {
    if (!(await this.isStudioOwner(actorId)))
      throw new ContractError(
        'ACCESS_DENIED',
        'Only the studio owner can see or make backups. They hold every workspace, so owning a workspace does not grant this.',
      );
  }

  async settings(defaultFolder: string): Promise<BackupSettings> {
    const { rows } = await this.pool.query<{
      version: number;
      daily_enabled: boolean;
      keep_daily: number;
      folder: string;
      created_at: Date;
    }>(
      'select version, daily_enabled, keep_daily, folder, created_at from backup_settings order by version desc limit 1',
    );
    const r = rows[0];
    return r
      ? {
          version: r.version,
          daily_enabled: r.daily_enabled,
          keep_daily: r.keep_daily,
          folder: r.folder,
          default_folder: defaultFolder,
          updated_at: r.created_at.toISOString(),
        }
      : {
          version: 0,
          ...BACKUP_DEFAULTS,
          folder: defaultFolder,
          default_folder: defaultFolder,
          updated_at: null,
        };
  }

  /** A new version, bound to the one the person reviewed; the folder is checked by the caller. */
  async saveSettings(
    actorId: string,
    raw: unknown,
    checkFolder: (folder: string) => Promise<string>,
  ) {
    const input = parse(BackupSettingsInputSchema, raw);
    await this.requireStudioOwner(actorId);
    const folder = await checkFolder(input.folder);
    try {
      const { rowCount } = await this.pool.query(
        `insert into backup_settings (version, daily_enabled, keep_daily, folder, actor_id)
         select $1 + 1, $2, $3, $4, $5
          where coalesce((select max(version) from backup_settings), 0) = $1`,
        [
          input.expected_version,
          input.daily_enabled,
          input.keep_daily,
          folder,
          actorId,
        ],
      );
      if (rowCount !== 1) throw new Error('stale');
    } catch (e) {
      if (
        e instanceof Error &&
        e.message !== 'stale' &&
        !isUnique(e, 'backup_settings_pkey')
      )
        throw e;
      throw new ContractError(
        'VERSION_CONFLICT',
        'The backup settings changed elsewhere; review them again.',
      );
    }
  }

  /**
   * Records a run as it starts. Refused while another runs, and for `daily` when today's
   * (UTC) daily attempt already exists: both are unique indexes, so two processes or a
   * restart cannot both win.
   */
  async startRun(o: {
    trigger: BackupRun['trigger'];
    actorId: string | null;
    backupName: string | null;
    dailyDay?: string;
  }): Promise<BackupRun | null> {
    try {
      const { rows } = await this.pool.query<RunRow>(
        `insert into backup_runs (id, trigger, backup_name, daily_day, actor_id)
         values ($1, $2, $3, $4, $5)
         returning id, trigger, status, backup_name, started_at, finished_at, error, result`,
        [
          randomUUID(),
          o.trigger,
          o.backupName,
          o.trigger === 'daily' ? o.dailyDay : null,
          o.trigger === 'daily' ? null : o.actorId,
        ],
      );
      return runOf(rows[0]!);
    } catch (e) {
      if (isUnique(e, 'backup_runs_daily_once')) return null;
      if (isUnique(e, 'backup_runs_one_running'))
        throw new ContractError(
          'VERSION_CONFLICT',
          'Another backup, check or restore is running. Wait for it to finish.',
        );
      throw e;
    }
  }
  async finishRun(
    id: string,
    o: {
      status: 'succeeded' | 'failed' | 'interrupted';
      error?: string | null;
      result?: Record<string, unknown> | null;
    },
  ) {
    await this.pool.query(
      `update backup_runs set status = $2, error = $3, result = $4, finished_at = clock_timestamp()
        where id = $1 and status = 'running'`,
      [
        id,
        o.status,
        o.error ? o.error.slice(0, 2000) : null,
        o.result ? JSON.stringify(o.result) : null,
      ],
    );
  }
  /**
   * At startup: a run still marked running belongs to a studio that stopped mid-way (or to
   * the snapshot a restored copy came from). It is recorded as interrupted, never as done.
   */
  async sweepInterrupted(): Promise<number> {
    const { rowCount } = await this.pool.query(
      `update backup_runs set status = 'interrupted', finished_at = clock_timestamp(),
          error = 'The studio stopped before this finished, or this copy was restored from a backup taken while it ran.'
        where status = 'running'`,
    );
    return rowCount ?? 0;
  }
  async runs(): Promise<{
    runs: BackupRun[];
    running: BackupRun | null;
    lastDailyDay: string | null;
  }> {
    const { rows } = await this.pool.query<RunRow>(
      `select id, trigger, status, backup_name, started_at, finished_at, error, result
         from backup_runs order by started_at desc, id limit 20`,
    );
    const running = await this.pool.query<RunRow>(
      `select id, trigger, status, backup_name, started_at, finished_at, error, result
         from backup_runs where status = 'running'`,
    );
    const daily = await this.pool.query<{ d: string | null }>(
      `select max(daily_day)::text as d from backup_runs where trigger = 'daily'`,
    );
    return {
      runs: rows.map(runOf),
      running: running.rows[0] ? runOf(running.rows[0]) : null,
      lastDailyDay: daily.rows[0]?.d ?? null,
    };
  }
  async run(id: string): Promise<BackupRun | null> {
    const { rows } = await this.pool.query<RunRow>(
      `select id, trigger, status, backup_name, started_at, finished_at, error, result
         from backup_runs where id = $1`,
      [id],
    );
    return rows[0] ? runOf(rows[0]) : null;
  }
}
