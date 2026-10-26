// Default mode is check-only; --record can create the new receipt exactly once.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const root='C:/dev/creator_agent';
const dir='tracking/evidence/theme-intent-observation-classifier-v2-2026-10-25';
const output=dir+'/repair-receipt.json';
const inputs={},excluded=[];let checked=0;
function local(p){if(path.isAbsolute(p)||p.split(/[\\/]/).includes('..'))throw Error('Nonrepository input');return path.join(root,p);}
function hash(p){const h=crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');inputs[p]=h;return h;}
function read(p){hash(p);return JSON.parse(fs.readFileSync(local(p),'utf8'));}
function check(map){for(const [p,h]of Object.entries(map)){if(['tracking/BUILD_STATUS.md','tracking/SESSION_HANDOFF.md'].includes(p)){excluded.push({path:p,recorded_preupdate_sha256:h,reason:'mutable pre-update tracking'});continue;}if(hash(p)!==h)throw Error('Changed frozen input '+p);checked++;}}
function purityGuard(source){
 const tree=ts.createSourceFile('fixture.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 if(tree.parseDiagnostics.length)return false;
 let ok=true;let imports=0;
 const forbidden=new Set(['process','Date','performance','globalThis','global','require','eval','Function','fetch','setTimeout','setInterval','queueMicrotask','WebSocket','XMLHttpRequest','window','document','navigator','self','Deno','Bun','constructor']);
 function visit(n){
  if(ts.isImportDeclaration(n)){
   imports++;const names=n.importClause?.namedBindings;
   if(n.moduleSpecifier.text!=='node:crypto'||n.importClause?.name||!names||!ts.isNamedImports(names)||names.elements.length!==1||names.elements[0].name.text!=='createHash'||names.elements[0].propertyName)ok=false;
  }
  if((ts.isExportDeclaration(n)&&n.moduleSpecifier)||ts.isImportEqualsDeclaration(n)||ts.isNewExpression(n)||
    (ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword)||
    (ts.isIdentifier(n)&&forbidden.has(n.text))||
    (ts.isElementAccessExpression(n)&&ts.isStringLiteral(n.argumentExpression)&&n.argumentExpression.text==='constructor'))ok=false;
  ts.forEachChild(n,visit);
 }
 visit(tree);return ok&&imports===1;
}
const review=read('tracking/evidence/theme-intent-observation-classifier-review-2026-10-25/reviewer-receipt.json');check(review.input_sha256);check(review.report_sha256);
const old=read('tracking/evidence/theme-intent-observation-classifier-2026-10-25/implementation-receipt.json');check(old.input_sha256);
for(const p of ['scripts/theme-intent-observation-classifier-fixture-v2.mjs','tests/theme-intent-observation-classifier-fixture-v2.test.mjs','docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V2_REPAIR_2026-10-25.md','docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2_NOTE_2026-10-25.md',dir+'/tests.tap',dir+'/baseline-probes.json',dir+'/verify.mjs'])hash(p);
const source=fs.readFileSync(local('scripts/theme-intent-observation-classifier-fixture-v2.mjs'),'utf8');
if(!purityGuard(source))throw Error('AST dependency guard');
for(const mutant of ["import fs from 'node:fs';", "import {createHash} from 'node:crypto'; globalThis.process;", "import {createHash} from 'node:crypto'; require('fs');", "import {createHash} from 'node:crypto'; import('node:fs');", "import {createHash} from 'node:crypto'; performance.now();", "import {createHash} from 'node:crypto'; ({}).constructor('return process')();"])
 if(purityGuard(mutant))throw Error('AST guard self-test');
const tap=fs.readFileSync(local(dir+'/tests.tap'),'utf8');
const exact=(name,n,text=tap)=>new RegExp('^# '+name+' '+n+'\\r?$','m').test(text);
for(const [name,n]of [['tests',15],['pass',15],['fail',0],['skipped',0]])if(!exact(name,n))throw Error('Anchored TAP total');
if(exact('pass',15,'# pass 150\n'))throw Error('TAP guard self-test');
const probes=read(dir+'/baseline-probes.json');
if(probes.results.M1.v1.status!=='unknown'||probes.results.M1.v2.reason!=='LAUNCH_DURING_SAMPLING'||probes.results.M2.v1.status!=='pass'||probes.results.M2.v2.reason!=='PLANNED_QUIT_NOT_ESTABLISHED'||probes.results.M3.v1.status!=='pass'||probes.results.M3.v2.reason!=='CONTRADICTORY_POSTGRES_OBSERVATION')throw Error('Baseline probe binding');
const value={format:'theme-intent-observation-classifier-repair/2',status:'fixture_repair_verified_independent_review_pending',independent_review:false,author_involvement:'Authored classifier-v2/tests/report/v4.2 note; not independent support',checks:{prior_frozen_hash_bindings:checked,mismatches:0,fixture_test_groups_passed:15,fixture_test_groups_failed:0,anchored_TAP_totals:true,AST_dependency_guard:true,guard_negative_self_checks:7,baseline_defects_reproduced:3},excluded_preupdate_tracking:excluded,operational_access:false,OS_observations_executed:0,config_reads:0,native_cases_executed:0,provider_calls:0,workflows_activated:0,collector_implemented:false,operational_adapter_implemented:false,reader_N1_N4:'unchanged_out_of_scope',classifier_L1_L4:'future_collector_scope',M3_scheduling_decision:'unchanged',retired_checkout_accessed:false,full_C54:'partial',input_sha256:inputs};
if(process.argv.length===3&&process.argv[2]==='--record'){fs.writeFileSync(local(output),JSON.stringify({...value,recorded_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(value.checks));}
else if(process.argv.length===2){const saved=JSON.parse(fs.readFileSync(local(output),'utf8'));delete saved.recorded_at;if(JSON.stringify(saved)!==JSON.stringify(value))throw Error('Receipt mismatch');console.log(JSON.stringify({mode:'check_only_no_writes',...value.checks}));}
else throw Error('Usage: node verify.mjs [--record]');
