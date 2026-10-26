import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-acceptance-plan-v3-2026-10-24';
const inputs={};
function hash(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Repository-only');const h=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');inputs[p]=h;return h;}
const prior='tracking/evidence/theme-intent-acceptance-v2-review-2026-10-24/reviewer-receipt.json';
hash(prior);const reviewed=JSON.parse(fs.readFileSync(path.join(root,prior),'utf8'));
let preserved=0;for(const [p,h] of Object.entries(reviewed.input_sha256)){if(hash(p)!==h)throw Error('Changed prior input: '+p);preserved++;}
const v2='docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V2_2026-10-24.md';
if(hash(v2)!=='754a9873965c6d223fae3126d6d1b8cf8fbddb913190d9c93c7543615e67c592')throw Error('V2 changed');
const v3='docs/THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V3_2026-10-24.md';
const proposal='docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_2026-10-24.md';
for(const p of [v3,proposal,dir+'/verify.mjs'])hash(p);
const text=fs.readFileSync(path.join(root,v3),'utf8');
for(let i=0;i<=10;i++){const id='NI-'+String(i).padStart(2,'0');if(!text.includes(id))throw Error('Missing '+id);}
if(text.includes('wait for control stopped'))throw Error('Old NI-04 expectation');
if(!text.includes('SH-01')||!text.includes('unknown live scheduling remain blocking'))throw Error('Missing gate');
const receipt={format:'theme-intent-acceptance-plan-revision/3',recorded_at:new Date().toISOString(),status:'proposed_independent_review_required_execution_blocked',independent_review:false,author_involvement:'This conversation reviewed v2 and now prepared v3/proposal; cannot independently support v3.',candidate_plan_hash:reviewed.candidate_plan_hash,installation_plan_hash:reviewed.installation_plan_hash,checks:{prior_review_inputs_preserved:preserved,frozen_v2_unchanged:true,NI_00_through_NI_10_present:true,old_NI_04_stopped_control_expectation_removed:true},operational_access:false,credentials_accessed:false,helpers_executed:0,native_cases_executed:0,provider_calls:0,workflows_activated:0,retired_checkout_accessed:false,inspector_implemented:false,full_C54:'partial',next:'Independent exact-v3/proposal review; no operational execution',input_sha256:inputs};
fs.writeFileSync(path.join(root,dir,'revision-receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt.checks));
