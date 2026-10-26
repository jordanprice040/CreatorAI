import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
const review = JSON.parse(
  await readFile(
    new URL(
      '../tracking/evidence/discovery-qualification-prep/settings-review.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
let csrf = '';
async function api(path, body) {
  const r = await fetch('http://127.0.0.1:4310/api/' + path, {
    headers: {
      Cookie: `creator_session=${secret.token}`,
      ...(body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
        : {}),
    },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(r.ok, `API request failed: ${r.status}`);
  return r.json();
}
const session = await api('auth/session');
assert.equal(session.authenticated, true);
csrf = session.csrf_token;
const path =
  'workspaces/88df6c10-7310-4ec0-b623-7f48046bc447/plan-connections/7529f8ef-8579-4685-80fc-5df300130667';
async function detail() {
  const { sign_in_attempt, ...d } = await api(path);
  return PlanConnectionDetailSchema.parse(d);
}
if (process.argv.includes('--inspect')) {
  const current = await detail();
  const requests = await api(path + '/requests');
  await writeFile(
    new URL(
      '../tracking/evidence/discovery-qualification-prep/verified-live-receipt.json',
      import.meta.url,
    ),
    JSON.stringify(
      { at: new Date().toISOString(), detail: current, requests },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      usage: current.usage,
      qualifications: current.qualifications,
      settings_hash: current.connection.settings_hash,
      blockers: current.blockers,
    }),
  );
  process.exit(0);
}
const before = await detail();
assert.equal(before.connection.settings_hash, review.before_hash);
assert.equal(before.usage.in_flight, 0);
assert.equal(before.usage.unresolved, 0);
await api(path + '/settings', {
  expected_version: before.connection.version,
  settings: review.after,
});
const updated = await detail();
assert.equal(updated.connection.settings_hash, review.after_hash);
await api(path + '/accept-caps', {
  expected_version: updated.connection.version,
  settings_hash: review.after_hash,
});
const after = await detail();
assert.deepEqual(after.blockers, []);
await writeFile(
  new URL(
    '../tracking/evidence/discovery-qualification-prep/accepted-settings.json',
    import.meta.url,
  ),
  JSON.stringify({ at: new Date().toISOString(), before, after }, null, 2) +
    '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    authenticated: true,
    settings_hash: after.connection.settings_hash,
    blockers: after.blockers,
    usage: after.usage,
  }),
);
