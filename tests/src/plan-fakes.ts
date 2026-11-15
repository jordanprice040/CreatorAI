import { createServer, type Server } from 'node:http';
import {
  generateKeyPairSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';

// Loopback stand-in for the Sign in with ChatGPT authorization server and the plan Responses
// route. It follows the documented contract only; it proves our side, never OpenAI's.

export interface FakePlanOptions {
  /** Scopes granted at the token endpoint (default: all requested). */
  scope?: string;
  /** Responses route behaviour for each call, in order; the last repeats. */
  responses?: (
    | { kind: 'text'; text: string }
    | { kind: 'error'; status: number; code: string; param?: string }
    | { kind: 'cut'; text: string }
  )[];
  /** Refresh-token behaviour. */
  refresh?: 'rotate' | 'invalid_grant' | 'down';
  subject?: string;
  nonce_override?: string;
  /** Awaited before each Responses answer, so a test can hold a request in flight. */
  beforeResponse?: () => Promise<void>;
  /** When set, answers each Responses request from its body instead of `responses`. */
  respond?: (
    body: Record<string, unknown>,
  ) => string | { kind: 'error'; status: number; code: string; param?: string };
}

export interface FakePlan {
  auth_base: string;
  api_base: string;
  tokenRequests: Record<string, string>[];
  responseRequests: { auth: string; body: Record<string, unknown> }[];
  revoked: string[];
  issuedClient: string;
  /** Simulates the browser: follows the authorization URL to the loopback callback. */
  approve(url: string, override?: Record<string, string>): Promise<number>;
  close(): Promise<void>;
}

const b64 = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString('base64url');
function jwt(key: KeyObject, claims: Record<string, unknown>) {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = b64(claims);
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString(
    'base64url',
  );
  return `${head}.${body}.${sig}`;
}

export async function fakePlan(o: FakePlanOptions = {}): Promise<FakePlan> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid: 'k1',
    alg: 'RS256',
    use: 'sig',
  };
  const issuedClient = `app_${randomBytes(6).toString('hex')}`;
  const codes = new Map<string, { nonce: string; client: string }>();
  const tokenRequests: Record<string, string>[] = [];
  const responseRequests: { auth: string; body: Record<string, unknown> }[] =
    [];
  const revoked: string[] = [];
  let calls = 0;
  let refreshSerial = 0;
  let base = '';
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', async () => {
      const json = (status: number, v: unknown) =>
        res
          .writeHead(status, { 'content-type': 'application/json' })
          .end(JSON.stringify(v));
      if (u.pathname === '/.well-known/openid-configuration')
        return json(200, {
          issuer: base,
          jwks_uri: `${base}/jwks`,
          revocation_endpoint: `${base}/oauth/revoke`,
        });
      if (u.pathname === '/jwks') return json(200, { keys: [jwk] });
      if (u.pathname === '/api/accounts/authorize') {
        const q = u.searchParams;
        const code = randomBytes(12).toString('hex');
        const client =
          q.get('client_id') === 'dynamic_agent_client'
            ? issuedClient
            : q.get('client_id')!;
        codes.set(code, { nonce: q.get('nonce')!, client });
        const to = new URL(q.get('redirect_uri')!);
        to.searchParams.set('code', code);
        to.searchParams.set('state', q.get('state')!);
        to.searchParams.set('client_id', client);
        res.writeHead(302, { location: to.toString() }).end();
        return;
      }
      if (u.pathname === '/api/accounts/oauth/token') {
        const f = Object.fromEntries(new URLSearchParams(raw));
        tokenRequests.push(f);
        const scope =
          o.scope ??
          'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
        if (f.grant_type === 'authorization_code') {
          const c = codes.get(f.code ?? '');
          if (!c || c.client !== f.client_id)
            return json(400, { error: 'invalid_grant' });
          codes.delete(f.code!);
          return json(200, {
            token_type: 'Bearer',
            access_token: `at-${randomBytes(16).toString('hex')}`,
            refresh_token: `rt-${refreshSerial++}-${randomBytes(8).toString('hex')}`,
            expires_in: 3600,
            scope,
            id_token: jwt(privateKey, {
              iss: base,
              aud: c.client,
              sub: o.subject ?? 'user-1',
              email: 'owner@example.test',
              exp: Math.floor(Date.now() / 1000) + 600,
              nonce: o.nonce_override ?? c.nonce,
            }),
          });
        }
        if (f.grant_type === 'refresh_token') {
          if (o.refresh === 'down')
            return json(503, { error: 'temporarily_unavailable' });
          if (o.refresh === 'invalid_grant')
            return json(400, { error: 'invalid_grant' });
          return json(200, {
            token_type: 'Bearer',
            access_token: `at-${randomBytes(16).toString('hex')}`,
            refresh_token: `rt-${refreshSerial++}-${randomBytes(8).toString('hex')}`,
            expires_in: 3600,
            scope,
          });
        }
        return json(400, { error: 'unsupported_grant_type' });
      }
      if (u.pathname === '/oauth/revoke') {
        revoked.push(new URLSearchParams(raw).get('token') ?? '');
        return res.writeHead(200).end();
      }
      if (u.pathname === '/v1/responses' && req.method === 'POST') {
        const body = JSON.parse(raw) as Record<string, unknown>;
        responseRequests.push({
          auth: String(req.headers.authorization),
          body,
        });
        await o.beforeResponse?.();
        const list = o.responses ?? [{ kind: 'text', text: 'ok' }];
        const answered = o.respond?.(body);
        const step =
          answered === undefined
            ? list[Math.min(calls++, list.length - 1)]!
            : typeof answered === 'string'
              ? { kind: 'text' as const, text: answered }
              : answered;
        if (o.respond) calls++;
        if (step.kind === 'error')
          return json(step.status, {
            error: { code: step.code, param: step.param ?? null, message: 'x' },
          });
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-request-id': `req_${calls}`,
        });
        const ev = (v: Record<string, unknown>) =>
          res.write(`data: ${JSON.stringify(v)}\n\n`);
        ev({ type: 'response.created', response: { id: `resp_${calls}` } });
        for (const ch of step.text.match(/.{1,40}/gs) ?? [])
          ev({ type: 'response.output_text.delta', delta: ch });
        if (step.kind === 'cut') return res.end();
        ev({
          type: 'response.completed',
          response: { id: `resp_${calls}`, usage: { output_tokens: 2 } },
        });
        return res.end();
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    auth_base: base,
    api_base: `${base}/v1`,
    tokenRequests,
    responseRequests,
    revoked,
    issuedClient,
    async approve(url, override) {
      const r = await fetch(url, { redirect: 'manual' });
      const to = new URL(r.headers.get('location')!);
      for (const [k, v] of Object.entries(override ?? {}))
        to.searchParams.set(k, v);
      return (await fetch(to)).status;
    },
    close: () =>
      new Promise((ok) => {
        server.close(() => ok());
        server.closeAllConnections();
      }),
  };
}
