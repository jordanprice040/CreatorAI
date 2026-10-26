// Bounded disk cleanup of C:\dev\creator_agent (2026-10-24).
// Dry-run by default; pass --execute to delete. Targets are an explicit list,
// never a glob. Each target must resolve inside its allowed root, must not be a
// reparse point itself, and is removed with an lstat walk that unlinks nested
// links/junctions without following them.
import { lstat, readdir, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

const ROOT = 'C:\\dev\\creator_agent';
const VER = join(ROOT, '.verification');
const TGT = join(ROOT, 'apps', 'desktop', 'src-tauri', 'target');
const execute = process.argv.includes('--execute');

const v = (name, reason) => ({ root: VER, path: join(VER, name), class: 'disposable synthetic test environment', reason });
const c = (sub, reason) => ({ root: TGT, path: join(TGT, sub), class: 'reproducible build cache', reason });
const superseded = 'TEST_ONLY synthetic fixture root of a superseded helper; inactive; no receipt hashes or plans reference its contents; failures captured in tracked TAP/evidence';
const probe = 'TEST_ONLY synthetic reviewer probe root; inactive; tracked probe JSON/script retain the result';
const cargo = 'cargo intermediate output; rebuilt by cargo build; no review, plan or script references it';

const targets = [
  v('theme-helper-v2-1792803661619', superseded),
  v('theme-helper-v2-1792803740615', superseded),
  v('theme-helper-v2-1792803815899', superseded),
  v('theme-helper-v2-1792804436268', superseded + ' (interrupted run, no summary, no postmaster.pid)'),
  v('theme-helper-v2-1792804947316', superseded),
  v('theme-helper-v2-1792805317469', superseded),
  v('theme-helper-v2-1792808079636', superseded),
  v('theme-helper-v3-1792809917958', superseded),
  v('theme-helper-v3-1792815865601', superseded),
  v('theme-v2-review-probe-1792808608951', probe),
  v('theme-v3-review-probe-1792816685719', probe),
  v('theme-v3-review-probe-1792816827608', probe),
  c('debug\\deps', cargo),
  c('debug\\build', cargo),
  c('debug\\incremental', cargo),
  c('debug\\.fingerprint', cargo),
  c('release\\deps', cargo),
  c('release\\build', cargo),
  c('release\\.fingerprint', cargo),
];

const inside = (root, p) => {
  const r = relative(root, p);
  return r !== '' && !r.startsWith('..') && !isAbsolute(r);
};
const isLink = (st) => st.isSymbolicLink();

async function measure(p) {
  const st = await lstat(p);
  if (isLink(st)) return { bytes: 0, files: 0, links: 1 };
  if (!st.isDirectory()) return { bytes: st.size, files: 1, links: 0 };
  const acc = { bytes: 0, files: 0, links: 0 };
  for (const e of await readdir(p)) {
    const m = await measure(join(p, e));
    acc.bytes += m.bytes; acc.files += m.files; acc.links += m.links;
  }
  return acc;
}

async function remove(p, root) {
  if (!inside(root, p)) throw new Error(`escape: ${p}`);
  const st = await lstat(p);
  if (isLink(st)) {
    // Junctions/symlinks: remove the link itself, never its target.
    try { await unlink(p); } catch { await rmdir(p); }
    return;
  }
  if (st.isDirectory()) {
    for (const e of await readdir(p)) await remove(join(p, e), root);
    await rmdir(p);
  } else await unlink(p);
}

const results = [];
for (const t of targets) {
  const r = { ...t, status: 'pending' };
  try {
    const st = await lstat(t.path);
    if (isLink(st)) throw new Error('target is a reparse point');
    const real = await realpath(t.path);
    const realRoot = await realpath(t.root);
    if (!inside(realRoot, real) || !inside(ROOT, real)) throw new Error(`resolved outside root: ${real}`);
    Object.assign(r, await measure(t.path));
    if (execute) { await remove(t.path, t.root); r.status = 'deleted'; }
    else r.status = 'dry-run';
  } catch (e) {
    r.status = e.code === 'ENOENT' ? 'absent' : 'refused';
    r.error = String(e.message ?? e);
  }
  results.push(r);
  console.log(`${r.status.padEnd(8)} ${((r.bytes ?? 0) / 2 ** 30).toFixed(3)} GiB  ${t.path}${r.error ? '  ' + r.error : ''}`);
}
const total = results.filter((r) => r.status === (execute ? 'deleted' : 'dry-run')).reduce((s, r) => s + r.bytes, 0);
console.log(`total ${(total / 2 ** 30).toFixed(3)} GiB (${total} bytes)`);
const out = join(ROOT, 'tracking', 'evidence', 'disk-cleanup-2026-10-24', execute ? 'execute-result.json' : 'dry-run-result.json');
await writeFile(out, JSON.stringify({ at: new Date().toISOString(), execute, total_bytes: total, results }, null, 2) + '\n');
