// Default mode verifies only. --record creates one immutable implementation receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-observation-classifier-2026-10-25';
const output=dir+'/implementation-receipt.json';
const inputs={},excluded=[];let checked=0;
function local(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Nonrepository path');return path.join(root,p);}
function hash(p){const h=crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');inputs[p]=h;return h;}
function read(p){hash(p);return JSON.parse(fs.readFileSync(local(p),'utf8'));}
function check(map){for(const [p,h]of Object.entries(map)){if(['tracking/BUILD_STATUS.md','tracking/SESSION_HANDOFF.md'].includes(p)){excluded.push({path:p,recorded_preupdate_sha256:h,reason:'mutable tracking after review'});continue;}if(hash(p)!==h)throw Error('Changed prior input '+p);checked++;}}
const review=read('tracking/evidence/theme-intent-config-reader-v2-review-2026-10-25/reviewer-receipt.json');check(review.input_sha256);
const old=read('tracking/evidence/theme-intent-config-reader-v2-2026-10-24/repair-receipt.json');check(old.input_sha256);
for(const p of ['scripts/theme-intent-observation-classifier-fixture.mjs','tests/theme-intent-observation-classifier-fixture.test.mjs','docs/THEME_INTENT_OBSERVATION_CLASSIFIER_2026-10-25.md','docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_1_NOTE_2026-10-25.md',dir+'/tests.tap',dir+'/verify.mjs'])hash(p);
const tap=fs.readFileSync(local(dir+'/tests.tap'),'utf8');if(!tap.includes('# pass 10')||!tap.includes('# fail 0'))throw Error('Test evidence missing');
const source=fs.readFileSync(local('scripts/theme-intent-observation-classifier-fixture.mjs'),'utf8');
// Supplemental source guard; the independent review still needs to inspect the implementation.
if(/node:(fs|os|net|http|child_process)|process\.|Date\.|fetch\(/.test(source))throw Error('Non-pure dependency/call');
const result={format:'theme-intent-observation-classifier-fixture/1',status:'fixture_implemented_independent_review_pending',independent_review:false,author_involvement:'Prepared classifier/tests/report/note; not independent support',candidate_plan_hash:'7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc',installation_plan_hash:'27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1',checks:{prior_frozen_hash_bindings:checked,mismatches:0,fixture_test_groups_passed:10,fixture_test_groups_failed:0,no_OS_or_IO_dependency_source_guard:true},excluded_preupdate_tracking:excluded,operational_access:false,saved_studio_config_read:false,credentials_accessed:false,OS_observations_executed:0,operational_adapter_implemented:false,PR01_SH01_collector_implemented:false,classification_core_only:true,native_cases_executed:0,provider_calls:0,workflows_activated:0,retired_checkout_accessed:false,reader_N1_N4:'unchanged_deferred_to_operational_adapter_scope',M3:'unchanged',full_C54:'partial',input_sha256:inputs};
if(process.argv.length===3&&process.argv[2]==='--record'){fs.writeFileSync(local(output),JSON.stringify({...result,recorded_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.checks));}
else if(process.argv.length===2){const saved=JSON.parse(fs.readFileSync(local(output),'utf8'));delete saved.recorded_at;if(JSON.stringify(saved)!==JSON.stringify(result))throw Error('Receipt mismatch');console.log(JSON.stringify({mode:'check_only_no_writes',...result.checks}));}
else throw Error('Usage: node verify.mjs [--record]');
