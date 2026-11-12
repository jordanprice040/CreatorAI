import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import {
  ALLOWED_CLIENT_METHODS,
  CODEX_PIN,
  PlanRelay,
  checkCodexRequest,
  checkOutputItem,
  codexConfig,
  linuxCodexLauncher,
  wslCodexLauncher,
  offeredTools,
  runCodexTurn,
  workspaceChanges,
  workspacePath,
  type RelayOutcome,
} from '@creator/executor';

// "No command execution" for the ChatGPT-plan Codex builder (ADR-0042), checked layer by layer.
// The captured request bodies come from the pinned codex-cli 0.163.0 binary (tool lists only).

const root = new URL('../../', import.meta.url);
const captured = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`tests/fixtures/codex-0.163.0/${name}.json`, root),
      'utf8',
    ),
  ) as Record<string, unknown>;

test('the default Codex tool set is refused and the hardened one is accepted, in both catalog styles', () => {
  const sol = checkCodexRequest(captured('default-gpt-6.1-sol'));
  assert.ok(sol.includes('exec_tool_not_allowed:exec_command'));
  assert.ok(sol.includes('exec_tool_not_allowed:write_stdin'));
  assert.ok(sol.includes('tool_not_allowed:collaboration.spawn_agent'));
  const flat = checkCodexRequest(captured('default-gpt-5.5'));
  assert.ok(flat.includes('tool_not_allowed:exec_command'));
  assert.ok(flat.includes('tool_not_allowed:<web_search>'));
  assert.deepEqual(checkCodexRequest(captured('hardened-gpt-6.1-sol')), []);
  assert.deepEqual(checkCodexRequest(captured('hardened-gpt-5.5')), []);
  assert.deepEqual(offeredTools(captured('hardened-gpt-5.5')).tools, [
    'request_user_input',
    'apply_patch',
  ]);
});

test('request checks fail closed on unreadable exec tools, stored responses and unknown tools', () => {
  const exec = { type: 'custom', name: 'exec', description: 'no headings' };
  assert.ok(
    checkCodexRequest({ store: false, stream: true, tools: [exec] }).includes(
      'exec_tool_set_unreadable',
    ),
  );
  assert.ok(
    checkCodexRequest({ store: true, stream: true, tools: [] }).includes(
      'store_not_false',
    ),
  );
  assert.ok(
    checkCodexRequest({
      store: false,
      stream: true,
      tools: [{ type: 'local_shell' }],
    }).includes('tool_not_allowed:<local_shell>'),
  );
});

test('response items: only messages, reasoning and allowlisted calls reach Codex', () => {
  assert.equal(checkOutputItem({ type: 'message' }, true), null);
  assert.equal(
    checkOutputItem({ type: 'function_call', name: 'exec_command' }, false),
    'call_not_allowed:exec_command',
  );
  assert.equal(
    checkOutputItem({ type: 'local_shell_call' }, false),
    'output_type_not_allowed:local_shell_call',
  );
  assert.equal(
    checkOutputItem({ type: 'shell_call' }, false),
    'output_type_not_allowed:shell_call',
  );
  const js = (input: string) =>
    checkOutputItem(
      { type: 'custom_tool_call', namespace: 'functions', name: 'exec', input },
      true,
    );
  assert.equal(js('await tools.apply_patch("*** Begin Patch")'), null);
  assert.equal(
    js('await tools.exec_command({cmd:"id"})'),
    'exec_call_not_allowed:exec_command',
  );
  assert.equal(
    js('await tools["exec_" + "command"]({})'),
    'exec_dynamic_tool_access',
  );
  assert.equal(js('const t = globalThis.tools'), 'exec_dynamic_tool_access');
});

test('client methods never include shell, command or credit methods', () => {
  for (const m of [
    'thread/shellCommand',
    'command/exec',
    'process/spawn',
    'account/rateLimitResetCredit/consume',
    'account/sendAddCreditsNudgeEmail',
  ])
    assert.equal(ALLOWED_CLIENT_METHODS.has(m), false);
  const config = codexConfig(1);
  for (const k of [
    'features.shell_tool=false',
    'features.unified_exec=false',
    'features.multi_agent=false',
    'web_search="disabled"',
  ])
    assert.ok(config.includes(k));
  assert.ok(
    config.includes('model_providers.creator_relay.env_key="RELAY_CAPABILITY"'),
  );
});

test('workspace changes stay inside the task scope and jail paths stay inside /work', () => {
  const before = [
    { path: 'src/a.py', content: 'a' },
    { path: 'README.md', content: 'r' },
  ];
  const after = [
    { path: 'src/a.py', content: 'b' },
    { path: 'src/new.py', content: 'n' },
    { path: 'README.md', content: 'x' },
  ];
  const { changes, outside } = workspaceChanges(before, after, ['src']);
  assert.deepEqual(outside, ['README.md']);
  assert.deepEqual(
    changes.map((c) => [c.path, c.before_hash === null, c.content]),
    [
      ['src/a.py', false, 'b'],
      ['src/new.py', true, 'n'],
    ],
  );
  assert.equal(workspacePath('/work/src/a.py'), 'src/a.py');
  assert.equal(workspacePath('/etc/passwd'), null);
  assert.equal(workspacePath('/work/../etc'), null);
});

type Item = Record<string, unknown>;
/** A scripted Responses stand-in. Each request gets the next list of output items. */
async function upstream(script: Item[][]) {
  const seen: { auth: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      seen.push({
        auth: String(req.headers.authorization),
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      const n = seen.length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type: string, v: Item) =>
        res.write(
          `event: ${type}\ndata: ${JSON.stringify({ type, ...v })}\n\n`,
        );
      ev('response.created', { response: { id: `resp_${n}` } });
      for (const item of script[Math.min(n - 1, script.length - 1)]!) {
        ev('response.output_item.added', {
          item: { ...item, input: '', arguments: '' },
        });
        ev('response.output_item.done', { item });
      }
      ev('response.completed', {
        response: {
          id: `resp_${n}`,
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            total_tokens: 8,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      });
      res.end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  return {
    api_base: `http://127.0.0.1:${port}/v1`,
    port,
    seen,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
const done: Item[] = [
  {
    type: 'message',
    role: 'assistant',
    id: 'm2',
    content: [{ type: 'output_text', text: 'done' }],
  },
];
const patch = (file: string): Item[] => [
  {
    type: 'custom_tool_call',
    id: 'ctc_1',
    call_id: 'call_1',
    name: 'exec',
    namespace: 'functions',
    status: 'completed',
    input: `const r = await tools.apply_patch("*** Begin Patch\\n*** Add File: ${file}\\n+hi from codex\\n*** End Patch\\n"); text(JSON.stringify(r));`,
  },
];
const ATTACKS: Record<string, Item[]> = {
  function_call: [
    {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'exec_command',
      arguments: '{"cmd":"touch /work/src/SENTINEL"}',
    },
  ],
  js_exec: [
    {
      type: 'custom_tool_call',
      id: 'ctc_1',
      call_id: 'call_1',
      name: 'exec',
      namespace: 'functions',
      status: 'completed',
      input:
        "const r = await tools.exec_command({cmd:'touch /work/src/SENTINEL'}); text(String(r));",
    },
  ],
  local_shell: [
    {
      type: 'local_shell_call',
      id: 'ls_1',
      call_id: 'call_1',
      status: 'completed',
      action: {
        type: 'exec',
        command: ['touch', '/work/src/SENTINEL'],
        env: {},
      },
    },
  ],
};

const codexDir = process.env.CREATOR_CODEX_DIR;
const bwrap = process.env.CREATOR_CODEX_BWRAP ?? '/usr/bin/bwrap';
// On Windows the same tests drive the production WSL2 launcher (CREATOR_CODEX_DIR is the
// WSL path of the pinned binaries; CREATOR_WORKER_DISTRO defaults to Ubuntu).
const realCodex = (t: test.TestContext) => {
  if (process.platform === 'win32' && codexDir)
    return wslCodexLauncher({
      distro: process.env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
      codex_dir: codexDir,
    });
  if (!codexDir || !existsSync(`${codexDir}/codex`) || !existsSync(bwrap)) {
    t.skip(
      'Pinned Codex binary not run: set CREATOR_CODEX_DIR (and CREATOR_CODEX_BWRAP without /usr/bin/bwrap)',
    );
    return null;
  }
  return linuxCodexLauncher({ codex_dir: codexDir, bwrap });
};
const files = [
  { path: 'src/main.py', content: 'print(1)\n' },
  { path: 'README.md', content: 'readme\n' },
];
async function relayed(t: test.TestContext, script: Item[][]) {
  const launcher = realCodex(t);
  if (!launcher) return null;
  const up = await upstream(script);
  t.after(() => up.close());
  const settled: RelayOutcome[] = [];
  const relay = new PlanRelay({
    request_timeout_ms: 30000,
    onViolation() {},
    admit: async () => ({
      api_base: up.api_base,
      access_token: 'studio-held-token',
      settle: async (o) => void settled.push(o),
    }),
  });
  await relay.start();
  t.after(() => relay.close());
  const result = await runCodexTurn({
    launcher,
    relay,
    model: 'gpt-6.1-sol',
    instructions: 'go',
    files,
    file_scope: ['src'],
    timeout_ms: 90000,
  });
  return { result, up, settled, relay };
}

test('pinned Codex in the jail: an in-scope patch lands and the real token stays in the studio', async (t) => {
  const r = await relayed(t, [patch('src/hello.py'), done]);
  if (!r) return;
  assert.equal(r.result.state, 'completed', JSON.stringify(r.result));
  assert.deepEqual(r.result.violations, []);
  assert.notEqual(
    r.result.environment?.jail_network_namespace,
    r.result.environment?.host_network_namespace,
  );
  const { changes } = workspaceChanges(files, r.result.files!, ['src']);
  assert.deepEqual(
    changes.map((c) => c.path),
    ['src/hello.py'],
  );
  assert.ok(r.up.seen.every((s) => s.auth === 'Bearer studio-held-token'));
  assert.equal(r.settled.length, 2);
  assert.ok(r.settled.every((s) => s.kind === 'completed'));
});

test('pinned Codex in the jail: an out-of-scope patch is declined', async (t) => {
  const r = await relayed(t, [patch('outside.txt'), done]);
  if (!r) return;
  assert.ok(r.result.files);
  assert.deepEqual(workspaceChanges(files, r.result.files, ['src']), {
    changes: [],
    outside: [],
  });
});

for (const [name, items] of Object.entries(ATTACKS))
  test(`pinned Codex in the jail: the relay cuts a ${name} command before Codex receives it`, async (t) => {
    const r = await relayed(t, [items, done]);
    if (!r) return;
    assert.equal(r.result.state, 'stopped');
    assert.ok(
      r.result.violations.some((v) => v.startsWith('relay:')),
      JSON.stringify(r.result.violations),
    );
    assert.equal(
      r.up.seen.length,
      1,
      'no tool output ever went back to the model',
    );
    assert.equal(r.settled[0]!.reason_code, 'studio_tool_violation');
  });

for (const [name, items] of Object.entries(ATTACKS))
  test(`pinned Codex in the jail: with relay checks absent, the hardened config still runs no ${name} command`, async (t) => {
    // Layer independence: a plain forwarding stand-in instead of the checking relay.
    const launcher = realCodex(t);
    if (!launcher) return;
    const up = await upstream([items, done]);
    t.after(() => up.close());
    const capability = 'c'.repeat(43);
    const passthrough = {
      port: up.port,
      capability,
      options: { onViolation() {} },
    } as unknown as PlanRelay;
    const result = await runCodexTurn({
      launcher,
      relay: passthrough,
      model: 'gpt-6.1-sol',
      instructions: 'go',
      files,
      file_scope: ['src'],
      timeout_ms: 90000,
    });
    assert.equal(result.state, 'completed', JSON.stringify(result));
    assert.deepEqual(
      result.violations,
      [],
      'no command item or approval request appeared',
    );
    assert.equal(
      result.files?.some((f) => f.path.includes('SENTINEL')),
      false,
    );
    if (name === 'local_shell') {
      // 0.163.0 ignores a local_shell_call it never offered and ends the turn.
      assert.equal(up.seen.length, 1);
    } else {
      assert.equal(up.seen.length, 2);
      const echoed = JSON.stringify(up.seen[1]!.body.input);
      assert.match(
        echoed,
        /call_1/,
        'Codex reported the call back as failed instead of running it',
      );
    }
  });

test('a Codex disconnect mid-response stops the upstream call and settles the request (PR #128 re-review L-3)', async (t) => {
  // An upstream that keeps streaming until its client goes away.
  let upstreamClosed = false;
  let markGone = () => {};
  const upstreamGone = new Promise<void>((ok) => (markGone = ok));
  const up = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const block = `data: ${JSON.stringify({
      type: 'response.output_text.delta',
      delta: 'x'.repeat(16_000),
    })}\n\n`;
    const tick = setInterval(() => res.write(block), 2);
    res.on('close', () => {
      clearInterval(tick);
      upstreamClosed = true;
      markGone();
    });
  });
  await new Promise<void>((ok) => up.listen(0, '127.0.0.1', ok));
  t.after(() => {
    up.closeAllConnections();
    up.close();
  });
  const upAddr = up.address() as { port: number };
  const settled: RelayOutcome[] = [];
  const done = new Promise<void>((ok) => {
    const relay = new PlanRelay({
      request_timeout_ms: 60_000,
      onViolation() {},
      admit: async () => ({
        api_base: `http://127.0.0.1:${upAddr.port}/v1`,
        access_token: 'studio-held-token',
        settle: async (o) => {
          settled.push(o);
          ok();
        },
      }),
    });
    t.after(() => relay.close());
    void relay.start().then((port) => {
      // Codex reads a little, stops reading (backpressure), then disconnects.
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/v1/responses',
        headers: {
          authorization: `Bearer ${relay.capability}`,
          'content-type': 'application/json',
        },
      });
      req.on('response', (res) => {
        res.once('data', () => {
          res.pause();
          setTimeout(() => req.destroy(), 200);
        });
      });
      req.on('error', () => {});
      req.end(
        JSON.stringify({
          model: 'm',
          input: 'hi',
          tools: [],
          store: false,
          stream: true,
        }),
      );
    });
  });
  await Promise.race([
    Promise.all([done, upstreamGone]),
    new Promise((_, fail) =>
      setTimeout(() => fail(new Error('relay hung after disconnect')), 10_000),
    ),
  ]);
  assert.equal(settled.length, 1);
  assert.equal(settled[0]!.kind, 'unknown');
  assert.equal(settled[0]!.reason_code, 'codex_disconnected');
  assert.ok(upstreamClosed, 'the upstream call was stopped');
});

for (const phase of [
  'before the upstream headers',
  'during a silent stream',
] as const)
  test(`a Codex disconnect ${phase} stops the upstream call at once (PR #128 re-review N-6)`, async (t) => {
    // An upstream that sends nothing (or only headers) until its client goes away.
    let markGone = () => {};
    const upstreamGone = new Promise<void>((ok) => (markGone = ok));
    let markAsked = () => {};
    const upstreamAsked = new Promise<void>((ok) => (markAsked = ok));
    const up = http.createServer((req, res) => {
      req.resume();
      if (phase === 'during a silent stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.flushHeaders();
      }
      res.on('close', () => markGone());
      markAsked();
    });
    await new Promise<void>((ok) => up.listen(0, '127.0.0.1', ok));
    t.after(() => {
      up.closeAllConnections();
      up.close();
    });
    const upAddr = up.address() as { port: number };
    const settled: RelayOutcome[] = [];
    let markSettled = () => {};
    const done = new Promise<void>((ok) => (markSettled = ok));
    const relay = new PlanRelay({
      request_timeout_ms: 60_000,
      onViolation() {},
      admit: async () => ({
        api_base: `http://127.0.0.1:${upAddr.port}/v1`,
        access_token: 'studio-held-token',
        settle: async (o) => {
          settled.push(o);
          markSettled();
        },
      }),
    });
    t.after(() => relay.close());
    const port = await relay.start();
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/v1/responses',
      headers: {
        authorization: `Bearer ${relay.capability}`,
        'content-type': 'application/json',
      },
    });
    req.on('error', () => {});
    req.end(
      JSON.stringify({
        model: 'm',
        input: 'hi',
        tools: [],
        store: false,
        stream: true,
      }),
    );
    // Codex goes away once the upstream call is open and silent; no write follows.
    await upstreamAsked;
    await new Promise((ok) => setTimeout(ok, 100));
    req.destroy();
    await Promise.race([
      Promise.all([done, upstreamGone]),
      new Promise((_, fail) =>
        setTimeout(
          () => fail(new Error('relay kept waiting after disconnect')),
          5_000,
        ),
      ),
    ]);
    assert.equal(settled.length, 1);
    assert.equal(settled[0]!.kind, 'unknown');
    assert.equal(settled[0]!.reason_code, 'codex_disconnected');
  });

test('closing the relay records an in-flight request as relay_closed, not timeout', async (t) => {
  let markAsked = () => {};
  const upstreamAsked = new Promise<void>((ok) => (markAsked = ok));
  const up = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
    markAsked();
  });
  await new Promise<void>((ok) => up.listen(0, '127.0.0.1', ok));
  t.after(() => {
    up.closeAllConnections();
    up.close();
  });
  const upAddr = up.address() as { port: number };
  const settled: RelayOutcome[] = [];
  let markSettled = () => {};
  const done = new Promise<void>((ok) => (markSettled = ok));
  const relay = new PlanRelay({
    request_timeout_ms: 60_000,
    onViolation() {},
    admit: async () => ({
      api_base: `http://127.0.0.1:${upAddr.port}/v1`,
      access_token: 'studio-held-token',
      settle: async (o) => {
        settled.push(o);
        markSettled();
      },
    }),
  });
  const port = await relay.start();
  const req = http.request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/v1/responses',
    headers: {
      authorization: `Bearer ${relay.capability}`,
      'content-type': 'application/json',
    },
  });
  req.on('error', () => {});
  req.end(
    JSON.stringify({
      model: 'm',
      input: 'hi',
      tools: [],
      store: false,
      stream: true,
    }),
  );
  await upstreamAsked;
  await relay.close();
  await Promise.race([
    done,
    new Promise((_, fail) =>
      setTimeout(
        () => fail(new Error('relay never settled after close')),
        5_000,
      ),
    ),
  ]);
  assert.equal(settled[0]!.reason_code, 'relay_closed');
});

test('a Codex disconnect while the request is being admitted never reaches the upstream (PR #189 review nit 1)', async (t) => {
  let upstreamCalls = 0;
  const up = http.createServer((req, res) => {
    upstreamCalls++;
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.flushHeaders();
  });
  await new Promise<void>((ok) => up.listen(0, '127.0.0.1', ok));
  t.after(() => {
    up.closeAllConnections();
    up.close();
  });
  const upAddr = up.address() as { port: number };
  const settled: RelayOutcome[] = [];
  let markSettled = () => {};
  const done = new Promise<void>((ok) => (markSettled = ok));
  let markAdmitting = () => {};
  const admitting = new Promise<void>((ok) => (markAdmitting = ok));
  let releaseAdmit = () => {};
  const admitted = new Promise<void>((ok) => (releaseAdmit = ok));
  const relay = new PlanRelay({
    request_timeout_ms: 60_000,
    onViolation() {},
    admit: async () => {
      markAdmitting();
      await admitted;
      return {
        api_base: `http://127.0.0.1:${upAddr.port}/v1`,
        access_token: 'studio-held-token',
        settle: async (o) => {
          settled.push(o);
          markSettled();
        },
      };
    },
  });
  t.after(() => relay.close());
  const port = await relay.start();
  const req = http.request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/v1/responses',
    headers: {
      authorization: `Bearer ${relay.capability}`,
      'content-type': 'application/json',
    },
  });
  req.on('error', () => {});
  req.end(
    JSON.stringify({
      model: 'm',
      input: 'hi',
      tools: [],
      store: false,
      stream: true,
    }),
  );
  // Codex goes away while admission is still deciding; admission then lets the request through.
  await admitting;
  req.destroy();
  await new Promise((ok) => setTimeout(ok, 200));
  releaseAdmit();
  await Promise.race([
    done,
    new Promise((_, fail) =>
      setTimeout(
        () => fail(new Error('relay kept the request after disconnect')),
        5_000,
      ),
    ),
  ]);
  assert.equal(settled[0]!.reason_code, 'codex_disconnected');
  assert.equal(upstreamCalls, 0, 'nothing was sent upstream');
});

test('the install script checks the same Codex pin the builder records (audit 2026-11-12 N-3)', () => {
  const script = readFileSync(
    new URL('scripts/install-codex-wsl.sh', root),
    'utf8',
  );
  const value = (name: string) =>
    new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm').exec(script)?.[1];
  assert.equal(value('VERSION'), CODEX_PIN.version);
  assert.equal(value('SHA256'), CODEX_PIN.sha256);
  assert.equal(`sha512-${value('SHA512_B64')}`, CODEX_PIN.integrity);
  assert.equal(
    CODEX_PIN.url,
    `https://registry.npmjs.org/@openai/codex/-/codex-${CODEX_PIN.version}-linux-x64.tgz`,
  );
  assert.ok(script.includes(CODEX_PIN.binary_dir));
});
