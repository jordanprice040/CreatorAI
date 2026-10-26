import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  ROOT,
  bindings,
  hash,
  save,
  sha,
  command,
} from './theme-intent-upgrade-v4-core.mjs';
const name = process.argv[2];
assert.match(name, /^[a-z0-9-]+$/);
const dir = join(
  ROOT,
  'tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24',
);
const before = await bindings();
for (const p of [
  'scripts/run-theme-intent-v4-tests.mjs',
  'tests/theme-intent-upgrade-v4.test.mjs',
  'tests/theme-intent-upgrade-v4-guards.test.mjs',
  'tests/fixtures/theme-intent-v4-installer.ps1',
])
  before[p] = await hash(join(ROOT, p));
await save(join(dir, name + '-sources-before.json'), {
  started_at: new Date().toISOString(),
  source_sha256: before,
});
let failed = false;
for (const [kind, file] of [
  ['guards', 'tests/theme-intent-upgrade-v4-guards.test.mjs'],
  ['e2e', 'tests/theme-intent-upgrade-v4.test.mjs'],
]) {
  const result = await command(process.execPath, ['--test', join(ROOT, file)], {
    cwd: ROOT,
    timeout: 1200000,
    allowFailure: true,
  });
  const tap = result.stdout + result.stderr;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, name + '-' + kind + '.tap'), tap, { flag: 'wx' });
  const after = await bindings();
  for (const p of Object.keys(before))
    if (!(p in after)) after[p] = await hash(join(ROOT, p));
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  await save(join(dir, name + '-' + kind + '-run.json'), {
    format: 'theme-intent-helper-bound-test-run/1',
    ended_at: new Date().toISOString(),
    source_sha256: before,
    sources_unchanged: unchanged,
    tap_sha256: sha(tap),
    exit_code: result.code,
    timed_out: result.timed_out,
    fixture_installer: true,
    operational_access: false,
  });
  console.log(
    kind +
      ': exit ' +
      result.code +
      '; sources unchanged=' +
      unchanged +
      '\n' +
      tap.slice(-1800),
  );
  if (result.code !== 0 || result.timed_out || !unchanged) {
    failed = true;
    break;
  }
}
process.exitCode = failed ? 1 : 0;
