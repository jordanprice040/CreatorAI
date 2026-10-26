import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-acceptance-v2-review-2026-10-24';
const inputs={};let count=0;
function hash(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Outside repository');const h=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');inputs[p]=h;return h;}
function read(p){hash(p);return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));}
function check(m,prefix=''){for(const [p,h] of Object.entries(m)){if(hash(prefix+p)!==h)throw Error('Mismatch '+p);count++;}}
const assessment=read('tracking/evidence/theme-intent-acceptance-readiness-2026-10-24/assessment-receipt.json');check(assessment.input_sha256);
const install=read('tracking/evidence/theme-intent-installation-v4-2026-10-24/completion-receipt.json');check(install.evidence_sha256);
const base='tracking/evidence/theme-intent-operational-before-v4-2026-10-24/';
const before=read(base+'completion-receipt.json');check(before.evidence_sha256,base);
const review=read('tracking/evidence/theme-intent-upgrade-helper-v4-review-2026-10-24/reviewer-receipt.json');check(review.helper_sha256);
if(review.status!=='supported_exact_helper'||JSON.stringify(review.helper_sha256)!==JSON.stringify(install.helper_sha256))throw Error('Helper map mismatch');
const revision=read('tracking/evidence/theme-intent-acceptance-plan-v2-2026-10-24/revision-receipt.json');check(revision.artifact_sha256);
const run={};for(const n of fs.readdirSync(path.join(root,base,'run-01')))if(n.endsWith('.json'))run[n]=read(base+'run-01/'+n);
const after=run[path.basename(install.verification.receipt)];
const business=Object.entries(run['before.json'].hashes);
if(business.length!==114||business.some(([k,v])=>after.state.hashes[k]!==v)||after.state.schema!==29)throw Error('State mismatch');
if(!(Date.parse(run['migration-result.json'].at)<Date.parse(after.state.observed_at)))throw Error('Timeline mismatch');
for(const p of ['PROJECT_CONTEXT.md','PROMPT_LIBRARY.md','context/REQUIREMENTS.md','tracking/OWNER_DECISIONS_2026-10-20.md','docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_2026-10-23.md','apps/web/src/theme-intent.tsx','apps/web/src/catalog.tsx','apps/web/src/activity.tsx','apps/web/src/operations.tsx','apps/web/src/submit.tsx','apps/api/src/index.ts','apps/api/src/studio.ts','packages/contracts/src/intake.ts','packages/domain/src/intake.ts','apps/desktop/src-tauri/src/studio.rs','apps/desktop/src-tauri/src/signin.rs','apps/desktop/src-tauri/src/main.rs','apps/desktop/control/index.html',dir+'/verify.mjs','docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_REVIEW_2026-10-24.md'])hash(p);
const result={format:'theme-intent-checklist-independent-review/2',recorded_at:new Date().toISOString(),reviewer:'Codex primary agent, user-requested review conversation; no prior implementation involvement in available conversation; not blinded; not human acceptance',prior_implementation_involvement:false,status:'partial_checklist_support_execution_blocked',candidate_plan_hash:install.candidate_plan_hash,installation_plan_hash:install.installation_plan_hash,checklist_sha256:inputs['docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_2026-10-24.md'],checks:{hash_bindings_checked:count,mismatches:0,helper_bindings:Object.keys(review.helper_sha256).length,run_json_receipts_read:Object.keys(run).length,business_hashes_preserved:business.length,schema:29,migration_precedes_observation:true},findings:['M1 live scheduling and continuity blocked','M2 NI-04 visible stopped state unavailable; shutdown evidence scope needed'],per_gate_verdicts:'See hash-bound review report table A0, I, R, NI-00 through NI-10, H',operational_access:false,helper_executions:0,native_cases_executed:0,credentials_accessed:false,provider_calls:0,workflows_activated:0,retired_checkout_accessed:false,full_C54:'partial',input_sha256:inputs};
fs.writeFileSync(path.join(root,dir,'reviewer-receipt.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.checks));
