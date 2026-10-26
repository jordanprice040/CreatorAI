// Exact owner-authorized reconciliation/closure only. Never invokes inference.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
const dir = new URL('../tracking/evidence/v4-timeout-reconciliation/', import.meta.url);
await mkdir(dir, { recursive: true });
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw); raw = '';
const ws = '88df6c10-7310-4ec0-b623-7f48046bc447';
const conn = '7529f8ef-8579-4685-80fc-5df300130667';
const requestId = '50fcd841-85c1-4abd-9591-e18655538a2f';
const qid = '887288bb-ce7f-4edb-b11f-7f1494b146e3';
const path = `workspaces/${ws}/plan-connections/${conn}`;
const save = (name, v) => writeFile(new URL(name, dir), JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
let csrf = '';
async function api(path, body) {
  const r = await fetch('http://127.0.0.1:4310/api/' + path, {
    headers: { Cookie: `creator_session=${secret.session.token}`, ...(body ? {'Content-Type':'application/json','X-CSRF-Token':csrf} : {}) },
    ...(body ? {method:'POST',body:JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(r.ok, `Local API status ${r.status}`);
  return r.json();
}
const session = await api('auth/session');
assert.equal(session.authenticated, true); csrf = session.csrf_token;
const detail = async () => { const {sign_in_attempt, ...d} = await api(path); return PlanConnectionDetailSchema.parse(d); };
const before = await detail();
const requests = await api(path + '/requests');
const prior = requests.find(r => r.id === requestId);
assert.equal(requests.length, 24);
assert.equal(before.usage.in_flight, 0); assert.equal(before.usage.unresolved, 1);
assert.equal(before.connection.settings_hash, '5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533');
assert.equal(prior.state, 'unknown'); assert.equal(prior.reason_code, 'timeout');
assert.equal(prior.output_chars, 1653); assert.equal(prior.output_hash, null);
assert.equal(prior.upstream_request_id, 'resp_0306953cb8a7ff12016ad85ed6ed9c87d1a478817473f4ca98');
assert.equal(before.qualifications.find(q=>q.id===qid)?.state, 'running');
const installed = createHash('sha256').update(await readFile('C:/Users/jorda/AppData/Local/Creator Agent/studio/bundle-manifest.json')).digest('hex');
assert.equal(installed, '115b6c885e88ed226bfd1677d24a8627ec609aec7ad1108f9f16566cca2440c1');
await writeFile(new URL('operation.lock', dir), new Date().toISOString(), { flag:'wx' });
await save('before.json', {detail:before,requests});
const note = 'Partial response activity was observed before timeout. No complete result/hash was recovered. This records activity only, not success, acceptance or permission to retry.';
await save('intent.json', {owner_authorization:'Continue with the next step, following the explicit ran-without-usable-result/failed-qualification proposal',request_id:requestId,qualification_id:qid,outcome:'ran',note,new_provider_calls:0});
const reconciliation = await api(path + '/reconcile', {request_id:requestId,expected_version:before.connection.version,outcome:'ran',note});
await save('reconciliation.json', reconciliation);
const closure = await api(`workspaces/${ws}/plan-qualifications/${qid}/finish`, {});
await save('qualification-closure.json', closure);
assert.equal(closure.state, 'failed');
assert.deepEqual(closure.held_out, {passed:3,total:4});
const after = await detail();
const final = await api(path + '/requests');
const req = final.find(r=>r.id===requestId);
assert.equal(final.length,requests.length);
assert.equal(req.state,'reconciled'); assert.equal(req.reason_code,'owner_ran');
for(const k of ['id','upstream_request_id','output_chars','output_hash','output_tokens','started_at','finished_at']) assert.deepEqual(req[k],prior[k],k);
assert.equal(after.usage.in_flight,0); assert.equal(after.usage.unresolved,0);
assert.equal(after.connection.settings_hash,before.connection.settings_hash);
await save('after.json',{detail:after,requests:final});
await save('result.json',{request_id:requestId,state:'reconciled',recorded_outcome:'ran_without_usable_result',qualification_id:qid,qualification_state:closure.state,held_out:closure.held_out,requests:final.length,unresolved:0,in_flight:0,new_provider_calls:0,settings_unchanged:true,installed_unchanged:true,original_timeout_receipts_preserved:true});
console.log(JSON.stringify({request_state:req.state,reason:req.reason_code,qualification:closure.state,held_out:closure.held_out,requests:final.length,unresolved:after.usage.unresolved}));
