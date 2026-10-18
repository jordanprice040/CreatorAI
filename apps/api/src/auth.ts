import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as oidc from 'openid-client';
import {
  ContractError,
  DevLoginRequestSchema,
  parse,
  type SessionInfo,
} from '@creator/contracts';
import type { AuthConfig } from '@creator/domain';
import type { OversightStore } from '@creator/db';

const digest = (v: string) => createHash('sha256').update(v).digest();
/** Constant-time comparison of two secrets of any length. */
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

function cookies(req: IncomingMessage): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0) jar.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return jar;
}

/**
 * Owner sessions: an opaque random token in an HttpOnly, SameSite=Strict cookie, stored only
 * as a hash, plus a per-session CSRF token that every state-changing request must echo. Login
 * is either the local development code or OIDC (authorization code + PKCE via openid-client).
 */
export function createAuth(
  config: AuthConfig,
  store: OversightStore | null,
  ownerId: string,
) {
  const cookieName = config.cookie_secure
    ? '__Host-creator_session'
    : 'creator_session';
  // Printed once at startup when not supplied; never stored or logged elsewhere.
  const generatedCode =
    config.mode === 'dev_local' && !config.dev_login_code
      ? randomBytes(24).toString('base64url')
      : null;
  const devCode = config.dev_login_code ?? generatedCode;
  let failures = 0;
  let lockedUntil = 0;
  let discovered: Promise<oidc.Configuration> | null = null;

  function requireStore(): OversightStore {
    if (!store)
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        'Sign-in needs PostgreSQL; set CREATOR_DATABASE_URL.',
      );
    return store;
  }
  function setCookie(res: ServerResponse, token: string, expiresAt: string) {
    const maxAge = Math.max(
      0,
      Math.floor((Date.parse(expiresAt) - Date.now()) / 1000),
    );
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.cookie_secure ? '; Secure' : ''}`,
    );
  }
  function clearCookie(res: ServerResponse) {
    res.setHeader(
      'Set-Cookie',
      `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.cookie_secure ? '; Secure' : ''}`,
    );
  }
  async function current(req: IncomingMessage): Promise<SessionInfo | null> {
    const token = cookies(req).get(cookieName);
    return token ? requireStore().session(token) : null;
  }
  /** Backend authorization: every record and decision route resolves the actor from here. */
  async function require(
    req: IncomingMessage,
    mutating: boolean,
  ): Promise<SessionInfo> {
    const session = await current(req);
    if (!session)
      throw new ContractError('UNAUTHENTICATED', 'Sign in to continue.');
    if (mutating) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !same(sent, session.csrf_token))
        throw new ContractError(
          'CSRF_DENIED',
          'Missing or wrong X-CSRF-Token for this session.',
        );
    }
    return session;
  }
  function oidcConfig() {
    const o = config.oidc;
    if (!o) throw new ContractError('NOT_FOUND', 'OIDC is not configured.');
    discovered ??= oidc
      .discovery(
        new URL(o.issuer),
        o.client_id,
        o.client_secret ?? undefined,
        o.client_secret ? oidc.ClientSecretPost(o.client_secret) : oidc.None(),
        {
          // Plain-http issuers are accepted only on loopback (checked in authConfig).
          execute: o.issuer.startsWith('http:')
            ? [oidc.allowInsecureRequests]
            : [],
        },
      )
      .catch((e: unknown) => {
        discovered = null;
        throw e;
      });
    return discovered;
  }

  /** Handles /api/auth/*; returns false for other paths. */
  async function route(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    readJson: () => Promise<unknown>,
    respond: (status: number, value: unknown) => void,
  ): Promise<boolean> {
    if (!url.pathname.startsWith('/api/auth/')) return false;
    const path = url.pathname.slice('/api/auth/'.length);
    const method = req.method ?? 'GET';
    if (method === 'GET' && path === 'status') {
      respond(200, {
        mode: config.mode,
        available: store !== null,
        login_path:
          config.mode === 'oidc'
            ? '/api/auth/oidc/login'
            : '/api/auth/dev-login',
      });
      return true;
    }
    const s = requireStore();
    if (method === 'GET' && path === 'session') {
      const session = await current(req);
      if (!session)
        throw new ContractError('UNAUTHENTICATED', 'Not signed in.');
      respond(200, session);
      return true;
    }
    if (method === 'POST' && path === 'logout') {
      await require(req, true);
      const token = cookies(req).get(cookieName);
      if (token) await s.endSession(token);
      clearCookie(res);
      respond(200, { signed_out: true });
      return true;
    }
    if (method === 'POST' && path === 'dev-login') {
      if (config.mode !== 'dev_local' || !devCode)
        throw new ContractError(
          'NOT_FOUND',
          'Development login is disabled in this mode.',
        );
      if (Date.now() < lockedUntil)
        throw new ContractError(
          'ACCESS_DENIED',
          'Too many wrong codes; wait 30 seconds.',
        );
      const { code } = parse(DevLoginRequestSchema, await readJson());
      if (!same(code, devCode)) {
        if (++failures >= 5) {
          failures = 0;
          lockedUntil = Date.now() + 30_000;
        }
        throw new ContractError('UNAUTHENTICATED', 'Wrong login code.');
      }
      failures = 0;
      const { token, session } = await s.createSession(
        ownerId,
        'dev_local',
        null,
        config.session_hours,
      );
      setCookie(res, token, session.expires_at);
      respond(200, session);
      return true;
    }
    if (method === 'GET' && path === 'oidc/login') {
      const o = await oidcConfig();
      const verifier = oidc.randomPKCECodeVerifier();
      const state = oidc.randomState();
      const nonce = oidc.randomNonce();
      await s.saveOidcLogin(state, verifier, nonce);
      const target = oidc.buildAuthorizationUrl(o, {
        redirect_uri: config.oidc!.redirect_uri,
        scope: 'openid',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      res.writeHead(302, {
        Location: target.href,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }
    if (method === 'GET' && path === 'oidc/callback') {
      const o = await oidcConfig();
      const state = url.searchParams.get('state') ?? '';
      const login = await s.takeOidcLogin(state);
      if (!login)
        throw new ContractError(
          'UNAUTHENTICATED',
          'Unknown, used or expired sign-in attempt.',
        );
      const callback = new URL(config.oidc!.redirect_uri);
      callback.search = url.search;
      let claims;
      try {
        const tokens = await oidc.authorizationCodeGrant(o, callback, {
          pkceCodeVerifier: login.code_verifier,
          expectedState: state,
          expectedNonce: login.nonce,
          idTokenExpected: true,
        });
        claims = tokens.claims();
      } catch {
        throw new ContractError(
          'UNAUTHENTICATED',
          'The identity provider response did not verify.',
        );
      }
      if (!claims || claims.sub !== config.oidc!.owner_subject)
        throw new ContractError(
          'ACCESS_DENIED',
          'This identity is not the workspace owner.',
        );
      const { token, session } = await s.createSession(
        ownerId,
        'oidc',
        `${claims.iss}|${claims.sub}`,
        config.session_hours,
      );
      setCookie(res, token, session.expires_at);
      res.writeHead(302, {
        Location: `${config.oidc!.web_origin}/`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }
    throw new ContractError('NOT_FOUND', 'Route not found.');
  }
  return { route, require, generatedCode, mode: config.mode };
}
