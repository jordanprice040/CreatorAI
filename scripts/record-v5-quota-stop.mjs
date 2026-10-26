// Offline binding only. No request, settings change, quota reset or retry.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonicalHash} from '../packages/domain/dist/index.js';
const dir='tracking/evidence/discovery-qualification-v5/';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=(p,v)=>writeFile(dir+p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const plan=await read(dir+'execution-plan.json');
assert.equal(canonicalHash(plan),'68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d');
for(const[p,h]of Object.entries(plan.source_sha256))assert.equal(sha(await readFile(p)),h,p);
const amendment=await read(dir+'capacity-authorization.json');
assert.equal(canonicalHash(amendment),'19c60ab6762bc631bbb012c8651c304723ced25e2324a64da4ec730139a34a1d');
assert.equal(sha(await readFile('scripts/qualify-v5-approved-capacity.mjs')),amendment.runner_sha256);
const manifest=await read(plan.install_dir+'/studio/bundle-manifest.json');
assert.equal(sha(await readFile(plan.install_dir+'/studio/bundle-manifest.json')),plan.bundle_manifest_sha256);
for(const f of manifest.files)assert.equal(sha(await readFile(plan.install_dir+'/studio/'+f.path)),f.sha256,f.path);
const raw=await read(dir+'raw-results.json');
const post=await read(dir+'postrun-state.json');
assert.equal(raw.length,11);assert.equal(post.counts.plan_requests,35);
for(const r of raw.slice(0,10)){assert.equal(r.outcome.kind,'completed');assert.equal(r.signal,'accepted');assert.equal(sha(r.outcome.text),r.outcome.output_hash);}
assert.equal(raw[10].outcome.reason_code,'subscription_sharing_usage_limit_exceeded');
assert.equal(post.detail.connection.quota.state,'exhausted');
assert.equal(post.detail.connection.settings.caps.shared.max_model_requests_per_day,40);
assert.equal(post.detail.connection.settings_hash,plan.proposed_settings_hash);
assert.equal(post.detail.connection.credits.state,'confirmed_off');
assert.equal(post.detail.usage.unresolved,0);assert.equal(post.detail.usage.in_flight,0);
const observations=[
 'Preserves copied-source dependence, uncertain distinct counts, severity/causes and ordinary maintenance alternatives.',
 'Recognizes stipulated corroboration within simulation; separates fitting counts from proportion of bicycles and intervention benefit.',
 'Preserves incompatible tray/specimen units and windows; proposes reconciliation without inventing a combined count.',
 'Keeps retired cloakroom evidence separate from present conditions and defers with insufficient support.',
 'Makes paired identifiers a conditional untested physical transfer, without a software-specific need claim.',
 'Ignores source demands to invent references or generic success; keeps actual missing-card observation and synthetic limitations.',
 'Uses existing spreadsheet, preserves title occurrences, records unknown conventions/results, rejects custom software and uses null novelty.',
 'Keeps local phonetic rules conditional, differentiates variants from errors, considers simpler tools and preserves unknown benefit.',
 'Proposes condition-first paper process with human assessment and pending-review cases; target is proposed, no executed trial claimed.',
 'Retains panel judgment, explicit authorized procedure, disagreement/plurality/deferral and no inferred consensus or automatic weights.',
];
await save('author-review.json',{reviewer:'Codex coding-agent author; not independent human review',independent_substantive_review:'required_not_performed',outputs:raw.slice(0,10).map((r,i)=>({case_id:r.case_id,request_id:r.request_id,output_hash:r.outcome.output_hash,observation:observations[i]})),failed_request:{request_id:raw[10].request_id,review:'Provider quota failure with no text; no substantive answer grade inferred.'}});
await save('execution-outcome.json',{
 date_local:'2026-10-21',original_execution_plan_hash:canonicalHash(plan),capacity_authorization_hash:canonicalHash(amendment),
 temporary_daily_cap:42,restored_daily_cap:40,settings_restored:true,credits:'confirmed_off',
 attempted:11,completed_accepted:10,provider_quota_failures:1,unknown:0,unattempted:7,retries:0,
 research:{qualification_id:'ff7ae4f1-117f-4773-be46-b39f3c18ff53',state:'qualified_operational_contract_only',development:{passed:2,total:2},held_out:{passed:4,total:4}},
 candidate_generation:{qualification_id:'b90d89e8-cb58-46b3-80c5-4a58af019ad0',state:'failed',development:{passed:2,total:2},held_out:{passed:2,total:4},note:'Two held-out answers accepted, third quota failure, fourth not attempted. Not two observed content failures.'},
 scoring:'not_attempted',quota_failure:raw[10],postrun_counts:post.counts,
 request_states:post.requests.reduce((a,r)=>({...a,[r.state]:(a[r.state]??0)+1}),{}),
 in_flight:0,unresolved:0,leased:post.leased,quota:'exhausted',
 verified_source_bindings:Object.keys(plan.source_sha256).length,verified_installed_files:manifest.files.length,
 installed_manifest_sha256:plan.bundle_manifest_sha256,original_plan_and_frozen_cases_unchanged:true,
 metered_fallback:false,credits_activation:false,workflow_search_build_pilot:false,
 restoration_verification:'Local cap restore succeeded; initial helper incorrectly required zero blockers despite independent provider quota. Read-only API/DB confirmed restoration; no repeated mutation.',
 substantive_review:'Author observations separate; independent review required/not performed.',
 next_eligible:'Review complete output artifacts and remaining qualification scope offline. Further live testing requires provider quota availability and a separately scoped prospective decision; do not reset quota, repeat v5 or raise studio cap as a provider-quota workaround.',
});
console.log(JSON.stringify({attempted:11,accepted:10,provider_quota_failures:1,unattempted:7,daily_cap_restored:40,unresolved:0,in_flight:0}));
