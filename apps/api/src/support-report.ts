import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { arch, hostname, platform, release, userInfo } from 'node:os';
import type { Pool } from 'pg';
import {
  ContractError,
  SupportReportSchema,
  parse,
  type SessionInfo,
} from '@creator/contracts';
import {
  renderSupportReport,
  SUPPORT_FAILURE_LIMIT,
  type DeploymentConfig,
  type SupportFacts,
  type SupportIdentity,
} from '@creator/domain';
import {
  supportAccountNames,
  supportConnections,
  supportFailures,
  type OpsStore,
} from '@creator/db';

function appVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The account and machine names to hide; empty when the platform will not say. */
export function localIdentity(env: NodeJS.ProcessEnv): SupportIdentity {
  const users = new Set<string>();
  const hosts = new Set<string>();
  try {
    users.add(userInfo().username);
  } catch {
    // Some service accounts have no passwd entry.
  }
  for (const k of ['USERNAME', 'USER', 'LOGNAME'])
    if (env[k]) users.add(env[k]);
  try {
    hosts.add(hostname());
  } catch {
    // Unknown host name: nothing to hide.
  }
  if (env.COMPUTERNAME) hosts.add(env.COMPUTERNAME);
  return { userNames: [...users], hostNames: [...hosts] };
}

/**
 * ADR-0118 (F5): GET /api/support/report, the owner's redacted support report. Read-only and
 * owner-only, like the operations status it summarizes; it sends nothing anywhere.
 */
export function supportReportRoutes(o: {
  deployment: DeploymentConfig;
  pool: Pool | null;
  ops: OpsStore | null;
  ensureReady: () => Promise<void>;
  schemaVersion: () => number | null;
  readiness: () => Promise<{
    readiness: { ready: boolean };
    checks: { name: string; ok: boolean; detail: string }[];
  }>;
  maintenance: () => {
    jobs: Record<string, { error_code: string | null }>;
  };
  identity: SupportIdentity;
  requireOwner: (
    req: IncomingMessage,
    mutating: boolean,
  ) => Promise<SessionInfo>;
  now?: () => Date;
}) {
  const version = appVersion();
  async function facts(): Promise<{
    facts: SupportFacts;
    accounts: string[];
  }> {
    const unavailable: string[] = [];
    const attempt = async <T>(what: string, f: () => Promise<T>) => {
      try {
        return await f();
      } catch (e) {
        unavailable.push(
          `${what}: ${e instanceof ContractError ? e.code : 'could not be read'}`,
        );
        return null;
      }
    };
    const health = await attempt('health checks', o.readiness);
    const ready = o.pool
      ? await attempt('database', o.ensureReady).then((v) => v !== null)
      : false;
    if (!o.pool)
      unavailable.push(
        'workers, connections and failures: no database configured',
      );
    const metrics =
      ready && o.ops ? await attempt('workers', () => o.ops!.metrics()) : null;
    const pool = ready ? o.pool : null;
    const connections = pool
      ? await attempt('connections', () => supportConnections(pool))
      : null;
    const failures = pool
      ? await attempt('failures', () =>
          supportFailures(pool, SUPPORT_FAILURE_LIMIT),
        )
      : null;
    const accounts = pool
      ? await attempt('account names', () => supportAccountNames(pool))
      : [];
    // Without the account names the report cannot promise to hide them: leave out the
    // sections that may carry them rather than show them.
    const safe = accounts !== null;
    if (!safe)
      unavailable.push(
        'connections and failures: left out because the GitHub account names to hide could not be read',
      );
    const facts: SupportFacts = {
      generated_at: (o.now?.() ?? new Date()).toISOString(),
      app: {
        version,
        build_commit: o.deployment.build_commit,
        schema_version: o.schemaVersion(),
        mode: o.deployment.mode,
        environment: o.deployment.environment,
        node: process.version,
        os: { platform: platform(), release: release(), arch: arch() },
      },
      readiness: {
        ready: health?.readiness.ready ?? false,
        checks: health?.checks ?? [],
      },
      maintenance: Object.entries(o.maintenance().jobs).map(([job, j]) => ({
        job,
        error_code: j.error_code,
      })),
      workers: metrics
        ? {
            leases_active: metrics.workers.workflow_leases_active,
            leases_expired: metrics.workers.workflow_leases_expired,
            local_jobs_open: metrics.workers.local_jobs_open,
            outbox_pending: metrics.queue.outbox_pending,
            local: metrics.workers.local_last_seen,
          }
        : null,
      connections: safe ? connections : null,
      failures: safe ? failures : null,
      unavailable,
    };
    return { facts, accounts: accounts ?? [] };
  }

  async function route(
    req: IncomingMessage,
    url: URL,
  ): Promise<{ status: number; value: unknown } | null> {
    if (url.pathname !== '/api/support/report') return null;
    if (req.method !== 'GET')
      throw new ContractError('NOT_FOUND', 'Route not found.');
    await o.requireOwner(req, false);
    const { facts: f, accounts } = await facts();
    const { text, hidden } = renderSupportReport(f, {
      ...o.identity,
      accountNames: [...(o.identity.accountNames ?? []), ...accounts],
    });
    return {
      status: 200,
      value: parse(SupportReportSchema, {
        generated_at: f.generated_at,
        text,
        hidden,
      }),
    };
  }
  return { route, facts };
}
