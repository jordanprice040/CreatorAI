import { spawn } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// Credential storage for ChatGPT-plan tokens. Windows uses DPAPI (CurrentUser) through the
// built-in PowerShell, matching the installed studio's other secrets (ADR-0041); the plaintext
// passes over stdin only. Elsewhere a 0600 file vault is available only when explicitly
// chosen for development. Tokens never go to the database, logs, URLs or the browser.

export interface PlanCredential {
  issuer: string;
  subject: string;
  account_label: string;
  client_id: string;
  ext_agent_host_id: string;
  id_token: string | null;
  access_token: string;
  refresh_token: string | null;
  scopes: string[];
  expires_at: string;
  saved_at: string;
}
export interface PlanVault {
  readonly kind: 'dpapi' | 'file-dev' | 'memory';
  get(ref: string): Promise<PlanCredential | null>;
  put(ref: string, value: PlanCredential): Promise<void>;
  delete(ref: string): Promise<void>;
}
const REF = /^chatgpt-plan\/[0-9a-f-]{36}$/;
const fileOf = (dir: string, ref: string) => {
  if (!REF.test(ref)) throw new Error('Invalid credential reference.');
  return join(dir, `${ref.slice('chatgpt-plan/'.length)}.secret`);
};
export const newCredentialRef = () => `chatgpt-plan/${randomUUID()}`;

async function atomicWrite(path: string, data: string | Buffer) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  await rename(tmp, path);
}

export class MemoryVault implements PlanVault {
  readonly kind = 'memory' as const;
  readonly #m = new Map<string, string>();
  async get(ref: string) {
    const v = this.#m.get(ref);
    return v ? (JSON.parse(v) as PlanCredential) : null;
  }
  async put(ref: string, value: PlanCredential) {
    fileOf('/', ref);
    this.#m.set(ref, JSON.stringify(value));
  }
  async delete(ref: string) {
    this.#m.delete(ref);
  }
}

/** Development only: owner-only file permissions, no encryption. Never chosen implicitly. */
export class FileDevVault implements PlanVault {
  readonly kind = 'file-dev' as const;
  constructor(readonly dir: string) {}
  async get(ref: string) {
    try {
      return JSON.parse(
        await readFile(fileOf(this.dir, ref), 'utf8'),
      ) as PlanCredential;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async put(ref: string, value: PlanCredential) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await atomicWrite(fileOf(this.dir, ref), JSON.stringify(value));
  }
  async delete(ref: string) {
    await rm(fileOf(this.dir, ref), { force: true });
  }
}

const DPAPI_SCRIPT = (protect: boolean) =>
  [
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd()',
    '$e = [Text.Encoding]::UTF8.GetBytes("creator-agent-studio/1:chatgpt-plan")',
    `$o = [Security.Cryptography.ProtectedData]::${protect ? 'Protect' : 'Unprotect'}([Convert]::FromBase64String($in), $e, [Security.Cryptography.DataProtectionScope]::CurrentUser)`,
    '[Console]::Out.Write([Convert]::ToBase64String($o))',
  ].join('; ');
function powershell(script: string, input: string): Promise<string> {
  return new Promise((ok, bad) => {
    const p = spawn(
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', bad);
    p.on('close', (code) =>
      code === 0
        ? ok(out.trim())
        : bad(
            new Error(
              'Windows could not protect or unlock the saved ChatGPT sign-in.',
            ),
          ),
    );
    p.stdin.end(input);
  });
}
export class DpapiVault implements PlanVault {
  readonly kind = 'dpapi' as const;
  constructor(readonly dir: string) {}
  async get(ref: string) {
    let blob: string;
    try {
      blob = await readFile(fileOf(this.dir, ref), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    const plain = Buffer.from(
      await powershell(DPAPI_SCRIPT(false), blob.trim()),
      'base64',
    );
    return JSON.parse(plain.toString('utf8')) as PlanCredential;
  }
  async put(ref: string, value: PlanCredential) {
    await mkdir(this.dir, { recursive: true });
    const cipher = await powershell(
      DPAPI_SCRIPT(true),
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64'),
    );
    await atomicWrite(fileOf(this.dir, ref), cipher);
  }
  async delete(ref: string) {
    await rm(fileOf(this.dir, ref), { force: true });
  }
}

/**
 * DPAPI on Windows. Elsewhere only CREATOR_PLAN_VAULT=file-dev opts into the development file
 * vault; otherwise there is no vault and sign-in is refused with that reason.
 */
export function planVaultFromEnv(
  env: Record<string, string | undefined>,
): PlanVault | null {
  const dir = env.CREATOR_PLAN_VAULT_DIR;
  if (!dir) return null;
  if (process.platform === 'win32') return new DpapiVault(dir);
  return env.CREATOR_PLAN_VAULT === 'file-dev' ? new FileDevVault(dir) : null;
}
