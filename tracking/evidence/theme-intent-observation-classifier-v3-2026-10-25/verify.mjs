// Default mode verifies only. --record creates exactly one new immutable receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-observation-classifier-v3-2026-10-25';
const output=dir+'/repair-receipt.json';
const inputs={},excluded=[],priorPaths=new Set();let checked=0;
function local(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Nonrepository input');return path.join(root,p);}
function hash(p){const h=crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');inputs[p]=h;return h;}
function read(p){hash(p);return JSON.parse(fs.readFileSync(local(p),'utf8'));}
function check(map){for(const [p,h]of Object.entries(map)){if(['tracking/BUILD_STATUS.md','tracking/SESSION_HANDOFF.md','tracking/DECISIONS.md'].includes(p)){excluded.push({path:p,recorded_preupdate_sha256:h,reason:'historical mutable tracking'});continue;}if(hash(p)!==h)throw Error('Changed frozen input '+p);checked++;priorPaths.add(p);}}
function purityGuard(source){
 const tree=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(tree.parseDiagnostics.length)return false;
 let ok=true;let imports=0;
 const forbidden=new Set(['process','Date','performance','globalThis','global','require','eval','Function','fetch','setTimeout','setInterval','queueMicrotask','WebSocket','XMLHttpRequest','window','document','navigator','self','Deno','Bun','constructor','Math','crypto','Reflect','Proxy']);
 function visit(n){
  if(ts.isImportDeclaration(n)){
   imports++;const names=n.importClause?.namedBindings;
   if(n.moduleSpecifier.text!=='node:crypto'||n.importClause?.name||!names||!ts.isNamedImports(names)||names.elements.length!==1||names.elements[0].name.text!=='createHash'||names.elements[0].propertyName)ok=false;
  }
  if((ts.isExportDeclaration(n)&&n.moduleSpecifier)||ts.isImportEqualsDeclaration(n)||ts.isNewExpression(n)||ts.isElementAccessExpression(n)||ts.isMetaProperty(n)||
    (ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)||
    (ts.isIdentifier(n)&&forbidden.has(n.text)))ok=false;
  ts.forEachChild(n,visit);
 }
 visit(tree);return ok&&imports===1;
}
const review=read('tracking/evidence/theme-intent-observation-classifier-v2-review-2026-10-25/reviewer-receipt.json');check(review.input_sha256);check(review.report_sha256);
const old=read('tracking/evidence/theme-intent-observation-classifier-v2-2026-10-25/repair-receipt.json');check(old.input_sha256);
for(const p of ['scripts/theme-intent-observation-classifier-fixture-v3.mjs','tests/theme-intent-observation-classifier-fixture-v3.test.mjs','docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V3_REPAIR_2026-10-25.md','docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_3_NOTE_2026-10-25.md',dir+'/tests-initial.tap',dir+'/tests-second.tap',dir+'/tests-final.tap',dir+'/baseline-probes.json',dir+'/verify.mjs'])hash(p);
const source=fs.readFileSync(local('scripts/theme-intent-observation-classifier-fixture-v3.mjs'),'utf8');
if(!purityGuard(source))throw Error('AST source guard');
const prefix="import {createHash} from 'node:crypto'; ";
const mutants=["import fs from 'node:fs';",...[
 "globalThis.process;","require('fs');","import('node:fs');","performance.now();","({}).constructor('return 0')();",
 "(()=>0)['constr'+'uctor']('return 0')();","(()=>0)[`constructor`]('return 0')();","Math.random();","crypto.randomUUID();","Reflect.ownKeys({});","Proxy;","import.meta.url;","const o={};o['key'];"
].map(s=>prefix+s)];
for(const mutant of mutants)if(purityGuard(mutant))throw Error('AST guard mutant accepted');
const tap=fs.readFileSync(local(dir+'/tests-final.tap'),'utf8');
function total(name,n,text=tap){const matches=[...text.matchAll(new RegExp('^# '+name+' ([0-9]+)\\r?$','gm'))];return matches.length===1&&Number(matches[0][1])===n;}
for(const [name,n]of [['tests',18],['pass',18],['fail',0],['skipped',0]])if(!total(name,n))throw Error('Anchored unique TAP total');
if(total('pass',18,'# pass 180\n')||total('pass',18,'# pass 18\n# pass 18\n'))throw Error('TAP guard self-test');
const probes=read(dir+'/baseline-probes.json');
for(const id of ['R1','R2','R3'])if(probes.results[id].v2.status!=='pass'||probes.results[id].v3.reason!=='RESTART_AFTER_STOPPED_SAMPLE')throw Error('Restart probe mismatch');
if(probes.results.R4.v2.status!=='pass'||probes.results.R4.v3.status!=='pass'||probes.results.N1.v2.status!=='unknown'||probes.results.N1.v3.reason!=='LAUNCH_NOT_EXCLUDED')throw Error('Control/launch probe mismatch');
const value={format:'theme-intent-observation-classifier-repair/3',status:'fixture_repair_verified_independent_review_pending',independent_review:false,author_involvement:'Authored classifier-v3/tests/report/v4.3 note; not independent support',checks:{prior_frozen_hash_bindings_including_overlap:checked,prior_distinct_paths:priorPaths.size,mismatches:0,fixture_test_groups_passed:18,fixture_test_groups_failed:0,anchored_unique_TAP_totals:true,AST_source_guard:true,guard_negative_self_checks:mutants.length+2,baseline_restart_defects_reproduced:3,normal_shutdown_control:true,uncertain_launch_regression:true},excluded_preupdate_tracking:excluded,operational_access:false,OS_observations_executed:0,config_reads:0,native_cases_executed:0,provider_calls:0,workflows_activated:0,collector_implemented:false,operational_adapter_implemented:false,reader_N1_N4:'unchanged_out_of_scope',classifier_L1_L4:'future_collector_scope',M3_scheduling_decision:'unchanged',retired_checkout_accessed:false,full_C54:'partial',input_sha256:inputs};
if(process.argv.length===3&&process.argv[2]==='--record'){fs.writeFileSync(local(output),JSON.stringify({...value,recorded_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(value.checks));}
else if(process.argv.length===2){const saved=JSON.parse(fs.readFileSync(local(output),'utf8'));delete saved.recorded_at;if(JSON.stringify(saved)!==JSON.stringify(value))throw Error('Receipt mismatch');console.log(JSON.stringify({mode:'check_only_no_writes',...value.checks}));}
else throw Error('Usage: node verify.mjs [--record]');
