import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ProductSupervisor,
  digest,
  runStudyBuild,
  type StudyCall,
} from '@creator/executor';
import {
  BLOCKING_DECISIONS,
  BUILD_FIXTURE_SOURCE,
  BUILD_FIXTURE_SPEC,
  PROPOSED_PROTOCOL,
  SYNTHETIC_STUDY,
  canonicalHash,
  evaluationReadiness,
  fixtureHumilityReview,
  frozenCases,
} from '@creator/domain';
import { AUDIT_CHAIN_LOCK, readEvaluationConfig } from '@creator/db';
import type { StudyInput } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { TestDoubleExecutor } from './artifact-double.js';

const LABEL =
  'SYNTHETIC TEST RECORD: stand-in values for plumbing checks, not owner decisions.';
const SYNTHETIC_GOVERNANCE = {
  label: LABEL,
  participants: { status: 'unresolved', decision: 'RD3-participants' },
  reviewers: { status: 'unresolved', decision: 'RD4-reviewers' },
  human_subjects: { status: 'unresolved', decision: 'RD5-human-subjects' },
  task_selection: { status: 'unresolved', decision: 'RD8-final-tasks' },
  model: {
    owner_preference: 'gpt-6-astra',
    verified_model_id: null,
    decision: 'RD6-model-and-cap',
  },
  budget: { ledger_cap_nano_usd: '20000000000' },
} as const;
// The held-out case's input; it must never reach a role packet, participant or study record.
const HELD_OUT_ARG = '"unexpected"';

async function setup(t: test.TestContext, real: boolean) {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return null;
  const parent = resolve('.verification/t15-study-build');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(dir.startsWith(parent));
    await rm(dir, { recursive: true, force: true });
  });
  // The CLI runs with cwd=dir, so its default product store is the API's.
  const productsRoot = join(dir, '.creator/products');
  const products = new ProductSupervisor(productsRoot);
  const double = new TestDoubleExecutor(products);
  const env = {
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_PRODUCTS_ROOT: productsRoot,
  };
  const api = real
    ? createApi(env)
    : createApi(env, { artifacts: new ArtifactSupervisor(products, double) });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: origin,
    CREATOR_SESSION_FILE: join(dir, 'session.json'),
  };
  const cli = async (...args: string[]) => {
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [resolve('apps/cli/dist/main.js'), ...args],
        { env: cliEnv, cwd: dir, timeout: 240000, windowsHide: true },
      );
      return JSON.parse(
        args[0] === 'study-build'
          ? stdout.slice(stdout.indexOf('\n') + 1)
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

  // Owner's frozen build task: the reviewed T12 fixture spec, frozen and humility-reviewed.
  const seed = await cli('seed-selection');
  const ws: string = seed.workspace.id;
  const specId: string = seed.spec.id;
  const before = await cli('spec', ws, specId);
  const revised = await cli(
    'spec-revise',
    ws,
    specId,
    JSON.stringify({
      expected_version: before.spec.version,
      title: 'Synthetic bounded checklist',
      content: BUILD_FIXTURE_SPEC,
      reason: 'Synthetic T15 study build task; no empirical product claim',
    }),
  );
  const freezeBody = JSON.stringify({
    spec: { id: specId, version: revised.spec.version },
    justification: 'Synthetic exact T15 freeze',
    data_class: 'synthetic',
  });
  const asked = await cli('spec-freeze', ws, seed.run, freezeBody);
  if (asked.status === 'needs_human') {
    const d = await cli('decision', ws, asked.admission.decision_id);
    await cli(
      'answer',
      ws,
      d.id,
      d.coverage.coverage_hash,
      'approve_once',
      'Synthetic exact-version freeze',
    );
    assert.equal(
      (await cli('spec-freeze', ws, seed.run, freezeBody)).status,
      'frozen',
    );
  } else assert.equal(asked.status, 'frozen');
  const review = await cli(
    'create',
    ws,
    'humility_review',
    'Synthetic checklist spec humility review',
    JSON.stringify(
      fixtureHumilityReview({ id: specId, version: revised.spec.version }, []),
    ),
  );
  const status = (await http(`workspaces/${ws}/specs/${specId}`)).body;
  const implementation = {
    spec_id: specId,
    spec_version: status.spec.version,
    spec_hash: status.spec.content_hash,
    freeze_id: status.latest_freeze.id,
    task_key: 'T1',
    task_hash: status.latest_freeze.task_hashes.T1,
    humility_review: { id: review.id, version: review.version },
    max_repairs: 0,
    timeout_ms: 10000,
    max_output_tokens: 3000,
  };
  const study = (overrides: Partial<StudyInput> = {}): StudyInput => ({
    ...structuredClone(SYNTHETIC_STUDY),
    title: `${LABEL} Implementation task`,
    packet: {
      ...structuredClone(SYNTHETIC_STUDY.packet),
      stratum: 'implementation',
      implementation,
    },
    // $8 of simulated units per attempt against the $20 ledger: two open attempts fit, three do not.
    config: { ...SYNTHETIC_STUDY.config, max_cost_nano_usd: '8000000000' },
    governance: structuredClone(SYNTHETIC_GOVERNANCE) as any,
    ...overrides,
  });
  const call: StudyCall = async (path, body) => {
    const r = await http(path, body);
    if (r.status >= 300)
      throw new Error(`API returned ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  return {
    db,
    api,
    store: api.store!,
    owner: { actorId: DEFAULT_OWNER_ACTOR_ID },
    ws,
    specId,
    implementation,
    study,
    http,
    call,
    cli,
    file,
    products,
    double,
  };
}

test('T15 config keeps the owner model preference and $20 cap and leaves every study decision unresolved', () => {
  const c = readEvaluationConfig();
  assert.equal(c.model.owner_preference, 'gpt-6-astra');
  assert.equal(c.model.verified_model_id, null);
  assert.equal(c.model.live_dispatch_enabled, false);
  assert.equal(c.budget.t15_total_cap_usd, '20.00');
  assert.equal(c.budget.t15_total_cap_nano_usd, '20000000000');
  assert.equal(c.budget.spend_authorized, false);
  for (const item of Object.values(c.governance))
    assert.equal(item.status, 'unresolved');
  const open = evaluationReadiness(c);
  for (const rd of ['RD3', 'RD4', 'RD5', 'RD6', 'RD8'])
    assert.ok(
      open.some((l) => l.includes(rd)),
      `${rd} must be listed as unresolved`,
    );
});

test('synthetic implementation attempts: A/B build in isolated per-attempt products with exact hashes; C is refused the builder and its code is checked server-side; budget holds, cancellation and mismatches refuse', async (t) => {
  const s = await setup(t, false);
  if (!s) return;
  const { http, call, ws, implementation } = s;
  const heldOut = frozenCases(BUILD_FIXTURE_SPEC).filter((c) => c.held_out);
  assert.ok(heldOut.length > 0);

  // Exact versions: a wrong task or spec hash, or a different cap, cannot bind a study.
  const wrongTask = await http(
    `workspaces/${ws}/studies`,
    s.study({
      packet: {
        ...s.study().packet,
        implementation: { ...implementation, task_hash: digest('other') },
      },
    }),
  );
  assert.equal(wrongTask.status, 400);
  assert.equal(wrongTask.body.error.code, 'EVIDENCE_MISMATCH');
  const wrongSpec = await http(
    `workspaces/${ws}/studies`,
    s.study({
      packet: {
        ...s.study().packet,
        implementation: { ...implementation, spec_hash: digest('other') },
      },
    }),
  );
  assert.equal(wrongSpec.body.error.code, 'EVIDENCE_MISMATCH');
  const wrongCap = await http(
    `workspaces/${ws}/studies`,
    s.study({
      governance: {
        ...(SYNTHETIC_GOVERNANCE as any),
        budget: { ledger_cap_nano_usd: '40000000000' },
      },
    }),
  );
  assert.equal(wrongCap.body.error.code, 'INVALID_CONFIG');

  const created = await http(`workspaces/${ws}/studies`, s.study());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.synthetic, true);
  const assign = async (condition: string) => {
    const r = await http(`workspaces/${ws}/studies/${created.body.id}/assign`, {
      manifest_hash: created.body.manifest_hash,
      participant_actor_id: DEFAULT_OWNER_ACTOR_ID,
      participant_code: 'synthetic-owner',
      prior_familiarity: `${LABEL} Same operator; not independent participants.`,
      condition,
      discovery_method:
        condition === 'human_only' ? 'human_defined' : 'structured',
      continuation_of: null,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const A = await assign('autonomous');
  const B = await assign('human_in_loop');
  const C = await assign('human_only');
  const A2 = await assign('autonomous');
  const attempt = (id: string) => `workspaces/${ws}/study-attempts/${id}`;
  const entries = async (id: string) =>
    (await http(`${attempt(id)}/entries`)).body as {
      kind: string;
      payload: any;
      content_hash: string;
    }[];

  // Each attempt has its own workspace and a pinned copy of the exact frozen spec.
  assert.equal(new Set([A, B, C, A2].map((a) => a.workspace_id)).size, 4);
  const pinA = (await entries(A.id))[0]!.payload.pinned;
  assert.equal(pinA.spec.content_hash, implementation.spec_hash);
  assert.equal(pinA.source.task_hash, implementation.task_hash);
  assert.notEqual(pinA.spec.id, implementation.spec_id);

  // Participant context: visible task and cases only; held-out cases are a count.
  const contextC = (await http(`${attempt(C.id)}/context`)).body;
  assert.equal(
    contextC.context.implementation_task.held_out_cases,
    heldOut.length,
  );
  assert.ok(!JSON.stringify(contextC).includes(HELD_OUT_ARG));

  // Human-only: no builder, durable denial; no model call path.
  const deniedBuild = await http(`${attempt(C.id)}/build`, {});
  assert.equal(deniedBuild.status, 403);
  assert.equal(deniedBuild.body.error.code, 'HUMAN_ONLY_DENIED');
  assert.ok(
    (await entries(C.id)).some(
      (e) => e.kind === 'helper_denied' && e.payload.helper === 'build',
    ),
  );
  assert.equal((await http(`${attempt(C.id)}/execute`, {})).status, 403);

  // C submits code through the CLI; the server runs every frozen case, held-out included.
  const sentinel = `SENTINEL_C_${digest(C.id).slice(0, 12)}`;
  const code = await s.cli(
    'study-code',
    ws,
    C.id,
    await s.file('c-files', {
      files: [
        {
          path: 'src/main.py',
          content: `${BUILD_FIXTURE_SOURCE}# ${sentinel}\n`,
        },
      ],
    }),
  );
  assert.equal(
    code.checks.length,
    frozenCases(BUILD_FIXTURE_SPEC).length,
    'every frozen case ran',
  );
  assert.ok(code.checks.some((c: any) => c.held_out));
  assert.equal(code.isolation_evidence, false, 'test double is not isolation');
  assert.ok(!JSON.stringify(code).includes(HELD_OUT_ARG));
  // The AI arms cannot use the human code path.
  const aiCode = await http(`${attempt(A.id)}/code-check`, {
    product_id: code.artifact.id,
    task_id: code.artifact.id,
    commit: 'a'.repeat(40),
  });
  assert.equal(aiCode.status, 409);

  // Budget: each prepared AI attempt holds its whole cap; a third open one does not fit.
  assert.equal((await http(`${attempt(A.id)}/build`, {})).status, 201);
  assert.equal((await http(`${attempt(B.id)}/build`, {})).status, 201);
  const over = await http(`${attempt(A2.id)}/build`, {});
  assert.equal(over.status, 409, JSON.stringify(over.body));
  assert.equal(over.body.error.code, 'BUDGET_EXCEEDED');
  assert.ok((await entries(A2.id)).some((e) => e.kind === 'budget_refused'));

  // A and B: the real T12 builder through the real API admission, broker and grants.
  const requests: string[] = [];
  const recording: StudyCall = async (path, body, timeout) => {
    if (path.endsWith('/model-calls')) requests.push(JSON.stringify(body));
    return call(path, body, timeout);
  };
  const builds = new BuildSupervisor(s.products, s.double);
  const runA = await runStudyBuild(builds, recording, ws, A.id);
  assert.equal(runA.outcome.state, 'verified_candidate', runA.outcome.reason);
  const requestsBeforeB = requests.length;
  const runB = await runStudyBuild(builds, recording, ws, B.id);
  assert.equal(runB.outcome.state, 'verified_candidate', runB.outcome.reason);
  assert.notEqual(runA.product_id, runB.product_id);
  assert.ok(requests.length > requestsBeforeB);
  // No other arm's code and no held-out case reached any role packet.
  for (const r of requests) {
    assert.ok(!r.includes(sentinel), 'C code leaked into a builder packet');
    assert.ok(!r.includes(HELD_OUT_ARG), 'held-out case reached a role');
  }
  for (const [run, a] of [
    [runA, A],
    [runB, B],
  ] as const) {
    const e = await entries(a.id);
    const build = e.find((x) => x.kind === 'build')!;
    assert.equal(build.payload.spec_hash, implementation.spec_hash);
    assert.equal(build.payload.task_hash, implementation.task_hash);
    assert.equal(build.payload.commit, run.outcome.commit);
    assert.equal(build.payload.isolation_evidence, false);
    const artifact = e.find((x) => x.kind === 'artifacts')!;
    const files = JSON.parse(artifact.payload.content).files;
    assert.equal(
      files.find((f: any) => f.path === 'src/main.py').sha256,
      digest(BUILD_FIXTURE_SOURCE),
    );
    const tests = e.filter((x) => x.kind === 'tests');
    assert.equal(tests.length, frozenCases(BUILD_FIXTURE_SPEC).length);
    for (const x of tests)
      assert.equal(x.payload.artifact_hash, artifact.content_hash);
    assert.equal(
      e.find((x) => x.kind === 'finished')!.payload.status,
      'submitted',
    );
    assert.ok(!JSON.stringify(e).includes(HELD_OUT_ARG));
  }
  // A build is recorded once; another arm's product cannot be recorded for this attempt.
  const again = await http(`${attempt(A.id)}/build-record`, {
    product_id: runA.product_id,
    build_id: runA.outcome.id,
  });
  assert.equal(again.body.duplicate, true);
  const crossed = await http(`${attempt(A.id)}/build-record`, {
    product_id: runB.product_id,
    build_id: runB.outcome.id,
  });
  assert.equal(crossed.body.error.code, 'EVIDENCE_MISMATCH');

  // A and B are finished, so their holds shrink to settled cost and A2 now fits. It is
  // cancelled after its first role result: the trace is kept but never applied or submitted.
  let cancelled = false;
  const cancelling: StudyCall = async (path, body, timeout) => {
    const result = await call(path, body, timeout);
    if (path.endsWith('/model-calls') && !cancelled) {
      cancelled = true;
      await call(`${attempt(A2.id)}/finish`, {
        status: 'cancelled',
        summary: `${LABEL} Cancelled mid-build to test retention.`,
        human_active_minutes: 0,
        human_wait_seconds: 0,
      });
    }
    return result;
  };
  const runA2 = await runStudyBuild(builds, cancelling, ws, A2.id);
  assert.equal(runA2.outcome.state, 'checkpoint');
  assert.match(runA2.outcome.reason, /cancelled/);
  const e2 = await entries(A2.id);
  const kept = e2.find((x) => x.kind === 'build')!;
  assert.equal(kept.payload.attempt_state_at_record, 'cancelled');
  assert.ok(!e2.some((x) => x.kind === 'artifacts'));
  assert.deepEqual(
    e2.filter((x) => x.kind === 'finished').map((x) => x.payload.status),
    ['cancelled'],
  );
  assert.equal((await http(`${attempt(A2.id)}/build`, {})).status, 409);

  // Export: every attempt and its build evidence; still synthetic, no empirical claim.
  const exported = (
    await http(`workspaces/${ws}/studies/${created.body.id}/export`)
  ).body;
  assert.equal(exported.synthetic, true);
  assert.equal(exported.empirical_results, false);
  assert.deepEqual(
    exported.attempts.map((a: any) => a.state),
    ['submitted', 'submitted', 'assigned', 'cancelled'],
  );
  assert.ok(!JSON.stringify(exported).includes(HELD_OUT_ARG));
});

test('final (non-synthetic) records are refused until every owner answer is in an adopted freeze, and never run AI while live dispatch is disabled', async (t) => {
  const s = await setup(t, false);
  if (!s) return;
  const { store, owner } = s;
  const real = (
    await store.createWorkspace(owner, {
      name: `${LABEL} real-mode gate check`,
      record_mode: 'real',
    })
  ).id;
  const decided = (decision: string) => {
    const d = BLOCKING_DECISIONS.find((x) => x.id === decision)!;
    return {
      status: 'decided' as const,
      decision,
      choice: d.recommendation,
      reference: `${LABEL} test freeze answer`,
    };
  };
  const finalStudy = (freezeHash: string, verified: string | null) => ({
    ...structuredClone(SYNTHETIC_STUDY),
    synthetic: false,
    title: `${LABEL} final-record gate`,
    config: {
      ...SYNTHETIC_STUDY.config,
      model_version: verified ?? 'gpt-6-astra',
    },
    evaluation: { freeze_hash: freezeHash },
    governance: {
      label: LABEL,
      participants: decided('RD3-participants'),
      reviewers: decided('RD4-reviewers'),
      human_subjects: decided('RD5-human-subjects'),
      task_selection: decided('RD8-final-tasks'),
      model: {
        owner_preference: 'gpt-6-astra',
        verified_model_id: verified,
        decision: 'RD6-model-and-cap',
      },
      budget: { ledger_cap_nano_usd: '20000000000' },
    },
  });
  const refused = async (raw: unknown) => {
    try {
      await store.createStudy(owner, real, raw);
    } catch (e) {
      return (e as { details: string[] }).details;
    }
    assert.fail('A final record was created');
  };
  // No freeze yet.
  const none = await refused(finalStudy(digest('none'), null));
  assert.ok(none.some((d) => /No adopted protocol freeze/.test(d)));
  // Adopted test freeze in this throwaway database; governance matches it, but the model
  // is unverified in config/evaluation.json, so the gate still refuses.
  const freeze = await store.freezeStudyProtocol(owner, real, {
    proposal_hash: canonicalHash(PROPOSED_PROTOCOL),
    decisions: BLOCKING_DECISIONS.map((d) => ({
      id: d.id,
      choice: d.recommendation,
      rationale: `${LABEL} test answer`,
    })),
  });
  const model = await refused(finalStudy(freeze.freeze_hash, null));
  assert.deepEqual(model, [
    'No verified API model id for gpt-6-astra (RD6-model-and-cap).',
  ]);
  // A choice that differs from the freeze answer is refused, never silently accepted.
  const drifted = finalStudy(freeze.freeze_hash, null);
  drifted.governance.participants = {
    ...drifted.governance.participants,
    choice: 'Something the owner did not answer',
  };
  assert.ok(
    (await refused(drifted)).some((d) =>
      /participants choice does not match/.test(d),
    ),
  );
  assert.ok(
    (
      await refused({
        ...finalStudy(freeze.freeze_hash, null),
        evaluation: { freeze_hash: digest('stale') },
      })
    ).some((d) => /bind the hash of the adopted freeze/.test(d)),
  );

  // Test seam only: a stand-in verified id shows the path once every condition holds.
  const saved = store.evaluation;
  t.after(() => {
    store.evaluation = saved;
  });
  store.evaluation = {
    ...saved,
    model: { ...saved.model, verified_model_id: 'test-stand-in-gpt-6-astra' },
  };
  const created = await store.createStudy(
    owner,
    real,
    finalStudy(freeze.freeze_hash, 'test-stand-in-gpt-6-astra'),
  );
  assert.equal(created.synthetic, false);
  assert.equal(created.status, 'final_record');
  const assign = (condition: 'autonomous' | 'human_only') =>
    store.assignStudy(owner, real, created.id, {
      manifest_hash: created.manifest_hash,
      participant_actor_id: DEFAULT_OWNER_ACTOR_ID,
      participant_code: 'gate-check',
      prior_familiarity: LABEL,
      condition,
      discovery_method:
        condition === 'human_only' ? 'human_defined' : 'structured',
      continuation_of: null,
    });
  const ai = await assign('autonomous');
  const human = await assign('human_only');
  const mode = await s.db.pool.query(
    'select record_mode, fixture from workspaces where id = any($1)',
    [[ai.workspace_id, human.workspace_id]],
  );
  assert.deepEqual(
    mode.rows.map((r) => [r.record_mode, r.fixture]),
    [
      ['real', false],
      ['real', false],
    ],
  );
  // No AI grant was issued and execution refuses: live dispatch is disabled.
  const grants = await s.db.pool.query(
    'select 1 from grants where workspace_id=$1',
    [ai.workspace_id],
  );
  assert.equal(grants.rowCount, 0);
  await assert.rejects(
    store.prepareStudyExecution(owner, real, ai.id),
    (e: { code?: string }) => e.code === 'LIVE_DISABLED',
  );
  // Lock order (ADR-0047): a final build takes the study-ledger and runtime-ceiling locks
  // before the audit-chain lock, as ceiling and limit saves do, so the two cannot deadlock.
  // While the build waits on either, another transaction can still take the audit lock.
  for (const key of ['study-ledger:t15-final', 'runtime-ceiling']) {
    const holder: import('pg').PoolClient = await s.db.pool.connect();
    try {
      await holder.query('begin');
      await holder.query('select pg_advisory_xact_lock(hashtext($1))', [key]);
      const build = store.prepareStudyBuild(owner, real, ai.id);
      const settled = build.then(
        () => 'resolved',
        (e: { code?: string }) => e.code,
      );
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        const w = await s.db.pool.query(
          "select 1 from pg_locks where locktype='advisory' and not granted and objid = hashtext($1)::oid",
          [key],
        );
        waiting = Boolean(w.rowCount);
        if (!waiting) await new Promise((r) => setTimeout(r, 25));
      }
      assert.ok(waiting, `the final build never waited on ${key}`);
      const audit: { rows: { ok: boolean }[] } = await holder.query(
        'select pg_try_advisory_xact_lock($1) as ok',
        [AUDIT_CHAIN_LOCK],
      );
      assert.equal(
        audit.rows[0]!.ok,
        true,
        `audit lock held while waiting on ${key}`,
      );
      await holder.query('rollback');
      assert.equal(await settled, 'LIVE_DISABLED');
    } finally {
      await holder.query('rollback').catch(() => undefined);
      holder.release();
    }
  }
  // Human-only work records normally on the final path.
  await store.writeAttempt(owner, real, human.id, 'artifacts', {
    kind: 'document',
    name: 'Gate-check note',
    content: LABEL,
  });
  await store.writeAttempt(owner, real, human.id, 'finish', {
    status: 'submitted',
    summary: LABEL,
    human_active_minutes: 1,
    human_wait_seconds: 0,
  });
  const exported = await store.exportStudy(owner, real, created.id);
  assert.equal(exported.synthetic, false);
  assert.equal(exported.empirical_results, false);
});

const wsl2 = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
test(
  'compiled study-build CLI runs a synthetic A attempt in the reviewed WSL2 worker and records isolation evidence',
  {
    skip:
      !wsl2 && 'Study builds in real isolation require the opt-in WSL2 gate',
  },
  async (t) => {
    const s = await setup(t, true);
    if (!s) return;
    const created = await s.http(`workspaces/${s.ws}/studies`, s.study());
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const A = (
      await s.http(`workspaces/${s.ws}/studies/${created.body.id}/assign`, {
        manifest_hash: created.body.manifest_hash,
        participant_actor_id: DEFAULT_OWNER_ACTOR_ID,
        participant_code: 'synthetic-owner',
        prior_familiarity: LABEL,
        condition: 'autonomous',
        discovery_method: 'structured',
        continuation_of: null,
      })
    ).body;
    const run = await s.cli('study-build', s.ws, A.id);
    assert.equal(run.outcome.state, 'verified_candidate', run.outcome.reason);
    const e = (
      await s.http(`workspaces/${s.ws}/study-attempts/${A.id}/entries`)
    ).body as { kind: string; payload: any }[];
    const build = e.find((x) => x.kind === 'build')!;
    assert.equal(build.payload.isolation_evidence, true);
    assert.equal(
      e.find((x) => x.kind === 'finished')!.payload.status,
      'submitted',
    );
  },
);
