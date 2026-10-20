// Audit reproduction only. No provider calls, real credentials, or application changes.
// Run after build: CREATOR_TEST_DATABASE_URL=<disposable server> node --test this-file
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { casePassed } from '../../../packages/executor/dist/artifacts.js';
import { qaCaseSchema } from '../../../packages/executor/dist/contracts.js';
import { OpenAIBatchAdapter } from '../../../packages/broker/dist/batch.js';
import { PaymentService } from '../../../packages/broker/dist/payments-service.js';
import { PortfolioStore } from '../../../packages/db/dist/index.js';
import { freshDatabase } from '../../../tests/dist/pg-harness.js';

test('QA oracle is serialized whole and mounted in the generated process namespace', async () => {
  const execution = await readFile(
    'packages/executor/src/execution.ts',
    'utf8',
  );
  const bridge = await readFile('packages/executor/worker/bridge.py', 'utf8');
  const qa = qaCaseSchema.parse({
    check_key: 'A1',
    args: ['unseen'],
    stdin: 'secret input',
    stdout: 'secret correct answer\n',
    exit_code: 0,
  });
  assert.ok(execution.includes("jsonWrite(join(job, 'acceptance.json'), qa)"));
  assert.ok(
    bridge.includes("['--ro-bind', str(acceptance), '/acceptance.json']"),
  );
  // Emulate only the answer-copy operation and the real pass predicate. This is NOT
  // an executed WSL2 exploit or evidence that a reviewer approves malicious code.
  const visibleToProduct = JSON.parse(JSON.stringify(qa));
  const copiedResult = {
    state: 'succeeded',
    reason: null,
    exit_code: visibleToProduct.exit_code,
    log: visibleToProduct.stdout,
  };
  assert.equal(casePassed(copiedResult, qa), true);
  console.log(
    'Oracle copy passes real casePassed; native mount exploit not executed.',
  );
});

test('batch poll consumes a multi-megabyte file for one requested id, with no delete', async (t) => {
  const requests = [];
  const junk =
    `${JSON.stringify({ custom_id: 'not-requested', filler: 'x'.repeat(8192) })}\n`.repeat(
      256,
    );
  const line = JSON.stringify({
    custom_id: 'wanted',
    response: {
      status_code: 200,
      body: {
        id: 'response',
        status: 'completed',
        output: [],
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
  });
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/batches/probe')
      res.end(JSON.stringify({ status: 'completed', output_file_id: 'out' }));
    else if (req.url === '/files/out/content') res.end(junk + line + '\n');
    else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const adapter = new OpenAIBatchAdapter({
    apiKey: 'audit_fixture_key_0000000000',
    model_id: 'audit-model',
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  });
  const result = await adapter.poll(
    'probe',
    ['wanted'],
    AbortSignal.timeout(5000),
  );
  assert.equal(result.kind, 'status');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].custom_id, 'wanted');
  assert.equal(
    requests.some((r) => r.startsWith('DELETE')),
    false,
  );
  console.log(
    `Read ${Buffer.byteLength(junk + line + '\n')} bytes for one result; requests: ${requests.join(', ')}`,
  );
});

test('invalid payment signatures append a durable row on every repetition', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new PortfolioStore(db.pool);
  const owner = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Audit fixture owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Audit fixture',
    record_mode: 'fixture',
  });
  const conn = await store.registerPaymentConnection(owner, ws.id, {
    label: 'Audit fixture',
    processor: 'fixture',
    mode: 'fixture',
    account_id: 'acct_fixture0001',
    secret_key_env: null,
    webhook_secret_env: 'CREATOR_PAYMENTS_AUDIT_HOOK',
  });
  const service = new PaymentService(store, {
    env: { CREATOR_PAYMENTS_AUDIT_HOOK: 'fixture-only-audit-secret' },
  });
  for (let i = 0; i < 25; i++) {
    const result = await service.receiveWebhook(
      owner,
      conn.id,
      'invalid',
      Buffer.from('{}'),
    );
    assert.equal(result.status, 400);
  }
  const rows = await store.listPaymentEvents(owner, ws.id, conn.id);
  assert.equal(rows.filter((r) => r.status === 'rejected').length, 25);
  console.log(
    '25 unauthenticated invalid-signature attempts produced 25 durable rejected event rows.',
  );

  let entered;
  const inside = new Promise((resolve) => {
    entered = resolve;
  });
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const verified = await service.verify(owner, ws.id, conn.id);
  assert.equal(verified.status, 'active');
  const applying = store
    .applyPaymentSnapshot(
      owner,
      conn.id,
      async () => {
        entered();
        await wait;
        throw new Error('Intentional audit fixture interruption');
      },
      null,
      ws.id,
    )
    .catch((e) => e);
  await inside;
  const other = await db.pool.connect();
  try {
    await other.query('begin');
    const lock = await other.query(
      'select pg_try_advisory_xact_lock(hashtext($1)) as acquired',
      ['creator:reinvest:' + ws.id],
    );
    assert.equal(lock.rows[0].acquired, false);
    await assert.rejects(
      other.query(
        'select id from payment_connections where id=$1 for update nowait',
        [conn.id],
      ),
      (e) => e.code === '55P03',
    );
    await other.query('rollback');
    console.log(
      'While processor callback waits, workspace financial advisory lock and connection row lock are held.',
    );
  } finally {
    other.release();
    release();
    const stopped = await applying;
    assert.match(stopped.message, /Intentional audit/);
  }

  const seeded = await store.seedStudy(owner, ws.id);
  const exported = await store.exportStudy(owner, ws.id, seeded.study.id);
  const seen = new Set();
  for (const attempt of exported.attempts) {
    for (const event of attempt.audit_events) {
      assert.equal(
        seen.has(event.id),
        false,
        'audit event duplicated across attempts',
      );
      assert.equal(event.workspace_id, attempt.workspace_id);
      seen.add(event.id);
    }
  }
  assert.equal(new Set(exported.attempts.map((a) => a.workspace_id)).size, 3);
  console.log(
    `Three study attempts have separate workspaces; ${seen.size} exported audit events have no cross-attempt duplicates.`,
  );
});
