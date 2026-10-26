// Author the new preparation binder only; no install or inference.
import { readFile, writeFile } from 'node:fs/promises';
let code = await readFile('scripts/prepare-discovery-v3-execution.mjs', 'utf8');
code = code
  .replaceAll('discovery-qualification-v3', 'discovery-qualification-v4')
  .replaceAll('discovery-synthetic-v3', 'discovery-synthetic-v4')
  .replaceAll('discovery-v3', 'discovery-v4');
code = code.replace(
  "'tracking/evidence/discovery-v2-transport-repair/execution-plan.json'",
  "'tracking/evidence/discovery-qualification-v3/execution-plan.json'",
);
code = code.replace(
  'const sourcePaths = [',
  `const sourcePaths = [
  'scripts/author-discovery-v4.mjs',
  'scripts/author-discovery-v4-execution.mjs',
  'tests/src/discovery-v4-associations.test.ts',
  'tests/src/discovery-identity-assertions.test.ts',
  'tracking/evidence/discovery-qualification-v4/review-plan.json',
  'tracking/evidence/discovery-qualification-v4/tests-final.tap',
  'tracking/evidence/discovery-qualification-v3/raw-results.json',
  'tracking/evidence/discovery-qualification-v3/execution-outcome.json',
  'tracking/evidence/discovery-qualification-v3/run.lock',`,
);
code = code.replace(
  'discovery-qualification-v4/tests.tap',
  'discovery-qualification-v4/tests-final.tap',
);
code = code
  .replace(/# pass 56/g, '# pass 45')
  .replaceAll('passed: 56', 'passed: 45');
code = code
  .replace(
    'discovery-qualification-execution/3',
    'discovery-qualification-execution/4',
  )
  .replace(
    'New role1.2 and fresh v3 frozen cases',
    'New role1.3 and fresh v4 frozen cases',
  );
await writeFile('scripts/prepare-discovery-v4-execution.mjs', code, {
  flag: 'wx',
});
