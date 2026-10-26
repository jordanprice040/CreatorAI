// Owner-authorized temporary 40->42 cap change, or restoration; no inference.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {canonicalHash} from '../packages/domain/dist/index.js';
import {PlanConnectionDetailSchema} from '../packages/contracts/dist/index.js';
const dir=new URL('../tracking/evidence/discovery-qualification-v5/',import.meta.url);
await mkdir(dir,{recursive:true});
const mode=process.argv[2];assert.ok(['increase','restore'].includes(mode));
let raw='';for await(const c of process.stdin)raw+=c;const secret=JSON.parse(raw);raw='';
let csrf='';
async function api(path,body){const r=await fetch('http://127.0.0.1:4310/api/'+path,{headers:{Cookie:`creator_session=${secret.session.token}`,...(body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});assert.ok(r.ok,`Local API ${r.status}`);return r.json();}
const s=await api('auth/session');assert.equal(s.authenticated,true);csrf=s.csrf_token;
const path='workspaces/88df6c10-7310-4ec0-b623-7f48046bc447/plan-connections/7529f8ef-8579-4685-80fc-5df300130667';
const detail=async()=>{const{sign_in_attempt,...d}=await api(path);return PlanConnectionDetailSchema.parse(d);};
const before=await detail();assert.equal(before.usage.in_flight,0);
const baseline=JSON.parse(await readFile(new URL('installed-state.json',dir),'utf8'));
const target=structuredClone(baseline.detail.connection.settings);
target.caps.shared.max_model_requests_per_day=mode==='increase'?42:40;
if(mode==='increase'){
 assert.equal(before.connection.settings_hash,baseline.detail.connection.settings_hash);
 assert.equal(before.usage.unresolved,0);
 assert.equal(before.connection.settings.caps.shared.max_model_requests_per_day,40);
}else{
 const expected=structuredClone(target);expected.caps.shared.max_model_requests_per_day=42;
 assert.deepEqual(before.connection.settings,expected);
}
assert.equal(before.connection.credits.state,'confirmed_off');
await writeFile(new URL(`cap-${mode}.lock`,dir),new Date().toISOString(),{flag:'wx'});
await writeFile(new URL(`cap-${mode}-intent.json`,dir),JSON.stringify({owner_authorization:'I approve you adding more slots to do the testing',before,proposed_settings:target,proposed_hash:canonicalHash(target),temporary:true,restore_daily_cap:40},null,2)+'\n',{flag:'wx'});
await api(path+'/settings',{expected_version:before.connection.version,settings:target});
const changed=await detail();assert.equal(changed.connection.settings_hash,canonicalHash(target));
await api(path+'/accept-caps',{expected_version:changed.connection.version,settings_hash:changed.connection.settings_hash});
const after=await detail();
// Restoring a studio cap does not clear an independent provider quota refusal.
if(mode==='increase') assert.deepEqual(after.blockers,[]);
else assert.deepEqual(after.connection.quota,before.connection.quota);
assert.deepEqual(after.connection.settings,target);
await writeFile(new URL(`cap-${mode}-receipt.json`,dir),JSON.stringify({at:new Date().toISOString(),before,after,new_provider_calls:0},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({mode,daily_cap:target.caps.shared.max_model_requests_per_day,settings_hash:after.connection.settings_hash,usage:after.usage,credits:after.connection.credits.state}));
