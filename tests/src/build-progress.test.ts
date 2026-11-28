// B3 (build capability plan, 2026-11-14): the Build page's timeline, stop reasons, "Why did it
// fail?" and results. The server reads each task's newest build folder (packages/executor
// build-progress.ts); the page words come from apps/web/src/build-progress-rules.ts.
//
// The repair round runs through the studio's own build route: the frozen repair benchmark's
// spec, scripted fixture roles (a first draft with two easy-to-miss mistakes, then the
// reference), and a TEST DOUBLE that runs each case with the host's python3 directly (no
// isolation, a throwaway folder; never evidence of the WSL2 worker).
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi } from '@creator/api';
import {
  ArtifactSupervisor,
  ProductSupervisor,
  readBuildProgress,
  type BuildPorts,
} from '@creator/executor';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { TestDoubleExecutor } from './artifact-double.js';
import { loadWeb } from './web-module.js';
import { pythonScriptArgs } from './local-python.js';

const hasPython = spawnSync('python3', ['--version']).status === 0;
const REPAIR = resolve('config/repo-benchmarks/repair-v1/p14-repair-v1');
const WEB = resolve('config/web-benchmarks/p15-small-signup-v4');
const repairSpec = () =>
  JSON.parse(readFileSync(join(REPAIR, 'spec.json'), 'utf8')).content;
const reference = readFileSync(join(REPAIR, 'reference/src/main.py'), 'utf8');
/** The first draft: binary floating point averages and int() scores (+5 accepted). */
const firstDraft = reference
  .replace(
    /    # Tenths, rounded half up[\s\S]*?return '%d\.%d' % \(tenths \/\/ 10, tenths % 10\)/,
    "    return '%.1f' % (total / count)",
  )
  .replace(
    "    if not (1 <= len(text) <= 3 and all('0' <= ch <= '9' for ch in text)):\n        return None\n    value = int(text)",
    '    try:\n        value = int(text)\n    except ValueError:\n        return None\n    if value < 0:\n        return None',
  );

/**
 * TEST DOUBLE ONLY: runs a QA case with the host's python3 on the committed files, copied to
 * a throwaway folder, stdout and stderr merged like the worker's log. No isolation.
 */
class LocalPythonDouble extends TestDoubleExecutor {
  override async run(
    ...a: Parameters<TestDoubleExecutor['run']>
  ): ReturnType<TestDoubleExecutor['run']> {
    const e = await super.run(...a);
    const c = a[5];
    if (!c || !('args' in c)) return e;
    const [productId, taskId, commit] = a;
    const dir = await mkdtemp(join(tmpdir(), 'b3-qa-'));
    try {
      for (const f of await this.products.committedFiles(
        productId,
        taskId,
        commit,
      )) {
        await mkdir(dirname(join(dir, f.path)), { recursive: true });
        await writeFile(join(dir, f.path), f.content);
      }
      const r = spawnSync(
        'sh',
        [
          '-c',
          'exec python3 "$@" 2>&1',
          'qa',
          ...pythonScriptArgs(['-I'], 'src/main.py', c.args),
        ],
        { cwd: dir, input: c.stdin, timeout: 20000 },
      );
      return {
        ...e,
        state: r.status === 0 ? 'succeeded' : 'failed',
        log: r.stdout.toString(),
        exit_code: r.status,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

test('readBuildProgress: rounds, the live step, and held-out cases stay hidden', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'b3-progress-'));
  try {
    const w = (name: string, v: unknown) =>
      writeFile(join(dir, name), JSON.stringify(v));
    const cases = [
      {
        check_key: 'A1',
        args: ['x'],
        stdin: 'in\n',
        stdout: 'yes\n',
        exit_code: 0,
      },
      {
        check_key: 'A2',
        args: ['secret'],
        stdin: 'hidden-input',
        stdout: 'hidden-out\n',
        exit_code: 0,
      },
    ];
    await w('intent.json', {
      plan: {
        max_repairs: 1,
        max_calls: 4,
        cases,
        plan_roles: { connection_id: 'c', model_id: 'm' },
      },
    });
    const read = (running = true) =>
      readBuildProgress({ dir, heldOut: [false, true], running });
    let p = await read();
    assert.equal(p.now?.step, 'approval');
    await w('admission-0.json', {});
    await w('call-1-intent.json', { role: 'builder' });
    p = await read();
    assert.deepEqual(
      [p.now?.step, p.rounds[0]?.builder],
      ['builder', 'writing'],
    );
    await w('call-1-outcome.json', { status: 'succeeded' });
    await w('candidate-0.json', {
      commit: 'a'.repeat(40),
      changed_files: ['src/main.py'],
    });
    await w('call-2-intent.json', { role: 'reviewer' });
    p = await read();
    assert.equal(p.now?.step, 'reviewer');
    await w('call-2-outcome.json', { status: 'succeeded' });
    await w('review-0.json', { verdict: 'approve', findings: [] });
    const execution = (log: string, exit_code: number) => ({
      state: exit_code ? 'failed' : 'succeeded',
      log,
      exit_code,
      reason: null,
    });
    await w('qa-0-0.json', {
      check: cases[0],
      execution: execution('no\n', 1),
      passed: false,
    });
    p = await read();
    assert.deepEqual([p.now?.step, p.now?.case], ['testing', 2]);
    await w('qa-0-1.json', {
      check: cases[1],
      execution: execution('leaked-output\n', 0),
      passed: false,
    });
    // The newest file decides "since": a later test case moves it on.
    const old = new Date(Date.now() - 60000);
    await utimes(join(dir, 'review-0.json'), old, old);
    p = await read();
    assert.equal(p.now?.step, 'deciding');
    assert.equal(p.rounds.length, 1);
    const [visible, held] = p.rounds[0]!.failures as any[];
    assert.deepEqual(
      [
        visible?.held_out,
        visible?.expected_stdout,
        visible?.actual_stdout,
        visible?.actual_exit,
      ],
      [false, 'yes\n', 'no\n', 1],
    );
    assert.deepEqual(held, {
      index: 1,
      check_key: 'A2',
      held_out: true,
      unfinished: false,
    });
    const text = JSON.stringify(p);
    for (const secret of [
      'secret',
      'hidden-input',
      'hidden-out',
      'leaked-output',
    ])
      assert.ok(!text.includes(secret), secret);
    // A refused next round, then the outcome: nothing is "now" any more.
    await w('call-3-intent.json', { role: 'builder' });
    await w('call-3-outcome.json', { status: 'succeeded' });
    await w('refused-1.json', { reason: 'Patch changes nothing', details: [] });
    await w('outcome.json', {});
    p = await read();
    assert.equal(p.now, null);
    assert.equal(p.rounds[1]?.refused?.reason, 'Patch changes nothing');
    assert.equal(p.rounds[1]?.reviewer, null);
    assert.equal(p.requests, 3);
    // Long output is cut for the page.
    await w('qa-0-0.json', {
      check: cases[0],
      execution: execution('z'.repeat(5000), 1),
      passed: false,
    });
    p = await read(false);
    assert.ok((p.rounds[0]!.failures[0] as any).actual_stdout.length < 1600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// The web rules module (apps/web/src/build-progress-rules.ts), loaded untyped.
type Rules = Record<string, any>;

test('stop reasons read as what happened and one next step', async () => {
  const r = (await loadWeb('build-progress-rules.ts')) as Rules;
  const said = (reason: string) => r.stopExplanation(reason, null, 'FALLBACK');
  assert.match(
    said('Error: Build admission waiting_human; decision 1234').headline,
    /waiting for your approval/,
  );
  const blocked = said(
    'Error: The worker did not finish check A1 (blocked: Error: Isolation unavailable: this reviewed backend requires Windows + WSL2; execution x). The candidate is kept; build again once the worker runs.',
  );
  assert.match(blocked.headline, /not available here, so check A1 never ran/);
  assert.match(blocked.next, /WSL2/);
  assert.match(
    said(
      'Error: The worker did not finish check A2 (cleanup_required; execution x). The candidate is kept; Recover this product first, then build again.',
    ).next,
    /^Press Recover/,
  );
  assert.match(
    said('Error: Repair limit reached; partial commits and evidence preserved')
      .next,
    /Why did it fail/,
  );
  assert.match(
    said(
      'Error: Repair limit reached; the last patch was refused: Patch changes nothing',
    ).headline,
    /refused by the studio \(Patch changes nothing\)/,
  );
  assert.match(
    said('Error: Builder blocked: The spec contradicts itself.').headline,
    /could not do this: The spec contradicts itself$/,
  );
  assert.match(
    said('Error: Role stopped: failed rate_limited').headline,
    /slow down/,
  );
  assert.match(
    said('Error: Role stopped: failed network_error').next,
    /continues from the last code/,
  );
  assert.match(
    said('Error: Role stopped: failed something_new').headline,
    /something new/,
  );
  assert.match(
    said('Error: Build deadline reached').headline,
    /ran out of time/,
  );
  assert.match(
    said('ContractError: The per-run request cap of 30 is reached').headline,
    /This run’s request limit/,
  );
  // Review 1 L-2: the API's "no covering grant" means the build needs your approval.
  assert.match(
    said('Error: Build admission has no covering grant').headline,
    /waiting for your approval/,
  );
  // Review 1 M-1: the daily cap is a rolling 24 hours, and the owner can add 20 more.
  const daily = said(
    'ContractError: The studio daily request cap for this connection is reached. The workspace owner can add 20 more for the next 24 hours.',
  );
  assert.match(
    daily.next,
    /^The workspace owner can add 20 requests for the next 24 hours/,
  );
  assert.doesNotMatch(daily.next, /midnight/);
  assert.equal(r.headlineText('Something stopped.'), 'Something stopped.');
  assert.equal(r.headlineText('Something stopped'), 'Something stopped.');
  assert.equal(r.headlineText('What now?'), 'What now?');
  assert.equal(said('Error: never seen before').headline, 'FALLBACK');
  // Every answer names a next step.
  for (const reason of [
    'Error: Reviewer blocked candidate',
    'Error: Build call cap reached',
    'x',
  ])
    assert.ok(said(reason).next.length > 10);
});

test('run steps name the archive and both systems; untested items stay honest', async () => {
  const r = (await loadWeb('build-progress-rules.ts')) as Rules;
  const web = r.runSteps('static-web/1', 'creator-abc.tar');
  assert.deepEqual(
    web.map((s: any) => s.system),
    ['Windows (PowerShell)', 'macOS or Linux'],
  );
  assert.match(
    web[0]!.lines.join('\n'),
    /tar -xf creator-abc\.tar -C my-product\npy -3 -m http\.server 8000 --bind 127\.0\.0\.1 --directory my-product\\site$/,
  );
  assert.match(web[0]!.note, /^Open http:\/\/127\.0\.0\.1:8000\//);
  assert.match(
    r.runSteps('python-build/1', 'x.tar')[1]!.lines.join('\n'),
    /python3 -I src\/main\.py/,
  );
  // Found on Windows PowerShell 5.1 (Nov 15): piped text gets a byte-order mark, so a file goes through cmd.
  const py = r.runSteps('python-build/1', 'x.tar');
  assert.match(py[0]!.note, /cmd \/c "py -3 -I src\\main\.py < input\.txt"/);
  assert.match(py[1]!.note, /python3 -I src\/main\.py < input\.txt/);
  assert.equal(r.elapsed(new Date(0).toISOString(), 125000), '2 min 5 s');
  // Review 1 L-1: the live region gets the step only; the seconds sit outside it.
  const p = {
    max_repairs: 2,
    cases: 10,
    now: {
      step: 'testing',
      round: 1,
      case: 3,
      since: new Date(0).toISOString(),
    },
  };
  assert.deepEqual(r.nowParts(p, 12000), {
    step: 'Testing: case 3 of 10 (repair round 1 of 2)',
    time: '12 s so far',
  });
  // Review 1 N-1: Codex turns are counted apart from the request cap.
  const footer = r.timeline(
    { ...p, now: null, rounds: [], requests: 1, codex_turns: 4, max_calls: 4 },
    'failed',
  ).footer;
  assert.equal(
    footer.text,
    'Stopped. 1 model request of 4 used (plus 4 Codex turns).',
  );
});

test(
  'a repair round through the studio build route: timeline, why it failed, then verified',
  { skip: !hasPython && 'python3 not on PATH' },
  async (t) => {
    let closeApi = async () => {};
    t.after(() => closeApi());
    const db = await freshDatabase(t);
    if (!db) return;
    const parent = resolve('.verification/build-progress');
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(join(parent, 'case-'));
    t.after(async () => {
      assert.ok(dir.startsWith(parent));
      await rm(dir, { recursive: true, force: true });
    });
    const products = new ProductSupervisor(join(dir, 'products'));
    const worker = new LocalPythonDouble(products);
    // Scripted fixture roles: the fixture broker still admits and records each request; only
    // its answer is replaced. Round 0's builder sends the first draft, later rounds the
    // reference; the reviewer approves what it is bound to.
    const packets: { role: string; packet: any }[] = [];
    let builderRounds = 0;
    const script = (ports: BuildPorts): BuildPorts => ({
      ...ports,
      call: async (runId, request) => {
        const result = await ports.call(runId, request);
        if (result.status !== 'succeeded' || !result.output) return result;
        const role = request.input[0]!.text.startsWith('builder/')
          ? 'builder'
          : 'reviewer';
        const packet = JSON.parse(request.input[1]!.text);
        packets.push({ role, packet });
        if (!String(packet.problem ?? '').includes('averages scores'))
          return result; // Not the repair spec: leave the fixture answer.
        const main = packet.files.find((f: any) => f.path === 'src/main.py');
        const answer =
          role === 'builder'
            ? {
                summary: 'Scripted fixture builder (test)',
                submission: {
                  expected_commit: packet.candidate,
                  changes: [
                    {
                      path: 'src/main.py',
                      before_hash: main?.hash ?? null,
                      content: builderRounds++ === 0 ? firstDraft : reference,
                    },
                  ],
                },
                blocker: null,
              }
            : {
                candidate: packet.candidate,
                spec_hash: packet.spec_hash,
                task_hash: packet.task_hash,
                verdict: 'approve',
                findings: [],
              };
        const text = JSON.stringify(answer);
        return { ...result, output: { text, json: answer, vector: null } };
      },
    });
    const api = createApi(
      { CREATOR_DATABASE_URL: db.url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
      {
        artifacts: new ArtifactSupervisor(products, worker),
        buildPorts: script,
      },
    );
    api.server.listen(0, '127.0.0.1');
    api.preview.listen(0, '127.0.0.1');
    await Promise.all([
      once(api.server, 'listening'),
      once(api.preview, 'listening'),
    ]);
    closeApi = api.close;
    await api.ready();
    const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
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
    const http = async (path: string, body?: unknown) => {
      const r = await fetch(`${origin}/api/${path}`, {
        ...(body === undefined
          ? { headers: auth.read }
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...auth.write },
              body: JSON.stringify(body),
            }),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    const seed = await cli('seed-selection');
    const ws: string = seed.workspace.id;
    const specId: string = seed.spec.id;
    const base = `workspaces/${ws}/products`;
    const approve = async (reason: string) => {
      const id = /decision ([0-9a-f-]{36})/.exec(reason)?.[1];
      assert.ok(id, reason);
      const decision = await cli('decision', ws, id);
      await cli(
        'answer',
        ws,
        decision.id,
        decision.coverage.coverage_hash,
        'approve_once',
        'Synthetic: this one build',
      );
    };
    // The spec becomes the given content, frozen; returns a prepared product and task.
    const productFor = async (content: unknown, title: string) => {
      const before = await cli('spec', ws, specId);
      const revised = await cli(
        'spec-revise',
        ws,
        specId,
        JSON.stringify({
          expected_version: before.spec.version,
          title,
          content,
          reason: title,
        }),
      );
      const body = JSON.stringify({
        spec: { id: specId, version: revised.spec.version },
        justification: 'Synthetic exact freeze',
        data_class: 'synthetic',
      });
      const freezing = await cli('spec-freeze', ws, seed.run, body);
      if (freezing.status === 'needs_human') {
        await approve(`decision ${freezing.admission.decision_id}`);
        assert.equal(
          (await cli('spec-freeze', ws, seed.run, body)).status,
          'frozen',
        );
      }
      const made = await http(base, { spec_id: specId });
      assert.equal(made.status, 201, JSON.stringify(made.body));
      const task = await http(`${base}/${made.body.id}/tasks`, {
        task_key: 'T1',
        expected_commit: made.body.initial_commit,
      });
      assert.equal(task.status, 201, JSON.stringify(task.body));
      return {
        id: made.body.id as string,
        task: task.body.id as string,
        recipe: made.body.recipe,
      };
    };
    const [budgets, pricing] = await Promise.all([
      cli('budgets', ws),
      cli('pricing', ws),
    ]);
    const entry = async (productId: string) =>
      (await http(base)).body.find((x: any) => x.product.id === productId);
    const startBuild = async (
      p: { id: string; task: string },
      repairs: number,
    ) => {
      const review = (await http(`${base}/sample-review`, { spec_id: specId }))
        .body;
      const task = (await entry(p.id)).tasks.find((x: any) => x.id === p.task);
      const started = await http(`${base}/${p.id}/builds`, {
        task_id: p.task,
        expected_commit: task.head ?? task.base_commit,
        plan: {
          format: 'build-plan/1',
          run_id: seed.run,
          envelope_id: budgets[0].id,
          pricing_snapshot_id: pricing[0].id,
          humility_review: { id: review.id, version: review.version },
          data_class: 'synthetic',
          max_repairs: repairs,
          max_calls: 2 + 2 * repairs,
          timeout_ms: 30000,
          max_output_tokens: 6000,
          deadline: new Date(Date.now() + 600000).toISOString(),
        },
      });
      assert.equal(started.status, 202, JSON.stringify(started.body));
      const end = Date.now() + 60000;
      for (;;) {
        const b = (await entry(p.id)).builds.find(
          (x: any) => x.id === started.body.build_id,
        );
        if (b && b.state !== 'running') return b;
        if (Date.now() > end)
          throw new Error('Timed out waiting for the build');
        await sleep(200);
      }
    };

    // 1. A static web product's build starts from the Build page's route. Before B3 the app
    // sent no cases for it, so the request was refused with "cases: Too small".
    {
      const web = JSON.parse(
        readFileSync(join(WEB, 'spec.json'), 'utf8'),
      ).content;
      const p = await productFor(web, 'Synthetic sign-up page');
      assert.equal(p.recipe, 'static-web/1');
      const asked = await startBuild(p, 1);
      assert.equal(asked.state, 'checkpoint', JSON.stringify(asked));
      assert.match(asked.reason, /Build admission waiting_human/);
      assert.equal(asked.progress.cases, 10);
      assert.equal(asked.progress.held_out, 6);
      assert.equal(asked.progress.approved, false);
    }

    // 2. The repair benchmark: the first draft fails a visible and a held-out case, the
    // repair round fixes both, and the build verifies after one repair.
    const p = await productFor(
      repairSpec(),
      'Score sheet CLI (repair benchmark)',
    );
    await approve((await startBuild(p, 2)).reason);
    const built = await startBuild(p, 2);
    assert.equal(built.state, 'verified_candidate', JSON.stringify(built));
    const progress = built.progress;
    assert.equal(progress.rounds.length, 2);
    assert.equal(progress.requests, 4);
    const [first, second] = progress.rounds;
    assert.deepEqual(first.tests, {
      ran: 10,
      passed: 8,
      failed: 2,
      unfinished: 0,
    });
    const visible = first.failures.find((f: any) => !f.held_out);
    assert.equal(visible.check_key, 'A1');
    assert.equal(visible.expected_stdout, 'Cy 82.3 (4)\n');
    assert.equal(visible.actual_stdout, 'Cy 82.2 (4)\n');
    const held = first.failures.find((f: any) => f.held_out);
    assert.deepEqual(held, {
      index: 6,
      check_key: 'A2',
      held_out: true,
      unfinished: false,
    });
    assert.ok(!JSON.stringify(progress).includes('Bo,+5'));
    assert.deepEqual(second.tests, {
      ran: 10,
      passed: 10,
      failed: 0,
      unfinished: 0,
    });
    // The repair round's builder packet carried the visible failure, and the held-out one by
    // its check only.
    const repairPacket = packets
      .filter((x) => x.role === 'builder')
      .at(-1)!.packet;
    const feedback = JSON.stringify(repairPacket.feedback);
    assert.match(feedback, /Cy 82\.3/);
    assert.ok(!feedback.includes('Bo,+5'));
    // The page's words for it.
    const r = (await loadWeb('build-progress-rules.ts')) as Rules;
    const { groups, footer } = r.timeline(progress, built.state);
    assert.deepEqual(
      groups.map((g: any) => g.title),
      ['Before building', 'First try', 'Repair round 1 of 2'],
    );
    assert.deepEqual(
      groups[1]!.lines.map((l: any) => l.tone),
      ['done', 'done', 'failed'],
    );
    assert.equal(groups[1]!.lines[2]!.text, '2 of 10 test cases failed');
    assert.match(
      groups[2]!.lines[2]!.text,
      /All 10 test cases passed \(6 hidden cases/,
    );
    assert.match(footer!.text, /^Verified: .* 4 model requests of 6 used\.$/);
    assert.match(
      r.testedSummary(progress, 'python-build/1').tested.join(' '),
      /1 repair round: the first try failed and was fixed/,
    );
    // The folder the page read is what the build wrote: nothing new is recorded.
    const folder = join(dir, 'products', p.id, 'builds', built.id);
    assert.equal(
      JSON.parse(await readFile(join(folder, 'outcome.json'), 'utf8')).repairs,
      1,
    );
  },
);
