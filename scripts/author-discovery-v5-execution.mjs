// Create the new binder from the existing preparation seam; never activate it.
import { readFile, writeFile } from 'node:fs/promises';
let s = await readFile('scripts/prepare-discovery-v4-execution.mjs', 'utf8');
s = s
  .replaceAll('discovery-qualification-v4', 'discovery-qualification-v5')
  .replaceAll('discovery-synthetic-v4', 'discovery-synthetic-v5')
  .replaceAll('discovery-v4', 'discovery-v5');
s = s.replace(
  "'tracking/evidence/discovery-qualification-v3/execution-plan.json'",
  "'tracking/evidence/discovery-qualification-v4/execution-plan.json'",
);
s = s.replace(
  'const sourcePaths = [',
  `const sourcePaths = [
  'tests/src/plan-stream-recovery.test.ts',
  'tracking/evidence/plan-stream-recovery/result.json',
  'tracking/evidence/v4-timeout-reconciliation/result.json',
  'tracking/evidence/v4-timeout-reconciliation/postrun-state.json',
  'tracking/evidence/v4-timeout-reconciliation/operation.lock',
  'tracking/evidence/discovery-qualification-v4/raw-results.json',
  'tracking/evidence/discovery-qualification-v4/execution-outcome.json',
  'tracking/evidence/discovery-qualification-v4/run.lock',
  'tracking/evidence/discovery-qualification-v5/postrun-preparation-state.json',`,
);
s = s.replace(
  'assert.match(testLog, /# pass 45\\b/);',
  `const passed = Number(/# pass (\\d+)/.exec(testLog)?.[1]);
assert.ok(passed >= 70, 'Affected checks must execute, not skip.');`,
);
s = s
  .replaceAll('passed: 45', 'passed')
  .replace(
    'discovery-qualification-execution/4',
    'discovery-qualification-execution/5',
  )
  .replace('fresh v4 frozen cases', 'fresh v5 frozen cases');
s = s.replace(
  "note: 'New role1.3",
  "note: 'Stream/reconciliation repair candidate; same frozen timeout/caps, no proven live root cause or recovered answer. New role1.3",
);
await writeFile('scripts/prepare-discovery-v5-execution.mjs', s, {
  flag: 'wx',
});
