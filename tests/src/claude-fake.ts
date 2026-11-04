import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
const pf = args.indexOf('--system-prompt-file');
const system = pf >= 0 ? fs.readFileSync(args[pf + 1], 'utf8') : null;
record({ args, env: Object.keys(process.env).sort(), cwd: process.cwd(), stdin, system });
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

let windowsLauncher: string | null = null;
/** Native fixture launcher: production still accepts only a real executable, never a shim. */
function launcher(): string {
  if (windowsLauncher) return windowsLauncher;
  const build = mkdtempSync(join(tmpdir(), 'creator-fake-launcher-'));
  const source = join(build, 'Launcher.cs');
  const executable = join(build, 'claude.exe');
  writeFileSync(
    source,
    `using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
class Launcher {
  [DllImport("kernel32.dll")] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr p, uint s);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long processTime, jobTime; public uint flags; public UIntPtr min, max; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic basic; public IO io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob; }
  static string Quote(string s) {
    var b = new StringBuilder("\\\""); int slashes = 0;
    foreach (char c in s) {
      if (c == '\\\\') { slashes++; continue; }
      if (c == '"') { b.Append('\\\\', slashes * 2 + 1); b.Append(c); }
      else { b.Append('\\\\', slashes); b.Append(c); }
      slashes = 0;
    }
    b.Append('\\\\', slashes * 2); b.Append('"'); return b.ToString();
  }
  static int Main(string[] args) {
    // Closing this native fixture (including forced termination) also ends its Node child.
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var limits = new Extended(); limits.basic.flags = 0x2000;
    int size = Marshal.SizeOf(limits); IntPtr buffer = Marshal.AllocHGlobal(size);
    Marshal.StructureToPtr(limits, buffer, false);
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, buffer, (uint)size)) throw new Exception("Fixture job unavailable");
    Marshal.FreeHGlobal(buffer);
    string command = Quote(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "claude.mjs"));
    foreach (string arg in args) command += " " + Quote(arg);
    var info = new ProcessStartInfo(${JSON.stringify(process.execPath)}, command);
    info.UseShellExecute = false;
    using (var p = Process.Start(info)) {
      if (!AssignProcessToJobObject(job, p.Handle)) { p.Kill(); throw new Exception("Fixture child was not assigned"); }
      p.WaitForExit(); return p.ExitCode;
    }
  }
}`,
  );
  const csc = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  execFileSync(csc, ['/nologo', '/target:exe', `/out:${executable}`, source], {
    windowsHide: true,
    timeout: 30000,
  });
  windowsLauncher = executable;
  return executable;
}

/** Writes an executable fake `claude`, with a native Windows launcher or Unix shebang. */
export function writeFakeClaude(dir: string): string {
  mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    const bin = join(dir, 'claude.exe');
    writeFileSync(join(dir, 'claude.mjs'), SCRIPT);
    copyFileSync(launcher(), bin);
    return bin;
  }
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
  system?: string | null;
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
