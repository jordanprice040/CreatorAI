import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  rm,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ProductSupervisor,
  ExecutionSupervisor,
  BuildSupervisor,
  digest,
  scorePatchCase,
  gradePatchCase,
  qaCaseSchema,
  PLAN_ROLE_CONTEXT_MAX,
  PATCH_RULES,
  pathSchema,
  type Execution,
  type Binding,
  type BuildApprovalScope,
  type BuildPlan,
  type BuildPorts,
} from '@creator/executor';
import { TestDoubleExecutor } from './artifact-double.js';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_FIXTURE_SPEC,
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_SOURCE,
  buildFixtureAnswer,
  frozenCases,
  taskHashes,
} from '@creator/domain';
import type {
  SpecBody,
  BrokerCallRequest,
  BrokerCallResult,
} from '@creator/contracts';

async function setup(
  t: test.TestContext,
  edit: (spec: SpecBody) => SpecBody = (spec) => spec,
) {
  const parent = resolve('.verification/build-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(root.startsWith(parent));
    await rm(root, { recursive: true, force: true });
  });
  const spec: SpecBody = edit({
    ...structuredClone(BUILD_FIXTURE_SPEC),
    format: 'spec/1',
    alternative: { id: randomUUID(), version: 1 },
    selection_id: randomUUID(),
  });
  const binding: Binding = {
    workspace_id: randomUUID(),
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest('spec'),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: taskHashes(spec).T1!, file_scope: ['src'] }],
  };
  const products = new ProductSupervisor(join(root, 'products'));
  const product = await products.create(binding);
  const task = await products.createTask(
    product.id,
    'T1',
    product.initial_commit,
    binding,
  );
  const executor = new ExecutionSupervisor(products);
  const builds = new BuildSupervisor(products, executor);
  const plan: BuildPlan = {
    format: 'build-plan/1',
    run_id: randomUUID(),
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
    humility_review: { id: randomUUID(), version: 1 },
    data_class: 'synthetic',
    max_repairs: 0,
    max_calls: 2,
    timeout_ms: 10000,
    max_output_tokens: 3000,
    deadline: new Date(Date.now() + 300000).toISOString(),
    cases: structuredClone(BUILD_FIXTURE_CASES),
  };
  const requests: BrokerCallRequest[] = [];
  let script = (r: BrokerCallRequest) =>
    JSON.parse(buildFixtureAnswer(r.input)!);
  let active = true;
  const ports: BuildPorts = {
    current: async () => ({ binding, spec }),
    assertActive: async () => {
      if (!active) throw new Error('run cancelled');
    },
    authorize: async () => ({ verdict: 'allow', fixture: true }),
    call: async (_run, r) => {
      requests.push(r);
      const json: unknown = script(r);
      return {
        status: 'succeeded',
        reason_code: 'fixture',
        explanation: 'Test-only port; real broker tested separately',
        logical_operation_id: r.logical_operation_id,
        attempts: [],
        output: { text: JSON.stringify(json), json, vector: null },
        decision_id: null,
        fixture: true,
        replayed: false,
      } satisfies BrokerCallResult;
    },
  };
  return {
    root,
    products,
    product,
    task,
    binding,
    spec,
    builds,
    executor,
    plan,
    ports,
    requests,
    script: (fn: typeof script) => {
      script = fn;
    },
    cancel: () => {
      active = false;
    },
    run: () =>
      builds.run(product.id, task.id, product.initial_commit, plan, ports),
  };
}

test('builder rejects missing acceptance coverage, stale task hashes and cancelled runs before calls', async (t) => {
  const s = await setup(t);
  s.plan.cases.pop();
  await assert.rejects(s.run(), /cases frozen in the spec/);
  // A build cannot swap in weaker cases of its own: the frozen ones are bound by the task hash.
  s.plan.cases = structuredClone(BUILD_FIXTURE_CASES);
  s.plan.cases[1]!.stdout = 'anything\n';
  await assert.rejects(s.run(), /cases frozen in the spec/);
  s.plan.cases = structuredClone(BUILD_FIXTURE_CASES);
  s.spec.tasks[0]!.deliverable = 'Changed';
  await assert.rejects(s.run(), /hash mismatch/);
  s.cancel();
  await assert.rejects(s.run(), /cancelled/);
  assert.equal(s.requests.length, 0);
});

test('unsupported builder success claims never become verification or execute code', async (t) => {
  const s = await setup(t);
  s.script(() => ({
    summary: 'All tests passed!',
    submission: null,
    blocker: null,
  }));
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /no submitted patch/);
  assert.equal((await s.executor.executions(s.product.id)).length, 0);
  assert.equal(s.requests.length, 1);
});

test('admission refusal and expired deadlines dispatch no models', async (t) => {
  const s = await setup(t);
  s.ports.authorize = async () => {
    throw new Error('admission denied');
  };
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /admission denied/);
  assert.equal(s.requests.length, 0);
  s.plan.deadline = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(s.run(), /deadline/);
  assert.equal(s.requests.length, 0);
});

test('concurrent builds are refused; cancellation after a role result preserves its trace without applying it', async (t) => {
  const s = await setup(t);
  const original = s.ports.call;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  s.ports.call = async (run, r) => {
    entered();
    await held;
    return original(run, r);
  };
  const running = s.run();
  await started;
  await assert.rejects(s.run(), /locked/);
  s.cancel();
  release();
  const result = await running;
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /cancelled/);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(s.requests.length, 1);
  const trace = JSON.parse(
    await readFile(
      join(
        s.products.dir(s.product.id),
        'builds',
        result.id,
        'call-1-outcome.json',
      ),
      'utf8',
    ),
  );
  assert.equal(trace.status, 'succeeded');
});

test('scoped tools reject builder policy edits and retain the original code', async (t) => {
  const s = await setup(t);
  s.script(() => ({
    summary: 'success',
    blocker: null,
    submission: {
      expected_commit: s.product.initial_commit,
      changes: [
        { path: 'readme.md', before_hash: null, content: 'scope expansion' },
      ],
    },
  }));
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /scope exceeded/);
  assert.equal(result.commit, s.product.initial_commit);
});

test('fresh review excludes builder claims; a mismatched reviewed commit fails before QA', async (t) => {
  const s = await setup(t);
  s.script((r) => {
    const value = JSON.parse(buildFixtureAnswer(r.input)!);
    if (r.input[0]!.text.startsWith('builder/'))
      value.summary = 'SECRET_BUILDER_SUCCESS_CLAIM';
    else value.candidate = 'f'.repeat(40);
    return value;
  });
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /not bound/);
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[1]!.input.length, 2);
  assert.ok(!JSON.stringify(s.requests[1]).includes('SECRET_BUILDER'));
  assert.equal((await s.executor.executions(s.product.id)).length, 0);
  assert.equal(
    await readFile(
      join(s.products.worktree(s.product.id, s.task.id), 'src/main.py'),
      'utf8',
    ),
    BUILD_FIXTURE_SOURCE,
  );
});

const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
test(
  'real bounded builder verifies normal and error flows; changed commits and frozen specs invalidate evidence',
  { skip: !real && 'Real WSL2 gate is opt-in' },
  async (t) => {
    const s = await setup(t);
    const result = await s.run();
    assert.equal(result.state, 'verified_candidate', JSON.stringify(result));
    assert.equal(result.calls, 2);
    assert.equal((await s.executor.executions(s.product.id)).length, 2);
    assert.equal(
      (await s.builds.status(s.product.id, result.id, s.ports)).state,
      'verified_candidate',
    );
    const restarted = new BuildSupervisor(
      s.products,
      new ExecutionSupervisor(s.products),
    );
    assert.equal(
      (await restarted.status(s.product.id, result.id, s.ports)).commit,
      result.commit,
    );
    await s.products.apply(
      s.product.id,
      s.task.id,
      {
        expected_commit: result.commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(BUILD_FIXTURE_SOURCE),
            content: 'print("broken")\n',
          },
        ],
      },
      s.binding,
    );
    await assert.rejects(
      s.builds.status(s.product.id, result.id, s.ports),
      /Changed candidate/,
    );
    s.binding.spec_hash = digest('changed');
    await assert.rejects(
      s.builds.status(s.product.id, result.id, s.ports),
      /specification or task hashes changed/,
    );
  },
);

test(
  'real QA rejects broken behavior even when both roles claim success; bounded repairs preserve commits',
  { skip: !real && 'Real WSL2 gate is opt-in' },
  async (t) => {
    const s = await setup(t);
    s.plan.max_repairs = 2;
    s.plan.max_calls = 6;
    let cycle = 0;
    s.script((r) => {
      const packet = JSON.parse(r.input[1]!.text);
      const value = JSON.parse(buildFixtureAnswer(r.input)!);
      if (r.input[0]!.text.startsWith('builder/')) {
        cycle++;
        value.submission.changes[0].content = `print("broken ${cycle}")\n`;
      } else {
        value.verdict = 'approve';
        value.findings = [];
      }
      assert.equal(
        value.submission?.expected_commit ?? value.candidate,
        packet.candidate,
      );
      return value;
    });
    const result = await s.run();
    assert.equal(result.state, 'checkpoint');
    assert.match(result.reason, /Repair limit/);
    assert.equal(result.repairs, 2);
    assert.equal(result.calls, 6);
    assert.equal((await s.executor.executions(s.product.id)).length, 6);
    assert.match(
      await readFile(
        join(s.products.worktree(s.product.id, s.task.id), 'src/main.py'),
        'utf8',
      ),
      /broken 3/,
    );
  },
);

test('held-out QA cases never reach a role packet, and a task without one is refused', async (t) => {
  const s = await setup(t);
  await s.run();
  assert.ok(s.requests.length >= 1);
  const held = BUILD_FIXTURE_CASES[1]!;
  for (const r of s.requests) {
    const packet = r.input[1]!.text;
    assert.equal(packet.includes(JSON.stringify(held.stdout)), false);
    assert.equal(packet.includes(JSON.stringify(held.args)), false);
    const parsed = JSON.parse(packet) as {
      cases: { check_key: string }[];
      held_out_cases: number;
    };
    assert.deepEqual(
      parsed.cases.map((c) => c.check_key),
      ['A1'],
    );
    assert.equal(parsed.held_out_cases, 1);
  }
  assert.equal(held.check_key, 'A2');
  const before = s.requests.length;
  s.spec.acceptance_checks[1]!.cases![0]!.held_out = false;
  await assert.rejects(s.run(), /held-out case/);
  assert.equal(s.requests.length, before);
});

test('the ChatGPT-plan Codex builder still goes through scoped patches and an independent broker review', async (t) => {
  const s = await setup(t);
  const plan = {
    ...s.plan,
    codex_plan_builder: {
      connection_id: randomUUID(),
      model_id: 'fixture-plan-model',
    },
  };
  const missing = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    s.ports,
  );
  assert.equal(missing.state, 'checkpoint');
  assert.match(missing.reason, /Codex plan builder is not configured/);
  assert.equal(s.requests.length, 0);
  const packets: Record<string, unknown>[] = [];
  const ports: BuildPorts = {
    ...s.ports,
    codexBuilder: async (target, packet) => {
      assert.equal(target.model_id, 'fixture-plan-model');
      packets.push(packet);
      // The fixture's own builder answer stands in for a Codex workspace diff.
      const answer = JSON.parse(
        buildFixtureAnswer([
          { role: 'system', text: 'builder/1: fixture' },
          { role: 'user', text: JSON.stringify(packet) },
        ])!,
      ) as { submission: unknown };
      return {
        summary: 'CODEX_SUMMARY_CLAIM',
        submission: answer.submission,
        blocker: null,
      };
    },
  };
  const result = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    ports,
  );
  assert.equal(packets.length, 1);
  assert.equal(s.requests.length, 1, 'only the reviewer used the broker');
  assert.ok(s.requests[0]!.input[0]!.text.startsWith('independent-reviewer/'));
  assert.ok(!JSON.stringify(s.requests[0]).includes('CODEX_SUMMARY_CLAIM'));
  // Held-out expectations never reach the Codex packet either.
  const assigned = s.spec.tasks.find((x) => x.key === 'T1')!.acceptance;
  const heldOut = frozenCases(s.spec, assigned).filter((c) => c.held_out);
  assert.ok(heldOut.length > 0);
  for (const c of heldOut)
    assert.ok(!JSON.stringify(packets[0]).includes(JSON.stringify(c.stdout)));
  assert.notEqual(
    result.commit,
    s.product.initial_commit,
    'the patch was applied as a scoped change',
  );
  // The final state comes from QA on this host, never from the Codex claim. Real
  // execution needs Windows + WSL2; elsewhere every QA case fails closed. On Windows
  // without the opt-in gate the worker may or may not be usable, so either state stands.
  if (real) assert.equal(result.state, 'verified_candidate');
  else if (process.platform === 'win32')
    assert.ok(['verified_candidate', 'checkpoint'].includes(result.state));
  else {
    assert.equal(result.state, 'checkpoint');
    assert.match(result.reason, /Repair limit reached/);
  }
});

test('a Codex builder change outside the task scope is refused by the scoped patch tool', async (t) => {
  const s = await setup(t);
  const plan = {
    ...s.plan,
    codex_plan_builder: {
      connection_id: randomUUID(),
      model_id: 'fixture-plan-model',
    },
  };
  const result = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    {
      ...s.ports,
      codexBuilder: async (_target, packet) => ({
        summary: 's',
        submission: {
          expected_commit: packet.candidate,
          changes: [{ path: 'policy.json', before_hash: null, content: '{}' }],
        },
        blocker: null,
      }),
    },
  );
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /scope/);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(s.requests.length, 0);
});

test('a Codex builder packet past the plan-role ceiling stops before Codex is asked', async (t) => {
  // Full audit L-11: the Codex packet was bounded only by the API's 1 MiB body.
  // Visible frozen cases at their schema maximums are the largest valid part of a packet.
  const s = await setup(t, (spec) => {
    const [a1, ...rest] = spec.acceptance_checks;
    const big = Array.from({ length: 8 }, () => ({
      args: Array.from({ length: 12 }, () => 'a'.repeat(500)),
      stdin: 'i'.repeat(4000),
      stdout: '"'.repeat(12000),
      exit_code: 0,
      held_out: false,
    }));
    return {
      ...spec,
      acceptance_checks: [{ ...a1!, cases: [...a1!.cases!, ...big] }, ...rest],
    };
  });
  let asked = 0;
  const result = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    {
      ...s.plan,
      cases: frozenCases(s.spec).map(({ held_out: _, ...c }) => c),
      codex_plan_builder: {
        connection_id: randomUUID(),
        model_id: 'fixture-plan-model',
      },
    },
    {
      ...s.ports,
      codexBuilder: async () => {
        asked++;
        throw new Error('no Codex turn may start');
      },
    },
  );
  assert.equal(result.state, 'checkpoint');
  assert.match(
    result.reason,
    new RegExp(
      `Codex builder context exceeds bounded packet \\(\\d+ > ${PLAN_ROLE_CONTEXT_MAX}`,
    ),
  );
  assert.equal(asked, 0);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(s.requests.length, 0);
});

test('plan roles send builder and reviewer as fresh plan requests and never touch the broker', async (t) => {
  const s = await setup(t);
  const plan: BuildPlan = {
    ...s.plan,
    timeout_ms: 120000,
    plan_roles: { connection_id: randomUUID(), model_id: 'fixture-plan' },
  };
  const go = (ports: BuildPorts) =>
    s.builds.run(
      s.product.id,
      s.task.id,
      s.product.initial_commit,
      plan,
      ports,
    );
  const missing = await go(s.ports);
  assert.equal(missing.state, 'checkpoint');
  assert.match(missing.reason, /Plan role route is not configured/);
  assert.equal(s.requests.length, 0);
  const seen: { role: string; input: string; timeout_ms: number }[] = [];
  let authorized = 0;
  // An unready role stops the build before the grant is used or the builder is sent.
  const unready = await go({
    ...s.ports,
    authorize: async () => {
      authorized++;
      return { verdict: 'allow', fixture: true };
    },
    planRolesReady: async () => [
      'Model fixture-plan is not qualified for independent_review (the T12 reviewer).',
    ],
    planRole: async () => {
      throw new Error('no role request may be sent');
    },
  });
  assert.equal(unready.state, 'checkpoint');
  assert.match(unready.reason, /not ready: .*independent_review/);
  assert.equal(authorized, 0);
  assert.equal(unready.calls, 0);
  const result = await go({
    ...s.ports,
    planRolesReady: async (target) => {
      assert.equal(target.run_id, plan.run_id);
      return [];
    },
    planRole: async (target, request) => {
      assert.equal(target.connection_id, plan.plan_roles!.connection_id);
      assert.equal(target.run_id, plan.run_id);
      seen.push({ role: target.role, ...request });
      // The server adds the fixed role prompt; the fixture needs it to pick an answer.
      const text = buildFixtureAnswer([
        { role: 'system', text: BUILD_ROLE_PROMPTS[target.role] },
        { role: 'user', text: request.input },
      ]);
      return {
        request_id: randomUUID(),
        status: 'succeeded',
        reason_code: 'ok',
        text,
        fixture: true,
      };
    },
  });
  assert.equal(s.requests.length, 0, 'no dollar broker call');
  assert.deepEqual(
    seen.map((x) => x.role),
    ['builder', 'reviewer'],
  );
  assert.ok(seen.every((x) => x.timeout_ms <= 120000));
  // The reviewer packet carries no builder summary or conversation.
  assert.ok(!seen[1]!.input.includes('builder/1'));
  const assigned = s.spec.tasks.find((x) => x.key === 'T1')!.acceptance;
  for (const c of frozenCases(s.spec, assigned).filter((c) => c.held_out))
    for (const x of seen)
      assert.ok(!x.input.includes(JSON.stringify(c.stdout)));
  const intent = JSON.parse(
    await readFile(
      join(
        s.products.dir(s.product.id),
        'builds',
        result.id,
        'call-2-intent.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  assert.equal(intent.route, 'chatgpt_plan_responses');
  assert.equal(intent.task_class, 'independent_review');
  assert.equal(intent.instructions, BUILD_ROLE_PROMPTS.reviewer);
  assert.equal(result.fixture, true);
  if (real) assert.equal(result.state, 'verified_candidate');
  else if (process.platform !== 'win32')
    assert.equal(result.state, 'checkpoint');
});

test('a failed plan role request stops the build without applying anything', async (t) => {
  const s = await setup(t);
  const plan: BuildPlan = {
    ...s.plan,
    plan_roles: { connection_id: randomUUID(), model_id: 'fixture-plan' },
  };
  const result = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    {
      ...s.ports,
      planRolesReady: async () => [],
      planRole: async () => ({
        request_id: randomUUID(),
        status: 'failed',
        reason_code: 'quota_exhausted',
        text: null,
        fixture: true,
      }),
    },
  );
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /quota_exhausted/);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(s.requests.length, 0);
});

test('plan-role packets are bounded by the accepted plan input cap, broker packets by 20,000', async (t) => {
  // Owner pilot F21: a v4 spec plus a 5.5k program and its diff passed 20,000 characters and
  // stopped a $0 plan build before the reviewer, though the accepted plan cap was 64,000.
  const s = await setup(t, (spec) => ({
    ...spec,
    problem_statement: 'p'.repeat(1200),
    scope: Array.from({ length: 20 }, (_, i) => `${i} ${'s'.repeat(290)}`),
    non_goals: Array.from({ length: 20 }, (_, i) => `${i} ${'n'.repeat(290)}`),
    risks: Array.from({ length: 20 }, () => ({
      risk: 'r'.repeat(300),
      mitigation: 'm'.repeat(300),
    })),
  }));
  const ports = s.ports;
  const broker = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    s.plan,
    ports,
  );
  assert.equal(broker.state, 'checkpoint');
  assert.match(broker.reason, /exceeds bounded packet \(\d+ > 20000/);
  assert.equal(s.requests.length, 0);
  const sizes: number[] = [];
  const plan: BuildPlan = {
    ...s.plan,
    plan_roles: { connection_id: randomUUID(), model_id: 'fixture-plan' },
  };
  await s.builds.run(s.product.id, s.task.id, s.product.initial_commit, plan, {
    ...ports,
    planRolesReady: async () => [],
    planRole: async (target, request) => {
      sizes.push(request.input.length);
      return {
        request_id: randomUUID(),
        status: 'succeeded',
        reason_code: 'ok',
        text: buildFixtureAnswer([
          { role: 'system', text: BUILD_ROLE_PROMPTS[target.role] },
          { role: 'user', text: request.input },
        ]),
        fixture: true,
      };
    },
  });
  assert.ok(sizes.length >= 1, 'the builder request was sent');
  assert.ok(sizes.every((n) => n > 20000));
  assert.equal(s.requests.length, 0, 'no dollar broker call');
});

test('plan roles exclude the Codex builder, and broker builds keep the 60 s call bound', async (t) => {
  const s = await setup(t);
  const target = { connection_id: randomUUID(), model_id: 'm' };
  const go = (plan: BuildPlan) =>
    s.builds.run(
      s.product.id,
      s.task.id,
      s.product.initial_commit,
      plan,
      s.ports,
    );
  await assert.rejects(
    go({ ...s.plan, plan_roles: target, codex_plan_builder: target }),
    /not both/,
  );
  await assert.rejects(go({ ...s.plan, timeout_ms: 60001 }), /60 s/);
  assert.equal(s.requests.length, 0);
});

test('the patch qualification scorer applies only scoped patches and never trusts a claim', async (t) => {
  const s = await setup(t);
  const check = {
    kind: 'patch_cases' as const,
    file_scope: ['src'],
    cases: structuredClone(BUILD_FIXTURE_CASES).slice(0, 1),
  };
  const score = (text: string | null) =>
    scorePatchCase(
      { products: s.products, executor: s.executor },
      s.binding.owner_id,
      check,
      text,
    );
  assert.equal(await score('not json'), 'schema_invalid');
  assert.equal(await score(null), 'schema_invalid');
  assert.equal(
    await score(
      '{"submission":null,"summary":"all tests pass","blocker":"none"}',
    ),
    'acceptance_check_failed',
  );
  const patch = (path: string) =>
    JSON.stringify({
      submission: {
        expected_commit: '0'.repeat(40),
        changes: [{ path, before_hash: null, content: 'print(1)\n' }],
      },
      summary: 's',
      blocker: null,
    });
  assert.equal(await score(patch('policy.json')), 'acceptance_check_failed');
  // In scope, the cases decide; without the WSL2 worker they fail closed.
  const before = await readdir(s.products.root).catch(() => []);
  const inScope = await score(patch('src/extra.py'));
  assert.deepEqual(
    await readdir(s.products.root).catch(() => []),
    before,
    'the throwaway product is removed after grading',
  );
  // A strict T12 builder answer only: extra or missing keys are a schema failure.
  assert.equal(
    await score(
      JSON.stringify({
        submission: null,
        summary: 's',
        blocker: null,
        extra: 1,
      }),
    ),
    'schema_invalid',
  );
  if (real) assert.equal(inScope, 'acceptance_check_failed');
  else assert.notEqual(inScope, 'accepted');
  // F10: each non-pass says where it failed, so a decline is not mistaken for a broken grader.
  const grade = (text: string | null) =>
    gradePatchCase(
      { products: s.products, executor: s.executor },
      s.binding.owner_id,
      check,
      text,
    );
  assert.match((await grade('not json'))!.detail!, /not valid JSON/);
  assert.match((await grade(null))!.detail!, /No answer text/);
  assert.match(
    (await grade('{"submission":null,"summary":"s","blocker":7}'))!.detail!,
    /not in the builder format: blocker/,
  );
  const declined = await grade(
    '{"submission":null,"summary":"s","blocker":"The task deadline has passed."}',
  );
  assert.equal(declined.signal, 'acceptance_check_failed');
  assert.match(
    declined.detail!,
    /no code change.*"The task deadline has passed\."/,
  );
  const outOfScope = await grade(patch('policy.json'));
  assert.match(outOfScope.detail!, /did not apply \(policy\.json\)/);
});

test('the patch scorer grades a manifest read back from jsonb, and an unrun case is no verdict', async (t) => {
  const s = await setup(t);
  // PostgreSQL jsonb orders keys by length then bytes; the stored manifest comes back so.
  const first = structuredClone(BUILD_FIXTURE_CASES)[0]!;
  const jsonbOrdered = {
    args: first.args,
    stdin: first.stdin,
    stdout: first.stdout,
    check_key: first.check_key,
    exit_code: first.exit_code,
  };
  const check = {
    kind: 'patch_cases' as const,
    file_scope: ['src'],
    cases: [jsonbOrdered],
  };
  let state: Execution['state'] = 'succeeded';
  // Stands in for the WSL worker exactly where it matters: the acceptance hash it records.
  const worker = {
    run: async (
      _p: string,
      _t: string,
      commit: string,
      _b: unknown,
      _s: unknown,
      qa: unknown,
    ) => {
      const c = qaCaseSchema.parse(qa);
      return {
        commit,
        state,
        reason: state === 'succeeded' ? null : 'Isolation unavailable',
        exit_code: c.exit_code,
        log: c.stdout,
        environment: { acceptance_hash: digest(JSON.stringify(c)) },
      };
    },
  } as unknown as ExecutionSupervisor;
  const answer = JSON.stringify({
    submission: {
      expected_commit: '0'.repeat(40),
      changes: [{ path: 'src/extra.py', before_hash: null, content: 'x\n' }],
    },
    summary: 's',
    blocker: null,
  });
  const score = () =>
    scorePatchCase(
      { products: s.products, executor: worker },
      s.binding.owner_id,
      check,
      answer,
    );
  assert.equal(await score(), 'accepted');
  const grade = () =>
    gradePatchCase(
      { products: s.products, executor: worker },
      s.binding.owner_id,
      check,
      answer,
    );
  assert.deepEqual(await grade(), { signal: 'accepted', detail: null });
  state = 'blocked';
  assert.equal(await score(), 'provider_error');
  assert.deepEqual(await grade(), {
    signal: 'provider_error',
    detail: `The worker did not finish check ${first.check_key} (blocked: Isolation unavailable).`,
  });
  // A wrong program names the check and exit codes, never the expected output.
  state = 'failed';
  const wrong = await gradePatchCase(
    {
      products: s.products,
      executor: {
        run: async (...a: unknown[]) => ({
          ...(await worker.run(
            ...(a as Parameters<ExecutionSupervisor['run']>),
          )),
          state: 'failed',
          reason: null,
          exit_code: first.exit_code + 1,
          log: 'something else\n',
        }),
      } as unknown as ExecutionSupervisor,
    },
    s.binding.owner_id,
    check,
    answer,
  );
  assert.equal(wrong.signal, 'acceptance_check_failed');
  assert.equal(
    wrong.detail,
    `Check ${first.check_key} failed: exit code ${first.exit_code + 1}, expected ${first.exit_code}; output did not match.`,
  );
  if (first.stdout.trim())
    assert.ok(!wrong.detail!.includes(first.stdout.trim()));
  // A worker that throws is the studio's problem, and says so.
  const thrown = await gradePatchCase(
    {
      products: s.products,
      executor: {
        run: async () => {
          throw new Error('wsl.exe was not found');
        },
      } as unknown as ExecutionSupervisor,
    },
    s.binding.owner_id,
    check,
    answer,
  );
  assert.deepEqual(thrown, {
    signal: 'provider_error',
    detail: `The worker could not run check ${first.check_key}: wsl.exe was not found`,
  });
});

test('a worker run an earlier grading left unresolved blocks grading until it is settled', async (t) => {
  const s = await setup(t);
  const check = {
    kind: 'patch_cases' as const,
    file_scope: ['src'],
    cases: structuredClone(BUILD_FIXTURE_CASES).slice(0, 1),
  };
  const answer = JSON.stringify({
    submission: {
      expected_commit: '0'.repeat(40),
      changes: [{ path: 'src/extra.py', before_hash: null, content: 'x\n' }],
    },
    summary: 's',
    blocker: null,
  });
  // A marker whose throwaway product is gone cannot be shown stopped: refused, never cleared.
  const marker = join(s.products.root, 'pending-worker.json');
  const body = JSON.stringify({
    product_id: randomUUID(),
    execution_id: randomUUID(),
    supervisor_pid: 1,
  });
  await writeFile(marker, body);
  const before = await readdir(s.products.root);
  await assert.rejects(
    scorePatchCase(
      { products: s.products, executor: s.executor },
      s.binding.owner_id,
      check,
      answer,
    ),
    /unresolved worker run.*no creator worker unit is running/,
  );
  assert.equal(await readFile(marker, 'utf8'), body);
  assert.deepEqual(await readdir(s.products.root), before, 'nothing created');
});

// ADR-0054: one approval per build. The execution double stands in for the WSL2 worker
// (its records say so) so repair rounds can run here; QA isolation is covered elsewhere.
test('one approval covers a whole build: repair rounds and both roles never ask again', async (t) => {
  const s = await setup(t);
  const builds = new BuildSupervisor(
    s.products,
    new TestDoubleExecutor(s.products),
  );
  const plan: BuildPlan = {
    ...s.plan,
    max_repairs: 1,
    max_calls: 4,
    timeout_ms: 120000,
    plan_roles: { connection_id: randomUUID(), model_id: 'fixture-plan' },
  };
  const scopes: BuildApprovalScope[] = [];
  const roles: { role: string; build_id: string }[] = [];
  let builderRound = 0,
    drafts = 0;
  const ports = (over: Partial<BuildPorts> = {}): BuildPorts => ({
    ...s.ports,
    authorize: async (_plan, scope) => {
      scopes.push(scope);
      return { verdict: 'allow', fixture: true };
    },
    planRolesReady: async () => [],
    planRole: async (target, request) => {
      roles.push({ role: target.role, build_id: target.build_id });
      const answer = JSON.parse(
        buildFixtureAnswer([
          { role: 'system', text: BUILD_ROLE_PROMPTS[target.role] },
          { role: 'user', text: request.input },
        ])!,
      );
      // The first candidate is a draft the reviewer sends back; the repair round fixes it.
      if (target.role === 'builder' && builderRound++ === 0)
        answer.submission.changes[0].content = `print("draft ${++drafts}")\n`;
      return {
        request_id: randomUUID(),
        status: 'succeeded',
        reason_code: 'ok',
        text: JSON.stringify(answer),
        fixture: true,
      };
    },
    ...over,
  });
  const result = await builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    ports(),
  );
  assert.equal(result.state, 'verified_candidate', JSON.stringify(result));
  assert.equal(result.repairs, 1);
  assert.equal(result.calls, 4);
  assert.deepEqual(
    roles.map((r) => r.role),
    ['builder', 'reviewer', 'builder', 'reviewer'],
  );
  // Asked once, before the first round, with the limits the approval is recorded with.
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes[0], {
    build_id: result.id,
    product_id: s.product.id,
    task_id: s.task.id,
    plan_hash: result.plan_hash,
    route: 'plan_roles',
    connection_id: plan.plan_roles!.connection_id,
    model_id: 'fixture-plan',
    request_limit: 4,
    max_repairs: 1,
    expires_at: plan.deadline,
  });
  // Every role request names the build whose approval covers it.
  assert.ok(roles.every((r) => r.build_id === result.id));

  // Not asking again is not trusting blindly: the run, grant and humility review are still
  // re-checked at every step, so a stop between rounds ends the build before the repair.
  builderRound = 0;
  scopes.length = roles.length = 0;
  let checks = 0;
  const stopped = await builds.run(
    s.product.id,
    s.task.id,
    result.commit,
    plan,
    ports({
      assertActive: async () => {
        // Allow the first round (builder, reviewer, QA), then the authority is gone.
        if (roles.length >= 2 && ++checks > 1)
          throw new Error(
            'Build authority or humility review changed or expired',
          );
      },
    }),
  );
  assert.equal(stopped.state, 'checkpoint');
  assert.match(stopped.reason, /authority .* changed or expired/);
  assert.deepEqual(
    roles.map((r) => r.role),
    ['builder', 'reviewer'],
  );
  assert.equal(scopes.length, 1);

  // A frozen study build keeps its admission per round (study conditions are unchanged).
  builderRound = 0;
  scopes.length = roles.length = 0;
  const study = await builds.run(
    s.product.id,
    s.task.id,
    stopped.commit,
    plan,
    ports({ perRoundAdmission: true }),
  );
  assert.equal(study.state, 'verified_candidate', JSON.stringify(study));
  assert.equal(scopes.length, 2);
});

test('a stopped build continues from its last candidate; the original base is stale', async (t) => {
  const s = await setup(t);
  s.script((r) => {
    const value = JSON.parse(buildFixtureAnswer(r.input)!);
    if (r.input[0]!.text.startsWith('independent-reviewer/'))
      value.verdict = 'blocked';
    return value;
  });
  const first = await s.run();
  assert.equal(first.state, 'checkpoint');
  assert.match(first.reason, /Reviewer blocked/);
  assert.notEqual(first.commit, s.product.initial_commit);
  // The task's worktree moved on, so the base commit no longer names the candidate.
  await assert.rejects(s.run(), /Stale build candidate/);
  assert.equal(
    await s.products.taskHead(s.product.id, s.task.id),
    first.commit,
  );
  s.script((r) => {
    const value = JSON.parse(buildFixtureAnswer(r.input)!);
    if (r.input[0]!.text.startsWith('builder/'))
      value.submission.changes[0].content = 'print("resumed")\n';
    else value.verdict = 'blocked';
    return value;
  });
  const resumed = await s.builds.run(
    s.product.id,
    s.task.id,
    first.commit,
    s.plan,
    s.ports,
  );
  assert.equal(resumed.state, 'checkpoint');
  // The builder of the resumed build starts from the stopped build's candidate.
  const builder = JSON.parse(s.requests.at(-2)!.input[1]!.text);
  assert.equal(builder.candidate, first.commit);
});

test('the path dialect admits Python package files and still refuses dot, dash and cache paths', () => {
  for (const ok of [
    'src/ledger/__init__.py',
    'src/__main__.py',
    'src/ledger/_util.py',
    'src/main.py',
    'src',
  ])
    assert.ok(pathSchema.safeParse(ok).success, ok);
  for (const bad of [
    'src/__pycache__/main.cpython-314.pyc',
    'src/.hidden',
    '.git/config',
    'src/-rf',
    'src/_',
    'src/__',
    'src/Main.py',
    'src/a..py',
    'src/nul.py',
    'con/x.py',
    '/abs.py',
    'src//x.py',
    'src/../x.py',
  ])
    assert.ok(!pathSchema.safeParse(bad).success, bad);
});

test('a refused patch becomes repair feedback: nothing is applied and the next round can pass', async (t) => {
  const s = await setup(t);
  const builds = new BuildSupervisor(
    s.products,
    new TestDoubleExecutor(s.products),
  );
  const plan: BuildPlan = {
    ...s.plan,
    max_repairs: 2,
    max_calls: 5,
    timeout_ms: 120000,
    plan_roles: { connection_id: randomUUID(), model_id: 'fixture-plan' },
  };
  const seen: { role: string; packet: Record<string, unknown> }[] = [];
  let builderRound = 0;
  const result = await builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    {
      ...s.ports,
      planRolesReady: async () => [],
      planRole: async (target, request) => {
        seen.push({ role: target.role, packet: JSON.parse(request.input) });
        const answer = JSON.parse(
          buildFixtureAnswer([
            { role: 'system', text: BUILD_ROLE_PROMPTS[target.role] },
            { role: 'user', text: request.input },
          ])!,
        );
        if (target.role === 'builder') {
          const extra = [
            // Round 0: a generated cache file the path contract refuses.
            {
              path: 'src/__pycache__/main.cpython-314.pyc',
              before_hash: null,
              content: 'x',
            },
            // Round 1: a valid path outside the task scope (src).
            { path: 'readme.md', before_hash: null, content: 'x' },
            // Round 2: a Python package marker, now admitted.
            { path: 'src/pkg/__init__.py', before_hash: null, content: '' },
          ][builderRound++]!;
          answer.submission.changes.push(extra);
        }
        return {
          request_id: randomUUID(),
          status: 'succeeded',
          reason_code: 'ok',
          text: JSON.stringify(answer),
          fixture: true,
        };
      },
    },
  );
  assert.equal(result.state, 'verified_candidate', JSON.stringify(result));
  assert.equal(result.repairs, 2);
  assert.equal(result.calls, 4);
  assert.deepEqual(
    seen.map((x) => x.role),
    ['builder', 'builder', 'builder', 'reviewer'],
  );
  const builders = seen.filter((x) => x.role === 'builder');
  // The rules travel as packet data; the qualified role prompt is unchanged.
  for (const b of builders) {
    assert.deepEqual(b.packet.patch_rules, [...PATCH_RULES]);
    assert.match(
      JSON.stringify(b.packet.qa_runtime),
      /python3.*-I.*src\/main\.py/,
    );
    // A refused round changed nothing, so every round starts from the same candidate.
    assert.equal(b.packet.candidate, s.product.initial_commit);
  }
  assert.equal(builders[0]!.packet.feedback, null);
  const first = builders[1]!.packet.feedback as {
    refused_patch: { reason: string; details: string[] };
  };
  assert.match(first.refused_patch.reason, /patch contract/);
  assert.match(
    first.refused_patch.details.join(' '),
    /submission\.changes\.1\.path: .*__pycache__/,
  );
  const second = builders[2]!.packet.feedback as {
    refused_patch: { reason: string };
  };
  assert.equal(second.refused_patch.reason, 'Task file scope exceeded');
  const dir = join(s.products.dir(s.product.id), 'builds', result.id);
  const files = await readdir(dir);
  assert.ok(
    files.includes('refused-0.json') && files.includes('refused-1.json'),
  );
  assert.ok(!files.includes('candidate-0.json'));
  const tree = s.products.worktree(s.product.id, s.task.id);
  assert.equal(await readFile(join(tree, 'src/pkg/__init__.py'), 'utf8'), '');
});

test('refusals use up the repair limit and the checkpoint names the last refusal', async (t) => {
  const s = await setup(t);
  s.plan.max_repairs = 1;
  s.plan.max_calls = 3;
  s.script((r) => {
    const value = JSON.parse(buildFixtureAnswer(r.input)!);
    value.submission.changes[0].path = 'src/.main.py';
    return value;
  });
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(
    result.reason,
    /Repair limit reached; the last patch was refused/,
  );
  assert.equal(result.repairs, 1);
  assert.equal(s.requests.length, 2);
  assert.equal(result.commit, s.product.initial_commit);
});
