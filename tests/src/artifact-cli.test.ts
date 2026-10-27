import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApi } from '@creator/api';
import {
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_FEEDBACK,
  BUILD_FIXTURE_REVISION_CASES,
  BUILD_FIXTURE_REVISION_SPEC,
  BUILD_FIXTURE_SPEC,
  fixtureHumilityReview,
} from '@creator/domain';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
test(
  'compiled owner flow: package, re-extract and start, download, private preview, feedback revision and reverified comparison in the real worker',
  { skip: !real && 'T13 acceptance requires real WSL2 isolation' },
  async (t) => {
    let closeApi = async () => {};
    t.after(() => closeApi());
    const db = await freshDatabase(t);
    if (!db) return;
    const api = createApi({
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    });
    const native = process.env.CREATOR_TEST_NATIVE === '1';
    api.server.listen(native ? 4310 : 0, '127.0.0.1');
    api.preview.listen(0, '127.0.0.1');
    await Promise.all([
      once(api.server, 'listening'),
      once(api.preview, 'listening'),
    ]);
    closeApi = api.close;
    await api.ready();
    const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    const parent = resolve('.verification/t13-cli');
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(join(parent, 'case-'));
    t.after(async () => {
      assert.ok(dir.startsWith(parent));
      await rm(dir, { recursive: true, force: true });
    });
    const env = {
      ...process.env,
      CREATOR_API_URL: origin,
      CREATOR_SESSION_FILE: join(dir, 'session.json'),
    };
    const cli = async (...args: string[]) => {
      try {
        const { stdout } = await promisify(execFile)(
          process.execPath,
          ['apps/cli/dist/main.js', ...args],
          { env, timeout: 240000, windowsHide: true },
        );
        // Long-running commands print a progress line before the result.
        const lines = stdout.trim().split('\n');
        return JSON.parse(
          ['build-task', 'artifact-package'].includes(args[0]!)
            ? lines.slice(1).join('\n')
            : stdout,
        ) as any;
      } catch (e) {
        throw new Error(String((e as { stdout?: string }).stdout ?? e));
      }
    };
    const file = async (name: string, body: unknown) => {
      const path = join(dir, `${name}.json`);
      await writeFile(path, JSON.stringify(body));
      return path;
    };
    await cli('login', LOGIN_CODE);
    const seed = await cli('seed-selection'),
      ws = seed.workspace.id,
      specId = seed.spec.id;
    const freeze = async (version: number) => {
      const body = JSON.stringify({
        spec: { id: specId, version },
        justification: 'Synthetic exact T13 freeze',
        data_class: 'synthetic',
      });
      const requested = await cli('spec-freeze', ws, seed.run, body);
      if (requested.status === 'needs_human') {
        const decision = await cli(
          'decision',
          ws,
          requested.admission.decision_id,
        );
        await cli(
          'answer',
          ws,
          decision.id,
          decision.coverage.coverage_hash,
          'approve_once',
          'Synthetic exact-version freeze',
        );
        assert.equal(
          (await cli('spec-freeze', ws, seed.run, body)).status,
          'frozen',
        );
      }
    };
    const humility = async (version: number) =>
      cli(
        'create',
        ws,
        'humility_review',
        `Synthetic humility review v${version}`,
        JSON.stringify(fixtureHumilityReview({ id: specId, version }, [])),
      );
    const before = await cli('spec', ws, specId);
    const v1 = await cli(
      'spec-revise',
      ws,
      specId,
      JSON.stringify({
        expected_version: before.spec.version,
        title: 'Synthetic bounded checklist',
        content: BUILD_FIXTURE_SPEC,
        reason: 'Synthetic T13 acceptance; no empirical product claim',
      }),
    );
    await freeze(v1.spec.version);
    const review1 = await humility(v1.spec.version);
    await cli(
      'grant-create',
      ws,
      JSON.stringify({
        run_id: seed.run,
        action_types: ['product.commit_build'],
        target_kind: 'specification',
        max_amount_nano_usd: null,
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['synthetic'],
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        rationale: 'Synthetic T13 builds only',
      }),
    );
    const budgets = await cli('budgets', ws),
      pricing = await cli('pricing', ws);
    const plan = (cases: unknown, review: any) => ({
      format: 'build-plan/1',
      run_id: seed.run,
      envelope_id: budgets[0].id,
      pricing_snapshot_id: pricing[0].id,
      humility_review: { id: review.id, version: review.version },
      data_class: 'synthetic',
      max_repairs: 0,
      max_calls: 2,
      timeout_ms: 10000,
      max_output_tokens: 3000,
      deadline: new Date(Date.now() + 600000).toISOString(),
      cases,
    });
    const product = await cli('product-init', ws, specId);
    const task = await cli(
      'product-task',
      product.id,
      'T1',
      product.initial_commit,
    );
    const build = await cli(
      'build-task',
      product.id,
      task.id,
      product.initial_commit,
      await file('plan', plan(BUILD_FIXTURE_CASES, review1)),
    );
    assert.equal(build.state, 'verified_candidate', JSON.stringify(build));

    // Package, re-extract and start every case from the exported archive in the real worker.
    const packaged = await cli('artifact-package', product.id, build.id);
    assert.equal(packaged.state, 'verified', JSON.stringify(packaged));
    assert.ok(packaged.package_checks.every((c: any) => c.passed));
    const a1 = packaged.artifact;
    const detail = await cli('artifact', ws, a1.id);
    assert.equal(detail.integrity.ok, true);
    assert.equal(detail.manifest.toolchain.backend, 'wsl2-bwrap-systemd');
    assert.ok(
      detail.manifest.tests.package.every(
        (c: any, i: number) =>
          c.input_hash === detail.manifest.tests.build_qa[i].input_hash,
      ),
    );
    const out = join(dir, 'download.tar');
    const downloaded = await cli(
      'artifact-download',
      ws,
      a1.id,
      a1.manifest_sha256,
      out,
    );
    assert.equal(sha256(await readFile(out)), detail.manifest.package.sha256);
    assert.equal(downloaded.sha256, detail.manifest.package.sha256);

    if (process.env.CREATOR_TEST_INTERACTIVE === '1') {
      // Fixture server only, never counted as completion of this automated test.
      const finish = join(dir, 'finish-interactive');
      console.log(
        JSON.stringify({
          mode: 'interactive_fixture_only',
          workspace_id: ws,
          artifact_id: a1.id,
          manifest_sha256: a1.manifest_sha256,
          finish_file: finish,
          fixture_login_code: LOGIN_CODE,
        }),
      );
      const until = Date.now() + 1800000;
      while (Date.now() < until) {
        try {
          await readFile(finish);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      t.skip(
        'Interactive fixture only; normal T13/native automated assertions were not run',
      );
      return;
    }

    await t.test(
      'paired worker CLI executes an exact owner job in real WSL; native window closure leaves the worker running',
      async () => {
        const auth = await login(`${origin}/api`);
        const post = async (path: string, body: unknown) => {
          const r = await fetch(`${origin}/api/${path}`, {
            method: 'POST',
            headers: { ...auth.write, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const value = (await r.json()) as any;
          assert.ok(r.ok, JSON.stringify(value));
          return value;
        };
        const wait = async (
          condition: () => boolean | Promise<boolean>,
          timeoutMs: number,
          description: string,
        ) => {
          const until = Date.now() + timeoutMs;
          while (Date.now() < until) {
            if (await condition()) return;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(`Timed out: ${description}`);
        };
        const worker = spawn(
          process.execPath,
          [
            'apps/desktop/worker.mjs',
            'run',
            ws,
            resolve('.creator/products'),
            'X05 WSL acceptance worker',
          ],
          {
            windowsHide: true,
            env: { ...process.env, CREATOR_API_URL: origin },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '';
        let workerError = '';
        worker.stdout.on('data', (b) => {
          output = (output + b.toString()).slice(-12000);
        });
        worker.stderr.on('data', (b) => {
          workerError = (workerError + b.toString()).slice(-4000);
        });
        let web: ReturnType<typeof spawn> | undefined;
        try {
          await wait(
            () => /approve\?id=([a-f0-9-]{36})/.test(output),
            10000,
            'worker pairing challenge',
          );
          const challengeId = output.match(/approve\?id=([a-f0-9-]{36})/)![1];
          await post(`desktop/challenges/${challengeId}/approve`, {});
          await wait(
            () => /Paired device ([a-f0-9-]{36})/.test(output),
            10000,
            'worker identity',
          );
          const deviceId = output.match(/Paired device ([a-f0-9-]{36})/)![1];
          let queuedId: string;
          if (native) {
            web = spawn(
              process.execPath,
              [
                resolve('node_modules/vite/bin/vite.js'),
                'preview',
                '--host',
                '127.0.0.1',
                '--port',
                '5173',
                '--strictPort',
              ],
              { cwd: resolve('apps/web'), windowsHide: true, stdio: 'ignore' },
            );
            await wait(
              async () => {
                try {
                  return (
                    await fetch('http://127.0.0.1:5173/', {
                      signal: AbortSignal.timeout(500),
                    })
                  ).ok;
                } catch {
                  return false;
                }
              },
              10000,
              'native shared UI',
            );
            const probe = await promisify(execFile)(
              resolve(
                'apps/desktop/src-tauri/target/debug/creator-desktop.exe',
              ),
              ['--paired-job-probe'],
              {
                windowsHide: true,
                timeout: 30000,
                env: {
                  ...process.env,
                  CREATOR_NATIVE_PROBE_COOKIE: auth.cookie,
                  CREATOR_NATIVE_PROBE_WORKSPACE: ws,
                  CREATOR_NATIVE_PROBE_ARTIFACT: a1.id,
                  CREATOR_STUDIO_HOME: join(dir, 'native-home'),
                },
              },
            );
            const id = probe.stdout.match(
              /NATIVE_PAIRED_JOB ([a-f0-9-]{36})/,
            )?.[1];
            assert.ok(id, probe.stderr);
            queuedId = id;
          } else {
            queuedId = (
              await post(`desktop/devices/${deviceId}/jobs`, {
                request_id: randomUUID(),
                artifact_id: a1.id,
                manifest_sha256: a1.manifest_sha256,
                input: { args: [], stdin: '' },
              })
            ).id;
          }
          let completed: any;
          await wait(
            async () => {
              const r = await fetch(
                `${origin}/api/desktop/devices/${deviceId}/jobs`,
                { headers: auth.read },
              );
              const jobs = (await r.json()) as any[];
              completed = jobs.find((j) => j.id === queuedId);
              if (worker.exitCode !== null)
                throw new Error(`Worker exited: ${workerError}`);
              return (
                completed?.state === 'completed' ||
                completed?.state === 'reconciling'
              );
            },
            60000,
            'real paired execution',
          );
          assert.equal(completed.state, 'completed', JSON.stringify(completed));
          assert.equal(completed.verification, 'worker_report_only');
          assert.equal(
            completed.report.state,
            'succeeded',
            JSON.stringify(completed.report),
          );
          assert.equal(completed.report.stdout, BUILD_FIXTURE_CASES[0]!.stdout);
          assert.equal(
            completed.report.archive_sha256,
            detail.manifest.package.sha256,
          );
          const execution = await api.artifacts.executor.status(
            product.id,
            completed.execution_id,
          );
          assert.equal(execution.environment.backend, 'wsl2-bwrap-systemd');
          assert.match(String(execution.environment.kernel), /microsoft/i);
          assert.ok(execution.environment.effective_limits);
          assert.equal(execution.environment.cleanup, 'inactive');
          assert.equal(execution.state, 'succeeded');
          assert.equal(worker.exitCode, null); // Native probe has exited; separate worker stays alive.
          const stopped = once(worker, 'close');
          await post(`desktop/devices/${deviceId}/control`, {
            state: 'shutdown',
          });
          const [code] = await Promise.race([
            stopped,
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Worker shutdown was not observed')),
                15000,
              ),
            ),
          ]);
          assert.equal(code, 0, workerError);
        } finally {
          web?.kill();
          if (worker.exitCode === null) worker.kill();
        }
      },
    );

    // Private preview: readiness is a real run of the exported package; then a real interactive run.
    const started = await cli(
      'preview-start',
      ws,
      a1.id,
      a1.manifest_sha256,
      '5',
      '3',
    );
    assert.equal(started.preview.state, 'ready', JSON.stringify(started));
    const opened = await fetch(started.url, { redirect: 'manual' });
    const cookie = opened.headers.get('set-cookie')!.split(';')[0]!;
    const previewBase = new URL(started.url).origin;
    const run = (id: string, c: string, args: string[]) =>
      fetch(`${previewBase}/preview/${id}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: c,
          Origin: previewBase,
        },
        body: JSON.stringify({ args, stdin: '' }),
      });
    const ran = (await (
      await run(started.preview.id, cookie, [])
    ).json()) as any;
    assert.equal(ran.state, 'succeeded', JSON.stringify(ran));
    assert.equal(ran.stdout, BUILD_FIXTURE_CASES[0]!.stdout);
    const invalid = (await (
      await run(started.preview.id, cookie, ['--plain'])
    ).json()) as any;
    assert.equal(invalid.exit_code, 2);
    await cli(
      'preview-stop',
      ws,
      started.preview.id,
      String(started.preview.version),
      'Synthetic revoke',
      '--revoke',
    );
    assert.equal((await run(started.preview.id, cookie, [])).status, 403);
    const second = await cli(
      'preview-start',
      ws,
      a1.id,
      a1.manifest_sha256,
      '5',
      '3',
    );
    const cookie2 = (await fetch(second.url, { redirect: 'manual' })).headers
      .get('set-cookie')!
      .split(';')[0]!;
    await db.pool.query(
      `update artifact_previews set expires_at = now() - interval '1 second' where id = $1`,
      [second.preview.id],
    );
    assert.equal((await run(second.preview.id, cookie2, [])).status, 410);

    // Hash mismatch on the stored archive.
    const archivePath = resolve(
      '.creator/products',
      product.id,
      'artifacts',
      a1.id,
      'source.tar',
    );
    const original = await readFile(archivePath);
    await writeFile(archivePath, Buffer.concat([original, Buffer.from('x')]));
    await assert.rejects(
      cli(
        'artifact-download',
        ws,
        a1.id,
        a1.manifest_sha256,
        join(dir, 'bad.tar'),
      ),
      /400/,
    );
    await writeFile(archivePath, original);

    // Feedback on the exact version → accepted → spec revision → freeze → rebuild from the package.
    const fb = await cli(
      'feedback-submit',
      ws,
      a1.id,
      a1.manifest_sha256,
      'change_request',
      BUILD_FIXTURE_FEEDBACK,
    );
    const accepted = await cli(
      'feedback-decide',
      ws,
      fb.id,
      String(fb.version),
      'accept',
      'Synthetic owner acceptance',
    );
    const revised = await cli(
      'feedback-revise',
      ws,
      fb.id,
      await file('revision', {
        expected_version: accepted.version,
        expected_spec_version: v1.spec.version,
        title: 'Synthetic checklist with plain list',
        content: BUILD_FIXTURE_REVISION_SPEC,
        reason: 'Accepted synthetic feedback',
      }),
    );
    assert.equal(revised.status, 'revised');
    await freeze(revised.revision.version);
    const review2 = await humility(revised.revision.version);
    const product2 = await cli('product-init', ws, specId, '--from', a1.id);
    assert.equal(product2.base.artifact_id, a1.id);
    const task2 = await cli(
      'product-task',
      product2.id,
      'T1',
      product2.initial_commit,
    );
    const build2 = await cli(
      'build-task',
      product2.id,
      task2.id,
      product2.initial_commit,
      await file('plan2', plan(BUILD_FIXTURE_REVISION_CASES, review2)),
    );
    assert.equal(build2.state, 'verified_candidate', JSON.stringify(build2));
    const packaged2 = await cli(
      'artifact-package',
      product2.id,
      build2.id,
      '--previous',
      a1.id,
      '--feedback',
      fb.id,
    );
    assert.equal(packaged2.state, 'verified', JSON.stringify(packaged2));
    const cmp = await cli('artifact-compare', ws, a1.id, packaged2.artifact.id);
    assert.equal(cmp.linked, true);
    assert.deepEqual(
      cmp.tests.find((x: any) => x.check_key === 'A3'),
      {
        check_key: 'A3',
        base: null,
        candidate: true,
      },
    );
    assert.equal(BigInt(cmp.costs.candidate_nano_usd) >= 0n, true);
    // Stale: late feedback on the superseded version cannot revise the spec again.
    const late = await cli(
      'feedback-submit',
      ws,
      a1.id,
      a1.manifest_sha256,
      'defect',
      'Synthetic late feedback',
    );
    const lateOk = await cli(
      'feedback-decide',
      ws,
      late.id,
      String(late.version),
      'accept',
      'Synthetic',
    );
    await assert.rejects(
      cli(
        'feedback-revise',
        ws,
        late.id,
        await file('late', {
          expected_version: lateOk.version,
          expected_spec_version: revised.revision.version,
          title: 'Stale',
          content: BUILD_FIXTURE_REVISION_SPEC,
          reason: 'Stale',
        }),
      ),
      /409/,
    );
    if (process.env.CREATOR_RECORD_T19_EVIDENCE === 'true') {
      const evidence = 'tracking/evidence/t19/product-demo';
      await mkdir(evidence, { recursive: true });
      await writeFile(join(evidence, 'original.tar'), await readFile(out));
      const revisionDownload = await cli(
        'artifact-download',
        ws,
        packaged2.artifact.id,
        packaged2.artifact.manifest_sha256,
        join(evidence, 'revision.tar'),
      );
      const lineage = await cli('lineage', ws, a1.entity_id, 'upstream', '8');
      const search = await cli('search', ws, a1.entity_id);
      const overview = await cli('overview', ws);
      assert.ok(JSON.stringify(lineage).includes(specId));
      assert.ok(JSON.stringify(search).includes(a1.entity_id));
      assert.ok(BigInt(overview.budget.incurred) > 0n);
      assert.equal(
        sha256(await readFile(join(evidence, 'revision.tar'))),
        packaged2.artifact.archive_sha256,
      );
      await writeFile(
        join(evidence, 'acceptance.json'),
        JSON.stringify(
          {
            synthetic: true,
            empirical_results: false,
            source_note:
              'Fixture discovery/selection, explicit checklist spec substitution, real worker and same-workspace search/cost inspection; no participant study.',
            first: { build, packaged, manifest: detail.manifest },
            preview: {
              state: started.preview.state,
              interactive: ran,
              invalid_input: invalid,
            },
            revision: {
              build: build2,
              packaged: packaged2,
              download: revisionDownload,
            },
            comparison: cmp,
            lineage,
            search,
            overview,
            refusals: [
              'revoked preview 403',
              'expired preview 410',
              'tampered archive download 400',
              'stale feedback revision 409',
            ],
          },
          null,
          2,
        ) + '\n',
      );
    }
    if (process.env.CREATOR_RECORD_T13_EVIDENCE === 'true') {
      await mkdir('tracking/evidence/t13', { recursive: true });
      await writeFile(
        'tracking/evidence/t13/cli-acceptance.json',
        JSON.stringify(
          {
            synthetic: true,
            empirical_results: false,
            first: { build, packaged, manifest: detail.manifest },
            preview: { started, interactive: ran, invalid_input: invalid },
            feedback: { submitted: fb, accepted, revised },
            revision: { product: product2, build: build2, packaged: packaged2 },
            comparison: cmp,
            refusals: [
              'revoked preview 403',
              'expired preview 410',
              'tampered archive download 400',
              'stale feedback revision 409',
            ],
          },
          null,
          2,
        ) + '\n',
      );
    }
  },
);
