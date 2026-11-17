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

// Credential storage for ChatGPT-plan tokens and (ADR-0093) workspaces' OpenAI API keys. Windows uses DPAPI (CurrentUser) through the
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
  /** ADR-0093 (P28): a workspace's OpenAI API key, under its own reference kind and entropy. */
  getApiKey(ref: string): Promise<string | null>;
  putApiKey(ref: string, key: string): Promise<void>;
  /** ADR-0132 (P32): a studio-created GitHub App's private key (PEM), under its own kind. */
  getGitHubAppKey(ref: string): Promise<string | null>;
  putGitHubAppKey(ref: string, pem: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
/** The two kinds of entry; each kind has its own file name and (on Windows) DPAPI entropy. */
type Purpose = 'chatgpt-plan' | 'openai-api-key' | 'github-app-key';
const REF = /^(chatgpt-plan|openai-api-key|github-app-key)\/[0-9a-f-]{36}$/;
const purposeOf = (ref: string): Purpose => {
  const m = REF.exec(ref);
  if (!m) throw new Error('Invalid credential reference.');
  return m[1] as Purpose;
};
const fileOf = (dir: string, ref: string, want?: Purpose) => {
  const purpose = purposeOf(ref);
  if (want && purpose !== want)
    throw new Error('Invalid credential reference.');
  const id = ref.slice(purpose.length + 1);
  // Plan sign-ins keep their original file name, so existing vaults still open.
  return join(
    dir,
    purpose === 'chatgpt-plan'
      ? `${id}.secret`
      : purpose === 'openai-api-key'
        ? `${id}.api-key.secret`
        : `${id}.github-app-key.secret`,
  );
};
export const newCredentialRef = () => `chatgpt-plan/${randomUUID()}`;
export const newApiKeyRef = () => `openai-api-key/${randomUUID()}`;
export const newGitHubAppKeyRef = () => `github-app-key/${randomUUID()}`;
const keyEntry = (key: string) => JSON.stringify({ api_key: key });
const keyOf = (raw: string): string => {
  // Review 2 L-1: JSON.parse's own message quotes the text around the fault, which here is
  // the key, so it is never passed on.
  let v: { api_key?: unknown } | null;
  try {
    v = JSON.parse(raw) as { api_key?: unknown } | null;
  } catch {
    throw new Error('A saved key is damaged.');
  }
  if (typeof v?.api_key !== 'string')
    throw new Error('A saved key is damaged.');
  return v.api_key;
};

// Review N-3: a GitHub App key is stored under its own field, not as an "api_key".
const pemEntry = (pem: string) => JSON.stringify({ private_key_pem: pem });
const pemOf = (raw: string): string => {
  let v: { private_key_pem?: unknown } | null;
  try {
    v = JSON.parse(raw) as { private_key_pem?: unknown } | null;
  } catch {
    throw new Error('A saved key is damaged.');
  }
  if (typeof v?.private_key_pem !== 'string')
    throw new Error('A saved key is damaged.');
  return v.private_key_pem;
};

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
    fileOf('/', ref, 'chatgpt-plan');
    const v = this.#m.get(ref);
    return v ? (JSON.parse(v) as PlanCredential) : null;
  }
  async put(ref: string, value: PlanCredential) {
    fileOf('/', ref, 'chatgpt-plan');
    this.#m.set(ref, JSON.stringify(value));
  }
  async getApiKey(ref: string) {
    fileOf('/', ref, 'openai-api-key');
    const v = this.#m.get(ref);
    return v ? keyOf(v) : null;
  }
  async putApiKey(ref: string, key: string) {
    fileOf('/', ref, 'openai-api-key');
    this.#m.set(ref, keyEntry(key));
  }
  async getGitHubAppKey(ref: string) {
    fileOf('/', ref, 'github-app-key');
    const v = this.#m.get(ref);
    return v ? pemOf(v) : null;
  }
  async putGitHubAppKey(ref: string, pem: string) {
    fileOf('/', ref, 'github-app-key');
    this.#m.set(ref, pemEntry(pem));
  }
  async delete(ref: string) {
    fileOf('/', ref);
    this.#m.delete(ref);
  }
  /** Tests: every stored entry as written, to check a key never lands anywhere else. */
  entries(): string[] {
    return [...this.#m.values()];
  }
}

/** Development only: owner-only file permissions, no encryption. Never chosen implicitly. */
export class FileDevVault implements PlanVault {
  readonly kind = 'file-dev' as const;
  constructor(readonly dir: string) {}
  async #read(path: string) {
    try {
      return await readFile(path, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async get(ref: string) {
    const raw = await this.#read(fileOf(this.dir, ref, 'chatgpt-plan'));
    return raw === null ? null : (JSON.parse(raw) as PlanCredential);
  }
  async put(ref: string, value: PlanCredential) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await atomicWrite(
      fileOf(this.dir, ref, 'chatgpt-plan'),
      JSON.stringify(value),
    );
  }
  async getApiKey(ref: string) {
    const raw = await this.#read(fileOf(this.dir, ref, 'openai-api-key'));
    return raw === null ? null : keyOf(raw);
  }
  async putApiKey(ref: string, key: string) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await atomicWrite(fileOf(this.dir, ref, 'openai-api-key'), keyEntry(key));
  }
  async getGitHubAppKey(ref: string) {
    const raw = await this.#read(fileOf(this.dir, ref, 'github-app-key'));
    return raw === null ? null : pemOf(raw);
  }
  async putGitHubAppKey(ref: string, pem: string) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await atomicWrite(fileOf(this.dir, ref, 'github-app-key'), pemEntry(pem));
  }
  async delete(ref: string) {
    await rm(fileOf(this.dir, ref), { force: true });
  }
}

const DPAPI_SCRIPT = (protect: boolean, purpose: Purpose) =>
  [
    'Add-Type -AssemblyName System.Security',
    '$in = [Console]::In.ReadToEnd()',
    `$e = [Text.Encoding]::UTF8.GetBytes("creator-agent-studio/1:${purpose}")`,
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
              'Windows could not protect or unlock a saved sign-in or key.',
            ),
          ),
    );
    p.stdin.end(input);
  });
}
export class DpapiVault implements PlanVault {
  readonly kind = 'dpapi' as const;
  constructor(readonly dir: string) {}
  async #open(ref: string, purpose: Purpose): Promise<string | null> {
    let blob: string;
    try {
      blob = await readFile(fileOf(this.dir, ref, purpose), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    return Buffer.from(
      await powershell(DPAPI_SCRIPT(false, purpose), blob.trim()),
      'base64',
    ).toString('utf8');
  }
  async #seal(ref: string, purpose: Purpose, plain: string) {
    await mkdir(this.dir, { recursive: true });
    const cipher = await powershell(
      DPAPI_SCRIPT(true, purpose),
      Buffer.from(plain, 'utf8').toString('base64'),
    );
    await atomicWrite(fileOf(this.dir, ref, purpose), cipher);
  }
  async get(ref: string) {
    const plain = await this.#open(ref, 'chatgpt-plan');
    return plain === null ? null : (JSON.parse(plain) as PlanCredential);
  }
  async put(ref: string, value: PlanCredential) {
    await this.#seal(ref, 'chatgpt-plan', JSON.stringify(value));
  }
  async getApiKey(ref: string) {
    const plain = await this.#open(ref, 'openai-api-key');
    return plain === null ? null : keyOf(plain);
  }
  async putApiKey(ref: string, key: string) {
    await this.#seal(ref, 'openai-api-key', keyEntry(key));
  }
  async getGitHubAppKey(ref: string) {
    const plain = await this.#open(ref, 'github-app-key');
    return plain === null ? null : pemOf(plain);
  }
  async putGitHubAppKey(ref: string, pem: string) {
    await this.#seal(ref, 'github-app-key', pemEntry(pem));
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
