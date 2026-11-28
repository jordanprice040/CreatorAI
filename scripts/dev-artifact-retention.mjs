// Bounded retention for synthetic development test artifacts under .verification.
//
// Opt-in only: a test run that wants retention calls createOwnedRun(), which
// writes a marker before anything else. Cleanup considers only direct children
// of the verification root that carry a valid marker naming that exact
// directory. Unmarked, foreign, linked, referenced, protected and active
// directories are always kept. The CLI is a dry run unless --apply is given.
import { randomBytes } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { hostname, homedir, tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MARKER = '.creator-dev-run.json';
export const SCHEMA = 'creator-dev-artifact-run/1';
export const LOCK = '.creator-dev-cleanup.lock';
const TOMBSTONE = '.creator-dev-deleting-';
const STATES = new Set(['active', 'passed', 'failed']);
const PREFIX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HOUR = 3_600_000;

// Documented in docs/DEV_ARTIFACT_RETENTION.md. Retention is measured from
// finishedAt (or the last heartbeat for an abandoned active run).
export const DEFAULT_POLICY = Object.freeze({
  passedRetentionHours: 24,
  failedRetentionDays: 14,
  keepLatestPassed: 1,
  keepLatestFailed: 2,
  staleActiveHours: 24,
});

// Text roots scanned for evidence references to a run directory name.
export const DEFAULT_REFERENCE_ROOTS = ['tracking', 'docs'];
const REFERENCE_EXT = /\.(md|json|txt|tap|log|ya?ml|csv)$/i;
const REFERENCE_MAX_BYTES = 8 * 1024 * 1024;

const now = () => new Date().toISOString();

// Rejects roots that could put operational data, credentials or the checkout
// itself within reach. The root must exist as a real directory, not a link.
export async function assertSafeRoot(root, { repoRoot = ROOT } = {}) {
  if (typeof root !== 'string' || !isAbsolute(root))
    throw new Error('Root must be absolute');
  const abs = resolve(root);
  const info = await lstat(abs);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`Refusing linked or non-directory root: ${abs}`);
  const real = await realpath(abs);
  if (real.toLowerCase() !== abs.toLowerCase())
    throw new Error(`Refusing root that resolves elsewhere: ${abs} -> ${real}`);
  const lower = abs.toLowerCase();
  const norm = (p) =>
    resolve(p)
      .toLowerCase()
      .replace(/[\\/]+$/, '');
  const within = (p) => lower.startsWith(norm(p) + sep);
  // Windows may give the temp folder as an 8.3 short name (C:\Users\RUNNER~1);
  // a root that passed the check above is in long form, so compare with both.
  const temps = [tmpdir(), await realpath(tmpdir()).catch(() => tmpdir())];
  // The root must not be, or contain, a drive root, the checkout, the home
  // folder or the temp folder.
  for (const p of [parse(abs).root, repoRoot, homedir(), ...temps]) {
    const q = norm(p);
    if (
      lower === q ||
      q.startsWith(lower + sep) ||
      parse(abs).root.toLowerCase() === lower
    )
      throw new Error(`Refusing broad root: ${abs}`);
  }
  // Application data and install folders hold operational data and
  // credentials. Disposable roots under the temp folder are allowed.
  if (!temps.some(within))
    for (const env of [
      'APPDATA',
      'LOCALAPPDATA',
      'PROGRAMDATA',
      'ProgramFiles',
      'ProgramFiles(x86)',
    ])
      if (
        process.env[env] &&
        (lower === norm(process.env[env]) || within(process.env[env]))
      )
        throw new Error(`Refusing root inside ${env}: ${abs}`);
  return abs;
}

async function writeAtomic(file, value) {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await rename(tmp, file);
}

// Creates <root>/<prefix>-<epochMs>-<random> with an active marker and
// returns a handle. Call heartbeat() during long runs and finish() at the end;
// protect() pins the run (recovery material, evidence) so cleanup never
// removes it.
export async function createOwnedRun({ root, prefix, owner, repoRoot = ROOT }) {
  if (!PREFIX.test(prefix ?? '')) throw new Error('Invalid run prefix');
  if (typeof owner !== 'string' || !owner)
    throw new Error('Run owner required');
  const base = await assertSafeRoot(root, { repoRoot });
  const runId = `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const dir = join(base, runId);
  await mkdir(dir);
  const file = join(dir, MARKER);
  let marker = {
    schema: SCHEMA,
    synthetic: true,
    runId,
    prefix,
    owner,
    host: hostname(),
    pid: process.pid,
    state: 'active',
    createdAt: now(),
    heartbeatAt: now(),
    finishedAt: null,
    protected: null,
  };
  await writeAtomic(file, marker);
  const update = async (patch) => {
    marker = { ...marker, ...patch };
    await writeAtomic(file, marker);
    return marker;
  };
  return {
    dir,
    runId,
    marker: () => ({ ...marker }),
    heartbeat: () => update({ heartbeatAt: now() }),
    protect: (reason) => {
      if (typeof reason !== 'string' || !reason)
        throw new Error('Protection reason required');
      return update({ protected: { reason, at: now() } });
    },
    finish: (state) => {
      if (state !== 'passed' && state !== 'failed')
        throw new Error('Run ends passed or failed');
      if (marker.state !== 'active') throw new Error('Run already finished');
      return update({ state, finishedAt: now(), heartbeatAt: now() });
    },
  };
}

export async function readMarker(dir, name = basename(dir)) {
  let raw;
  try {
    const info = await lstat(join(dir, MARKER));
    if (!info.isFile()) return { error: 'marker-not-regular-file' };
    raw = await readFile(join(dir, MARKER), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { error: 'unmarked' };
    throw error;
  }
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return { error: 'marker-unparseable' };
  }
  if (m?.schema !== SCHEMA || m.synthetic !== true)
    return { error: 'marker-schema' };
  if (m.runId !== name) return { error: 'marker-names-other-directory' };
  if (!PREFIX.test(m.prefix ?? '') || !m.runId.startsWith(m.prefix + '-'))
    return { error: 'marker-prefix' };
  if (!STATES.has(m.state)) return { error: 'marker-state' };
  for (const k of ['createdAt', 'heartbeatAt'])
    if (!Number.isFinite(Date.parse(m[k]))) return { error: 'marker-time' };
  if (m.state !== 'active' && !Number.isFinite(Date.parse(m.finishedAt)))
    return { error: 'marker-time' };
  return { marker: m };
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// True when the active run's owner is (or may be) still running. A different
// host or a recent heartbeat is treated as alive; only a dead local pid with a
// stale heartbeat counts as abandoned.
export function activeRunAlive(
  m,
  { at = Date.now(), policy = DEFAULT_POLICY } = {},
) {
  if (at - Date.parse(m.heartbeatAt) < policy.staleActiveHours * HOUR)
    return true;
  if (m.host !== hostname()) return true;
  return pidAlive(m.pid);
}

// Returns the first symlink/junction/reparse-like entry within dir, or null.
// Directories are never entered through a link.
export async function findLink(dir) {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const p = join(current, entry.name);
      const info = await lstat(p);
      if (info.isSymbolicLink()) return p;
      if (info.isDirectory()) {
        const real = await realpath(p);
        if (real.toLowerCase() !== p.toLowerCase()) return p;
        stack.push(p);
      }
    }
  }
  return null;
}

async function referenceCorpus(repoRoot, roots) {
  const texts = [];
  const visit = async (p) => {
    let info;
    try {
      info = await lstat(p);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of await readdir(p)) await visit(join(p, name));
    } else if (
      info.isFile() &&
      REFERENCE_EXT.test(p) &&
      info.size <= REFERENCE_MAX_BYTES
    ) {
      texts.push(await readFile(p, 'utf8'));
    }
  };
  for (const r of roots) await visit(resolve(repoRoot, r));
  return texts;
}

// Produces a decision for every direct child of root. Nothing is changed.
export async function planCleanup({
  root,
  repoRoot = ROOT,
  referenceRoots = DEFAULT_REFERENCE_ROOTS,
  policy = DEFAULT_POLICY,
  at = Date.now(),
}) {
  const base = await assertSafeRoot(root, { repoRoot });
  const corpus = await referenceCorpus(repoRoot, referenceRoots);
  const entries = [];
  const finished = [];
  for (const entry of (await readdir(base, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(base, entry.name);
    const keep = (reason) =>
      entries.push({ name: entry.name, action: 'keep', reason });
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      keep('link');
      continue;
    }
    if (!info.isDirectory()) {
      keep('not-directory');
      continue;
    }
    if (entry.name.startsWith(TOMBSTONE)) {
      keep('interrupted-deletion');
      continue;
    }
    const { marker, error } = await readMarker(path);
    if (error) {
      keep(error);
      continue;
    }
    if (marker.protected) {
      keep('protected');
      continue;
    }
    if (corpus.some((t) => t.includes(entry.name))) {
      keep('referenced-evidence');
      continue;
    }
    if (marker.state === 'active') {
      if (activeRunAlive(marker, { at, policy })) {
        keep('active');
        continue;
      }
      // Abandoned run: diagnostics retained like a failure, aged from the
      // last heartbeat.
      finished.push({
        name: entry.name,
        marker,
        kind: 'failed',
        since: marker.heartbeatAt,
      });
      continue;
    }
    finished.push({
      name: entry.name,
      marker,
      kind: marker.state,
      since: marker.finishedAt,
    });
  }
  const groups = new Map();
  for (const f of finished) {
    const key = `${f.marker.prefix}\u0000${f.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => Date.parse(b.since) - Date.parse(a.since));
    list.forEach((f, i) => {
      const latest =
        f.kind === 'passed' ? policy.keepLatestPassed : policy.keepLatestFailed;
      const window =
        f.kind === 'passed'
          ? policy.passedRetentionHours * HOUR
          : policy.failedRetentionDays * 24 * HOUR;
      const reasonKind = f.kind === 'failed' ? 'failed-diagnostics' : 'passed';
      if (i < latest)
        entries.push({
          name: f.name,
          action: 'keep',
          reason: `${reasonKind}-latest`,
        });
      else if (at - Date.parse(f.since) < window)
        entries.push({
          name: f.name,
          action: 'keep',
          reason: `${reasonKind}-within-retention`,
        });
      else
        entries.push({
          name: f.name,
          action: 'delete',
          reason: `${reasonKind}-expired`,
          state: f.marker.state,
          since: f.since,
        });
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { root: base, at: new Date(at).toISOString(), policy, entries };
}

// Applies a fresh plan. Serialized by an exclusive lock file. Each candidate is
// re-validated, renamed to a tombstone (fails while Windows has files open),
// re-validated again and then removed. Any doubt keeps the directory.
export async function applyCleanup(options) {
  const base = await assertSafeRoot(options.root, options);
  const lockPath = join(base, LOCK);
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(`Cleanup lock held: ${lockPath}`);
    throw error;
  }
  const results = [];
  try {
    await lock.writeFile(
      JSON.stringify({ pid: process.pid, host: hostname(), at: now() }),
    );
    const plan = await planCleanup(options);
    for (const e of plan.entries) {
      if (e.action !== 'delete') {
        results.push(e);
        continue;
      }
      results.push({ ...e, ...(await removeRun(base, e, options)) });
    }
    return { ...plan, entries: results, applied: true };
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function stillDeletable(dir, entry, options) {
  const { marker, error } = await readMarker(dir);
  if (error) return error;
  if (marker.protected) return 'protected';
  if (marker.state !== entry.state) return 'state-changed';
  if (marker.state === 'active' && activeRunAlive(marker, options))
    return 'active';
  return (await findLink(dir)) ? 'contains-link' : null;
}

async function removeRun(base, entry, options) {
  const dir = join(base, entry.name);
  const inside = relative(base, dir);
  if (!inside || inside.includes(sep) || inside.startsWith('..'))
    return { action: 'keep', reason: 'path-escape' };
  const first = await stillDeletable(dir, entry, options);
  if (first) return { action: 'keep', reason: first };
  const tomb = join(base, TOMBSTONE + randomBytes(6).toString('hex'));
  try {
    await rename(dir, tomb);
  } catch (error) {
    return {
      action: 'keep',
      reason: `rename-refused-${error.code ?? 'error'}`,
    };
  }
  const second = await readMarker(tomb, entry.name);
  const linked = await findLink(tomb);
  if (second.error || linked) {
    await rename(tomb, dir).catch(() => {});
    return { action: 'keep', reason: 'changed-during-delete' };
  }
  await rm(tomb, { recursive: true, force: false, maxRetries: 2 });
  if (
    await stat(tomb).then(
      () => true,
      () => false,
    )
  )
    return { action: 'keep', reason: 'remove-incomplete' };
  return { action: 'deleted' };
}

function parseArgs(argv) {
  const args = { apply: false, root: join(ROOT, '.verification') };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--root') args.root = resolve(argv[(i += 1)]);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = args.apply
      ? await applyCleanup(args)
      : await planCleanup(args);
    const counts = {};
    for (const e of result.entries)
      counts[e.action] = (counts[e.action] ?? 0) + 1;
    console.log(
      JSON.stringify(
        { mode: args.apply ? 'apply' : 'dry-run', ...result, counts },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
