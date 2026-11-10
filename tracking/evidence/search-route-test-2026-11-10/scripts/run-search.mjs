// Bounded Claude Code WebSearch probe. Unmodified CLI, owner's own sign-in in the studio's
// dedicated config folder, allowlisted environment (no API keys), WebSearch only.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , id, outDir, query] = process.argv;
const cfg = 'C:\\dev\\creator_agent\\.creator\\studio\\claude-code';
const cwd = join(cfg, 'empty-workdir');
const allow = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'SystemDrive',
  'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'LANG'];
const env = {};
for (const k of allow) if (process.env[k]) env[k] = process.env[k];
Object.assign(env, {
  CLAUDE_CONFIG_DIR: cfg,
  ANTHROPIC_CONFIG_DIR: join(cfg, 'studio-anthropic-config'),
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION: '3',
});
const prompt = `Use the WebSearch tool (at most 3 searches) to find current, publicly accessible web pages relevant to this research question. Do not answer from memory; only report URLs that appeared in your search results.

Question: ${query}

Return only a JSON object: {"candidates":[{"url":"...","title":"...","why":"one short line"}]} with up to 10 candidates from distinct pages, most useful first.`;
const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--restricted',
  '--tools', 'WebSearch', '--allowedTools', 'WebSearch', '--strict-mcp-config',
  '--disallowedTools', 'mcp__*', '--disable-slash-commands', '--no-session-persistence',
  '--max-turns', '5'];
mkdirSync(outDir, { recursive: true });
const started = new Date();
const t0 = Date.now();
const child = spawn('C:\\Users\\jorda\\.local\\bin\\claude.exe', args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', err = '', timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 180_000);
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
child.on('close', (code) => {
  clearTimeout(timer);
  writeFileSync(join(outDir, `${id}.stream.jsonl`), out);
  writeFileSync(join(outDir, `${id}.meta.json`), JSON.stringify({
    id, query, args: args.map((a) => (a === prompt ? '<prompt>' : a)), prompt,
    started_at: started.toISOString(), elapsed_ms: Date.now() - t0, exit_code: code,
    timed_out: timedOut, stderr: err.slice(0, 4000),
    search_cap_env: env.CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION,
  }, null, 2));
  console.log(id, 'exit', code, 'ms', Date.now() - t0, 'timedOut', timedOut, 'bytes', out.length);
});
