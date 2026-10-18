import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApi } from '@creator/api';
import {
  BUILD_FIXTURE_SPEC,
  BUILD_FIXTURE_CASES,
  fixtureHumilityReview,
} from '@creator/domain';
import { freshDatabase, LOGIN_CODE } from './pg-harness.js';

const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
test(
  'compiled builder CLI binds authenticated frozen spec, admission, metered roles and real QA; zero-budget and human-only runs fail',
  { skip: !real && 'Compiled acceptance requires real WSL2 isolation' },
  async (t) => {
    let closeApi = async () => {};
    t.after(() => closeApi());
    const db = await freshDatabase(t);
    if (!db) return;
    const api = createApi({
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    });
    api.server.listen(0, '127.0.0.1');
    await once(api.server, 'listening');
    closeApi = api.close;
    await api.ready();
    const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    const parent = resolve('.verification/t12-cli');
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
          { env, timeout: 120000, windowsHide: true },
        );
        return JSON.parse(
          args[0] === 'build-task'
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
    const seed = await cli('seed-selection'),
      ws = seed.workspace.id,
      specId = seed.spec.id;
    const before = await cli('spec', ws, specId);
    const revised = await cli(
      'spec-revise',
      ws,
      specId,
      JSON.stringify({
        expected_version: before.spec.version,
        title: 'Synthetic bounded checklist',
        content: BUILD_FIXTURE_SPEC,
        reason: 'Synthetic T12 task acceptance; no empirical product claim',
      }),
    );
    const freezeBody = JSON.stringify({
      spec: { id: specId, version: revised.spec.version },
      justification: 'Synthetic exact T12 freeze',
      data_class: 'synthetic',
    });
    const requested = await cli('spec-freeze', ws, seed.run, freezeBody);
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
    }
    const frozen =
      requested.status === 'frozen'
        ? requested
        : await cli('spec-freeze', ws, seed.run, freezeBody);
    assert.equal(frozen.status, 'frozen');
    const review = await cli(
      'create',
      ws,
      'humility_review',
      'Synthetic exact checklist spec humility review',
      JSON.stringify(
        fixtureHumilityReview(
          { id: specId, version: revised.spec.version },
          [],
        ),
      ),
    );
    const buildGrant = await cli(
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
        rationale: 'Synthetic bounded checklist acceptance only',
      }),
    );
    const budgets = await cli('budgets', ws),
      pricing = await cli('pricing', ws);
    const product = await cli('product-init', ws, specId);
    const task = await cli(
      'product-task',
      product.id,
      'T1',
      product.initial_commit,
    );
    const plan = {
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
      deadline: new Date(Date.now() + 300000).toISOString(),
      cases: BUILD_FIXTURE_CASES,
    };
    const result = await cli(
      'build-task',
      product.id,
      task.id,
      product.initial_commit,
      await file('plan', plan),
    );
    assert.equal(result.state, 'verified_candidate', JSON.stringify(result));
    assert.equal(result.fixture, true);
    assert.equal(result.calls, 2);
    assert.equal(
      (await cli('build-status', product.id, result.id)).commit,
      result.commit,
    );
    const state = await cli('product-status', product.id);
    assert.equal(state.executions.length, 2);
    const reservations = await cli('reservations', ws);
    // The two build calls are settled before QA starts; use their unique operation IDs from the local traces below.
    const { readFile } = await import('node:fs/promises');
    const buildDir = resolve(
      '.creator/products',
      product.id,
      'builds',
      result.id,
    );
    const traces = await Promise.all(
      [1, 2].map(async (n) =>
        JSON.parse(
          await readFile(join(buildDir, `call-${n}-outcome.json`), 'utf8'),
        ),
      ),
    );
    assert.ok(
      traces.every(
        (trace) =>
          trace.status === 'succeeded' &&
          trace.attempts.length === 1 &&
          trace.attempts[0].status === 'settled',
      ),
    );
    assert.ok(
      traces.every((trace) =>
        reservations.some(
          (r: any) => r.logical_operation_id === trace.logical_operation_id,
        ),
      ),
    );
    const zero = await cli(
      'budget-create',
      ws,
      JSON.stringify({
        parent_id: null,
        kind: 'global',
        run_id: null,
        name: 'Synthetic zero budget',
        cap_nano_usd: '0',
        starts_at: null,
        ends_at: null,
        max_in_flight: 1,
      }),
    );
    const denied = await cli(
      'build-task',
      product.id,
      task.id,
      result.commit,
      await file('zero-plan', { ...plan, envelope_id: zero.id }),
    );
    assert.equal(denied.state, 'checkpoint');
    assert.match(denied.reason, /denied/);
    assert.equal(denied.commit, result.commit);
    await cli(
      'grant-revoke',
      ws,
      buildGrant.id,
      String(buildGrant.version),
      'Synthetic revoked build authority',
    );
    const refused = await cli(
      'build-task',
      product.id,
      task.id,
      result.commit,
      await file('revoked-plan', plan),
    );
    assert.equal(refused.state, 'checkpoint');
    assert.match(refused.reason, /Build admission/);
    assert.equal(refused.calls, 0);
    const decision = (await cli('decisions', ws, 'pending')).find(
      (d: any) => d.binding?.action_type === 'product.commit_build',
    );
    assert.ok(decision);
    await cli(
      'answer',
      ws,
      decision.id,
      decision.coverage.coverage_hash,
      'approve_once',
      'Synthetic one-time exact-spec build',
    );
    const onceProduct = await cli('product-init', ws, specId);
    const onceTask = await cli(
      'product-task',
      onceProduct.id,
      'T1',
      onceProduct.initial_commit,
    );
    const onceResult = await cli(
      'build-task',
      onceProduct.id,
      onceTask.id,
      onceProduct.initial_commit,
      await file('once-plan', plan),
    );
    assert.equal(
      onceResult.state,
      'verified_candidate',
      JSON.stringify(onceResult),
    );
    const human = await cli(
      'create',
      ws,
      'run',
      'Synthetic human-only',
      JSON.stringify({
        state: 'queued',
        experiment_condition: 'human_only',
        discovery_method: 'human_defined',
        config_hash: null,
      }),
    );
    await cli('run-register', ws, `${human.id}@1`, 'human_only');
    await assert.rejects(
      cli(
        'build-task',
        product.id,
        task.id,
        result.commit,
        await file('human-plan', { ...plan, run_id: human.id }),
      ),
      /non-human-only/,
    );
    await cli(
      'spec-revise',
      ws,
      specId,
      JSON.stringify({
        expected_version: revised.spec.version,
        title: 'Changed synthetic specification',
        content: BUILD_FIXTURE_SPEC,
        reason: 'Invalidate exact candidate evidence',
      }),
    );
    await assert.rejects(
      cli('build-status', product.id, result.id),
      /current active frozen|specification/,
    );
    await cli('logout');
    await assert.rejects(cli('build-status', product.id, result.id), /401/);
    if (process.env.CREATOR_RECORD_T12_EVIDENCE === 'true') {
      await mkdir('tracking/evidence/t12', { recursive: true });
      await writeFile(
        'tracking/evidence/t12/cli-acceptance.json',
        JSON.stringify(
          {
            synthetic: true,
            empirical_results: false,
            product,
            task,
            result,
            executions: state.executions,
            broker_calls: traces,
            zero_budget: denied,
            revoked_authority: refused,
            one_time_authority: onceResult,
            checks: [
              'authenticated owner',
              'current frozen spec',
              'exact task hashes',
              'build admission and humility',
              'two settled broker reservations',
              'fresh review',
              'normal and invalid-input QA',
              'zero-budget denial',
              'human-only denial',
              'changed spec denial',
              'unauthenticated denial',
            ],
          },
          null,
          2,
        ) + '\n',
      );
    }
  },
);
