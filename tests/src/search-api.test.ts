import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);

test('X03 API and CLI: zoned search, questions, refused plans, saved queries, lineage export and verify, membership', async (t) => {
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
  const tmp = await mkdtemp(join(tmpdir(), 'creator-x03-'));
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
  const seed = await cli('seed-lineage');
  const ws: string = seed.workspace.id;
  const product: string = seed.product_from_two_ideas;

  // Search with a time zone: each hit carries its local time; coverage is reported per type.
  const found = await cli(
    'search',
    ws,
    'roster',
    'record,cost,model',
    '--tz',
    'Asia/Kolkata',
  );
  assert.ok(found.hits.some((h: { id: string }) => h.id === product));
  assert.match(found.hits[0].occurred_local, /\+05:30$/);
  assert.equal(found.coverage.record.excluded.redacted, 0);
  const none = await cli(
    'search',
    ws,
    'roster',
    'record',
    '--from',
    '2001-01-01',
    '--to',
    '2001-01-02',
  );
  assert.equal(none.hits.length, 0);
  const badZone = await fetch(
    `${base}/workspaces/${ws}/search?q=x&tz=Mars%2FOlympus`,
    { headers: auth.read },
  );
  assert.equal(badZone.status, 400);

  // A question compiles to a read-only plan and names its supporting records.
  const answer = await cli(
    'ask',
    ws,
    'Which sources does product "Roster with reminders" come from?',
    'America/Chicago',
  );
  assert.equal(answer.status, 'answered', answer.explanation);
  assert.equal(answer.read_only, true);
  assert.deepEqual(
    answer.rows.map((r: { title: string }) => r.title),
    ['Fixture volunteer report'],
  );
  // A plan carrying SQL is refused at the contract; nothing runs.
  const bad = await post(`workspaces/${ws}/audit-plans`, {
    plan: {
      version: 'audit-plan/1',
      limit: 5,
      intent: 'redactions',
      window: { from: null, to: null, tz: 'UTC' },
      sql: 'delete from entities',
    },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_CONTRACT');
  assert.ok(JSON.stringify(bad.body.error.details).includes('sql'));
  const planFile = join(tmp, 'plan.json');
  await writeFile(planFile, JSON.stringify(answer.plan));
  const direct = await cli('audit-plan', ws, planFile);
  assert.equal(direct.plan_hash, answer.plan_hash);

  // Saved queries round-trip through the CLI.
  const saved = await cli(
    'saved-query-save',
    ws,
    'Roster records',
    'search',
    JSON.stringify({
      q: 'roster',
      types: ['record'],
      kind: null,
      status: null,
      limit: 5,
    }),
  );
  assert.equal((await cli('saved-queries', ws)).length, 1);
  const ran = await cli('saved-query-run', ws, saved.id);
  assert.equal(ran.kind, 'search');
  assert.ok(ran.result.hits.length >= 2);
  assert.ok((await cli('saved-query-archive', ws, saved.id)).archived_at);

  // Lineage export to a file, verified clean, then flagged after a tamper.
  const out = join(tmp, 'lineage.json');
  const written = await cli('lineage-export', ws, product, out, 'both');
  assert.equal(written.written, out);
  assert.equal((await cli('lineage-verify', ws, out)).ok, true);
  await assert.rejects(
    cli('lineage-export', ws, product, out),
    /EEXIST|exists/,
  );
  const bundle = JSON.parse(await readFile(out, 'utf8'));
  bundle.graph.nodes.pop();
  const tampered = join(tmp, 'tampered.json');
  await writeFile(tampered, JSON.stringify(bundle));
  const check = await cli('lineage-verify', ws, tampered);
  assert.equal(check.ok, false);
  assert.equal(check.hash_ok, false);
  const graph = await cli('lineage-graph', ws, product, 'upstream', '1');
  assert.equal(graph.truncated.depth, true);

  // Membership: an owner adds and removes a member through the API; the removal is audited.
  const member = randomUUID();
  await api.store!.ensureActor({
    id: member,
    kind: 'human',
    display_name: 'Reviewer',
  });
  assert.equal((await cli('member-add', ws, member, 'viewer')).role, 'viewer');
  const removed = await cli('member-remove', ws, member, 'Review', 'finished');
  assert.equal(removed.removed, true);
  const history = await cli('activity', ws, '', 'member.');
  assert.ok(
    history.some((h: { action: string }) => h.action === 'member.removed'),
  );
  await assert.rejects(cli('member-remove', ws, member, 'again'), /404/);
});
