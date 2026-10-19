import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import {
  ContractError,
  OpsStatusSchema,
  ReadinessSchema,
  UncertainActionSchema,
  VerificationRequestSchema,
  parse,
  type Readiness,
  type SessionInfo,
} from '@creator/contracts';
import {
  AlertRulesSchema,
  canonicalHash,
  evaluateAlerts,
  liveConfirmation,
  type DeploymentConfig,
} from '@creator/domain';
import {
  flatMetrics,
  prometheusText,
  type DeploymentVerification,
  type OpsStore,
} from '@creator/db';

const ALERT_RULES = parse(
  AlertRulesSchema,
  JSON.parse(
    readFileSync(
      new URL('../../../config/operations/alerts.json', import.meta.url),
      'utf8',
    ),
  ) as unknown,
  'INVALID_CONFIG',
);
const digest = (v: string) => createHash('sha256').update(v).digest();

type Check = { name: string; ok: boolean; detail: string };

/**
 * X06 readiness, operations status, metrics and verification recording. Readiness is
 * public and terse; everything else needs the owner session, or for status and metrics
 * alone the scrape token (read-only, never a session).
 */
export function createOps(o: {
  deployment: DeploymentConfig;
  configHash: string;
  ops: OpsStore | null;
  productsRoot: string;
  ensureReady: () => Promise<void>;
  workerMode: 'on' | 'off';
  schemaVersion: () => number | null;
  requireSession: (
    req: IncomingMessage,
    mutating: boolean,
  ) => Promise<SessionInfo>;
}) {
  const d = o.deployment;
  function verificationState(
    v: DeploymentVerification | null,
    schema: number | null,
  ): Readiness['verification'] {
    if (!v) return 'unverified';
    if (
      v.build_commit !== d.build_commit ||
      v.config_hash !== o.configHash ||
      v.schema_version !== schema
    )
      return 'stale';
    return v.result === 'passed' ? 'verified' : 'failed';
  }

  async function probeProducts(): Promise<Check> {
    const probe = join(
      o.productsRoot,
      `.ready-${randomBytes(6).toString('hex')}`,
    );
    try {
      await mkdir(o.productsRoot, { recursive: true });
      await writeFile(probe, 'ok', { flag: 'wx' });
      await rm(probe);
      return { name: 'artifact_storage', ok: true, detail: 'Writable.' };
    } catch (e) {
      return {
        name: 'artifact_storage',
        ok: false,
        detail: `Product store not writable: ${(e as NodeJS.ErrnoException).code ?? 'error'}`,
      };
    }
  }

  async function evaluate() {
    const checks: Check[] = [];
    let latest: DeploymentVerification | null = null;
    if (!o.ops)
      checks.push({
        name: 'database',
        ok: d.mode === 'local',
        detail:
          d.mode === 'local'
            ? 'No database configured (stateless local fixture mode).'
            : 'Hosted deployment needs CREATOR_DATABASE_URL.',
      });
    else {
      try {
        // Includes the schema check and the environment-identity claim.
        await o.ensureReady();
        checks.push({
          name: 'database',
          ok: true,
          detail: `Schema ${o.schemaVersion()}; database labelled ${d.environment}.`,
        });
        latest = await o.ops.latestVerification(d.environment);
      } catch (e) {
        checks.push({
          name: 'database',
          ok: false,
          detail: e instanceof ContractError ? e.message : 'Unavailable.',
        });
      }
    }
    checks.push(await probeProducts());
    checks.push({
      name: 'workflow_worker',
      ok: true,
      detail:
        o.workerMode === 'on'
          ? 'In-process workflow worker enabled.'
          : 'CREATOR_WORKER=off: a separate pnpm worker must run.',
    });
    const schema = o.schemaVersion();
    const readiness = parse(ReadinessSchema, {
      ready: checks.every((c) => c.ok),
      mode: d.mode,
      environment: d.environment,
      build_commit: d.build_commit,
      config_hash: o.configHash,
      schema_version: schema,
      verification: verificationState(latest, schema),
      checks: checks.map(({ name, ok }) => ({ name, ok })),
      public_origins:
        d.mode === 'hosted'
          ? { web: d.web_origin, api: d.api_origin, preview: d.preview_origin }
          : null,
    });
    return { readiness, checks, latest };
  }

  function scrapeToken(req: IncomingMessage): boolean {
    const auth = req.headers.authorization;
    if (!d.metrics_token || typeof auth !== 'string') return false;
    const m = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(auth);
    return (
      m !== null && timingSafeEqual(digest(m[1]!), digest(d.metrics_token))
    );
  }
  function needStore(): OpsStore {
    if (!o.ops)
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        'Operations status needs PostgreSQL; set CREATOR_DATABASE_URL.',
      );
    return o.ops;
  }

  async function status() {
    const ops = needStore();
    const { readiness, checks, latest } = await evaluate();
    await o.ensureReady();
    const metrics = await ops.metrics();
    return parse(OpsStatusSchema, {
      readiness,
      checks,
      identity: await ops.identity(),
      latest_verification: latest,
      metrics,
      alerts: evaluateAlerts(ALERT_RULES, flatMetrics(metrics)),
      alert_delivery: ALERT_RULES.delivery,
    });
  }

  /** Handles /api/ready and /api/ops/*; returns null for other paths. */
  async function route(
    req: IncomingMessage,
    url: URL,
    body: () => Promise<unknown>,
  ): Promise<{
    status: number;
    value: unknown;
    text?: string;
  } | null> {
    const method = req.method ?? 'GET';
    if (url.pathname === '/api/ready' && method === 'GET') {
      const { readiness } = await evaluate();
      return { status: readiness.ready ? 200 : 503, value: readiness };
    }
    if (!url.pathname.startsWith('/api/ops/')) return null;
    const path = url.pathname.slice('/api/ops/'.length);
    if (method === 'GET' && (path === 'status' || path === 'metrics')) {
      if (!scrapeToken(req)) await o.requireSession(req, false);
      if (path === 'status') return { status: 200, value: await status() };
      await o.ensureReady();
      const flat = flatMetrics(await needStore().metrics());
      return {
        status: 200,
        value: null,
        text: prometheusText(flat, { environment: d.environment }),
      };
    }
    if (method === 'GET' && path === 'uncertain') {
      await o.requireSession(req, false);
      await o.ensureReady();
      const rows = await needStore().uncertainActions();
      return {
        status: 200,
        value: rows.map((r) => parse(UncertainActionSchema, r)),
      };
    }
    if (method === 'POST' && path === 'verifications') {
      const session = await o.requireSession(req, true);
      const ops = needStore();
      const input = parse(VerificationRequestSchema, await body());
      const report = input.smoke_report;
      if (!d.build_commit)
        throw new ContractError(
          'INVALID_CONFIG',
          'Set CREATOR_BUILD_COMMIT to the deployed commit before recording a verification.',
        );
      const mismatch = [
        report.environment !== d.environment && 'environment',
        report.declared_environment !== d.environment && 'declared environment',
        report.build_commit !== d.build_commit && 'build commit',
        report.config_hash !== o.configHash && 'configuration hash',
        d.mode === 'hosted' && report.target !== d.api_origin && 'target',
      ].filter(Boolean);
      if (mismatch.length)
        throw new ContractError(
          'EVIDENCE_MISMATCH',
          `The smoke report checked a different deployment (${mismatch.join(', ')}).`,
        );
      const { readiness, checks } = await evaluate();
      const passed = report.passed && readiness.ready;
      let confirmation: string | null = null;
      if (d.environment === 'live' && passed) {
        // Typed confirmation of the exact build: the owner's concrete decision for live.
        const want = liveConfirmation(d.build_commit, o.configHash);
        if (input.confirmation !== want)
          throw new ContractError(
            'SCOPE_EXCEEDED',
            'Recording a live verification needs the typed confirmation "verify live <first 12 of commit> <first 12 of config hash>".',
          );
        confirmation = want;
      }
      const recorded = await ops.recordVerification(
        { actorId: session.actor_id },
        {
          environment: d.environment,
          build_commit: d.build_commit,
          config_hash: o.configHash,
          schema_version: readiness.schema_version ?? 0,
          result: passed ? 'passed' : 'failed',
          checks: { smoke: report.checks, server: checks },
          smoke_report_sha256: canonicalHash(report),
          confirmation,
        },
      );
      return { status: 201, value: recorded };
    }
    throw new ContractError('NOT_FOUND', 'Route not found.');
  }
  return { route, evaluate };
}
