import {
  ReadinessSchema,
  SmokeReportSchema,
  type Readiness,
  type SmokeReport,
} from '@creator/contracts';
import type { DeploymentEnvironment } from './deployment.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * X06 smoke check of a declared target: read-only GETs only. It never signs in, never
 * writes and never follows redirects. A target off this machine must be https. The report
 * binds what it saw (environment, commit, configuration hash) so an owner can record it as
 * a verification of exactly that deployment.
 */
export async function smokeCheck(
  target: string,
  declared: DeploymentEnvironment,
  fetchImpl: typeof fetch = fetch,
  expectCommit?: string,
): Promise<SmokeReport> {
  const started = new Date().toISOString();
  const checks: SmokeReport['checks'] = [];
  const add = (name: string, ok: boolean, detail: string, required = true) =>
    checks.push({ name, ok, required, detail: detail.slice(0, 500) });
  let base: URL;
  try {
    base = new URL(target);
  } catch {
    base = new URL('invalid:');
  }
  const local = LOOPBACK.has(base.hostname);
  add(
    'target',
    (base.protocol === 'https:' || (local && base.protocol === 'http:')) &&
      !base.username &&
      !base.password &&
      base.pathname === '/',
    local
      ? 'Loopback target.'
      : 'A target off this machine must be a bare https origin.',
  );
  const get = async (path: string) => {
    const r = await fetchImpl(new URL(path, base), {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const text = await r.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { r, body };
  };
  let ready: Readiness | null = null;
  if (checks[0]!.ok) {
    try {
      const { r, body } = await get('/api/health');
      const status = (body as { status?: unknown } | null)?.status;
      add('health', r.status === 200 && status === 'ok', `HTTP ${r.status}`);
      add(
        'response_headers',
        r.headers.get('cache-control') === 'no-store' &&
          r.headers.get('x-content-type-options') === 'nosniff',
        'API responses must be no-store and nosniff.',
      );
    } catch (e) {
      add('health', false, (e as Error).message);
    }
    try {
      const { r, body } = await get('/api/ready');
      const parsed = ReadinessSchema.safeParse(body);
      ready = parsed.success ? parsed.data : null;
      add(
        'ready',
        r.status === 200 && ready?.ready === true,
        ready
          ? ready.checks
              .map((c) => `${c.name}: ${c.ok ? 'ok' : 'failing'}`)
              .join(', ')
          : `HTTP ${r.status}, unreadable readiness`,
      );
    } catch (e) {
      add('ready', false, (e as Error).message);
    }
    add(
      'environment',
      ready?.environment === declared,
      `Declared ${declared}; target reports ${ready?.environment ?? 'nothing'}.`,
    );
    if (expectCommit)
      add(
        'build_commit',
        ready?.build_commit === expectCommit,
        `Expected ${expectCommit}; target reports ${ready?.build_commit ?? 'none'}.`,
      );
    if (ready?.mode === 'hosted') {
      const p = ready.public_origins;
      add(
        'declared_target',
        p !== null && new URL(p.api).origin === base.origin,
        `The target must be the deployment's own public API origin (${p?.api ?? 'unknown'}).`,
      );
      add(
        'preview_separate',
        p !== null &&
          new URL(p.preview).hostname !== new URL(p.web).hostname &&
          new URL(p.preview).hostname !== base.hostname,
        'Previews must be served from their own host.',
      );
    }
    try {
      const { r } = await get('/api/ops/status');
      add(
        'ops_protected',
        r.status === 401,
        `Unauthenticated operations status returned HTTP ${r.status}.`,
      );
    } catch (e) {
      add('ops_protected', false, (e as Error).message);
    }
    add(
      'verification',
      true,
      `Recorded verification for this exact build: ${ready?.verification ?? 'unknown'}.`,
      false,
    );
  }
  return SmokeReportSchema.parse({
    format: 'creator-smoke/1',
    target: base.origin === 'null' ? target.slice(0, 300) : base.origin,
    declared_environment: declared,
    environment: ready?.environment ?? null,
    build_commit: ready?.build_commit ?? null,
    config_hash: ready?.config_hash ?? null,
    started_at: started,
    finished_at: new Date().toISOString(),
    passed: checks.every((c) => c.ok || !c.required),
    checks,
  });
}
