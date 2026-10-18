import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import { SYNTHETIC_STUDY } from '@creator/domain';
import { StudySummarySchema, StudyAttemptSchema, z } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

test('study HTTP paths enforce schema errors, human-only execution denial and grader separation', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const post = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
  const wsResponse = await post('workspaces', {
    name: 'Synthetic study HTTP acceptance',
    record_mode: 'fixture',
  });
  const ws = z.object({ id: z.string() }).parse(await wsResponse.json());
  const root = `workspaces/${ws.id}`;
  const invalid = await post(`${root}/studies`, {
    ...SYNTHETIC_STUDY,
    synthetic: false,
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    z
      .object({ error: z.object({ code: z.string() }) })
      .parse(await invalid.json()).error.code,
    'INVALID_CONTRACT',
  );
  const seeded = await post(`${root}/studies/seed`, {});
  assert.equal(seeded.status, 201);
  const seed = z
    .object({
      study: StudySummarySchema,
      attempts: z.array(StudyAttemptSchema),
    })
    .parse(await seeded.json());
  const c = seed.attempts.find((a) => a.condition === 'human_only')!;
  const denied = await post(`${root}/study-attempts/${c.id}/execute`, {});
  assert.equal(denied.status, 403);
  const entries = await fetch(
    `${base}/${root}/study-attempts/${c.id}/entries`,
    { headers: auth.read },
  );
  assert.ok(
    z
      .array(z.object({ kind: z.string() }))
      .parse(await entries.json())
      .some((e) => e.kind === 'helper_denied'),
  );
  const hidden = await fetch(
    `${base}/${root}/studies/${seed.study.id}/grader-material`,
    { headers: auth.read },
  );
  assert.equal(hidden.status, 403);
  const unauthenticated = await fetch(`${base}/${root}/studies`);
  assert.equal(unauthenticated.status, 401);
});
