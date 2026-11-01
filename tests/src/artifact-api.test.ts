import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ProductSupervisor,
  TerminalSupervisor,
  digest,
  type Binding,
  type BuildPlan,
  type BuildPorts,
} from '@creator/executor';
import {
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_FEEDBACK,
  BUILD_FIXTURE_REVISION_CASES,
  BUILD_FIXTURE_REVISION_SOURCE,
  BUILD_FIXTURE_REVISION_SPEC,
  BUILD_FIXTURE_SPEC,
  buildFixtureAnswer,
} from '@creator/domain';
import {
  SpecBodySchema,
  parse,
  type BrokerCallResult,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { TestDoubleExecutor } from './artifact-double.js';

test('owner inspects, downloads, previews, gives feedback and compares a revision; hash, expiry, revocation and stale-version refusals hold', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const parent = resolve('.verification/t13-api');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(dir.startsWith(parent));
    await rm(dir, { recursive: true, force: true });
  });
  const products = new ProductSupervisor(join(dir, 'products'));
  const double = new TestDoubleExecutor(products);
  const artifacts = new ArtifactSupervisor(products, double);
  // ADR-0058 terminal sessions with a stand-in console window: nothing is executed; the
  // stand-in answers with the bridge's management records.
  const windows: { args: string[]; exit: () => void }[] = [];
  const terminals = new TerminalSupervisor(products, 'Ubuntu', {
    platform: 'win32',
    workerPath: (x) => x,
    heartbeatMs: 20,
    openConsole: (_program, args) => {
      const handlers: (() => void)[] = [];
      windows.push({ args, exit: () => handlers.forEach((h) => h()) });
      return {
        once(event: string, cb: (e: Error) => void) {
          if (event === 'exit') handlers.push(() => cb(new Error('closed')));
          return this;
        },
      };
    },
    reap: async () => ({ cleaned: true, unit_state: 'inactive' }),
  });
  const api = createApi(
    { CREATOR_DATABASE_URL: db.url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
    { artifacts, terminals },
  );
  const nativeGate = process.env.CREATOR_TEST_NATIVE === '1';
  api.server.listen(nativeGate ? 4310 : 0, '127.0.0.1');
  api.preview.listen(0, '127.0.0.1');
  await Promise.all([
    once(api.server, 'listening'),
    once(api.preview, 'listening'),
  ]);
  closeApi = api.close;
  await api.ready();
  const store = api.store!;
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  const previewOrigin = `http://127.0.0.1:${(api.preview.address() as { port: number }).port}`;
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
        { env, timeout: 60000 },
      );
      return JSON.parse(stdout) as any;
    } catch (e) {
      throw new Error(String((e as { stdout?: string }).stdout ?? e));
    }
  };
  await cli('login', LOGIN_CODE);
  const auth = await login(`${origin}/api`);
  const http = async (
    path: string,
    body?: unknown,
    headers: Record<string, string> = body === undefined
      ? auth.read
      : auth.write,
  ) => {
    const r = await fetch(`${origin}/api/${path}`, {
      ...(body === undefined
        ? { headers }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify(body),
          }),
    });
    const type = r.headers.get('content-type') ?? '';
    return {
      status: r.status,
      headers: r.headers,
      body: type.includes('json')
        ? ((await r.json()) as any)
        : await r.arrayBuffer(),
    };
  };
  const seed = await cli('seed-selection');
  const ws: string = seed.workspace.id;
  const specId: string = seed.spec.id;
  const ctx = { actorId: DEFAULT_OWNER_ACTOR_ID };
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
    } else assert.equal(requested.status, 'frozen');
  };
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
  // In-process owner ports read the current frozen spec from the store, like the CLI does over HTTP.
  const binding = async (): Promise<{ binding: Binding; spec: any }> => {
    const status = await store.specStatus(ctx, ws, specId);
    const detail = await store.getEntity(ctx, ws, specId);
    const spec = parse(SpecBodySchema, detail.entity.body);
    return {
      spec,
      binding: {
        workspace_id: ws,
        owner_id: DEFAULT_OWNER_ACTOR_ID,
        spec_id: specId,
        spec_version: status.spec.version,
        spec_hash: status.spec.content_hash,
        freeze_id: status.latest_freeze!.id,
        tasks: spec.tasks
          .filter((x) => x.file_scope.length)
          .map((x) => ({
            key: x.key,
            hash: status.latest_freeze!.task_hashes[x.key]!,
            file_scope: x.file_scope,
          })),
      },
    };
  };
  const ports: BuildPorts = {
    current: binding,
    assertActive: async () => {},
    authorize: async () => ({ verdict: 'allow', test_port: true }),
    call: async (_run, r) => {
      const json: unknown = JSON.parse(buildFixtureAnswer(r.input)!);
      return {
        status: 'succeeded',
        reason_code: 'fixture',
        explanation: 'Test-only port; the real broker is covered by T12 tests',
        logical_operation_id: r.logical_operation_id,
        attempts: [],
        output: { text: JSON.stringify(json), json, vector: null },
        decision_id: null,
        fixture: true,
        replayed: false,
      } satisfies BrokerCallResult;
    },
  };
  const plan = (cases: typeof BUILD_FIXTURE_CASES): BuildPlan => ({
    format: 'build-plan/1',
    run_id: seed.run,
    envelope_id: seed.run,
    pricing_snapshot_id: seed.run,
    humility_review: { id: specId, version: 1 },
    data_class: 'synthetic',
    max_repairs: 0,
    max_calls: 2,
    timeout_ms: 10000,
    max_output_tokens: 3000,
    deadline: new Date(Date.now() + 300000).toISOString(),
    cases,
  });
  const builds = new BuildSupervisor(products, double);
  const first = await products.create((await binding()).binding);
  const firstTask = await products.createTask(
    first.id,
    'T1',
    first.initial_commit,
    (await binding()).binding,
  );
  const build1 = await builds.run(
    first.id,
    firstTask.id,
    first.initial_commit,
    plan(BUILD_FIXTURE_CASES),
    ports,
  );
  assert.equal(build1.state, 'verified_candidate', build1.reason);
  const pkg1 = await artifacts.package(first.id, build1.id, ports);
  assert.equal(pkg1.manifest.state, 'verified');

  // Registration re-reads and re-hashes the local manifest.
  const wrong = await http(`workspaces/${ws}/artifacts`, {
    product_id: first.id,
    artifact_id: pkg1.manifest.id,
    manifest_sha256: digest('not it'),
  });
  assert.equal(wrong.status, 400);
  const reg = await http(`workspaces/${ws}/artifacts`, {
    product_id: first.id,
    artifact_id: pkg1.manifest.id,
    manifest_sha256: pkg1.manifest_sha256,
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const a1 = reg.body;
  assert.equal(a1.current, true);
  await t.test(
    'paired-job HTTP admission, single dispatch, cancellation, immutable reports and unknown-outcome fencing (fixture contract only)',
    async () => {
      const hash = (value: string) =>
        createHash('sha256').update(value).digest('hex');
      async function pair(capabilities: string[]) {
        const proof = randomBytes(32).toString('hex');
        const c = await http('desktop/challenges', {
          kind: 'worker',
          label: 'Fixture job worker',
          proof_hash: hash(proof),
          workspace_id: ws,
          capabilities,
        });
        assert.equal(c.status, 201);
        assert.equal(
          (await http(`desktop/challenges/${c.body.id}/approve`, {})).status,
          200,
        );
        const claim = await http(`desktop/challenges/${c.body.id}/claim`, {
          proof,
        });
        assert.equal(claim.status, 200);
        return claim.body as { token: string; device: { id: string } };
      }
      const presence = await pair(['artifact.verify']);
      const request = {
        request_id: randomUUID(),
        artifact_id: a1.id,
        manifest_sha256: a1.manifest_sha256,
        input: { args: [], stdin: '' },
      };
      assert.equal(
        (await http(`desktop/devices/${presence.device.id}/jobs`, request))
          .status,
        403,
      );
      const worker = await pair(['artifact.run']);
      const bearer = { Authorization: `Bearer ${worker.token}` };
      const secondWorker = await pair(['artifact.run']);
      const submit = (body: unknown) =>
        http(`desktop/devices/${worker.device.id}/jobs`, body);
      const wrong = await submit({
        ...request,
        manifest_sha256: digest('wrong'),
      });
      assert.equal(wrong.status, 400);
      const queued = await Promise.all([
        submit(request),
        submit({ ...request, request_id: randomUUID() }),
      ]);
      assert.deepEqual(queued.map((r) => r.status).sort(), [201, 429]);
      const accepted = queued.find((r) => r.status === 201)!;
      const exact =
        accepted.body.request_id === request.request_id
          ? request
          : { ...request, request_id: accepted.body.request_id };
      const replay = await submit(exact);
      assert.equal(replay.body.id, accepted.body.id);
      assert.equal(
        (await submit({ ...exact, input: { args: [], stdin: 'changed' } }))
          .status,
        409,
      );
      const leased = await Promise.all([
        http('desktop/jobs', {}, bearer),
        http('desktop/jobs', {}, bearer),
      ]);
      assert.equal(leased.filter((r) => r.body !== null).length, 1);
      const job = leased.find((r) => r.body !== null)!.body;
      const executionId = randomUUID();
      const start = { lease_id: job.lease_id, execution_id: executionId };
      assert.equal(
        (
          await http(`desktop/jobs/${job.id}/start`, start, {
            Authorization: `Bearer ${secondWorker.token}`,
          })
        ).status,
        403,
      );
      assert.equal(
        (await http(`desktop/jobs/${job.id}/start`, start, bearer)).status,
        200,
      );
      assert.equal(
        (await http(`desktop/jobs/${job.id}/start`, start, bearer)).status,
        409,
      );
      assert.equal(
        (
          await http(
            `desktop/jobs/${job.id}/check`,
            { lease_id: job.lease_id },
            bearer,
          )
        ).body.continue,
        true,
      );
      assert.equal(
        (await http(`desktop/jobs/${job.id}/cancel`, {})).status,
        200,
      );
      assert.equal(
        (
          await http(
            `desktop/jobs/${job.id}/check`,
            { lease_id: job.lease_id },
            bearer,
          )
        ).body.continue,
        false,
      );
      const report = {
        execution_id: executionId,
        manifest_sha256: a1.manifest_sha256,
        archive_sha256: pkg1.manifest.package.sha256,
        backend: 'wsl2-bwrap-systemd',
        state: 'cancelled',
        stdout: 'Synthetic worker claim, not actual execution.',
        stdout_truncated: false,
        exit_code: null,
        reason: 'Fixture contract only',
      };
      const settled = await http(
        `desktop/jobs/${job.id}/finish`,
        { lease_id: job.lease_id, report },
        bearer,
      );
      assert.equal(settled.status, 200);
      assert.equal(settled.body.state, 'cancelled');
      assert.equal(settled.body.verification, 'worker_report_only');
      assert.equal(
        (
          await http(
            `desktop/jobs/${job.id}/finish`,
            { lease_id: job.lease_id, report },
            bearer,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await http(
            `desktop/jobs/${job.id}/finish`,
            {
              lease_id: job.lease_id,
              report: { ...report, stdout: 'rewrite' },
            },
            bearer,
          )
        ).status,
        409,
      );
      const beforeStop = await submit({ ...request, request_id: randomUUID() });
      assert.equal(beforeStop.status, 201);
      const toStop = (await http('desktop/jobs', {}, bearer)).body;
      await http(`desktop/devices/${worker.device.id}/control`, {
        state: 'paused',
      });
      assert.equal(
        (
          await http(
            `desktop/jobs/${toStop.id}/start`,
            { lease_id: toStop.lease_id, execution_id: randomUUID() },
            bearer,
          )
        ).status,
        409,
      );
      await http(`desktop/devices/${worker.device.id}/control`, {
        state: 'active',
      });
      assert.equal((await http('desktop/jobs', {}, bearer)).body, null);
      const crash = await submit({ ...request, request_id: randomUUID() });
      assert.equal(crash.status, 201);
      const lost = (await http('desktop/jobs', {}, bearer)).body;
      await http(
        `desktop/jobs/${lost.id}/start`,
        { lease_id: lost.lease_id, execution_id: randomUUID() },
        bearer,
      );
      await db.pool.query(
        `update desktop_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1`,
        [lost.id],
      );
      const history = await http(`desktop/devices/${worker.device.id}/jobs`);
      assert.equal(
        history.body.find((j: { id: string }) => j.id === lost.id).state,
        'reconciling',
      );
      assert.equal(
        (await submit({ ...request, request_id: randomUUID() })).status,
        429,
      );
      assert.equal((await http('desktop/jobs', {}, bearer)).body, null);
      await http(`desktop/devices/${worker.device.id}/control`, {
        state: 'revoked',
      });
      assert.equal(
        (
          await http(
            `desktop/jobs/${lost.id}/check`,
            { lease_id: lost.lease_id },
            bearer,
          )
        ).body.continue,
        false,
      );
      assert.equal((await http('desktop/jobs', {}, bearer)).status, 403);
      const events = await db.pool.query(
        `select a.kind from audit_events e join actors a on a.id=e.actor_id where e.action='desktop.job_started' and e.workspace_id=$1`,
        [ws],
      );
      assert.ok(events.rows.length > 0);
      assert.ok(events.rows.every((r) => r.kind === 'agent'));
    },
  );
  const detail = await http(`workspaces/${ws}/artifacts/${a1.id}`);
  assert.equal(detail.body.integrity.ok, true);
  assert.equal(
    detail.body.manifest.availability.runnable_demo.state,
    'available',
  );
  const lineage = await http(
    `workspaces/${ws}/entities/${a1.entity_id}/lineage?direction=upstream`,
  );
  assert.equal(lineage.status, 200);
  assert.ok(JSON.stringify(lineage.body).includes(specId));
  // X03: the verified build's commit is a searchable code version (by commit prefix).
  const code = await http(
    `workspaces/${ws}/search?q=${a1.commit.slice(0, 10)}&types=code_version`,
  );
  assert.equal(code.status, 200, JSON.stringify(code.body));
  assert.equal(code.body.hits.length, 1);
  assert.equal(code.body.hits[0].id, a1.id);
  assert.equal(code.body.hits[0].match, 'id_prefix');
  assert.equal(code.body.hits[0].subject.id, a1.entity_id);
  assert.equal(code.body.coverage.code_version.searchable, 1);

  // Download: owner session, current manifest hash, and exact bytes.
  const rawManifest = await fetch(
    `${origin}/api/workspaces/${ws}/artifacts/${a1.id}/manifest?sha256=${a1.manifest_sha256}`,
    { headers: auth.read },
  );
  assert.equal(rawManifest.status, 200);
  assert.equal(
    digest(Buffer.from(await rawManifest.arrayBuffer())),
    a1.manifest_sha256,
  );
  assert.equal(
    (
      await http(
        `workspaces/${ws}/artifacts/${a1.id}/manifest?sha256=${digest('stale')}`,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        `workspaces/${ws}/artifacts/${a1.id}/manifest?sha256=${a1.manifest_sha256}`,
        undefined,
        {},
      )
    ).status,
    401,
  );
  const dl = await http(
    `workspaces/${ws}/artifacts/${a1.id}/download?sha256=${a1.manifest_sha256}`,
  );
  assert.equal(dl.status, 200);
  const bytes = Buffer.from(dl.body as ArrayBuffer);
  assert.equal(digest(bytes), pkg1.manifest.package.sha256);
  assert.equal(dl.headers.get('x-content-sha256'), digest(bytes));
  await t.test(
    'actual Windows native authenticated download preserves manifest and archive bytes',
    {
      skip: nativeGate
        ? false
        : 'Native gate requires CREATOR_TEST_NATIVE=1 and a built Windows executable',
    },
    async () => {
      const web = spawn(
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
      try {
        for (let i = 0; i < 50; i++) {
          if (web.exitCode !== null)
            throw new Error('Native-gate web preview failed to start');
          try {
            if (
              (
                await fetch('http://127.0.0.1:5173/', {
                  signal: AbortSignal.timeout(500),
                })
              ).ok
            )
              break;
          } catch {}
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const native = await promisify(execFile)(
          resolve('apps/desktop/src-tauri/target/debug/creator-desktop.exe'),
          ['--download-probe'],
          {
            timeout: 30000,
            windowsHide: true,
            env: {
              ...process.env,
              CREATOR_NATIVE_PROBE_WORKSPACE: ws,
              CREATOR_NATIVE_PROBE_ARTIFACT: a1.id,
              CREATOR_NATIVE_PROBE_COOKIE: auth.cookie,
              CREATOR_STUDIO_HOME: join(dir, 'native-home'),
            },
          },
        );
        const downloaded = native.stdout
          .match(/NATIVE_SOURCE_CACHE (.+)/)?.[1]
          ?.trim();
        assert.ok(downloaded, native.stderr);
        assert.equal(
          digest(await readFile(join(downloaded!, 'manifest.json'))),
          a1.manifest_sha256,
        );
        assert.equal(
          digest(await readFile(join(downloaded!, 'source.tar'))),
          pkg1.manifest.package.sha256,
        );
        const receipt = JSON.parse(
          await readFile(join(downloaded!, 'receipt.json'), 'utf8'),
        ) as { offline: string; extracted: boolean };
        assert.equal(receipt.offline, 'read_only_snapshot');
        assert.equal(receipt.extracted, false);
        console.log(
          'Native source download verified on Windows; fixture artifact, no isolation or browser-approval claim.',
        );
      } finally {
        web.kill();
      }
    },
  );
  assert.equal(
    (
      await http(
        `workspaces/${ws}/artifacts/${a1.id}/download?sha256=${digest('stale')}`,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        `workspaces/${ws}/artifacts/${a1.id}/download?sha256=${a1.manifest_sha256}`,
        undefined,
        {},
      )
    ).status,
    401,
  );

  // ADR-0058: run in a terminal. Owner, current manifest and CSRF are checked; the session
  // gets a fresh copy of the exact package and only the confirmed arguments.
  const terminalPath = `workspaces/${ws}/artifacts/${a1.id}/terminals`;
  assert.equal(
    (
      await http(terminalPath, {
        manifest_sha256: digest('stale'),
        args: [],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        terminalPath,
        { manifest_sha256: a1.manifest_sha256, args: [] },
        { 'Content-Type': 'application/json' },
      )
    ).status >= 400,
    true,
  );
  assert.equal(windows.length, 0);
  const term = await http(terminalPath, {
    manifest_sha256: a1.manifest_sha256,
    args: ['--practice', '--fps', '60'],
  });
  assert.equal(term.status, 201, JSON.stringify(term.body));
  assert.equal(term.body.state, 'running');
  assert.equal(term.body.command, 'python3 src/main.py --practice --fps 60');
  assert.equal(term.body.package_sha256, pkg1.manifest.package.sha256);
  assert.equal(windows.length, 1);
  const job = windows[0]!.args[windows[0]!.args.indexOf('-I') + 2]!;
  assert.deepEqual(
    JSON.parse(await readFile(join(job, 'launch.json'), 'utf8')),
    {
      args: ['--practice', '--fps', '60'],
    },
  );
  for (const f of pkg1.manifest.package.files)
    assert.equal(
      digest(await readFile(join(job, 'input', ...f.path.split('/')))),
      f.sha256,
    );
  assert.equal(
    (
      await http(terminalPath, {
        manifest_sha256: a1.manifest_sha256,
        args: [],
      })
    ).status,
    409,
  );
  const termList = await http(terminalPath);
  assert.equal(termList.status, 200);
  assert.deepEqual(
    termList.body.map((x: any) => [x.id, x.state]),
    [[term.body.id, 'running']],
  );
  assert.equal(
    (
      await http(`workspaces/${ws}/terminals/${term.body.id}/stop`, {
        artifact_id: randomUUID(),
      })
    ).status,
    404,
  );
  // The stand-in bridge reports once it sees the cancelled lease.
  void (async () => {
    for (let i = 0; i < 300; i++) {
      const lease = JSON.parse(
        await readFile(join(job, 'lease.json'), 'utf8').catch(() => '{}'),
      );
      if (lease.cancelled) {
        await writeFile(
          join(job, 'result.json'),
          JSON.stringify({ exit_code: -15, reason: 'stopped', cleaned: true }),
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  })();
  const stopped = await http(
    `workspaces/${ws}/terminals/${term.body.id}/stop`,
    {
      artifact_id: a1.id,
    },
  );
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  assert.equal(stopped.body.state, 'stopped');
  const termAudit = await db.pool.query(
    `select action, payload from audit_events where action like 'artifact.terminal.%' order by sequence`,
  );
  // Each request is audited before its window opens, so the refused second start
  // (one per product) is on record too, under its own session id.
  const rows = termAudit.rows.map((r) => [r.action, r.payload.session_id]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], ['artifact.terminal.requested', term.body.id]);
  assert.equal(rows[1]![0], 'artifact.terminal.requested');
  assert.notEqual(rows[1]![1], term.body.id);
  assert.deepEqual(rows[2], ['artifact.terminal.stopped', term.body.id]);

  // Previews: separate origin, one-time ticket, preview-only cookie, rechecks on every use.
  const startPreview = (expected = a1.manifest_sha256, extra: object = {}) =>
    http(`workspaces/${ws}/artifacts/${a1.id}/previews`, {
      expected_manifest_sha256: expected,
      ttl_minutes: 5,
      max_runs: 3,
      ...extra,
    });
  assert.equal((await startPreview(digest('other'))).status, 400);
  const p1 = await startPreview();
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  assert.equal(p1.body.preview.state, 'ready');
  assert.equal(
    p1.body.preview.readiness.input_hash,
    pkg1.manifest.package.input_hash,
  );
  const url = new URL(p1.body.url);
  assert.equal(url.origin, previewOrigin);
  assert.notEqual(url.origin, origin);
  const opened = await fetch(url, { redirect: 'manual' });
  assert.equal(opened.status, 303);
  const cookie = opened.headers.get('set-cookie')!.split(';')[0]!;
  assert.match(opened.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/);
  assert.equal((await fetch(url, { redirect: 'manual' })).status, 403);
  const pageUrl = `${previewOrigin}/preview/${p1.body.preview.id}`;
  const pageResponse = await fetch(pageUrl, { headers: { Cookie: cookie } });
  assert.equal(pageResponse.status, 200);
  assert.match(
    pageResponse.headers.get('content-security-policy')!,
    /default-src 'none'/,
  );
  const pageHtml = await pageResponse.text();
  assert.match(pageHtml, new RegExp(pkg1.manifest.repository.commit));
  // F16: the page says how to use the package with a visible case from the frozen spec, and
  // never shows the held-out case (A2, args ["unexpected"], output "invalid input").
  assert.match(pageHtml, /<h2>How to use it<\/h2>/);
  assert.match(pageHtml, /<strong>Print checklist<\/strong>/);
  assert.match(pageHtml, /<summary>A1: Print inspect, build, review, verify/);
  assert.match(pageHtml, /data-example data-args="\[\]"/);
  assert.match(pageHtml, /Held-out cases are not shown here/);
  assert.doesNotMatch(
    pageHtml,
    /<summary>A2|&quot;unexpected&quot;|main\.py unexpected|invalid input\n/,
  );
  // A management session cookie means nothing on the preview origin.
  assert.equal(
    (await fetch(pageUrl, { headers: { Cookie: auth.cookie } })).status,
    403,
  );
  const run = (previewId: string, cookieValue: string, from = previewOrigin) =>
    fetch(`${previewOrigin}/preview/${previewId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieValue,
        Origin: from,
      },
      body: JSON.stringify({ args: ['--plain'], stdin: '' }),
    });
  const ran = await run(p1.body.preview.id, cookie);
  assert.equal(ran.status, 200);
  const runBody = (await ran.json()) as any;
  assert.equal(runBody.stdout, double.interactive);
  assert.equal(runBody.runs_used, 1);
  assert.equal(
    double.runs.at(-1)!.source,
    'exported_package',
    'previews start the exported package, never the worktree',
  );
  assert.equal((await run(p1.body.preview.id, cookie, origin)).status, 403);
  // A multibyte character split across request chunks reaches the program intact.
  const body = Buffer.from(JSON.stringify({ args: [], stdin: 'café ✓' }));
  const cut = body.indexOf(Buffer.from('é')) + 1;
  const split = await new Promise<number>((done, failed) => {
    const r = request(
      `${previewOrigin}/preview/${p1.body.preview.id}/run`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          Cookie: cookie,
          Origin: previewOrigin,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => done(res.statusCode ?? 0));
      },
    );
    r.on('error', failed);
    r.write(body.subarray(0, cut));
    setTimeout(() => r.end(body.subarray(cut)), 50);
  });
  assert.equal(split, 200);
  assert.deepEqual(double.runs.at(-1)!.input, { args: [], stdin: 'café ✓' });

  // Resource lease: two live previews per workspace.
  const p2 = await startPreview();
  assert.equal(p2.status, 201);
  assert.equal((await startPreview()).status, 429);
  const stop = (p: any, revoke: boolean, version = p.version) =>
    http(`workspaces/${ws}/previews/${p.id}/stop`, {
      expected_version: version,
      revoke,
      reason: revoke ? 'Synthetic revoked access' : 'Synthetic stop',
    });
  assert.equal((await stop(p2.body.preview, false, 99)).status, 409);
  assert.equal((await stop(p2.body.preview, false)).body.state, 'stopped');
  // Revoked access: the open session is refused at start time.
  assert.equal((await stop(p1.body.preview, true)).body.state, 'revoked');
  const revoked = await run(p1.body.preview.id, cookie);
  assert.equal(revoked.status, 403);
  assert.match(((await revoked.json()) as any).error.message, /revoked/);

  // Expiry is checked at use, not only by a sweep.
  const p3 = await startPreview();
  const open3 = await fetch(p3.body.url, { redirect: 'manual' });
  const cookie3 = open3.headers.get('set-cookie')!.split(';')[0]!;
  await db.pool.query(
    `update artifact_previews set expires_at = now() - interval '1 second' where id = $1`,
    [p3.body.preview.id],
  );
  const expired = await run(p3.body.preview.id, cookie3);
  assert.equal(expired.status, 410);
  assert.equal(
    (
      await fetch(`${previewOrigin}/preview/${p3.body.preview.id}`, {
        headers: { Cookie: cookie3 },
      })
    ).status,
    410,
  );
  const listed = await http(`workspaces/${ws}/artifacts/${a1.id}`);
  assert.deepEqual(
    listed.body.previews.map((p: any) => p.state),
    ['revoked', 'stopped', 'expired'],
  );
  // Run cap of the lease.
  const p4 = await startPreview(a1.manifest_sha256, { max_runs: 1 });
  const cookie4 = (await fetch(p4.body.url, { redirect: 'manual' })).headers
    .get('set-cookie')!
    .split(';')[0]!;
  assert.equal((await run(p4.body.preview.id, cookie4)).status, 200);
  assert.equal((await run(p4.body.preview.id, cookie4)).status, 429);
  await stop(p4.body.preview, false, p4.body.preview.version);

  // Hash mismatch: changed bytes on disk are detected on read, download and start.
  const archivePath = join(artifacts.dir(first.id, a1.id), 'source.tar');
  const original = await readFile(archivePath);
  await writeFile(archivePath, Buffer.concat([original, Buffer.from('x')]));
  assert.equal(
    (await http(`workspaces/${ws}/artifacts/${a1.id}`)).body.integrity.ok,
    false,
  );
  const tamperedDl = await http(
    `workspaces/${ws}/artifacts/${a1.id}/download?sha256=${a1.manifest_sha256}`,
  );
  assert.equal(tamperedDl.status, 400);
  assert.match(tamperedDl.body.error.message, /hash mismatch/i);
  const tamperedPreview = await startPreview();
  assert.equal(tamperedPreview.body.preview.state, 'failed');
  assert.equal(tamperedPreview.body.url, null);
  await writeFile(archivePath, original);

  // Feedback binds to the exact manifest; acceptance and revision are versioned owner steps.
  const fbUrl = `workspaces/${ws}/artifacts/${a1.id}/feedback`;
  assert.equal(
    (
      await http(fbUrl, {
        expected_manifest_sha256: digest('old'),
        category: 'change_request',
        text: BUILD_FIXTURE_FEEDBACK,
      })
    ).status,
    409,
  );
  const fb = (
    await http(fbUrl, {
      expected_manifest_sha256: a1.manifest_sha256,
      category: 'change_request',
      text: BUILD_FIXTURE_FEEDBACK,
    })
  ).body;
  assert.equal(fb.status, 'submitted');
  const decide = (f: any, version = f.version) =>
    http(`workspaces/${ws}/feedback/${f.id}/decide`, {
      expected_version: version,
      decision: 'accept',
      rationale: 'Synthetic owner acceptance',
    });
  assert.equal((await decide(fb, 5)).status, 409);
  const accepted = (await decide(fb)).body;
  assert.equal(accepted.status, 'accepted');
  // The light feedback list (read by the what's-next line) shows the same item and state.
  const fbList = await http(fbUrl);
  assert.equal(fbList.status, 200);
  assert.deepEqual(
    fbList.body.map((f: any) => [f.id, f.status]),
    [[fb.id, 'accepted']],
  );
  const revise = (f: any, specVersion: number) =>
    http(`workspaces/${ws}/feedback/${f.id}/revision`, {
      expected_version: f.version,
      expected_spec_version: specVersion,
      title: 'Synthetic checklist with plain list',
      content: BUILD_FIXTURE_REVISION_SPEC,
      reason: 'Accepted synthetic feedback',
    });
  assert.equal((await revise(accepted, v1.spec.version - 1)).status, 409);
  const revised = (await revise(accepted, v1.spec.version)).body;
  assert.equal(revised.status, 'revised');
  assert.equal(revised.revision.version, v1.spec.version + 1);
  const spec2 = await cli('spec', ws, specId);
  assert.deepEqual(
    spec2.tasks.map((x: any) => x.status),
    ['changed'],
  );

  // Stale versions: the old artifact is superseded and cannot drive another revision or package.
  assert.equal(
    (await http(`workspaces/${ws}/artifacts`)).body[0].current,
    false,
  );
  const late = (
    await http(fbUrl, {
      expected_manifest_sha256: a1.manifest_sha256,
      category: 'defect',
      text: 'Synthetic late feedback on the old version',
    })
  ).body;
  const lateAccepted = (await decide(late)).body;
  const stale = await revise(lateAccepted, spec2.spec.version);
  assert.equal(stale.status, 409);
  assert.match(stale.body.error.message, /superseded/);
  await assert.rejects(
    artifacts.package(first.id, build1.id, ports),
    /specification or task hashes changed/,
  );

  // The revision: freeze, start from the verified package bytes, rebuild, reverify, register.
  await freeze(spec2.spec.version);
  const b2 = (await binding()).binding;
  const opened1 = await artifacts.open(first.id, a1.id, a1.manifest_sha256);
  const second = await products.create(b2, {
    files: opened1.files,
    lineage: {
      artifact_id: a1.id,
      manifest_sha256: a1.manifest_sha256,
      product_id: first.id,
      commit: a1.commit,
    },
  });
  const secondTask = await products.createTask(
    second.id,
    'T1',
    second.initial_commit,
    b2,
  );
  const build2 = await builds.run(
    second.id,
    secondTask.id,
    second.initial_commit,
    plan(BUILD_FIXTURE_REVISION_CASES),
    ports,
  );
  assert.equal(build2.state, 'verified_candidate', build2.reason);
  const pkg2 = await artifacts.package(second.id, build2.id, ports, {
    previous: { artifact_id: a1.id, manifest_sha256: a1.manifest_sha256 },
    feedback_ids: [fb.id],
  });
  assert.equal(pkg2.manifest.state, 'verified');
  assert.equal(
    (
      await artifacts.open(second.id, pkg2.manifest.id, pkg2.manifest_sha256)
    ).files
      .find((f) => f.path === 'src/main.py')!
      .content.toString(),
    BUILD_FIXTURE_REVISION_SOURCE,
  );
  const reg2 = await http(`workspaces/${ws}/artifacts`, {
    product_id: second.id,
    artifact_id: pkg2.manifest.id,
    manifest_sha256: pkg2.manifest_sha256,
  });
  assert.equal(reg2.status, 201, JSON.stringify(reg2.body));
  assert.equal(reg2.body.previous_id, a1.id);
  const all = (await http(`workspaces/${ws}/artifacts`)).body;
  assert.deepEqual(
    all.map((a: any) => a.current),
    [false, true],
  );
  const cmp = (
    await http(
      `workspaces/${ws}/artifacts/${a1.id}/compare?with=${reg2.body.id}`,
    )
  ).body;
  assert.equal(cmp.linked, true);
  assert.deepEqual(cmp.spec_versions, [v1.spec.version, spec2.spec.version]);
  assert.deepEqual(cmp.changed_tasks, ['T1']);
  assert.deepEqual(
    cmp.files.filter((f: any) => f.change !== 'same'),
    [{ path: 'src/main.py', change: 'changed' }],
  );
  assert.deepEqual(
    cmp.tests.find((x: any) => x.check_key === 'A3'),
    {
      check_key: 'A3',
      base: null,
      candidate: true,
    },
  );
  assert.equal(cmp.feedback[0].text, BUILD_FIXTURE_FEEDBACK);
  // Old artifacts are preserved and still downloadable.
  assert.equal(
    (
      await http(
        `workspaces/${ws}/artifacts/${a1.id}/download?sha256=${a1.manifest_sha256}`,
      )
    ).status,
    200,
  );

  // A real workspace refuses manifests that were not run in the reviewed worker.
  const realWs = await store.createWorkspace(ctx, {
    name: 'Real refusal check',
    record_mode: 'real',
  });
  await assert.rejects(
    store.registerArtifact(
      ctx,
      realWs.id,
      { ...pkg2.manifest, workspace_id: realWs.id },
      pkg2.manifest_sha256,
    ),
    /reviewed isolation backend/,
  );
  assert.equal((await store.verifyAuditChain()).ok, true);
  const history = (await http(`workspaces/${ws}/history`)).body.map(
    (h: any) => h.action,
  );
  for (const action of [
    'artifact.registered',
    'artifact.downloaded',
    'preview.leased',
    'preview.opened',
    'preview.run',
    'preview.revoked',
    'feedback.submitted',
    'feedback.revised',
  ])
    assert.ok(history.includes(action), action);
});
