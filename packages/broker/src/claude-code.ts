import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, extname, isAbsolute, join } from 'node:path';
import type { ClaudeCodeStatusObservation } from '@creator/db';
import type { PlanObservedOutcome } from './plan-responses.js';

// ADR-0050: Claude subscription usage through the owner's own, unmodified Claude Code CLI on
// this computer. Anthropic does not let an app offer Claude sign-in or hold Claude plan
// credentials, so the studio never reads, stores or forwards one: the owner signs in with
// `claude auth login` themselves, and the studio only starts `claude -p` and reads what it
// prints. Each run is locked down: restricted mode (no user or project settings, hooks or
// plugins from those), no built-in tools, no MCP servers, no skills or slash commands, one
// turn, no saved session, and an environment rebuilt from an allowlist so an API key, a
// long-lived token, a gateway URL or a cloud-provider switch in the studio's own environment
// can never reach the child.

export interface ClaudeCodeHost {
  /** Absolute path of the Claude Code executable. Never a .cmd/.bat/.ps1 shim (no shell). */
  bin: string;
  /** Dedicated CLAUDE_CONFIG_DIR: the owner's sign-in for the studio, apart from their own. */
  config_dir: string;
  /** Empty working directory for runs, so no project files or CLAUDE.md are in reach. */
  work_dir: string;
}

type Refusal = Extract<
  PlanObservedOutcome,
  { kind: 'failed' | 'rejected' | 'unknown' }
>;

const SHIMS = new Set(['.cmd', '.bat', '.ps1', '.vbs', '.com']);
const STATUS_TIMEOUT_MS = 20_000;
const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
/** Longer than any request may run (the timeout cap is 300 s), so only leftovers match. */
const STALE_PROMPT_MS = 15 * 60_000;
/** Environment names copied from the studio into the child; everything else is dropped. */
const ENV_ALLOW = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'SystemDrive',
  'USERPROFILE',
  'HOME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
] as const;
/** Credentials or routing that would take the request off the owner's subscription. */
export const CLAUDE_CODE_FOREIGN_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_PROFILE',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
] as const;

/**
 * Where the studio's Claude Code lives, from configuration. CREATOR_CLAUDE_CODE_BIN names the
 * executable (else `claude`/`claude.exe` on PATH, then the native installer's location);
 * CREATOR_CLAUDE_CODE_CONFIG_DIR names the dedicated sign-in folder. Missing either means the
 * route is not configured, never a fallback to the owner's personal Claude Code folder.
 */
export function claudeCodeHostFromEnv(
  env: Record<string, string | undefined>,
): ClaudeCodeHost | null {
  const config_dir = env.CREATOR_CLAUDE_CODE_CONFIG_DIR;
  if (!config_dir || !isAbsolute(config_dir)) return null;
  // The installed app passes a built environment without PATH; the process's own fills it.
  const bin = resolveClaudeBin({ ...process.env, ...env });
  if (!bin) return null;
  return { bin, config_dir, work_dir: join(config_dir, 'empty-workdir') };
}

export function resolveClaudeBin(
  env: Record<string, string | undefined>,
): string | null {
  const usable = (p: string) => {
    if (!isAbsolute(p) || SHIMS.has(extname(p).toLowerCase())) return false;
    try {
      accessSync(
        p,
        process.platform === 'win32' ? constants.R_OK : constants.X_OK,
      );
      return true;
    } catch {
      return false;
    }
  };
  if (env.CREATOR_CLAUDE_CODE_BIN)
    return usable(env.CREATOR_CLAUDE_CODE_BIN)
      ? env.CREATOR_CLAUDE_CODE_BIN
      : null;
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const home = env.USERPROFILE ?? env.HOME;
  if (home) dirs.push(join(home, '.local', 'bin'));
  for (const d of dirs) {
    const p = join(d, name);
    if (usable(p)) return p;
  }
  return null;
}

/** The child's environment: an allowlist plus the dedicated config folder, nothing else. */
export function claudeCodeEnv(
  host: ClaudeCodeHost,
  base: Record<string, string | undefined> = process.env,
  fixtureEnv?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOW) {
    const v = base[k];
    if (typeof v === 'string') out[k] = v;
  }
  out.CLAUDE_CONFIG_DIR = host.config_dir;
  // Review L-2: an active Anthropic profile (Workload Identity Federation) in the owner's
  // %APPDATA%\Anthropic or ~/.config/anthropic outranks the subscription login. The child
  // looks in an empty studio folder instead, which prepare() keeps empty.
  out.ANTHROPIC_CONFIG_DIR = anthropicConfigDir(host);
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  out.DISABLE_AUTOUPDATER = '1';
  // Contract tests only: a loopback stand-in for Anthropic's API, set by the caller for
  // fixture connections. Real connections never pass it.
  if (fixtureEnv) Object.assign(out, fixtureEnv);
  return out;
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  spawn_error: string | null;
}
function run(
  host: ClaudeCodeHost,
  args: string[],
  env: Record<string, string>,
  timeoutMs: number,
): Promise<Ran> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(host.bin, args, {
        cwd: host.work_dir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        timed_out: false,
        spawn_error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 64_000) stderr += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        code: null,
        stdout,
        stderr,
        timed_out: false,
        spawn_error: e.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timed_out: timedOut, spawn_error: null });
    });
  });
}

export const anthropicConfigDir = (host: ClaudeCodeHost) =>
  join(host.config_dir, 'studio-anthropic-config');
const promptDir = (host: ClaudeCodeHost) =>
  join(host.config_dir, 'studio-prompts');

/** Never throws: a file Windows briefly holds (antivirus, indexer) is left for a later sweep. */
function removeQuietly(path: string) {
  try {
    rmSync(path, { force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    // Swept by a later request once it is old enough.
  }
}

/** Review L-A: instruction files left by a crash or a failed delete are removed later. */
function sweepStalePrompts(host: ClaudeCodeHost) {
  const dir = promptDir(host);
  const now = Date.now();
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > STALE_PROMPT_MS) removeQuietly(p);
    } catch {
      // Gone already.
    }
  }
}

/** Creates the studio folders. Throws when the Anthropic profile folder is not empty. */
function prepare(host: ClaudeCodeHost) {
  mkdirSync(host.config_dir, { recursive: true });
  mkdirSync(host.work_dir, { recursive: true });
  mkdirSync(promptDir(host), { recursive: true });
  sweepStalePrompts(host);
  const anthropic = anthropicConfigDir(host);
  mkdirSync(anthropic, { recursive: true });
  if (readdirSync(anthropic).length)
    throw new Error(
      `The studio's Anthropic profile folder (${anthropic}) must stay empty: an Anthropic profile there could take requests off the Claude subscription.`,
    );
}

/**
 * Reads `claude --version` and `claude auth status` in the dedicated folder. Sends no model
 * request. Throws only when Claude Code could not be run or answered something unreadable.
 */
export async function claudeCodeStatus(
  host: ClaudeCodeHost,
  base?: Record<string, string | undefined>,
  fixtureEnv?: Record<string, string>,
): Promise<ClaudeCodeStatusObservation> {
  prepare(host);
  const env = claudeCodeEnv(host, base, fixtureEnv);
  const v = await run(host, ['--version'], env, STATUS_TIMEOUT_MS);
  if (v.spawn_error || v.code !== 0)
    throw new Error(
      `Claude Code could not be started (${v.spawn_error ?? `exit ${v.code}`}).`,
    );
  const version = /^(\d+\.\d+\.\d+)/.exec(v.stdout.trim())?.[1];
  if (!version) throw new Error('Claude Code did not report its version.');
  const s = await run(
    host,
    ['auth', 'status', '--json'],
    env,
    STATUS_TIMEOUT_MS,
  );
  if (s.spawn_error || s.timed_out)
    throw new Error('Claude Code did not answer the sign-in status check.');
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(s.stdout) as Record<string, unknown>;
  } catch {
    throw new Error(
      'Claude Code answered the status check with unreadable output.',
    );
  }
  const str = (k: string) =>
    typeof j[k] === 'string' ? (j[k] as string).slice(0, 200) : null;
  return {
    // Documented: exit 0 when logged in, 1 when not. Both signals must agree.
    logged_in: s.code === 0 && j.loggedIn === true,
    auth_method: str('authMethod') ?? 'none',
    api_provider: str('apiProvider'),
    account_label: str('email') ?? str('emailAddress') ?? null,
    cli_version: version,
  };
}

/** Retry categories that end the request: it was refused, so nothing more is sent. */
const TERMINAL_RETRY: Record<string, Partial<Refusal>> = {
  rate_limit: { quota: 'exhausted' },
  authentication_failed: { sign_in_invalid: true },
  oauth_org_not_allowed: { sign_in_invalid: true },
  account_on_hold: { eligibility: 'not_eligible' },
  billing_error: { eligibility: 'not_eligible' },
  model_not_found: { model_refused: true },
  invalid_request: {},
};

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ClaudeCodeCallInput {
  host: ClaudeCodeHost;
  model: string;
  instructions: string;
  input: string;
  timeout_ms: number;
  max_output_chars: number;
  signal?: AbortSignal;
  /** Contract tests only (fixture connections): see claudeCodeEnv. */
  fixture_env?: Record<string, string>;
  base_env?: Record<string, string | undefined>;
}

export function claudeCodeArgs(model: string, systemPromptFile: string) {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--restricted',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disallowedTools',
    'mcp__*',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--permission-mode',
    'dontAsk',
    // Review L-3: from a file, so the instructions are not on the command line (process
    // listings, and Windows' 32,767-character limit).
    '--system-prompt-file',
    systemPromptFile,
  ];
}

/**
 * One locked-down `claude -p` request. The prompt goes on stdin. Outcomes follow the plan
 * ledger: completed only with a successful result; a refusal Claude Code would retry (usage
 * limit, sign-in, model) is cut at the first retry notice and recorded as rejected; anything
 * that may have reached the model without a result is unknown and needs reconciling.
 */
export function callClaudeCode(
  o: ClaudeCodeCallInput,
): Promise<PlanObservedOutcome> {
  const rejected = (
    reason_code: string,
    message: string,
    extra: Partial<Refusal> = {},
  ): PlanObservedOutcome => ({
    kind: 'rejected',
    reason_code,
    message,
    response_id: null,
    output_chars: null,
    retry_allowed: false,
    ...extra,
  });
  if (o.signal?.aborted)
    return Promise.resolve(
      rejected(
        'cancelled_before_dispatch',
        'Request cancelled before dispatch.',
      ),
    );
  const promptFile = join(promptDir(o.host), `${randomUUID()}.txt`);
  try {
    prepare(o.host);
    writeFileSync(promptFile, o.instructions, { mode: 0o600 });
  } catch (e) {
    return Promise.resolve(
      rejected(
        'claude_code_folder_unavailable',
        e instanceof Error
          ? e.message.slice(0, 300)
          : 'The studio Claude Code folder could not be prepared.',
      ),
    );
  }
  const env = claudeCodeEnv(o.host, o.base_env, o.fixture_env);
  return new Promise((resolve) => {
    let settled = false;
    let initSeen = false;
    let sessionId: string | null = null;
    let buf = '';
    let bytes = 0;
    let verdict: PlanObservedOutcome | null = null;
    let child: ReturnType<typeof spawn>;
    const finish = (v: PlanObservedOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      removeQuietly(promptFile);
      o.signal?.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const stop = (v: PlanObservedOutcome) => {
      verdict ??= v;
      child.kill();
    };
    const unknown = (
      reason_code: string,
      message: string,
    ): PlanObservedOutcome => ({
      kind: 'unknown',
      reason_code,
      message,
      response_id: sessionId,
      output_chars: null,
      retry_allowed: false,
    });
    try {
      child = spawn(o.host.bin, claudeCodeArgs(o.model, promptFile), {
        cwd: o.host.work_dir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
    } catch (e) {
      removeQuietly(promptFile);
      resolve(
        rejected(
          'claude_code_start_failed',
          e instanceof Error
            ? e.message.slice(0, 200)
            : 'Could not start Claude Code.',
        ),
      );
      return;
    }
    const timer = setTimeout(
      () => stop(unknown('timeout', 'Claude Code did not finish in time.')),
      o.timeout_ms,
    );
    const onAbort = () =>
      stop(
        initSeen
          ? unknown('cancelled', 'Cancelled while Claude Code was running.')
          : rejected('cancelled_before_dispatch', 'Cancelled before dispatch.'),
      );
    o.signal?.addEventListener('abort', onAbort, { once: true });
    const onLine = (line: string) => {
      if (!line.trim().startsWith('{')) return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof m.session_id === 'string')
        sessionId = m.session_id.slice(0, 200);
      if (m.type === 'system' && m.subtype === 'init') {
        initSeen = true;
        // Defense in depth: the flags above must have taken effect before anything is used.
        const tools = Array.isArray(m.tools) ? m.tools : null;
        const mcp = Array.isArray(m.mcp_servers) ? m.mcp_servers : null;
        if (!tools || tools.length || !mcp || mcp.length)
          stop(
            unknown(
              'claude_code_unsafe_session',
              'Claude Code started with tools or MCP servers; stopped.',
            ),
          );
        // Review L-1: only `none` (no API key; a claude.ai login) is accepted, rather than a
        // list of what to refuse. The per-request `auth status` check is the main gate.
        else if (m.apiKeySource !== 'none' && !o.fixture_env)
          stop(
            unknown(
              'claude_code_not_subscription',
              `Claude Code started with ${typeof m.apiKeySource === 'string' ? m.apiKeySource.slice(0, 60) : 'an unreported credential'}, not the Claude subscription; stopped.`,
            ),
          );
        return;
      }
      if (m.type === 'system' && m.subtype === 'api_retry') {
        const cat = typeof m.error === 'string' ? m.error : 'unknown';
        const terminal = TERMINAL_RETRY[cat];
        if (terminal)
          stop({
            ...rejected(
              cat === 'rate_limit' ? 'claude_usage_limit' : `claude_${cat}`,
              `Claude refused the request (${cat}${typeof m.error_status === 'number' ? `, HTTP ${m.error_status}` : ''}).`,
              terminal,
            ),
            response_id: sessionId,
          });
        return;
      }
      if (m.type === 'result') verdict ??= fromResult(m, o, sessionId);
    };
    child.stdout!.on('data', (d: Buffer) => {
      bytes += d.length;
      if (bytes > MAX_STDOUT_BYTES) {
        stop(
          unknown(
            'claude_code_output_overflow',
            'Claude Code printed more than the studio reads.',
          ),
        );
        return;
      }
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr!.on('data', () => {});
    child.on('error', (e) => {
      // Spawn failure (missing binary, no permission): nothing was sent.
      finish(
        verdict ??
          rejected('claude_code_start_failed', e.message.slice(0, 200)),
      );
    });
    child.on('close', (code) => {
      if (buf) onLine(buf);
      buf = '';
      if (verdict) return finish(verdict);
      finish(
        initSeen
          ? unknown(
              'claude_code_no_result',
              `Claude Code exited (${code}) without a result.`,
            )
          : rejected(
              'claude_code_start_failed',
              `Claude Code exited (${code}) before starting a session.`,
            ),
      );
    });
    child.stdin!.on('error', () => {});
    child.stdin!.end(o.input);
  });
}

function fromResult(
  m: Record<string, unknown>,
  o: ClaudeCodeCallInput,
  sessionId: string | null,
): PlanObservedOutcome {
  const text = typeof m.result === 'string' ? m.result : '';
  const status =
    typeof m.api_error_status === 'number' ? m.api_error_status : null;
  const usage = (m.usage ?? {}) as Record<string, unknown>;
  const outTokens =
    typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
  if (m.is_error !== true && m.subtype === 'success') {
    // Never a silent substitution: the requested model must be the one that answered.
    const used = Object.entries(
      (m.modelUsage ?? {}) as Record<string, { canonicalModel?: unknown }>,
    ).flatMap(([k, v]) => [
      k,
      typeof v?.canonicalModel === 'string' ? v.canonicalModel : k,
    ]);
    if (!used.includes(o.model))
      return {
        kind: 'failed',
        reason_code: 'model_substituted',
        message: `Claude Code answered with ${[...new Set(used)].join(', ') || 'no reported model'}, not ${o.model}.`,
        response_id: sessionId,
        output_chars: text.length,
        retry_allowed: false,
      };
    if (text.length > o.max_output_chars)
      return {
        kind: 'failed',
        reason_code: 'output_cap_exceeded',
        message: `The answer was ${text.length} characters; the cap is ${o.max_output_chars}.`,
        response_id: sessionId,
        output_chars: text.length,
        retry_allowed: false,
      };
    return {
      kind: 'completed',
      text,
      output_chars: text.length,
      output_tokens: outTokens,
      response_id: sessionId,
      output_hash: sha(text),
    };
  }
  const lower = text.toLowerCase();
  const base = {
    response_id: sessionId,
    output_chars: null,
    retry_allowed: false,
    message: text.slice(0, 300) || 'Claude Code reported an error.',
  };
  if (status === 429 || /usage limit|limit reached|rate limit/.test(lower))
    return {
      kind: 'rejected',
      reason_code: 'claude_usage_limit',
      quota: 'exhausted',
      ...base,
    };
  if (
    status === 401 ||
    status === 403 ||
    /not logged in|\/login|authentication/.test(lower)
  )
    return {
      kind: 'rejected',
      reason_code: 'claude_sign_in_invalid',
      sign_in_invalid: true,
      ...base,
    };
  if (
    status === 404 ||
    /selected model|model .*(not exist|not available|access)/.test(lower)
  )
    return {
      kind: 'rejected',
      reason_code: 'claude_model_refused',
      model_refused: true,
      ...base,
    };
  if (m.subtype === 'error_max_turns')
    return { kind: 'failed', reason_code: 'claude_max_turns', ...base };
  // The request reached Claude and ended in an error: it ran, and did not succeed.
  return {
    kind: 'failed',
    reason_code: `claude_${typeof m.terminal_reason === 'string' ? m.terminal_reason.slice(0, 60) : 'error'}`,
    ...base,
  };
}
