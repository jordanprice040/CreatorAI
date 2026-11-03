import {
  lstat,
  mkdir,
  realpath,
  readFile,
  writeFile,
  open,
  unlink,
  link,
} from 'node:fs/promises';
import { resolve, join, parse, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { uptime } from 'node:os';
import { pathSchema, checked, digest } from './contracts.js';

export function contained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
/** Reject junctions/reparse links in every existing component, including the root. */
export async function canonical(
  target: string,
  allowMissing = false,
): Promise<string> {
  const full = resolve(target);
  let cursor = parse(full).root;
  for (const part of full.slice(cursor.length).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const st = await lstat(cursor);
      if (st.isSymbolicLink() || (!st.isDirectory() && cursor !== full))
        throw new Error('Linked or non-directory path refused');
    } catch (e) {
      if (allowMissing && (e as NodeJS.ErrnoException).code === 'ENOENT')
        continue;
      throw e;
    }
  }
  if (
    !allowMissing &&
    resolve(await realpath(full)).toLowerCase() !== full.toLowerCase()
  )
    throw new Error('Noncanonical path refused');
  return full;
}
export async function fileAt(root: string, name: string): Promise<string> {
  checked(pathSchema, name);
  const full = resolve(root, name);
  if (!contained(root, full)) throw new Error('Path escapes workspace');
  await canonical(full, true);
  try {
    const st = await lstat(full);
    if (!st.isFile() || st.nlink !== 1)
      throw new Error('Only unlinked regular files allowed');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  return full;
}
export async function jsonWrite(path: string, value: unknown): Promise<void> {
  await canonical(path, true);
  // Immutable records; no overwrite of an existing user or supervisor record.
  const f = await open(path, 'wx', 0o600);
  try {
    await f.writeFile(JSON.stringify(value, null, 2) + '\n');
    await f.sync();
  } finally {
    await f.close();
  }
}
/**
 * Like jsonWrite, but the record appears only once complete: it is written and synced
 * under a temporary name, then linked into place (EEXIST if a record is already there, so
 * nothing is overwritten). A crash or failed write leaves at most the temporary file,
 * never a partial record that readers would fail on.
 */
export async function jsonPublish(path: string, value: unknown): Promise<void> {
  await canonical(path, true);
  const tmp = join(parse(path).dir, `.${parse(path).base}.${randomUUID()}.tmp`);
  await jsonWrite(tmp, value);
  try {
    await link(tmp, path);
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}
export async function readJson(path: string): Promise<unknown> {
  await canonical(path);
  return JSON.parse(await readFile(path, 'utf8'));
}
/**
 * Whether a time (a lock's or a run's start) is from before this boot, with a margin for a
 * clock step after boot. Its recorded process number may since belong to anything else.
 */
export function bootedBefore(iso: string): boolean {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at < Date.now() - uptime() * 1000 - 10 * 60_000;
}
/** Whether a process exists (EPERM: it does, owned by someone else). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}
/** Tokens of the locks this process holds right now. */
const held = new Set<string>();
/**
 * Who holds a lock file: 'dead', a live process number, or 'writing' (empty and fresh: its
 * holder is between creating and filling it). An empty lock older than a minute is a crash.
 * This process's own lock is held only while its token is live here, whatever the clock
 * says; another process's lock from before this boot is dead (its number may be reused).
 */
export function lockHolder(
  raw: string,
  mtimeMs: number,
): 'dead' | 'writing' | number {
  let lock: { pid?: unknown; at?: unknown; token?: unknown };
  try {
    lock = JSON.parse(raw) as typeof lock;
  } catch {
    return Date.now() - mtimeMs > 60_000 ? 'dead' : 'writing';
  }
  const pid = Number(lock.pid);
  if (!Number.isInteger(pid) || pid <= 0) return 'dead';
  if (pid === process.pid) return held.has(String(lock.token)) ? pid : 'dead';
  if (bootedBefore(String(lock.at))) return 'dead';
  return alive(pid) ? pid : 'dead';
}
export async function withLock<T>(
  dir: string,
  work: () => Promise<T>,
): Promise<T> {
  await canonical(dir);
  const lock = join(dir, 'supervisor.lock');
  const token = randomUUID();
  // Live from before the file exists until after it is gone, so lockHolder never sees this
  // process's lock as stale while it is being written or removed.
  held.add(token);
  let f;
  try {
    f = await open(lock, 'wx', 0o600);
  } catch {
    held.delete(token);
    throw new Error(
      'Product is locked; inspect pending intents before recovery. A lock is released only by an explicit recovery once its process is gone (Build page: Recover), never by age.',
    );
  }
  let failed = false;
  try {
    await f.writeFile(
      JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }),
    );
    await f.sync();
    await f.close();
    return await work();
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    try {
      // Only our own lock: a recovery may have released it and someone else may hold it
      // now. Only a missing file is "not ours"; any other read error is surfaced.
      const now = await readFile(lock, 'utf8').catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return '';
          throw e;
        },
      );
      if (now.includes(token))
        await unlink(lock).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e;
        });
    } catch (e) {
      // A cleanup failure never hides the work's own error.
      if (!failed) throw e;
    } finally {
      held.delete(token);
    }
  }
}
export async function event(
  dir: string,
  kind: string,
  data: unknown,
): Promise<void> {
  await mkdir(join(dir, 'events'), { recursive: true });
  const payload = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    data,
  };
  await jsonWrite(
    join(
      dir,
      'events',
      `${payload.at.replace(/[:.]/g, '-')}-${payload.id}.json`,
    ),
    { ...payload, hash: digest(JSON.stringify(payload)) },
  );
}
export async function newFile(path: string, text: string): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, text, { flag: 'wx', mode: 0o600 });
}
