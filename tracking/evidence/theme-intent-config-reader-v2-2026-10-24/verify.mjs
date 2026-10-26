// No arguments: compare only, never update evidence. --record creates once exclusively.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-config-reader-v2-2026-10-24';
const output=dir+'/repair-receipt.json';
const inputs={},excluded=[];let checked=0;
function local(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Nonrepository path');return path.join(root,p);}
function hash(p){const h=crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');inputs[p]=h;return h;}
function read(p){hash(p);return JSON.parse(fs.readFileSync(local(p),'utf8'));}
function check(m){for(const [p,h]of Object.entries(m)){if(['tracking/BUILD_STATUS.md','tracking/SESSION_HANDOFF.md'].includes(p)){excluded.push({path:p,recorded_preupdate_sha256:h,reason:'mutable historical tracking'});continue;}if(hash(p)!==h)throw Error('Changed frozen input '+p);checked++;}}
const review=read('tracking/evidence/theme-intent-config-reader-v5-review-2026-10-24/reviewer-receipt.json');check(review.input_sha256);
const old=read('tracking/evidence/theme-intent-acceptance-plan-v5-2026-10-24/revision-receipt.json');check(old.input_sha256);
for(const p of ['scripts/theme-intent-config-reader-fixture-v2.mjs','tests/theme-intent-config-reader-fixture-v2.test.mjs','docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2026-10-24.md','docs/THEME_INTENT_CONFIG_READER_V2_REPAIR_2026-10-24.md',dir+'/tests-initial.tap',dir+'/tests-unsandboxed-attempt.tap',dir+'/tests-final.tap',dir+'/verify.mjs'])hash(p);
const tap=fs.readFileSync(local(dir+'/tests-final.tap'),'utf8');if(!tap.includes('# pass 12')||!tap.includes('# fail 0'))throw Error('Missing test evidence');
const value={format:'theme-intent-config-reader-repair/2',status:'fixture_repair_verified_independent_review_pending',independent_review:false,author_involvement:'Authored reader/proposal repairs; not independent support',checks:{prior_frozen_hash_bindings:checked,mismatches:0,windows_fixture_tests_passed:12,fixture_tests_failed:0},excluded_preupdate_tracking:excluded,operational_access:false,saved_studio_config_read:false,credentials_accessed:false,PR01_SH01_implemented:false,native_cases_executed:0,provider_calls:0,workflows_activated:0,retired_checkout_accessed:false,limits:['Fixture-only; native-accepted hash provenance not established by parser','All-tag reparse coverage not executed','Same-user namespace race prevention not claimed','Operational adapter and scope absent'],full_C54:'partial',input_sha256:inputs};
if(process.argv.length===3&&process.argv[2]==='--record'){fs.writeFileSync(local(output),JSON.stringify({...value,recorded_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(value.checks));}
else if(process.argv.length===2){const saved=JSON.parse(fs.readFileSync(local(output),'utf8'));delete saved.recorded_at;if(JSON.stringify(saved)!==JSON.stringify(value))throw Error('Receipt mismatch');console.log(JSON.stringify({mode:'check_only_no_writes',...value.checks}));}
else throw Error('Usage: node verify.mjs [--record]');
