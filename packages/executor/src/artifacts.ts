import { mkdir, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BuildManifestSchema,
  BrokerCallResultSchema,
  ContractError,
  type BuildManifest,
  type RunInput,
} from '@creator/contracts';
import {
  checked,
  digest,
  hash,
  id,
  isBrowserCase,
  type Execution,
  type QaCase,
} from './contracts.js';
import { ProductSupervisor, inputHash, templateOf } from './products.js';
import { ExecutionSupervisor } from './execution.js';
import {
  BuildSupervisor,
  browserResult,
  planRoleResultSchema,
  type BuildPlan,
  type BuildPorts,
} from './build.js';
import { canonical, jsonWrite, readJson, event } from './files.js';
import { readTar, writeTar, type PackageFile } from './tar.js';

export const REVIEWED_BACKEND = 'wsl2-bwrap-systemd';
const mismatch = (m: string) => new ContractError('EVIDENCE_MISMATCH', m);
/** A case passes only on the exact output and exit status, with no supervisor-side reason. */
export function casePassed(e: Execution, c: QaCase): boolean {
  if (!['succeeded', 'failed'].includes(e.state) || e.reason !== null)
    return false;
  if (!isBrowserCase(c))
    return e.exit_code === c.exit_code && e.log === c.stdout;
  // ADR-0078: every frozen step passed in the reviewed checker, with no page error or request
  // outside the site.
  const r = browserResult(e.log);
  return (
    e.recipe === 'static-web/1' &&
    e.exit_code === 0 &&
    r !== null &&
    r.passed &&
    r.steps.length === c.steps.length &&
    r.steps.every((x, i) => x.passed && x.index === i) &&
    !r.page_errors.length &&
    !r.outbound.length
  );
}

/**
 * Packages a verified task candidate, then re-extracts the exported archive into a clean
 * sandbox and runs every acceptance case against it. Package files and the manifest are
 * immutable; every later read re-hashes them.
 */
export class ArtifactSupervisor {
  constructor(
    readonly products: ProductSupervisor,
    readonly executor: ExecutionSupervisor,
  ) {}
  dir(productId: string, artifactId: string): string {
    return join(
      this.products.dir(productId),
      'artifacts',
      checked(id, artifactId),
    );
  }
  async package(
    productId: string,
    buildId: string,
    ports: BuildPorts,
    lineage: BuildManifest['lineage'] = { previous: null, feedback_ids: [] },
    onStarted: (artifactId: string) => void = () => {},
  ): Promise<{ manifest: BuildManifest; manifest_sha256: string }> {
    const builds = new BuildSupervisor(this.products, this.executor);
    // Re-checks the current frozen spec, active run, exact commit and clean worktree.
    const outcome = await builds.status(productId, buildId, ports);
    if (outcome.state !== 'verified_candidate')
      throw new ContractError(
        'INVALID_TRANSITION',
        'Only a verified task candidate can be packaged.',
      );
    const p = await this.products.product(productId);
    const task = await this.products.task(productId, outcome.task_id);
    const buildDir = join(this.products.dir(productId), 'builds', buildId);
    const intent = (await readJson(join(buildDir, 'intent.json'))) as {
      plan: BuildPlan;
      prompt_hash: string;
    };
    const buildQa: BuildManifest['tests']['build_qa'] = [];
    let qaExecution: Execution | null = null;
    for (const [i, c] of intent.plan.cases.entries()) {
      const qa = (await readJson(
        join(buildDir, `qa-${outcome.repairs}-${i}.json`),
      )) as { execution: Execution; passed: boolean };
      if (!qa.passed || qa.execution.commit !== outcome.commit)
        throw mismatch('Build QA does not cover this exact candidate.');
      qaExecution ??= qa.execution;
      buildQa.push({
        check_key: c.check_key,
        execution_id: qa.execution.id,
        state: qa.execution.state,
        input_hash: qa.execution.input_hash,
        passed: true,
        reason: null,
      });
    }
    let settled = 0n,
      unsettled = 0;
    const planRequests: string[] = [];
    for (let n = 1; n <= outcome.calls; n++) {
      const raw = await readJson(join(buildDir, `call-${n}-outcome.json`));
      if (intent.plan.plan_roles) {
        // Plan requests settle no dollars; record which ones the candidate rests on instead.
        const call = checked(planRoleResultSchema, raw);
        planRequests.push(call.request_id);
        continue;
      }
      const call = checked(BrokerCallResultSchema, raw);
      for (const a of call.attempts)
        if (a.status === 'settled' && a.incurred !== null)
          settled += BigInt(a.incurred);
        else unsettled++;
    }
    const files = await this.products.committedFiles(
      productId,
      task.id,
      outcome.commit,
    );
    const archive = writeTar(files);
    const artifactId = randomUUID();
    const dir = this.dir(productId, artifactId);
    await canonical(join(this.products.dir(productId), 'artifacts'), true);
    await mkdir(join(this.products.dir(productId), 'artifacts'), {
      recursive: true,
    });
    await mkdir(dir);
    const f = await open(join(dir, 'source.tar'), 'wx', 0o600);
    try {
      await f.writeFile(archive);
      await f.sync();
    } finally {
      await f.close();
    }
    const archiveSha = digest(archive);
    await jsonWrite(join(dir, 'package-intent.json'), {
      artifact_id: artifactId,
      build_id: buildId,
      commit: outcome.commit,
      archive_sha256: archiveSha,
      at: new Date().toISOString(),
    });
    await event(this.products.dir(productId), 'artifact.package.intent', {
      artifact_id: artifactId,
      build_id: buildId,
      archive_sha256: archiveSha,
    });
    onStarted(artifactId);
    // Read the bytes back from disk: the exported file, not the in-memory buffer, is tested.
    const exported = await readFile(join(dir, 'source.tar'));
    if (digest(exported) !== archiveSha)
      throw mismatch('Exported archive changed after it was written.');
    const extracted = readTar(exported);
    const packageChecks: BuildManifest['tests']['package'] = [];
    let blocked = false;
    for (const c of intent.plan.cases) {
      const e = await this.executor.runPackage(
        productId,
        task.id,
        outcome.commit,
        extracted,
        p.binding.owner_id,
        archiveSha,
        () => {},
        c,
      );
      blocked ||= ['blocked', 'cleanup_required', 'lost'].includes(e.state);
      packageChecks.push({
        check_key: c.check_key,
        execution_id: e.id,
        state: e.state,
        input_hash: e.input_hash,
        passed: casePassed(e, c) && e.input_hash === qaExecution!.input_hash,
        reason: e.reason,
      });
      if (blocked) break;
    }
    const state: BuildManifest['state'] = blocked
      ? 'blocked'
      : packageChecks.length === intent.plan.cases.length &&
          packageChecks.every((c) => c.passed)
        ? 'verified'
        : 'failed';
    const env = qaExecution!.environment;
    const backend = String(env.backend ?? 'unknown');
    const recipe = p.recipe ?? 'python-build/1';
    const web = recipe === 'static-web/1';
    const template = templateOf(p.recipe);
    const browser =
      env.browser && typeof env.browser === 'object'
        ? String((env.browser as { version?: unknown }).version ?? '')
        : '';
    const manifest: BuildManifest = {
      format: 'build-manifest/1',
      id: artifactId,
      created_at: new Date().toISOString(),
      state,
      workspace_id: p.binding.workspace_id,
      product_id: productId,
      owner_id: p.binding.owner_id,
      spec: {
        id: p.binding.spec_id,
        version: p.binding.spec_version,
        hash: p.binding.spec_hash,
        freeze_id: p.binding.freeze_id,
      },
      task: { id: task.id, key: task.key, hash: task.spec_task_hash },
      build: {
        id: buildId,
        plan_hash: outcome.plan_hash,
        prompt_hash: intent.prompt_hash,
        calls: outcome.calls,
        repairs: outcome.repairs,
        fixture_roles: outcome.fixture,
      },
      repository: {
        commit: outcome.commit,
        base_commit: task.base_commit,
        initial_commit: p.initial_commit,
        git_version: p.git_version,
      },
      template: { id: template.id, hash: template.hash },
      toolchain: {
        recipe,
        recipe_hash: qaExecution!.recipe_hash,
        policy_hash: qaExecution!.policy_hash,
        bridge_hash: checked(hash, env.bridge_hash),
        backend,
        python: typeof env.python === 'string' ? env.python : null,
        ...(web
          ? {
              browser: browser
                ? `chrome-headless-shell ${browser}`.slice(0, 80)
                : null,
            }
          : {}),
        supervisor_node: process.version,
      },
      dependencies: web
        ? {
            kind: 'static-files-only',
            lockfile: null,
            note: 'Reviewed template is plain HTML, CSS and JavaScript served as files; there are no packages to lock or install and no build step.',
          }
        : {
            kind: 'python-stdlib-only',
            lockfile: null,
            note: 'Reviewed template uses only the Python standard library; there is nothing to lock or install.',
          },
      package: {
        kind: 'source_archive',
        file: 'source.tar',
        media_type: 'application/x-tar',
        sha256: archiveSha,
        bytes: archive.length,
        input_hash: inputHash(extracted),
        files: files.map((x) => ({
          path: x.path,
          sha256: digest(x.content),
          bytes: x.content.length,
        })),
      },
      availability: {
        source_archive: {
          state: 'available',
          reason: 'Exact committed source as a deterministic tar archive.',
        },
        runnable_demo:
          state === 'verified'
            ? {
                state: 'available',
                reason: web
                  ? 'Private preview serves this exact package on its own preview host.'
                  : 'Private preview runs this exact package in the isolated worker.',
              }
            : {
                state: 'unavailable',
                reason: `The re-extracted package was not verified (${state}).`,
              },
        native_installer: {
          state: 'unavailable',
          reason: web
            ? 'No native installer recipe exists for static web pages.'
            : 'No native installer recipe exists for the Python CLI template.',
        },
      },
      startup: web
        ? {
            runtime:
              'Any static file server; for example Python 3 http.server, then open http://127.0.0.1:8000/',
            command: [
              'python3',
              '-m',
              'http.server',
              '8000',
              '--bind',
              '127.0.0.1',
              '--directory',
              'site',
            ],
            network: 'none',
            requirements: [
              'A current web browser',
              'A static file server (Python 3 has one built in)',
              'No packages, build step or network',
            ],
            readiness_case: intent.plan.cases[0]!.check_key,
          }
        : {
            runtime: 'Python 3 standard library (python3 -I)',
            command: ['python3', '-I', 'src/main.py'],
            network: 'none',
            requirements: [
              'Python 3 interpreter',
              'No packages, network or persistent files',
            ],
            readiness_case: intent.plan.cases[0]!.check_key,
          },
      tests: {
        cases: intent.plan.cases.map((c) =>
          isBrowserCase(c)
            ? { check_key: c.check_key, page: c.page, steps: c.steps }
            : {
                check_key: c.check_key,
                args: c.args,
                stdin: c.stdin,
                stdout: c.stdout,
                exit_code: c.exit_code,
              },
        ),
        build_qa: buildQa,
        package: packageChecks,
      },
      costs: {
        broker_calls: intent.plan.plan_roles ? 0 : outcome.calls,
        settled_nano_usd: settled.toString(),
        unsettled_attempts: unsettled,
        local_compute: 'not_metered_by_studio',
        ...(intent.plan.plan_roles
          ? {
              plan_requests: {
                ...intent.plan.plan_roles,
                request_ids: planRequests,
              },
            }
          : {}),
      },
      lineage,
      limitations: [
        ...(web
          ? [
              'Verifies one task commit and its owner-authored browser cases in one pinned headless browser (Chrome 156), not other browsers, screen sizes, accessibility, the whole product or real user needs.',
              'Static HTML, CSS and JavaScript only: no packages, build step, server code, network or storage kept between visits.',
              'No native installer; the private preview serves the files on its own preview host.',
            ]
          : [
              'Verifies one task commit and its owner-authored exact stdout/exit cases, not a merge, the whole product or real user needs.',
              'Python standard-library CLI only: no web UI, persistence or dependency recipe.',
              'No native installer; the runnable demo exists only as a private preview in the isolated worker.',
            ]),
        'Local compute is bounded but not monetarily metered by the studio.',
        ...(intent.plan.plan_roles
          ? [
              'Builder and reviewer ran as ChatGPT-plan requests: no dollars are settled, but they use the plan quota.',
            ]
          : []),
        ...(outcome.fixture
          ? [
              'Builder and reviewer were fixed synthetic fixture roles, not model reasoning.',
            ]
          : []),
        ...(backend !== REVIEWED_BACKEND
          ? [
              `Executed on "${backend}", not the reviewed isolation backend; this is not isolation evidence.`,
            ]
          : []),
        ...(state !== 'verified'
          ? [
              `Exported package ${state}: ${packageChecks.find((c) => !c.passed)?.reason ?? 'a case did not match'}`.slice(
                0,
                2000,
              ),
            ]
          : []),
      ],
    };
    checked(BuildManifestSchema, manifest);
    await jsonWrite(join(dir, 'manifest.json'), manifest);
    await event(this.products.dir(productId), 'artifact.package.outcome', {
      artifact_id: artifactId,
      state,
    });
    return this.manifest(productId, artifactId);
  }
  /** Reads the manifest and checks it against an expected hash when one is given. */
  async manifest(
    productId: string,
    artifactId: string,
    expected?: string,
  ): Promise<{ manifest: BuildManifest; manifest_sha256: string }> {
    const path = join(this.dir(productId, artifactId), 'manifest.json');
    let raw: Buffer;
    try {
      await canonical(path);
      raw = await readFile(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ContractError(
          'NOT_FOUND',
          'No local package for this artifact.',
        );
      throw e;
    }
    const sha = digest(raw);
    if (expected !== undefined && sha !== expected)
      throw mismatch('Manifest hash mismatch; the stored manifest changed.');
    const manifest = checked(BuildManifestSchema, JSON.parse(raw.toString()));
    if (manifest.id !== artifactId || manifest.product_id !== productId)
      throw mismatch('Manifest identity mismatch.');
    return { manifest, manifest_sha256: sha };
  }
  /** Exact package bytes, refused unless both the manifest and the archive still match. */
  async exportManifest(
    productId: string,
    artifactId: string,
    expected: string,
  ): Promise<Buffer> {
    await this.manifest(productId, artifactId, expected);
    const path = join(this.dir(productId, artifactId), 'manifest.json');
    await canonical(path);
    const bytes = await readFile(path);
    if (digest(bytes) !== expected)
      throw mismatch('Manifest changed during export.');
    return bytes;
  }

  async open(
    productId: string,
    artifactId: string,
    expectedManifest: string,
  ): Promise<{
    manifest: BuildManifest;
    archive: Buffer;
    files: PackageFile[];
  }> {
    const { manifest } = await this.manifest(
      productId,
      artifactId,
      expectedManifest,
    );
    const path = join(this.dir(productId, artifactId), 'source.tar');
    await canonical(path);
    const archive = await readFile(path);
    if (digest(archive) !== manifest.package.sha256)
      throw mismatch('Package hash mismatch; the archive changed on disk.');
    let files: PackageFile[];
    try {
      files = readTar(archive);
    } catch (e) {
      throw mismatch(`Package archive refused: ${(e as Error).message}`);
    }
    if (inputHash(files) !== manifest.package.input_hash)
      throw mismatch('Package contents do not match the manifest.');
    return { manifest, archive, files };
  }
  /** Starts the exact exported package (never the worktree) with typed argv/stdin. */
  async start(
    productId: string,
    artifactId: string,
    expectedManifest: string,
    owner: string,
    input: RunInput | QaCase,
    onStarted: (executionId: string) => void | Promise<void> = () => {},
  ): Promise<Execution> {
    const { manifest, files } = await this.open(
      productId,
      artifactId,
      expectedManifest,
    );
    if (manifest.availability.runnable_demo.state !== 'available')
      throw new ContractError(
        'INVALID_TRANSITION',
        manifest.availability.runnable_demo.reason,
      );
    return this.executor.runPackage(
      productId,
      manifest.task.id,
      manifest.repository.commit,
      files,
      owner,
      manifest.package.sha256,
      onStarted,
      input,
    );
  }
  /** Readiness = the manifest's readiness case passes again on the exported package. */
  async readiness(
    productId: string,
    artifactId: string,
    expectedManifest: string,
    owner: string,
    onStarted: (executionId: string) => void | Promise<void> = () => {},
  ): Promise<{ ready: boolean; execution: Execution }> {
    const { manifest } = await this.manifest(
      productId,
      artifactId,
      expectedManifest,
    );
    const c = manifest.tests.cases.find(
      (x) => x.check_key === manifest.startup.readiness_case,
    )!;
    const execution = await this.start(
      productId,
      artifactId,
      expectedManifest,
      owner,
      c,
      onStarted,
    );
    return {
      ready:
        casePassed(execution, c) &&
        execution.input_hash === manifest.package.input_hash,
      execution,
    };
  }
}
