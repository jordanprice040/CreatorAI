import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-acceptance-plan-v5-2026-10-24';
const receiptPath=dir+'/revision-receipt.json';
const inputs={},excluded=[];let count=0;
function local(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Nonrepository input');return path.join(root,p);}
function hash(p){const h=crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');inputs[p]=h;return h;}
const reviewPath='tracking/evidence/theme-intent-acceptance-v4-review-2026-10-24/reviewer-receipt.json';
hash(reviewPath);const review=JSON.parse(fs.readFileSync(local(reviewPath),'utf8'));
for(const [p,h]of Object.entries(review.input_sha256)){
 if(['tracking/BUILD_STATUS.md','tracking/SESSION_HANDOFF.md'].includes(p)){excluded.push({path:p,recorded_preupdate_sha256:h,reason:'mutable tracking updated after independent review'});continue;}
 if(hash(p)!==h)throw Error('Changed reviewed input '+p);count++;
}
for(const p of ['docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V5_2026-10-24.md','docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V3_2026-10-24.md','docs/THEME_INTENT_CONFIG_READER_PREPARATION_2026-10-24.md','scripts/theme-intent-config-reader-fixture.mjs','tests/theme-intent-config-reader-fixture.test.mjs','tracking/evidence/theme-intent-config-reader-2026-10-24/tests-final.tap','tracking/evidence/theme-intent-config-reader-2026-10-24/initial-result.txt',dir+'/verify.mjs'])hash(p);
const tap=fs.readFileSync(local('tracking/evidence/theme-intent-config-reader-2026-10-24/tests-final.tap'),'utf8');if(!tap.includes('# pass 6')||!tap.includes('# fail 0'))throw Error('Test result');
const result={format:'theme-intent-acceptance-plan-revision/5',status:'fixture_reader_prepared_exact_review_required',independent_review:false,owner_selection:'Prepare a field-limited reader for separate review; not operational access',candidate_plan_hash:review.candidate_plan_hash,installation_plan_hash:review.installation_plan_hash,checks:{preserved_review_inputs:count,mismatches:0,fixture_tests_passed:6,fixture_tests_failed:0},excluded_preupdate_tracking:excluded,operational_access:false,credentials_accessed:false,studio_config_read:false,fixture_only_config_reads:true,PR01_SH01_implemented:false,native_cases_executed:0,provider_calls:0,workflows_activated:0,retired_checkout_accessed:false,full_C54:'partial',input_sha256:inputs};
if(process.argv.length===3&&process.argv[2]==='--record'){
 fs.writeFileSync(local(receiptPath),JSON.stringify({...result,recorded_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.checks));
}else if(process.argv.length===2){
 const saved=JSON.parse(fs.readFileSync(local(receiptPath),'utf8'));delete saved.recorded_at;
 if(JSON.stringify(saved)!==JSON.stringify(result))throw Error('Receipt mismatch');console.log(JSON.stringify({mode:'check_only_no_writes',...result.checks}));
}else throw Error('Usage: node verify.mjs [--record]');
