import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PLAN_BUILD_TIMEOUT_MAX_MS } from '@creator/contracts';

// PR #123 review M-1: the jail bridge refused any timeout over 1800 s, so a Codex build
// timeout above about 30 minutes failed every build. The bridge now accepts up to the owner
// cap's timer bound, exactly as codex-host sends it: ceil(timeout_ms / 1000) + 5 seconds.
const BRIDGE = 'packages/executor/worker/codex_bridge.py';
const sent = (ms: number) => Math.max(10, Math.ceil(ms / 1000) + 5);

function python(): string | null {
  for (const bin of ['python3', 'python'])
    try {
      execFileSync(bin, ['--version'], { stdio: 'ignore' });
      return bin;
    } catch {
      /* try the next name */
    }
  return null;
}

test('the Codex bridge accepts every build timeout the caps form allows (ADR-0062)', (t) => {
  const py = python();
  if (!py) return t.skip('no Python here');
  const dir = mkdtempSync(join(tmpdir(), 'bridge-timeout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bins: Record<string, string> = {};
  for (const k of ['codex', 'code_mode_host', 'bwrap']) {
    bins[k] = join(dir, k);
    writeFileSync(bins[k]!, '');
  }
  const check = (timeout_s: unknown) => {
    const job = {
      format: 'codex-bridge-job/1',
      ...bins,
      port: 4555,
      capability: 'c'.repeat(40),
      config: [],
      timeout_s,
    };
    const script = [
      'import importlib.util, json, sys; sys.dont_write_bytecode = True',
      `spec = importlib.util.spec_from_file_location('bridge', ${JSON.stringify(BRIDGE)})`,
      'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
      'try:',
      '    m.check_job(json.loads(sys.argv[1])); print("ok")',
      'except RuntimeError as e:',
      '    print(e)',
    ].join('\n');
    return execFileSync(py, ['-I', '-c', script, JSON.stringify(job)], {
      encoding: 'utf8',
    }).trim();
  };
  assert.equal(check(sent(10 * 60_000)), 'ok');
  assert.equal(check(sent(30 * 60_000)), 'ok', 'the old top value (1805 s)');
  assert.equal(check(sent(60 * 60_000)), 'ok', 'one hour');
  assert.equal(check(sent(PLAN_BUILD_TIMEOUT_MAX_MS)), 'ok', 'the timer bound');
  assert.equal(check(sent(PLAN_BUILD_TIMEOUT_MAX_MS) + 1), 'Invalid timeout');
  assert.equal(check(9), 'Invalid timeout');
  assert.equal(check('600'), 'Invalid timeout');
  assert.equal(check(600.5), 'Invalid timeout');
});
