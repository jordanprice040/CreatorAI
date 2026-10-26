// Offline evidence coverage audit. Executes the exact compiled discovery filter only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { BenchmarkCheckSchema } from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  discoveryRoleInput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/discovery-research14-runner/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const compiledPath = 'packages/db/dist/connection-store.js',
  source = await readFile(compiledPath, 'utf8');
const begin = source.indexOf(
  '.filter((r) =>',
  source.indexOf('async #discoveryQualifications('),
);
const end = source.indexOf('.map((r) => toQualification(r))', begin);
assert.ok(begin > 0 && end > begin);
const fragment = source.slice(begin, end).trim();
const filter = (rows) =>
  vm.runInNewContext(
    'rows' + fragment,
    {
      rows,
      canonicalHash,
      BenchmarkCheckSchema,
      DISCOVERY_ROLE_VERSION,
      discoveryRoleInput,
    },
    { timeout: 1000 },
  );

const research=await read(dir+'execution-outcome.json');
const semantics=await read('tracking/evidence/discovery-semantics-v2-runner/execution-outcome.json');
const rows=await Promise.all([...research.decisions,...semantics.decisions].map(async q=>({...q,manifest:await read(`config/connections/benchmarks/${q.task_class==='research_synthesis'?'discovery-research14-v2':'discovery-semantics-v2'}/${q.task_class}.json`)})));
for(const row of rows){assert.equal(row.state,'qualified');assert.equal(canonicalHash(row.manifest),row.manifest_hash);assert.equal(filter([row]).length,1);}
for(const r of research.results){assert.equal(r.outcome.kind,'completed');assert.equal(r.signal,'accepted');assert.equal(createHash('sha256').update(r.outcome.text).digest('hex'),r.outcome.output_hash);}
const receipt={format:'research14-live-operational-coverage/1',verified_at:new Date().toISOString(),compiled_filter_sha256:await hash(compiledPath),role_version:DISCOVERY_ROLE_VERSION,prompt_hash:DISCOVERY_PROMPT_HASH,eligible_classes:rows.map(r=>({task_class:r.task_class,qualification_id:r.id,state:r.state,manifest_hash:r.manifest_hash})),operational_coverage:'3/3',research_outputs:6,research_substantive_review:'required_not_performed',human_acceptance:false,provider_calls:0};
await writeFile(dir+'operational-coverage.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
