import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';
import { parse } from '@creator/contracts';
import {
  authConfig,
  deploymentConfig,
  deploymentConfigHash,
  DeploymentEnvironmentSchema,
  resolveSecretFiles,
  RetentionSchema,
  SECRET_NAMES,
  serviceConfig,
  smokeCheck,
} from '@creator/domain';
import { databaseUrl } from './config.js';
import { assertSchemaCurrent } from './migrate.js';
import { OPERATIONS_ACTOR_ID, OpsStore } from './ops-store.js';
import { TesterStore, type TesterRole } from './tester-store.js';

const USAGE = `Usage:
  pnpm ops config-check                       (validates this environment's configuration; no network)
  pnpm ops smoke <origin> --environment <env> [--commit <sha>] [--out <file>]
  pnpm ops status                             (metrics and uncertain-action counts from the database)
  pnpm ops uncertain                          (every action whose outcome is unknown, with its runbook)
  pnpm ops cleanup [--apply]                  (expired sign-in material past retention; dry run by default)
  pnpm ops claim-environment <env> [--relabel-from <env>]
  pnpm ops tester-add --subject <sub> --name <name> --expires <iso time> [--role editor|viewer] [--issuer <url>]
                                              (allow-lists one OIDC identity and seeds its synthetic sample workspace)
  pnpm ops tester-list
  pnpm ops tester-extend <actor id> --expires <iso time> [--restore]
                                              (moves the expiry; --restore re-enables a removed account with a fresh sample)
  pnpm ops tester-reset <actor id>            (retires the tester's workspace and seeds a fresh sample)
  pnpm ops tester-remove <actor id> --reason <text>  (disables the account and ends its sessions; keeps records)
Environments: local, test, staging, live. NAME_FILE variables load secrets from files.`;

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** ADR-0075: tester accounts, run as the operations actor on the same pool. */
const withTesters = <T>(
  env: Record<string, string | undefined>,
  fn: (testers: TesterStore) => Promise<T>,
) => withStore(env, (_ops, pool) => fn(new TesterStore(pool)));

async function withStore<T>(
  env: Record<string, string | undefined>,
  fn: (ops: OpsStore, pool: pg.Pool) => Promise<T>,
): Promise<T> {
  const mode = env.CREATOR_DEPLOYMENT_MODE === 'hosted' ? 'hosted' : 'local';
  const url = databaseUrl(env.CREATOR_DATABASE_URL, mode);
  if (!url)
    throw new Error('Set CREATOR_DATABASE_URL (or CREATOR_DATABASE_URL_FILE).');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  pool.on('error', () => undefined);
  try {
    await assertSchemaCurrent(pool);
    const ops = new OpsStore(pool);
    await ops.ensureOperationsActor();
    return await fn(ops, pool);
  } finally {
    await pool.end();
  }
}

try {
  const [command, ...args] = process.argv.slice(2);
  const { env, from_files } = resolveSecretFiles(process.env, (p) =>
    readFileSync(p, 'utf8'),
  );
  const ctx = { actorId: OPERATIONS_ACTOR_ID };
  let out: unknown;
  if (command === 'config-check') {
    const deployment = deploymentConfig(env);
    const auth = authConfig(env);
    const service = serviceConfig(env);
    const db = databaseUrl(env.CREATOR_DATABASE_URL, deployment.mode);
    const warnings: string[] = [];
    if (deployment.mode === 'hosted') {
      if (auth.oidc?.web_origin !== deployment.web_origin)
        warnings.push(
          'CREATOR_WEB_ORIGIN must equal CREATOR_PUBLIC_WEB_ORIGIN; the API will refuse to start.',
        );
      for (const name of SECRET_NAMES)
        if (env[name] && !from_files.includes(name))
          warnings.push(
            `${name} is set directly in the environment; prefer ${name}_FILE.`,
          );
    }
    out = {
      ok: warnings.length === 0,
      mode: deployment.mode,
      environment: deployment.environment,
      build_commit: deployment.build_commit,
      config_hash: deploymentConfigHash(deployment, env),
      listen: `${service.host}:${service.api_port} (previews :${service.preview_port})`,
      public_origins:
        deployment.mode === 'hosted'
          ? {
              web: deployment.web_origin,
              api: deployment.api_origin,
              preview: deployment.preview_origin,
            }
          : null,
      auth: auth.mode,
      database: db ? `configured (${new URL(db).host})` : 'not configured',
      products_root: deployment.products_root,
      secrets_from_files: from_files,
      warnings,
    };
  } else if (command === 'smoke' && args[0]) {
    const environment = parse(
      DeploymentEnvironmentSchema,
      flag(args, '--environment'),
      'INVALID_CONFIG',
    );
    const report = await smokeCheck(
      args[0],
      environment,
      fetch,
      flag(args, '--commit'),
    );
    const file = flag(args, '--out');
    if (file)
      await writeFile(file, JSON.stringify(report, null, 2) + '\n', {
        flag: 'wx',
      });
    out = report;
  } else if (command === 'status')
    out = await withStore(env, async (ops) => ({
      identity: await ops.identity(),
      metrics: await ops.metrics(),
    }));
  else if (command === 'uncertain')
    out = await withStore(env, (ops) => ops.uncertainActions());
  else if (command === 'cleanup') {
    const retention = parse(
      RetentionSchema,
      JSON.parse(
        readFileSync(
          new URL('../../../config/operations/retention.json', import.meta.url),
          'utf8',
        ),
      ) as unknown,
      'INVALID_CONFIG',
    );
    out = await withStore(env, (ops) =>
      ops.cleanup(ctx, retention, args.includes('--apply')),
    );
  } else if (command === 'claim-environment' && args[0]) {
    const to = parse(DeploymentEnvironmentSchema, args[0], 'INVALID_CONFIG');
    const from = flag(args, '--relabel-from');
    out = await withStore(env, (ops) =>
      from
        ? ops.relabelEnvironment(
            ctx,
            parse(DeploymentEnvironmentSchema, from, 'INVALID_CONFIG'),
            to,
          )
        : ops.claimEnvironment(ctx, to),
    );
  } else if (command === 'tester-add') {
    const issuer = flag(args, '--issuer') ?? env.CREATOR_OIDC_ISSUER;
    if (!issuer)
      throw new Error('Give --issuer or set CREATOR_OIDC_ISSUER.\n' + USAGE);
    out = await withTesters(env, (t) =>
      t.addTester(ctx, {
        issuer,
        subject: flag(args, '--subject') ?? '',
        display_name: flag(args, '--name') ?? '',
        expires_at: flag(args, '--expires') ?? '',
        workspace_role: (flag(args, '--role') ?? 'editor') as TesterRole,
        owner_subject: env.CREATOR_OIDC_OWNER_SUBJECT ?? null,
      }),
    );
  } else if (command === 'tester-list')
    out = await withTesters(env, (t) => t.listTesters());
  else if (command === 'tester-extend' && args[0])
    out = await withTesters(env, (t) =>
      t.extendTester(
        ctx,
        args[0]!,
        flag(args, '--expires') ?? '',
        args.includes('--restore'),
      ),
    );
  else if (command === 'tester-reset' && args[0])
    out = await withTesters(env, (t) => t.resetTester(ctx, args[0]!));
  else if (command === 'tester-remove' && args[0])
    out = await withTesters(env, (t) =>
      t.removeTester(ctx, args[0]!, flag(args, '--reason') ?? ''),
    );
  else throw new Error(USAGE);
  console.log(JSON.stringify(out, null, 2));
  if (
    out &&
    typeof out === 'object' &&
    (('ok' in out && out.ok === false) ||
      ('passed' in out && out.passed === false))
  )
    process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operation failed.');
  const details = (error as { details?: unknown }).details;
  if (Array.isArray(details)) for (const d of details) console.error(`  ${d}`);
  process.exitCode = 1;
}
