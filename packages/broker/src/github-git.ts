import { spawn } from 'node:child_process';

/**
 * Management Git for GitHub pushes: hooks, fsmonitor, system and global config off, and no
 * protocol except the ones named here. Credentials arrive through GIT_CONFIG_* environment
 * entries, so they never appear in argv, in the repository's config or in output we keep.
 */
export async function studioGit(
  cwd: string,
  args: string[],
  opts: {
    config?: [string, string][];
    secret?: string;
    timeoutMs?: number;
  } = {},
): Promise<{ code: number | null; output: string }> {
  const config: [string, string][] = [
    ['core.hooksPath', '/dev/null'],
    ['core.fsmonitor', 'false'],
    ['protocol.allow', 'never'],
    ['credential.helper', ''],
    ['core.askPass', ''],
    ...(opts.config ?? []),
  ];
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '',
    LC_ALL: 'C',
    GIT_CONFIG_COUNT: String(config.length),
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  config.forEach(([k, v], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = k;
    env[`GIT_CONFIG_VALUE_${i}`] = v;
  });
  return await new Promise((resolve) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const collect = (b: Buffer) => {
      size += b.length;
      if (size <= 1024 * 1024) chunks.push(b);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000);
    const done = (code: number | null) => {
      clearTimeout(timer);
      let output = Buffer.concat(chunks).toString('utf8').trim();
      if (opts.secret) output = output.split(opts.secret).join('***');
      resolve({ code, output: output.slice(0, 4000) });
    };
    child.on('error', () => done(null));
    child.on('close', (code, signal) => done(signal ? null : code));
  });
}

export async function commitExists(dir: string, sha: string) {
  const r = await studioGit(dir, ['cat-file', '-e', `${sha}^{commit}`]);
  return r.code === 0;
}
export async function isAncestor(dir: string, base: string, sha: string) {
  const r = await studioGit(dir, ['merge-base', '--is-ancestor', base, sha]);
  return r.code === 0;
}
/** Paths a push would change on the remote branch: base..sha, or the whole tree when new. */
export async function changedPaths(
  dir: string,
  base: string | null,
  sha: string,
): Promise<string[]> {
  const r = base
    ? await studioGit(dir, ['diff', '--name-only', '-z', base, sha])
    : await studioGit(dir, ['ls-tree', '-r', '--name-only', '-z', sha]);
  if (r.code !== 0) throw new Error(`Git could not list changes: ${r.output}`);
  return r.output.split('\0').filter(Boolean).sort();
}
