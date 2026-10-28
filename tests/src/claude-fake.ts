import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A stand-in for the Claude Code CLI (ADR-0050 tests). It reads its behaviour from
// <CLAUDE_CONFIG_DIR>/fake.json, because the studio passes the child only an allowlisted
// environment, and records each call's arguments, environment names and stdin there.

export interface FakeClaudeConfig {
  version?: string;
  status: Record<string, unknown>;
  run?:
    | 'ok'
    | 'substitute'
    | 'rate_limit'
    | 'auth_retry'
    | 'unsafe'
    | 'hang'
    | 'error404'
    | 'usage_text'
    | 'crash';
  text?: string;
  apiKeySource?: string;
}

const SCRIPT = String.raw`
import fs from 'node:fs';
import path from 'node:path';
const dir = process.env.CLAUDE_CONFIG_DIR;
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'fake.json'), 'utf8'));
const args = process.argv.slice(2);
const record = (o) => fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(o) + '\n');
if (args[0] === '--version') {
  record({ args, env: Object.keys(process.env).sort(), cwd: process.cwd() });
  console.log(cfg.version ?? '2.1.312 (Claude Code)');
  process.exit(0);
}
if (args[0] === 'auth') {
  record({ args, env: Object.keys(process.env).sort(), cwd: process.cwd() });
  console.log(JSON.stringify(cfg.status));
  process.exit(cfg.status.loggedIn ? 0 : 1);
}
const stdin = fs.readFileSync(0, 'utf8');
record({ args, env: Object.keys(process.env).sort(), cwd: process.cwd(), stdin });
const model = args[args.indexOf('--model') + 1];
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sid = 'fake-session-1';
if (cfg.run === 'crash') process.exit(2);
out({ type: 'system', subtype: 'init', session_id: sid, tools: cfg.run === 'unsafe' ? ['Bash'] : [], mcp_servers: [], model, apiKeySource: cfg.apiKeySource ?? 'none' });
const hang = () => setTimeout(() => {}, 120000);
switch (cfg.run) {
  case 'rate_limit':
    out({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 429, error: 'rate_limit', session_id: sid });
    hang();
    break;
  case 'auth_retry':
    out({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 401, error: 'authentication_failed', session_id: sid });
    hang();
    break;
  case 'hang':
  case 'unsafe':
    hang();
    break;
  case 'error404':
    out({ type: 'result', subtype: 'success', is_error: true, api_error_status: 404, terminal_reason: 'api_error', result: "There's an issue with the selected model (" + model + ').', session_id: sid, modelUsage: {} });
    break;
  case 'usage_text':
    out({ type: 'result', subtype: 'success', is_error: true, api_error_status: null, terminal_reason: 'api_error', result: 'Claude usage limit reached. Your limit will reset at 5pm.', session_id: sid, modelUsage: {} });
    break;
  default: {
    const m = cfg.run === 'substitute' ? 'claude-haiku-other' : model;
    const text = cfg.text ?? 'ok';
    out({ type: 'assistant', message: { model: m, content: [{ type: 'text', text }] }, session_id: sid });
    out({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sid, usage: { output_tokens: 2 }, modelUsage: { [m]: { canonicalModel: m } }, total_cost_usd: 0.0001 });
  }
}
`;

/** Writes an executable fake `claude` (no shell; node runs it through its shebang). */
export function writeFakeClaude(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const bin = join(dir, 'claude');
  writeFileSync(bin, `#!${process.execPath}\n${SCRIPT}`);
  chmodSync(bin, 0o755);
  return bin;
}

export function setFake(configDir: string, cfg: FakeClaudeConfig) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'fake.json'), JSON.stringify(cfg));
}

export function fakeCalls(configDir: string): {
  args: string[];
  env: string[];
  cwd: string;
  stdin?: string;
}[] {
  try {
    return readFileSync(join(configDir, 'calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export const SUBSCRIBED = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'owner@example.test',
};
