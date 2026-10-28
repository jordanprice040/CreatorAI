import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  CREDITS_OFF_STATEMENT,
  ContractError,
  PlanConnectionSchema,
  type ErrorCode,
  type PlanConnection,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import {
  CLAUDE_CODE_FOREIGN_ENV,
  PlanConnectionService,
  callClaudeCode,
  claudeCodeArgs,
  claudeCodeEnv,
  claudeCodeHostFromEnv,
  claudeCodeStatus,
  resolveClaudeBin,
  type ClaudeCodeHost,
  type PlanObservedOutcome,
} from '@creator/broker';
import { admissionBlockers, connectionBlockers } from '@creator/domain';
import { freshDatabase } from './pg-harness.js';
import {
  SUBSCRIBED,
  fakeCalls,
  setFake,
  writeFakeClaude,
  type FakeClaudeConfig,
} from './claude-fake.js';

// ADR-0050: Claude subscription usage through the owner's own signed-in Claude Code CLI.
// Everything here runs a fake `claude`; the optional last test drives the real CLI against a
// loopback stand-in for Anthropic's API (never a live call).

const root = new URL('../../', import.meta.url);
const SETTINGS = JSON.parse(
  readFileSync(new URL('config/connections/claude-code.json', root), 'utf8'),
) as PlanConnection['settings'];
const owner: CommandContext = { actorId: randomUUID() };
const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(
      e.code,
      code,
      `${e.code}: ${e.message} ${e.details.join(' | ')}`,
    );
    if (detail)
      assert.ok(
        detail.test([e.message, ...e.details].join(' | ')),
        [e.message, ...e.details].join(' | '),
      );
    return true;
  });

const refusal = (o: PlanObservedOutcome) => {
  assert.notEqual(o.kind, 'completed');
  return o as Exclude<PlanObservedOutcome, { kind: 'completed' }>;
};

function fakeHost(cfg: FakeClaudeConfig): ClaudeCodeHost {
  const dir = mkdtempSync(join(tmpdir(), 'creator-claude-'));
  const bin = writeFakeClaude(join(dir, 'bin'));
  const config_dir = join(dir, 'config');
  setFake(config_dir, cfg);
  return { bin, config_dir, work_dir: join(config_dir, 'empty-workdir') };
}
const call = (
  host: ClaudeCodeHost,
  over: Partial<Parameters<typeof callClaudeCode>[0]> = {},
) =>
  callClaudeCode({
    host,
    model: 'claude-test-model',
    instructions: 'Reply with exactly the word: ok',
    input: 'Reply with exactly: ok',
    timeout_ms: 10_000,
    max_output_chars: 16_000,
    ...over,
  });

test('proposed Claude Code settings keep code_build, Codex builds and private data out', () => {
  assert.equal(SETTINGS.caps.codex.max_builds_per_day, 0);
  assert.equal(SETTINGS.allowed_task_classes.includes('code_build'), false);
  assert.deepEqual(SETTINGS.allowed_data_classes, ['synthetic', 'public']);
  assert.equal(SETTINGS.caps.shared.max_in_flight, 1);
});

test('the child gets an allowlisted environment: no API key, token, gateway or provider switch', () => {
  const host = {
    bin: '/x/claude',
    config_dir: '/studio/claude-code',
    work_dir: '/studio/claude-code/empty-workdir',
  };
  const base: Record<string, string> = { PATH: '/usr/bin', HOME: '/home/o' };
  for (const k of CLAUDE_CODE_FOREIGN_ENV) base[k] = 'set-by-studio-env';
  base.CLAUDE_CONFIG_DIR = '/home/o/.claude';
  base.CLAUDE_CODE_SOMETHING = '1';
  const env = claudeCodeEnv(host, base);
  for (const k of CLAUDE_CODE_FOREIGN_ENV) assert.equal(k in env, false, k);
  assert.equal(env.CLAUDE_CONFIG_DIR, '/studio/claude-code');
  assert.equal('CLAUDE_CODE_SOMETHING' in env, false);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
});

test('runs are locked down: restricted, no tools, no MCP, one turn, no saved session', () => {
  const a = claudeCodeArgs('claude-test-model', 'instr');
  const after = (f: string) => a[a.indexOf(f) + 1];
  for (const f of [
    '-p',
    '--restricted',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
  ])
    assert.ok(a.includes(f), f);
  assert.equal(after('--tools'), '');
  assert.equal(after('--disallowedTools'), 'mcp__*');
  assert.equal(after('--max-turns'), '1');
  assert.equal(after('--permission-mode'), 'dontAsk');
  assert.equal(after('--model'), 'claude-test-model');
  assert.equal(after('--system-prompt'), 'instr');
  assert.equal(a.includes('--bare'), false, 'bare mode would ignore the login');
  assert.equal(a.includes('--fallback-model'), false);
});

test('the binary must be a real executable; shell shims and missing folders are refused', () => {
  const host = fakeHost({ status: SUBSCRIBED });
  assert.equal(
    resolveClaudeBin({ CREATOR_CLAUDE_CODE_BIN: host.bin }),
    host.bin,
  );
  const shim = join(host.config_dir, 'claude.cmd');
  writeFileSync(shim, '@echo off');
  assert.equal(resolveClaudeBin({ CREATOR_CLAUDE_CODE_BIN: shim }), null);
  assert.equal(resolveClaudeBin({ CREATOR_CLAUDE_CODE_BIN: 'claude' }), null);
  // No dedicated folder means not configured, never the owner's personal ~/.claude.
  assert.equal(
    claudeCodeHostFromEnv({ CREATOR_CLAUDE_CODE_BIN: host.bin }),
    null,
  );
  assert.equal(
    claudeCodeHostFromEnv({
      CREATOR_CLAUDE_CODE_BIN: host.bin,
      CREATOR_CLAUDE_CODE_CONFIG_DIR: 'relative/dir',
    }),
    null,
  );
  assert.deepEqual(
    claudeCodeHostFromEnv({
      CREATOR_CLAUDE_CODE_BIN: host.bin,
      CREATOR_CLAUDE_CODE_CONFIG_DIR: host.config_dir,
    }),
    host,
  );
});

test('status reads auth status in the dedicated folder and never passes a key through', async () => {
  const host = fakeHost({ status: SUBSCRIBED });
  const s = await claudeCodeStatus(host, {
    PATH: process.env.PATH ?? '',
    ANTHROPIC_API_KEY: 'sk-should-not-pass',
  });
  assert.deepEqual(s, {
    logged_in: true,
    auth_method: 'claude.ai',
    api_provider: 'firstParty',
    account_label: 'owner@example.test',
    cli_version: '2.1.312',
  });
  const calls = fakeCalls(host.config_dir);
  assert.deepEqual(
    calls.map((c) => c.args),
    [['--version'], ['auth', 'status', '--json']],
  );
  for (const c of calls) {
    assert.equal(c.env.includes('ANTHROPIC_API_KEY'), false);
    assert.ok(c.env.includes('CLAUDE_CONFIG_DIR'));
    assert.equal(c.cwd, host.work_dir);
  }
  setFake(host.config_dir, { status: { loggedIn: false, authMethod: 'none' } });
  assert.equal((await claudeCodeStatus(host)).logged_in, false);
});

test('a successful run returns the text, with the prompt on stdin and no tools', async () => {
  const host = fakeHost({ status: SUBSCRIBED, text: 'ok' });
  const o = await call(host, { input: 'Reply with exactly: ok' });
  assert.equal(o.kind, 'completed');
  if (o.kind !== 'completed') return;
  assert.equal(o.text, 'ok');
  assert.equal(o.output_tokens, 2);
  assert.equal(o.response_id, 'fake-session-1');
  const run = fakeCalls(host.config_dir).at(-1)!;
  assert.equal(run.stdin, 'Reply with exactly: ok');
  assert.ok(run.args.includes('--restricted'));
});

test('refusals end at the first retry notice and say what they mean', async () => {
  const host = fakeHost({ status: SUBSCRIBED, run: 'rate_limit' });
  const started = Date.now();
  const limited = await call(host);
  assert.ok(Date.now() - started < 8000, 'did not wait out the retries');
  assert.equal(limited.kind, 'rejected');
  assert.equal(refusal(limited).quota, 'exhausted');
  setFake(host.config_dir, { status: SUBSCRIBED, run: 'auth_retry' });
  const auth = await call(host);
  assert.equal(refusal(auth).sign_in_invalid, true);
  setFake(host.config_dir, { status: SUBSCRIBED, run: 'error404' });
  const model = await call(host);
  assert.equal(model.kind, 'rejected');
  assert.equal(refusal(model).model_refused, true);
  setFake(host.config_dir, { status: SUBSCRIBED, run: 'usage_text' });
  const usage = await call(host);
  assert.equal(refusal(usage).quota, 'exhausted');
});

test('a different answering model, an oversized answer, tools or an API key are never accepted', async () => {
  const host = fakeHost({ status: SUBSCRIBED, run: 'substitute' });
  const sub = await call(host);
  assert.equal(sub.kind, 'failed');
  assert.equal(refusal(sub).reason_code, 'model_substituted');
  setFake(host.config_dir, { status: SUBSCRIBED, text: 'x'.repeat(600) });
  const big = await call(host, { max_output_chars: 500 });
  assert.equal(refusal(big).reason_code, 'output_cap_exceeded');
  setFake(host.config_dir, { status: SUBSCRIBED, run: 'unsafe' });
  const unsafe = await call(host);
  assert.equal(unsafe.kind, 'unknown');
  assert.equal(refusal(unsafe).reason_code, 'claude_code_unsafe_session');
  setFake(host.config_dir, {
    status: SUBSCRIBED,
    apiKeySource: 'ANTHROPIC_API_KEY',
  });
  const keyed = await call(host);
  assert.equal(refusal(keyed).reason_code, 'claude_code_not_subscription');
});

test('timeouts and runs without a result are unknown; a crash before the session is rejected', async () => {
  const host = fakeHost({ status: SUBSCRIBED, run: 'hang' });
  const hung = await call(host, { timeout_ms: 500 });
  assert.equal(hung.kind, 'unknown');
  assert.equal(refusal(hung).reason_code, 'timeout');
  setFake(host.config_dir, { status: SUBSCRIBED, run: 'crash' });
  const crash = await call(host);
  assert.equal(crash.kind, 'rejected');
  const missing = await call({ ...host, bin: join(host.config_dir, 'nope') });
  assert.equal(missing.kind, 'rejected');
  const ac = new AbortController();
  ac.abort();
  assert.equal((await call(host, { signal: ac.signal })).kind, 'rejected');
});

async function setup(t: test.TestContext, cfg: FakeClaudeConfig) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const host = fakeHost(cfg);
  const service = new PlanConnectionService({
    store,
    vault: null,
    claudeCode: host,
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Claude fixture',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    kind: 'claude_code',
    label: 'Claude Code on this computer',
    settings: SETTINGS,
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  const ready = async () => {
    await service.checkClaudeCode(owner, ws.id, conn.id);
    let c = await current();
    await store.attestPlanCredits(owner, ws.id, c.id, {
      expected_version: c.version,
      statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
      checked_on: '2026-10-28',
    });
    c = await current();
    await store.acceptPlanCaps(owner, ws.id, c.id, {
      expected_version: c.version,
      settings_hash: c.settings_hash,
    });
    return current();
  };
  return { db, store, host, service, ws, conn, current, ready };
}

test('a Claude Code connection refuses ChatGPT-only settings, statements and sign-in', async (t) => {
  const s = await setup(t, { status: SUBSCRIBED });
  if (!s) return;
  assert.equal(PlanConnectionSchema.parse(s.conn).kind, 'claude_code');
  await rejects(
    'INVALID_CONTRACT',
    s.store.createPlanConnection(owner, s.ws.id, {
      kind: 'claude_code',
      label: 'with code_build',
      settings: {
        ...SETTINGS,
        allowed_task_classes: ['summarization', 'code_build'],
      },
    }),
    /code_build/,
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.createPlanConnection(owner, s.ws.id, {
      kind: 'claude_code',
      label: 'with codex builds',
      settings: {
        ...SETTINGS,
        caps: {
          ...SETTINGS.caps,
          codex: { ...SETTINGS.caps.codex, max_builds_per_day: 2 },
        },
      },
    }),
    /Codex builds/,
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.attestPlanCredits(owner, s.ws.id, s.conn.id, {
      expected_version: s.conn.version,
      statement: CREDITS_OFF_STATEMENT,
      checked_on: '2026-10-28',
    }),
    /other kind/,
  );
  await rejects(
    'INVALID_TRANSITION',
    s.service.beginSignIn(owner, s.ws.id, s.conn.id, { open_browser: false }),
    /claude auth login/,
  );
  await rejects(
    'INVALID_TRANSITION',
    s.store.recordPlanSignIn(owner, s.ws.id, s.conn.id, {
      issued_client_id: 'x',
      account_label: 'x',
      scopes: [],
      access_expires_at: new Date().toISOString(),
      credential_ref: `chatgpt-plan/${randomUUID()}`,
    }),
  );
  // The kind is fixed in the database, not only in code.
  await assert.rejects(
    s.db.pool.query(
      `update plan_connections set kind = 'chatgpt_plan' where id = $1`,
      [s.conn.id],
    ),
    /immutable/,
  );
  // A ChatGPT connection cannot take the Claude statement either.
  const chat = await s.store.createPlanConnection(owner, s.ws.id, {
    label: 'ChatGPT plan',
    settings: { ...SETTINGS, plan_type: 'plus' },
  });
  assert.equal(chat.kind, 'chatgpt_plan');
  await rejects(
    'INVALID_CONTRACT',
    s.store.attestPlanCredits(owner, s.ws.id, chat.id, {
      expected_version: chat.version,
      statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
      checked_on: '2026-10-28',
    }),
  );
});

test('only a claude.ai subscription login counts as signed in', async (t) => {
  const s = await setup(t, {
    status: {
      loggedIn: true,
      authMethod: 'api_key',
      apiProvider: 'firstParty',
    },
  });
  if (!s) return;
  let r = await s.service.checkClaudeCode(owner, s.ws.id, s.conn.id);
  assert.equal(r.config_dir, s.host.config_dir);
  assert.equal(r.connection.sign_in.state, 'signed_in');
  assert.equal(r.connection.sign_in.plan_usage_granted, false);
  assert.ok(
    connectionBlockers(r.connection).some((b) => /API key/.test(b)),
    connectionBlockers(r.connection).join(' | '),
  );
  for (const status of [
    { loggedIn: true, authMethod: 'oauth_token', apiProvider: 'firstParty' },
    { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' },
  ]) {
    setFake(s.host.config_dir, { status });
    r = await s.service.checkClaudeCode(owner, s.ws.id, s.conn.id);
    assert.equal(
      r.connection.sign_in.plan_usage_granted,
      false,
      JSON.stringify(status),
    );
  }
  setFake(s.host.config_dir, {
    status: { loggedIn: false, authMethod: 'none' },
  });
  r = await s.service.checkClaudeCode(owner, s.ws.id, s.conn.id);
  assert.equal(r.connection.sign_in.state, 'not_signed_in');
  setFake(s.host.config_dir, { status: SUBSCRIBED });
  r = await s.service.checkClaudeCode(owner, s.ws.id, s.conn.id);
  assert.equal(r.connection.sign_in.plan_usage_granted, true);
  assert.equal(r.connection.sign_in.account_label, 'owner@example.test');
  assert.equal(r.connection.sign_in.issued_client_id, 'claude-code/2.1.312');
  // Still blocked until extra usage is confirmed off and the caps are accepted.
  assert.equal(connectionBlockers(r.connection).length, 2);
});

test('verification runs through the gates, and a sign-in that changed since the check is refused before sending', async (t) => {
  const s = await setup(t, { status: SUBSCRIBED });
  if (!s) return;
  const c = await s.ready();
  assert.deepEqual(connectionBlockers(c), []);
  await rejects(
    'INVALID_CONTRACT',
    s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
      expected_version: c.version,
      model_id: 'claude-test-model',
      path: 'codex',
      expires_in_minutes: 30,
    }),
    /direct path/,
  );
  const g = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'claude-test-model',
    path: 'responses',
    expires_in_minutes: 30,
  });
  const v = await s.service.verifyModel(owner, s.ws.id, c.id, {
    id: g.id,
    model_id: 'claude-test-model',
  });
  assert.equal(v.verified, true);
  const d = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
  assert.deepEqual(
    d.model_access.map((a) => [a.model_id, a.path, a.access]),
    [['claude-test-model', 'responses', 'verified']],
  );
  const runs = fakeCalls(s.host.config_dir).filter((x) => x.args[0] === '-p');
  assert.equal(runs.length, 1);
  // Codex-path admission is refused for this kind even if asked directly.
  assert.ok(
    admissionBlockers({
      connection: d.connection,
      request: {
        connection_id: c.id,
        logical_operation_id: randomUUID(),
        path: 'codex',
        purpose: 'codex_build',
        model_id: 'claude-test-model',
        task_class: 'code_build',
        data_class: 'synthetic',
        run_id: null,
        build_id: randomUUID(),
        grant_id: null,
        qualification_id: null,
        input_chars: 0,
      },
      access: d.model_access,
      qualifications: [],
      grant: null,
      usage: {
        last_24h_requests: 0,
        last_24h_codex_builds: 0,
        run_requests: 0,
        build_requests: 0,
        in_flight: 0,
        unresolved: 0,
      },
      now: new Date(),
    }).some((b) => /direct path only/.test(b)),
  );

  // Claude Code switched to an API key after the owner's check: refused, nothing sent.
  setFake(s.host.config_dir, {
    status: {
      loggedIn: true,
      authMethod: 'api_key',
      apiProvider: 'firstParty',
    },
  });
  const after = await s.current();
  const g2 = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: after.version,
    model_id: 'claude-test-model',
    path: 'responses',
    expires_in_minutes: 30,
    intent: 'availability_recheck',
  });
  const r = await s.service.recheckAvailability(owner, s.ws.id, c.id, {
    id: g2.id,
    model_id: 'claude-test-model',
  });
  assert.equal(r.available, false);
  assert.equal(r.outcome.kind, 'rejected');
  assert.equal(
    fakeCalls(s.host.config_dir).filter((x) => x.args[0] === '-p').length,
    1,
    'no second model request was started',
  );
  const blocked = await s.current();
  assert.equal(blocked.sign_in.state, 'reauthorization_required');
  assert.ok(
    connectionBlockers(blocked).some((b) => /claude auth login/.test(b)),
  );
});

test('a usage limit pauses the connection instead of falling back to anything paid', async (t) => {
  const s = await setup(t, { status: SUBSCRIBED });
  if (!s) return;
  const c = await s.ready();
  setFake(s.host.config_dir, { status: SUBSCRIBED, run: 'rate_limit' });
  const g = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'claude-test-model',
    path: 'responses',
    expires_in_minutes: 30,
  });
  const v = await s.service.verifyModel(owner, s.ws.id, c.id, {
    id: g.id,
    model_id: 'claude-test-model',
  });
  assert.equal(v.verified, false);
  const after = await s.current();
  assert.equal(after.quota.state, 'exhausted');
  assert.ok(connectionBlockers(after).some((b) => /usage limit/.test(b)));
  const requests = await s.store.planRequests(owner, s.ws.id, c.id);
  assert.deepEqual(
    requests.map((r) => [r.state, r.reason_code]),
    [['rejected', 'claude_usage_limit']],
  );
});

test('real Claude Code CLI against a loopback stand-in (optional, never live)', async (t) => {
  const bin = process.env.CREATOR_TEST_CLAUDE_BIN;
  if (!bin) {
    t.skip(
      'Set CREATOR_TEST_CLAUDE_BIN to a Claude Code executable to run this contract check.',
    );
    return;
  }
  let mode: 'ok' | '429' = 'ok';
  const seen: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages')) {
        res.writeHead(404).end('{}');
        return;
      }
      const j = JSON.parse(body) as { model: string; stream?: boolean };
      seen.push(j as unknown as Record<string, unknown>);
      if (mode === '429') {
        res.writeHead(429, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            type: 'error',
            error: { type: 'rate_limit_error', message: 'limit' },
          }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (e: string, d: unknown) =>
        res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      ev('message_start', {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: j.model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 5, output_tokens: 1 },
        },
      });
      ev('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      });
      ev('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ok' },
      });
      ev('content_block_stop', { type: 'content_block_stop', index: 0 });
      ev('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1 },
      });
      ev('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const dir = mkdtempSync(join(tmpdir(), 'creator-claude-real-'));
  const host = {
    bin,
    config_dir: join(dir, 'config'),
    work_dir: join(dir, 'config', 'empty-workdir'),
  };
  const fixture_env = {
    ANTHROPIC_API_KEY: 'sk-ant-loopback-fixture',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    HOME: join(dir, 'home'),
  };
  const ok = await call(host, {
    model: 'claude-opus-5-5',
    timeout_ms: 60_000,
    fixture_env,
  });
  assert.equal(ok.kind, 'completed', JSON.stringify(ok));
  const sent = seen.at(-1)!;
  assert.deepEqual(sent.tools, []);
  assert.equal(sent.model, 'claude-opus-5-5');
  mode = '429';
  const started = Date.now();
  const limited = await call(host, {
    model: 'claude-opus-5-5',
    timeout_ms: 60_000,
    fixture_env,
  });
  assert.equal(limited.kind, 'rejected', JSON.stringify(limited));
  assert.equal(refusal(limited).quota, 'exhausted');
  assert.ok(Date.now() - started < 20_000, 'cut at the first retry notice');
});
