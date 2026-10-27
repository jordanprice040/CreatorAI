import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { readdir, lstat } from 'node:fs/promises';
import { canonical, fileAt } from './files.js';

/** Management Git only. Product commands never run on this process/host. */
export async function git(cwd: string, args: string[]): Promise<string> {
  await canonical(cwd);
  return await new Promise((resolve, reject) => {
    // The installed studio runs with a minimal PATH; its supervisor names Git (ADR-0046).
    const child = spawn(
      process.env.CREATOR_GIT && isAbsolute(process.env.CREATOR_GIT)
        ? process.env.CREATOR_GIT
        : 'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'protocol.allow=never',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.safecrlf=false',
        '-c',
        'user.name=Creator local supervisor',
        '-c',
        'user.email=local-supervisor@invalid',
        ...args,
      ],
      {
        cwd,
        shell: false,
        windowsHide: true,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
          GIT_TERMINAL_PROMPT: '0',
          GIT_ATTR_NOSYSTEM: '1',
          LC_ALL: 'C',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    let excessive = false;
    const collect = (b: Buffer) => {
      size += b.length;
      if (size > 2 * 1024 * 1024) {
        excessive = true;
        child.kill();
      } else chunks.push(b);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timeout = setTimeout(() => child.kill(), 15000);
    child.on('error', (e: NodeJS.ErrnoException) =>
      reject(
        e.code === 'ENOENT'
          ? new Error(
              'Git was not found. Builds need Git for Windows (git-scm.com); install it and restart Creator Agent.',
            )
          : e,
      ),
    );
    child.on('close', (code) => {
      clearTimeout(timeout);
      const text = Buffer.concat(chunks).toString('utf8');
      if (code !== 0 || excessive)
        reject(new Error(`Git command failed: ${text.slice(0, 3000)}`));
      else resolve(text.trim());
    });
  });
}
export async function clean(dir: string): Promise<void> {
  if (await git(dir, ['status', '--porcelain=v1', '--untracked-files=all']))
    throw new Error(
      'User edits present; preserve and resolve them before continuing',
    );
}
export async function head(dir: string): Promise<string> {
  return git(dir, ['rev-parse', '--verify', 'HEAD']);
}
/** Walk before any Git operation that might read files; ignore only the worktree Git pointer. */
export async function safeTree(dir: string, prefix = ''): Promise<void> {
  await canonical(dir);
  for (const name of await readdir(join(dir, prefix))) {
    if (!prefix && name === '.git') continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    const full = await fileAtDirectory(dir, rel);
    const st = await lstat(full);
    if (st.isDirectory()) await safeTree(dir, rel);
    else await fileAt(dir, rel);
  }
}
async function fileAtDirectory(root: string, rel: string): Promise<string> {
  // fileAt also rejects directories, so validate the directory's dialect separately.
  const { pathSchema, checked } = await import('./contracts.js');
  checked(pathSchema, rel);
  return canonical(join(root, rel));
}
