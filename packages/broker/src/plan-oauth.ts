import {
  createHash,
  createPublicKey,
  randomBytes,
  verify as verifySignature,
  type JsonWebKey,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';

// Sign in with ChatGPT with ChatGPT plan usage, for a locally hosted app (official docs read
// 2026-10-20: developers.openai.com/siwc/token-sharing-open-source/*). System browser, PKCE
// S256, fresh state and nonce, 127.0.0.1 loopback callback, ID token checked against the
// published JWKS. No client secret exists in this flow.

export const PLAN_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct';
export const PLAN_RESOURCE = 'https://api.openai.com/v1';
export const DYNAMIC_CLIENT = 'dynamic_agent_client';
/** Used consistently across installations, and only on first registration. */
export const AGENT_NAME_HINT = 'Creator Agent';
export const CALLBACK_PATH = '/auth/callback';
export const PREFERRED_CALLBACK_PORT = 1455;

export interface PlanEndpoints {
  /** https://auth.openai.com, or a loopback stand-in in fixture workspaces and tests. */
  auth_base: string;
  /** https://api.openai.com/v1, or a loopback stand-in. */
  api_base: string;
}
export const OFFICIAL_PLAN_ENDPOINTS: PlanEndpoints = {
  auth_base: 'https://auth.openai.com',
  api_base: PLAN_RESOURCE,
};
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
/** Official endpoints always; loopback http only where the caller allows stand-ins. */
export function checkedEndpoints(
  e: PlanEndpoints,
  allowLoopback: boolean,
): PlanEndpoints {
  const ok = (raw: string, official: string) => {
    const u = new URL(raw);
    const norm = u.toString().replace(/\/$/, '');
    if (norm === official) return norm;
    if (allowLoopback && u.protocol === 'http:' && LOOPBACK.has(u.hostname))
      return norm;
    throw new Error(
      'ChatGPT plan endpoints must be the official OpenAI hosts.',
    );
  };
  return {
    auth_base: ok(e.auth_base, OFFICIAL_PLAN_ENDPOINTS.auth_base),
    api_base: ok(e.api_base, OFFICIAL_PLAN_ENDPOINTS.api_base),
  };
}

const b64url = (b: Buffer) => b.toString('base64url');
export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  return {
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
  };
}

export interface AuthorizationAttempt {
  url: string;
  state: string;
  nonce: string;
  verifier: string;
  redirect_uri: string;
  /** The issued client id this attempt must end with; null for first registration. */
  client_id: string | null;
}
export function authorizationUrl(o: {
  endpoints: PlanEndpoints;
  host_id: string;
  redirect_uri: string;
  client_id: string | null;
  id_token_hint?: string | null;
  login_hint?: string | null;
}): AuthorizationAttempt {
  const { verifier, challenge } = pkcePair();
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const u = new URL(`${o.endpoints.auth_base}/api/accounts/authorize`);
  const q = u.searchParams;
  q.set('client_id', o.client_id ?? DYNAMIC_CLIENT);
  if (!o.client_id) q.set('agent_name_hint', AGENT_NAME_HINT);
  q.set('ext_agent_host_id', o.host_id);
  if (o.client_id && o.id_token_hint) q.set('id_token_hint', o.id_token_hint);
  if (o.client_id && o.login_hint) q.set('login_hint', o.login_hint);
  q.set('response_type', 'code');
  q.set('redirect_uri', o.redirect_uri);
  q.set('scope', PLAN_SCOPES);
  q.set('resource', PLAN_RESOURCE);
  q.set('state', state);
  q.set('nonce', nonce);
  q.set('code_challenge_method', 'S256');
  q.set('code_challenge', challenge);
  return {
    url: u.toString(),
    state,
    nonce,
    verifier,
    redirect_uri: o.redirect_uri,
    client_id: o.client_id,
  };
}

export interface CallbackResult {
  code: string;
  client_id: string;
  scope: string | null;
}
export class PlanAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Listens on 127.0.0.1 before the browser opens. Prefers 1455; later sign-ins may use any
 * free port because only the port may vary. Resolves once with the validated callback.
 */
export async function loopbackCallback(
  attempt: () => AuthorizationAttempt | null,
  opts: {
    port?: number;
    timeout_ms: number;
  },
): Promise<{
  redirect_uri: string;
  result: Promise<CallbackResult>;
  close: () => void;
}> {
  let settle!: (r: CallbackResult) => void, reject!: (e: Error) => void;
  const result = new Promise<CallbackResult>(
    (a, b) => ((settle = a), (reject = b)),
  );
  result.catch(() => {});
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || u.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }
    const a = attempt();
    const done = (status: number, text: string) => {
      res.writeHead(status, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(text);
    };
    if (!a || u.searchParams.get('state') !== a.state) {
      done(
        400,
        'This sign-in link is not the one Creator Agent started. Close this tab.',
      );
      return;
    }
    const error = u.searchParams.get('error');
    if (error) {
      done(200, 'ChatGPT sign-in was not completed. You can close this tab.');
      reject(
        new PlanAuthError(
          error === 'access_denied'
            ? 'consent_declined'
            : 'authorization_error',
          `Authorization returned ${error.slice(0, 80)}.`,
        ),
      );
      return;
    }
    const code = u.searchParams.get('code');
    const issued = u.searchParams.get('client_id');
    if (!code) {
      done(400, 'The sign-in response had no code.');
      reject(new PlanAuthError('no_code', 'Authorization returned no code.'));
      return;
    }
    let clientId: string;
    if (a.client_id) {
      if (issued && issued !== a.client_id) {
        done(
          400,
          'The sign-in returned a different registration. Close this tab.',
        );
        reject(
          new PlanAuthError(
            'client_mismatch',
            'The callback named a different client id.',
          ),
        );
        return;
      }
      clientId = a.client_id;
    } else {
      if (!issued || issued === DYNAMIC_CLIENT) {
        done(
          400,
          'Registration did not complete. Close this tab and try again.',
        );
        reject(
          new PlanAuthError(
            'registration_incomplete',
            'New registration returned no issued client id.',
          ),
        );
        return;
      }
      clientId = issued;
    }
    done(200, 'Signed in. You can close this tab and return to Creator Agent.');
    settle({ code, client_id: clientId, scope: u.searchParams.get('scope') });
  });
  const listen = (port: number) =>
    new Promise<void>((ok, bad) => {
      server.once('error', bad);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', bad);
        ok();
      });
    });
  try {
    await listen(opts.port ?? PREFERRED_CALLBACK_PORT);
  } catch {
    await listen(0);
  }
  const port = (server.address() as { port: number }).port;
  const timer = setTimeout(
    () =>
      reject(new PlanAuthError('timeout', 'Sign-in was not finished in time.')),
    opts.timeout_ms,
  );
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections?.();
  };
  result.finally(close).catch(() => {});
  return {
    redirect_uri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
    result,
    close,
  };
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string | null;
  id_token: string | null;
  expires_in: number;
  scope: string[];
}
function tokenResponse(body: Record<string, unknown>): TokenResponse {
  const at = body.access_token;
  if (
    typeof at !== 'string' ||
    at.length < 20 ||
    body.token_type?.toString().toLowerCase() !== 'bearer'
  )
    throw new PlanAuthError(
      'malformed_token_response',
      'The token response was not usable.',
    );
  const expires = Number(body.expires_in);
  return {
    access_token: at,
    refresh_token:
      typeof body.refresh_token === 'string' ? body.refresh_token : null,
    id_token: typeof body.id_token === 'string' ? body.id_token : null,
    expires_in: Number.isFinite(expires) && expires > 0 ? expires : 3600,
    scope:
      typeof body.scope === 'string'
        ? body.scope.split(' ').filter(Boolean)
        : [],
  };
}
async function postForm(
  url: string,
  form: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(form).toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { status: res.status, body };
}
const errorCode = (b: Record<string, unknown>) =>
  typeof b.error === 'string'
    ? b.error.slice(0, 80)
    : typeof b.code === 'string'
      ? b.code.slice(0, 80)
      : 'error';

export async function exchangeCode(o: {
  endpoints: PlanEndpoints;
  client_id: string;
  code: string;
  verifier: string;
  redirect_uri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const r = await postForm(
    `${o.endpoints.auth_base}/api/accounts/oauth/token`,
    {
      grant_type: 'authorization_code',
      client_id: o.client_id,
      code: o.code,
      code_verifier: o.verifier,
      redirect_uri: o.redirect_uri,
      resource: PLAN_RESOURCE,
    },
    o.fetchImpl ?? fetch,
  );
  if (r.status !== 200)
    throw new PlanAuthError(
      errorCode(r.body),
      `Code exchange failed (${r.status}).`,
    );
  return tokenResponse(r.body);
}

/** Codes after which the refresh token is unusable and the owner must sign in again. */
export const TERMINAL_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
  'invalid_client',
]);
export async function refreshTokens(o: {
  endpoints: PlanEndpoints;
  client_id: string;
  refresh_token: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const r = await postForm(
    `${o.endpoints.auth_base}/api/accounts/oauth/token`,
    {
      grant_type: 'refresh_token',
      client_id: o.client_id,
      refresh_token: o.refresh_token,
      resource: PLAN_RESOURCE,
    },
    o.fetchImpl ?? fetch,
  );
  if (r.status !== 200)
    throw new PlanAuthError(
      errorCode(r.body),
      `Token refresh failed (${r.status}).`,
    );
  return tokenResponse(r.body);
}

export interface Discovery {
  issuer: string;
  jwks_uri: string;
  revocation_endpoint: string | null;
}
export async function discover(
  endpoints: PlanEndpoints,
  fetchImpl: typeof fetch = fetch,
): Promise<Discovery> {
  const res = await fetchImpl(
    `${endpoints.auth_base}/.well-known/openid-configuration`,
    {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (res.status !== 200)
    throw new PlanAuthError(
      'discovery_failed',
      'OpenID configuration unavailable.',
    );
  const d = (await res.json()) as Record<string, unknown>;
  const same = (v: unknown) =>
    typeof v === 'string' &&
    new URL(v).origin === new URL(endpoints.auth_base).origin;
  if (typeof d.issuer !== 'string' || !same(d.jwks_uri))
    throw new PlanAuthError(
      'discovery_failed',
      'OpenID configuration is not usable.',
    );
  return {
    issuer: d.issuer,
    jwks_uri: d.jwks_uri as string,
    revocation_endpoint: same(d.revocation_endpoint)
      ? (d.revocation_endpoint as string)
      : null,
  };
}

export interface VerifiedIdentity {
  subject: string;
  email: string | null;
  issuer: string;
}
/** Verifies signature (RS256/ES256 via the published JWKS), issuer, audience, expiry and nonce. */
export async function verifyIdToken(o: {
  id_token: string;
  discovery: Discovery;
  client_id: string;
  nonce: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedIdentity> {
  const parts = o.id_token.split('.');
  if (parts.length !== 3)
    throw new PlanAuthError('id_token_invalid', 'Malformed ID token.');
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(
    Buffer.from(h, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  const claims = JSON.parse(
    Buffer.from(p, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  if (header.alg !== 'RS256' && header.alg !== 'ES256')
    throw new PlanAuthError(
      'id_token_invalid',
      'Unsupported ID token algorithm.',
    );
  const res = await (o.fetchImpl ?? fetch)(o.discovery.jwks_uri, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200)
    throw new PlanAuthError('jwks_unavailable', 'Signing keys unavailable.');
  const keys =
    ((await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] }).keys ??
    [];
  const jwk =
    keys.find((k) => k.kid === header.kid) ??
    (keys.length === 1 ? keys[0] : undefined);
  if (!jwk)
    throw new PlanAuthError(
      'id_token_invalid',
      'No signing key matches the ID token.',
    );
  const key = createPublicKey({ key: jwk, format: 'jwk' });
  const data = Buffer.from(`${h}.${p}`);
  const sig = Buffer.from(s, 'base64url');
  const ok =
    header.alg === 'RS256'
      ? verifySignature('RSA-SHA256', data, key, sig)
      : verifySignature(
          'sha256',
          data,
          { key, dsaEncoding: 'ieee-p1363' },
          sig,
        );
  if (!ok)
    throw new PlanAuthError(
      'id_token_invalid',
      'ID token signature is invalid.',
    );
  const now = Math.floor((o.now ?? new Date()).getTime() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== o.discovery.issuer)
    throw new PlanAuthError('id_token_invalid', 'ID token issuer mismatch.');
  if (!aud.includes(o.client_id))
    throw new PlanAuthError('id_token_invalid', 'ID token audience mismatch.');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60)
    throw new PlanAuthError('id_token_invalid', 'ID token expired.');
  if (claims.nonce !== o.nonce)
    throw new PlanAuthError('id_token_invalid', 'ID token nonce mismatch.');
  if (typeof claims.sub !== 'string' || !claims.sub)
    throw new PlanAuthError('id_token_invalid', 'ID token has no subject.');
  return {
    subject: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    issuer: claims.iss as string,
  };
}

/** Revokes the renewable session. An empty 200 is success, including for an invalid token. */
export async function revokeRefreshToken(o: {
  discovery: Discovery;
  client_id: string;
  refresh_token: string;
  fetchImpl?: typeof fetch;
  attempts?: number;
}): Promise<boolean> {
  if (!o.discovery.revocation_endpoint) return false;
  for (let i = 0; i < (o.attempts ?? 3); i++) {
    try {
      const r = await postForm(
        o.discovery.revocation_endpoint,
        {
          token: o.refresh_token,
          token_type_hint: 'refresh_token',
          client_id: o.client_id,
        },
        o.fetchImpl ?? fetch,
      );
      if (r.status === 200) return true;
      if (r.status < 500) return false;
    } catch {
      /* network: retry */
    }
    await new Promise((d) => setTimeout(d, 250 * 2 ** i));
  }
  return false;
}
