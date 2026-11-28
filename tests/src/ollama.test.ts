import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  LocalModelsConfigSchema,
  isCloudModelName,
  parse,
} from '@creator/contracts';
import {
  OLLAMA_PATHS,
  OllamaAdapter,
  OllamaClient,
  loadLocalModelsConfig,
  ollamaBase,
  type AdapterRequest,
} from '@creator/broker';

// ADR-0127 (F11 first slice): every test talks to a fake Ollama server on loopback. Nothing
// here reaches a real Ollama, downloads a model or touches the owner's computer.

const root = new URL('../../', import.meta.url);
const DIGEST = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const MODEL = 'example-family:small';

interface Seen {
  method: string;
  path: string;
  body: unknown;
}
type Handler = (req: Seen, res: ServerResponse) => void;

/** Every request any fake server in this file received, for the allowed-paths check. */
const allSeen: Seen[] = [];

async function fakeOllama(routes: Record<string, Handler>) {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const s: Seen = {
        method: req.method ?? '',
        path: req.url ?? '',
        body: text ? (JSON.parse(text) as unknown) : null,
      };
      seen.push(s);
      allSeen.push(s);
      const h = routes[`${s.method} ${s.path}`];
      if (!h) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      h(s, res);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((r) => server.close(() => r()));
    },
  };
}

const json =
  (status: number, body: unknown): Handler =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
const tags = (models: unknown[]) => json(200, { models });
const installed = (digest = DIGEST, extra: Record<string, unknown> = {}) => ({
  name: MODEL,
  model: MODEL,
  modified_at: '2026-11-17T00:00:00Z',
  size: 123,
  digest,
  details: {
    format: 'gguf',
    family: 'example-family',
    families: ['example-family'],
    parameter_size: '1B',
    quantization_level: 'Q4_K_M',
  },
  ...extra,
});
const chatAnswer = (over: Record<string, unknown> = {}) => ({
  model: MODEL,
  created_at: '2026-11-17T00:00:00Z',
  message: { role: 'assistant', content: '{"ok":true}' },
  done: true,
  done_reason: 'stop',
  total_duration: 1,
  load_duration: 1,
  prompt_eval_count: 40,
  prompt_eval_cached_count: 10,
  prompt_eval_duration: 1,
  eval_count: 7,
  eval_duration: 1,
  ...over,
});
const request = (over: Partial<AdapterRequest> = {}): AdapterRequest => ({
  action: 'model.generate',
  model_id: MODEL,
  input: [
    { role: 'system', text: 'Answer in JSON.' },
    { role: 'user', text: 'Say ok.' },
  ],
  max_output_tokens: 256,
  output_format: 'json',
  tool: null,
  ...over,
});
const adapter = (url: string, extra: Record<string, unknown> = {}) =>
  new OllamaAdapter({
    base_url: url,
    pin: { name: MODEL, digest: DIGEST },
    ...extra,
  });
const signal = () => new AbortController().signal;

test('the address must be IP loopback over http, host and port only', () => {
  assert.equal(ollamaBase('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(ollamaBase('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434');
  assert.equal(ollamaBase('http://[::1]:11434'), 'http://[::1]:11434');
  for (const bad of [
    'http://localhost:11434',
    'https://127.0.0.1:11434',
    'http://192.168.1.5:11434',
    'http://ollama.example.com',
    'http://127.0.0.1:11434/api',
    'http://user:pw@127.0.0.1:11434',
    'http://127.0.0.1:11434/?x=1',
    'not a url',
  ])
    assert.throws(() => ollamaBase(bad), /local model address/, bad);
});

test('the shipped config pins no model and points at the default loopback address', () => {
  const config = loadLocalModelsConfig(
    fileURLToPath(new URL('config/local-models.json', root)),
  );
  assert.deepEqual(config.models, []);
  assert.equal(config.base_url, 'http://127.0.0.1:11434');
  assert.equal(config.context_tokens, null);
});

test('config refuses cloud models, duplicate pins and digests that are not exact', () => {
  const base = { recorded_on: '2026-11-17' };
  assert.equal(isCloudModelName('gpt-oss:120b-cloud'), true);
  assert.equal(isCloudModelName('example:cloud'), true);
  assert.equal(isCloudModelName('cloudy-model:1b'), false);
  // Deliberately broad: a local name with a whole `cloud` segment is refused too.
  assert.equal(isCloudModelName('my-cloud-model:1b'), true);
  // Hugging Face names keep their capitals and can be pinned.
  assert.equal(
    parse(LocalModelsConfigSchema, {
      ...base,
      models: [{ name: 'hf.co/Owner/Example-1B-GGUF:Q4_K_M', digest: DIGEST }],
    }).models.length,
    1,
  );
  for (const models of [
    [{ name: 'example:20b-cloud', digest: DIGEST }],
    [
      { name: MODEL, digest: DIGEST },
      { name: MODEL, digest: OTHER },
    ],
    [{ name: MODEL, digest: 'sha256:' + DIGEST }],
    [{ name: MODEL }],
  ])
    assert.throws(() => parse(LocalModelsConfigSchema, { ...base, models }));
  assert.throws(
    () =>
      new OllamaAdapter({
        base_url: 'http://127.0.0.1:11434',
        pin: { name: 'example:cloud', digest: DIGEST },
      }),
    /cloud/,
  );
});

test('the inventory keeps what the server reported and leaves the rest null', async () => {
  const s = await fakeOllama({
    'GET /api/version': json(200, { version: '0.0.0-fake' }),
    'GET /api/tags': tags([
      installed(),
      { name: 'bare:1', digest: OTHER },
      { name: 'far:1', digest: OTHER, remote_host: 'https://example.invalid' },
      { model: 'x' },
      'junk',
    ]),
  });
  try {
    const c = new OllamaClient(s.url);
    assert.equal(await c.version(), '0.0.0-fake');
    const inv = await c.inventory();
    assert.equal(inv.kind, 'ok');
    if (inv.kind !== 'ok') return;
    assert.deepEqual(inv.models, [
      {
        name: MODEL,
        digest: DIGEST,
        size_bytes: 123,
        family: 'example-family',
        parameter_size: '1B',
        quantization_level: 'Q4_K_M',
        remote: false,
      },
      {
        name: 'bare:1',
        digest: OTHER,
        size_bytes: null,
        family: null,
        parameter_size: null,
        quantization_level: null,
        remote: false,
      },
      {
        name: 'far:1',
        digest: OTHER,
        size_bytes: null,
        family: null,
        parameter_size: null,
        quantization_level: null,
        remote: true,
      },
      {
        name: 'x',
        digest: null,
        size_bytes: null,
        family: null,
        parameter_size: null,
        quantization_level: null,
        remote: false,
      },
    ]);
  } finally {
    await s.close();
  }
});

test('the pin check names each way a model can be unusable', async () => {
  const pin = { name: MODEL, digest: DIGEST };
  const cases: [unknown[] | Handler, string][] = [
    [[installed()], 'ready'],
    [[], 'not_installed'],
    [[installed(OTHER)], 'digest_changed'],
    [[installed(DIGEST, { remote_model: 'elsewhere' })], 'remote_model'],
    [json(200, { nothing: true }), 'malformed'],
    [json(500, { error: 'boom' }), 'malformed'],
  ];
  for (const [answer, status] of cases) {
    const s = await fakeOllama({
      'GET /api/tags': Array.isArray(answer) ? tags(answer) : answer,
    });
    try {
      const check = await new OllamaClient(s.url).check(pin);
      assert.equal(check.status, status);
      assert.equal(check.pinned_digest, DIGEST);
    } finally {
      await s.close();
    }
  }
  // A port nobody listens on.
  const gone = await fakeOllama({});
  const url = gone.url;
  await gone.close();
  const check = await new OllamaClient(url).check(pin);
  assert.equal(check.status, 'unreachable');
  assert.equal(check.installed_digest, null);
});

test('a call checks the pin, then sends one non-streamed chat without tools', async () => {
  const s = await fakeOllama({
    'GET /api/tags': tags([installed()]),
    'POST /api/chat': json(200, chatAnswer()),
  });
  try {
    const out = await adapter(s.url, { context_tokens: 8192 }).call(
      request(),
      signal(),
    );
    assert.deepEqual(out, {
      kind: 'completed',
      response_id: null,
      text: '{"ok":true}',
      vector: null,
      usage: {
        uncached_input_tokens: 30,
        cached_input_tokens: 10,
        cache_write_tokens: 0,
        output_tokens: 7,
        reasoning_tokens: 0,
        tool_calls: {},
      },
      incomplete_reason: null,
    });
    assert.deepEqual(
      s.seen.map((r) => `${r.method} ${r.path}`),
      ['GET /api/tags', 'POST /api/chat'],
    );
    assert.deepEqual(s.seen[1]!.body, {
      model: MODEL,
      messages: [
        { role: 'system', content: 'Answer in JSON.' },
        { role: 'user', content: 'Say ok.' },
      ],
      stream: false,
      think: false,
      format: 'json',
      options: { num_predict: 256, num_ctx: 8192 },
    });
  } finally {
    await s.close();
  }
});

test('text output sends no format and leaves the context size to the model', async () => {
  const s = await fakeOllama({
    'GET /api/tags': tags([installed()]),
    'POST /api/chat': json(
      200,
      chatAnswer({
        done_reason: 'length',
        prompt_eval_cached_count: undefined,
      }),
    ),
  });
  try {
    const out = await adapter(s.url).call(
      request({ output_format: 'text', action: 'model.summarize' }),
      signal(),
    );
    assert.equal(out.kind, 'completed');
    if (out.kind !== 'completed') return;
    assert.equal(out.incomplete_reason, 'max_output_tokens');
    assert.equal(out.usage.cached_input_tokens, 0);
    assert.equal(out.usage.uncached_input_tokens, 40);
    assert.deepEqual(s.seen[1]!.body, {
      model: MODEL,
      messages: [
        { role: 'system', content: 'Answer in JSON.' },
        { role: 'user', content: 'Say ok.' },
      ],
      stream: false,
      think: false,
      options: { num_predict: 256 },
    });
  } finally {
    await s.close();
  }
});

test('a model that is not ready is refused, with its status, before any chat is sent', async () => {
  const cases: [Handler | null, string][] = [
    [tags([installed(OTHER)]), 'digest_changed'],
    [tags([]), 'not_installed'],
    [
      tags([installed(DIGEST, { remote_host: 'https://example.invalid' })]),
      'remote_model',
    ],
    [json(200, { nothing: true }), 'malformed'],
    // Nothing listens: still a definite refusal, because no chat was sent.
    [null, 'unreachable'],
  ];
  for (const [answer, status] of cases) {
    const s = await fakeOllama({
      ...(answer ? { 'GET /api/tags': answer } : {}),
      'POST /api/chat': json(200, chatAnswer()),
    });
    const url = s.url;
    if (!answer) await s.close();
    try {
      const out = await adapter(url).call(request(), signal());
      assert.equal(out.kind, 'rejected', status);
      assert.equal(
        'reason_code' in out ? out.reason_code : null,
        'unsupported',
      );
      assert.ok(
        out.kind === 'rejected' && out.message.startsWith(`${status}: `),
      );
      assert.equal(
        s.seen.some((r) => r.path === OLLAMA_PATHS.chat),
        false,
      );
    } finally {
      if (answer) await s.close();
    }
  }
});

test('a cached count above the prompt count keeps the answer (provisional reading)', async () => {
  const s = await fakeOllama({
    'GET /api/tags': tags([installed()]),
    'POST /api/chat': json(200, chatAnswer({ prompt_eval_cached_count: 41 })),
  });
  try {
    const out = await adapter(s.url).call(request(), signal());
    assert.equal(out.kind, 'completed');
    if (out.kind !== 'completed') return;
    assert.equal(out.usage.uncached_input_tokens, 40);
    assert.equal(out.usage.cached_input_tokens, 41);
  } finally {
    await s.close();
  }
});

test('requests the adapter cannot serve are refused without contacting the server', async () => {
  const s = await fakeOllama({ 'GET /api/tags': tags([installed()]) });
  try {
    const a = adapter(s.url);
    for (const r of [
      request({ action: 'model.embed' }),
      request({ action: 'tool.search_public' }),
      request({ tool: 'search_public' }),
      request({ model_id: 'another:1b' }),
    ]) {
      const out = await a.call(r, signal());
      assert.equal(out.kind, 'rejected');
    }
    assert.deepEqual(s.seen, []);
  } finally {
    await s.close();
  }
});

test('server answers map to refused, unknown or malformed, never to a made-up success', async () => {
  const big = 'x'.repeat(8 * 1024 * 1024 + 10);
  const cases: [Handler, string, string][] = [
    [
      json(404, { error: "model 'example-family:small' not found" }),
      'rejected',
      'invalid_request',
    ],
    [json(400, { error: 'bad' }), 'rejected', 'invalid_request'],
    [json(500, { error: 'boom' }), 'unknown', 'provider_error'],
    [
      (_q, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('not json');
      },
      'unknown',
      'malformed_response',
    ],
    [
      (_q, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(big);
      },
      'unknown',
      'malformed_response',
    ],
    [
      json(200, chatAnswer({ model: 'another:1b' })),
      'unknown',
      'malformed_response',
    ],
    [json(200, chatAnswer({ done: false })), 'unknown', 'malformed_response'],
    [
      json(200, chatAnswer({ eval_count: undefined })),
      'unknown',
      'malformed_response',
    ],
  ];
  for (const [handler, kind, reason] of cases) {
    const s = await fakeOllama({
      'GET /api/tags': tags([installed()]),
      'POST /api/chat': handler,
    });
    try {
      const out = await adapter(s.url).call(request(), signal());
      assert.equal(out.kind, kind);
      assert.equal('reason_code' in out ? out.reason_code : null, reason);
    } finally {
      await s.close();
    }
  }
});

test('a redirect is never followed', async () => {
  const elsewhere = await fakeOllama({
    'POST /api/chat': json(200, chatAnswer()),
  });
  const s = await fakeOllama({
    'GET /api/tags': tags([installed()]),
    'POST /api/chat': (_q, res) => {
      res.writeHead(307, { location: `${elsewhere.url}/api/chat` });
      res.end();
    },
  });
  try {
    const out = await adapter(s.url).call(request(), signal());
    assert.equal(out.kind, 'rejected');
    assert.deepEqual(elsewhere.seen, []);
  } finally {
    await s.close();
    await elsewhere.close();
  }
});

test('a slow model times out as unknown; the caller cancelling throws', async () => {
  const s = await fakeOllama({
    'GET /api/tags': tags([installed()]),
    // Never answers.
    'POST /api/chat': () => undefined,
  });
  try {
    const out = await adapter(s.url, { request_timeout_ms: 200 }).call(
      request(),
      signal(),
    );
    assert.deepEqual(out, {
      kind: 'unknown',
      reason_code: 'network_error',
      message: 'The local model did not finish in time.',
    });
    const ac = new AbortController();
    const pending = adapter(s.url).call(request(), ac.signal);
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(pending);
  } finally {
    await s.close();
  }
});

test('only the version, model list and chat paths were ever requested', () => {
  const allowed = new Set<string>(Object.values(OLLAMA_PATHS));
  assert.ok(allSeen.length > 0);
  for (const r of allSeen) {
    assert.ok(allowed.has(r.path), r.path);
    assert.equal(r.method === 'POST', r.path === OLLAMA_PATHS.chat, r.path);
  }
});
