import { spawn } from 'node:child_process';

/**
 * Management Git for GitHub pushes: hooks, fsmonitor, system and global config off, and no
 * protocol except the ones named here. Credentials arrive through GIT_CONFIG_* environment
 * entries, so they never appear in argv, in the repository's config or in output we keep.
 */
export interface GitResult {
  code: number | null;
  /** stdout then stderr, trimmed, secret masked and cut to 4,000 characters: for messages only. */
  output: string;
  /** stdout alone, untrimmed and uncut (secret masked), for parsing. */
  stdout: string;
  /** stderr alone, secret masked, cut to 4,000 characters. */
  stderr: string;
  /** stdout went over `maxStdoutBytes`; `stdout` is then empty, never a partial list. */
  stdoutOverflow: boolean;
}

/** Most stdout kept for parsing (8 MiB); past it the result is refused, not cut. */
export const MAX_GIT_STDOUT_BYTES = 8 * 1024 * 1024;

export async function studioGit(
  cwd: string,
  args: string[],
  opts: {
    config?: [string, string][];
    secret?: string;
    timeoutMs?: number;
  } = {},
): Promise<GitResult> {
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
    const out: Buffer[] = [];
    const errs: Buffer[] = [];
    let outSize = 0;
    let errSize = 0;
    let overflow = false;
    child.stdout.on('data', (b: Buffer) => {
      outSize += b.length;
      if (outSize > MAX_GIT_STDOUT_BYTES) {
        overflow = true;
        out.length = 0;
      } else out.push(b);
    });
    child.stderr.on('data', (b: Buffer) => {
      errSize += b.length;
      if (errSize <= 1024 * 1024) errs.push(b);
    });
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000);
    const mask = (t: string) =>
      opts.secret ? t.split(opts.secret).join('***') : t;
    const done = (code: number | null) => {
      clearTimeout(timer);
      const stdout = overflow ? '' : mask(Buffer.concat(out).toString('utf8'));
      const stderr = mask(Buffer.concat(errs).toString('utf8').trim());
      const output = [stdout.trim(), stderr].filter(Boolean).join('\n');
      resolve({
        code,
        output: output.slice(0, 4000),
        stdout,
        stderr: stderr.slice(0, 4000),
        stdoutOverflow: overflow,
      });
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
/** Most paths one push may change; a longer list is refused rather than cut. */
export const MAX_PUSH_PATHS = 20_000;

/** The push changes more paths than can be listed for approval. */
export class TooManyPathsError extends Error {}

/**
 * Paths a push would change on the remote branch: base..sha, or the whole tree when new.
 * Read from stdout alone and never cut: the list decides `github.write` versus
 * `github.workflow_change`, so a list that does not fit is refused whole.
 */
export async function changedPaths(
  dir: string,
  base: string | null,
  sha: string,
  maxPaths = MAX_PUSH_PATHS,
): Promise<string[]> {
  const r = base
    ? await studioGit(dir, [
        'diff',
        '--no-renames',
        '--name-only',
        '-z',
        base,
        sha,
      ])
    : await studioGit(dir, ['ls-tree', '-r', '--name-only', '-z', sha]);
  if (r.stdoutOverflow)
    throw new TooManyPathsError('The push changes too many paths to list.');
  if (r.code !== 0) throw new Error(`Git could not list changes: ${r.output}`);
  const paths = r.stdout.split('\0').filter(Boolean).sort();
  if (paths.length > maxPaths)
    throw new TooManyPathsError(
      `The push changes ${paths.length} paths; at most ${maxPaths} can be approved.`,
    );
  return paths;
}
