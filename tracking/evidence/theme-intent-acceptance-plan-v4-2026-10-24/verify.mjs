// Default invocation is check-only. --record exclusively creates the initial receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-acceptance-plan-v4-2026-10-24';
const output=dir+'/revision-receipt.json';
const inputs={};let checked=0;
function local(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Nonrepository input');return path.join(root,p);}
function hash(p){const h=crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');inputs[p]=h;return h;}
function read(p){hash(p);return JSON.parse(fs.readFileSync(local(p),'utf8'));}
function checkMap(m){for(const [p,h] of Object.entries(m)){if(['tracking/BUILD_STATUS.md','tracking/SESSION_HANDOFF.md'].includes(p))continue;if(hash(p)!==h)throw Error('Hash mismatch '+p);checked++;}}
const review=read('tracking/evidence/theme-intent-acceptance-v3-review-2026-10-24/reviewer-receipt.json');checkMap(review.input_sha256);
const revision=read('tracking/evidence/theme-intent-acceptance-plan-v3-2026-10-24/revision-receipt.json');checkMap(revision.input_sha256);
const helper=read('tracking/evidence/theme-intent-upgrade-helper-v4-review-2026-10-24/reviewer-receipt.json');checkMap(helper.helper_sha256);
const pkg=read('tracking/evidence/theme-intent-package-review-2026-10-23/reviewer-receipt.json');checkMap(pkg.artifact_sha256);
const plan=read('tracking/evidence/theme-intent-package-2026-10-23/installation-plan.json');
for(const p of ['docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V4_2026-10-24.md','docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V2_2026-10-24.md','docs/THEME_INTENT_ACCEPTANCE_SCHEDULING_DECISION_2026-10-24.md','apps/desktop/src-tauri/src/main.rs','apps/desktop/src-tauri/src/studio.rs','apps/desktop/src-tauri/src/home.rs','apps/desktop/src-tauri/src/winsys.rs','scripts/theme-intent-upgrade-v2-core.mjs','scripts/theme-intent-upgrade-v3-core.mjs','scripts/theme-intent-upgrade-v4-core.mjs',dir+'/verify.mjs'])hash(p);
const v4=fs.readFileSync(local('docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V4_2026-10-24.md'),'utf8');
for(let i=0;i<=10;i++)if(!v4.includes('NI-'+String(i).padStart(2,'0')))throw Error('Missing native case');
if(v4.includes('pending as of this revision')||v4.includes('not yet available')||v4.includes('wait for control stopped'))throw Error('Stale checklist wording');
if(!plan.studio_home||!plan.target_install_dir)throw Error('Missing historical path source');
const result={format:'theme-intent-acceptance-plan-revision/4',status:'planning_revised_exact_review_required_execution_blocked',independent_review:false,author_involvement:'Prepared v3/v4 and both proposals; cannot independently support these revisions.',candidate_plan_hash:review.candidate_plan_hash,installation_plan_hash:review.installation_plan_hash,owner_decision:'THEME-ACCEPTANCE-M3-2026-10-24; exact bundle configuration evidence accepted for this narrow session only',checks:{prior_hash_bindings_checked:checked,mismatches:0,mutable_tracking_preupdate_hashes_excluded:true,all_native_case_identifiers_present:true,stale_pending_install_wording_removed:true},limitations:['Inspector not implemented or executed','Database port, pg_bin/tool identity and active home attestation pending','Continuity/workspace/current role and concrete scopes pending','No live scheduler/continuous prevention/zero-dispatch claim'],operational_access:false,credentials_accessed:false,helpers_executed:0,native_cases_executed:0,provider_calls:0,workflows_activated:0,retired_checkout_accessed:false,full_C54:'partial',input_sha256:inputs};
if(process.argv.length===3&&process.argv[2]==='--record'){
 fs.writeFileSync(local(output),JSON.stringify({...result,recorded_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({mode:'record_exclusive',...result.checks}));
}else if(process.argv.length===2){
 const saved=JSON.parse(fs.readFileSync(local(output),'utf8'));
 if(JSON.stringify(saved.input_sha256)!==JSON.stringify(inputs)||JSON.stringify(saved.checks)!==JSON.stringify(result.checks))throw Error('Recorded inputs/checks differ');
 console.log(JSON.stringify({mode:'check_only_no_writes',...result.checks}));
}else throw Error('Usage: node verify.mjs [--record]');
