import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);

test('context API and CLI: capabilities, folder index, pack, cached call, batch, usage', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const tmp = await mkdtemp(join(tmpdir(), 'creator-ctx-'));
  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${port}`,
    CREATOR_SESSION_FILE: join(tmp, 's.json'),
  };
  const cli = async (...args: string[]) => {
    try {
      const out = await exec(
        process.execPath,
        ['apps/cli/dist/main.js', ...args],
        {
          env: cliEnv,
          timeout: 30000,
        },
      );
      return JSON.parse(out.stdout);
    } catch (e) {
      throw new Error(
        `${args[0]} failed: ${(e as { stdout?: string }).stdout ?? String(e)}`,
      );
    }
  };
  await cli('login', LOGIN_CODE);
  const ws = (
    await post('workspaces', { name: 'Context API', record_mode: 'fixture' })
  ).body.id as string;
  const runEntity = (
    await post(`workspaces/${ws}/entities`, {
      kind: 'run',
      title: 'Context run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    })
  ).body;
  const run = (
    await post(`workspaces/${ws}/runs`, {
      run: { id: runEntity.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).body.run_id as string;
  await post(`workspaces/${ws}/grants`, {
    run_id: run,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: '1000000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Routine fixture generation.',
  });
  const envelope = (
    await post(`workspaces/${ws}/budgets`, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Context budget',
      cap_nano_usd: '100000000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 8,
    })
  ).body.id as string;

  const caps = await cli(
    'context-capabilities-add',
    ws,
    'config/context/provider-capabilities.fixture.json',
  );
  const batchPricing = Object.values(
    caps.batch_pricing_snapshot_ids,
  )[0] as string;
  const pricing = (
    await cli('pricing-add', ws, 'config/pricing/fixture-context-v1.json')
  ).id;

  // A local folder indexed incrementally; a deleted file is removed on the next run.
  const src = join(tmp, 'repo');
  await mkdir(join(src, 'src'), { recursive: true });
  await mkdir(join(src, 'node_modules', 'x'), { recursive: true });
  await writeFile(
    join(src, 'README.md'),
    'The pilot export runs nightly. Retention is reported weekly.',
  );
  await writeFile(
    join(src, 'src', 'export.ts'),
    'export const pilotExport = () => "nightly retention export";\n',
  );
  await writeFile(join(src, 'src', 'old.ts'), 'export const legacy = 1;\n');
  await writeFile(
    join(src, 'node_modules', 'x', 'index.js'),
    'module.exports = 1;\n',
  );
  const first = await cli(
    'context-index',
    ws,
    'repo',
    'code',
    'synthetic',
    src,
  );
  assert.deepEqual(
    [first.added, first.current],
    [3, 3],
    'node_modules is skipped',
  );
  await rm(join(src, 'src', 'old.ts'));
  await writeFile(
    join(src, 'README.md'),
    'The pilot export runs nightly at 02:00. Retention is reported weekly.',
  );
  const second = await cli(
    'context-index',
    ws,
    'repo',
    'code',
    'synthetic',
    src,
  );
  assert.deepEqual(
    [
      second.added,
      second.updated,
      second.unchanged,
      second.removed,
      second.current,
    ],
    [0, 1, 1, 1, 2],
  );

  const pack = await cli(
    'context-pack',
    ws,
    JSON.stringify({
      run_id: run,
      task_id: null,
      project_id: null,
      task_class: 'code_build',
      data_class: 'synthetic',
      purpose: 'Explain when the pilot export runs.',
      query: ['pilot', 'export', 'retention'],
      token_budget: 2000,
      corpora: ['repo'],
      include: [],
      pins: [{ corpus: 'repo', key: 'README.md', pin: 'constraint' }],
      required_facts: ['02:00'],
      handoffs: [],
    }),
  );
  assert.ok(pack.items.some((i: { key: string }) => i.key === 'src/export.ts'));
  const call = (op: string) =>
    JSON.stringify({
      run_id: run,
      envelope_id: envelope,
      pricing_snapshot_id: pricing,
      model: { provider: 'fixture', model_id: 'fixture-context-v1' },
      pack_id: pack.id,
      project_id: null,
      action_type: 'model.generate',
      task_id: null,
      logical_operation_id: op,
      data_class: 'synthetic',
      messages: [
        {
          role: 'user',
          text: 'context-qa/1: QUESTION: When does the pilot export run?',
        },
      ],
      max_output_tokens: 100,
      output_format: 'text',
      tool: null,
      max_attempts: 1,
      timeout_ms: 5000,
      justification: 'Answer from the repository notes.',
      cache: { mode: 'use', max_age_seconds: 600, deps: [] },
    });
  const miss = await cli('context-call', ws, call(randomUUID()));
  assert.equal(miss.cache, 'miss');
  assert.match(miss.output.text, /02:00/);
  const hit = await cli('context-call', ws, call(randomUUID()));
  assert.equal(hit.cache, 'hit');
  assert.equal(hit.output.text, miss.output.text);

  const batch = await cli(
    'context-batch',
    ws,
    JSON.stringify({
      batch_operation_id: randomUUID(),
      run_id: run,
      envelope_id: envelope,
      model: { provider: 'fixture', model_id: 'fixture-context-v1' },
      pricing_snapshot_id: batchPricing,
      action_type: 'model.generate',
      data_class: 'synthetic',
      items: ['one', 'two'].map((custom_id) => ({
        custom_id,
        logical_operation_id: randomUUID(),
        task_id: null,
        input: [{ role: 'user', text: `Summarise ${custom_id}.` }],
        max_output_tokens: 20,
        output_format: 'text',
      })),
      justification: 'Overnight summaries.',
    }),
  );
  assert.equal(batch.status, 'submitted');
  const polled = await cli('context-batch-poll', ws, batch.id);
  assert.equal(polled.status, 'completed');

  const usage = await cli('context-usage', ws, run);
  assert.equal(usage.result_cache.hits, 1);
  assert.equal(usage.batches.settled, 2);
  assert.equal(usage.savings_claim, 'not_claimed_fixture');
  const cache = await cli('context-cache', ws);
  const invalidated = await cli(
    'context-cache-invalidate',
    ws,
    cache[0].id,
    'Owner reset.',
  );
  assert.equal(invalidated.status, 'invalidated');
});
