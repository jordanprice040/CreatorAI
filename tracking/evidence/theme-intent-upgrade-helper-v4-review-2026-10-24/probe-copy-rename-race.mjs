// Independent v4 review probe: does an immediate directory rename after a fresh payload copy
// get refused on this host without any deliberately held handle? Repeats the recovery step
// shape (mkdir, fixture installer copy, rename) in a disposable root. Read-only for sources.
// A refusal is retried only here, to measure its duration; the helper itself never retries.
import { mkdir, writeFile, rename, rm, lstat, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, command } from '../../../scripts/theme-intent-upgrade-v4-core.mjs';
const iterations = Number(process.argv[2] ?? 20);
const root = join(ROOT, '.verification', 'theme-v4-review-race-' + Date.now());
const payload = join(ROOT, '.verification/discovery-semantics-v2-artifacts');
await mkdir(root);
await writeFile(join(root, 'TEST_ONLY'), 'synthetic helper test\n');
const installer = join(root, 'fixture-installer.ps1');
await cp(join(ROOT, 'tests/fixtures/theme-intent-v4-installer.ps1'), installer);
const results = [];
for (const mode of ['powershell-fixture-installer', 'node-cp']) {
  for (let i = 0; i < iterations; i++) {
    const dir = join(root, `install-${mode}-${i}`),
      moved = dir + '.generated';
    await mkdir(dir);
    if (mode === 'node-cp') {
      await cp(join(payload, 'studio'), join(dir, 'studio'), { recursive: true });
      await cp(join(payload, 'packaged-creator-desktop.exe'), join(dir, 'creator-desktop.exe'));
    } else
      await command(
        'powershell.exe',
        ['-NoProfile', '-File', installer, '-InstallDir', dir, '-Payload', payload, '-Previous', 'true'],
        { timeout: 600000 },
      );
    const t0 = Date.now();
    let first = null,
      attempts = 0,
      ok = false;
    while (!ok && Date.now() - t0 < 15000) {
      attempts++;
      try {
        await rename(dir, moved);
        ok = true;
      } catch (e) {
        first ??= e.code;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    results.push({ mode, i, first_attempt: first ?? 'ok', attempts, renamed: ok, ms_until_renamed: ok ? Date.now() - t0 : null });
    await rm(ok ? moved : dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
const summary = {};
for (const r of results) {
  const k = r.mode;
  summary[k] ??= { iterations: 0, refused_first_attempt: 0, codes: {}, max_ms_until_renamed: 0, never_renamed: 0 };
  summary[k].iterations++;
  if (r.first_attempt !== 'ok') {
    summary[k].refused_first_attempt++;
    summary[k].codes[r.first_attempt] = (summary[k].codes[r.first_attempt] ?? 0) + 1;
  }
  if (!r.renamed) summary[k].never_renamed++;
  else summary[k].max_ms_until_renamed = Math.max(summary[k].max_ms_until_renamed, r.ms_until_renamed);
}
await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
const removed = await lstat(root).then(
  () => false,
  () => true,
);
console.log(
  JSON.stringify(
    { format: 'theme-intent-v4-review-copy-rename-race/1', at: new Date().toISOString(), root, root_removed: removed, summary, results },
    null,
    2,
  ),
);
