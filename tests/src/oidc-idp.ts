import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

/** A free loopback port for a server that must know its own address before it starts. */
export async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return address.port;
}

/**
 * A minimal local OIDC identity provider for tests (authorization code + PKCE); signing uses
 * jose, not our own crypto. `subject` is the identity the next sign-in returns.
 */
export async function testIdp() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  const codes = new Map<
    string,
    { challenge: string; nonce: string; sub: string }
  >();
  const state = { subject: 'owner-subject', issuer: '' };
  const idp = createServer((req, res) => {
    const issuer = state.issuer;
    const url = new URL(req.url ?? '/', issuer);
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const code = randomUUID();
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge') ?? '',
        nonce: url.searchParams.get('nonce') ?? '',
        sub: state.subject,
      });
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === '/token') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        void (async () => {
          const form = new URLSearchParams(raw);
          const grant = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          const verifier = form.get('code_verifier') ?? '';
          if (
            !grant ||
            createHash('sha256').update(verifier).digest('base64url') !==
              grant.challenge
          )
            return send(400, { error: 'invalid_grant' });
          const id_token = await new SignJWT({ nonce: grant.nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(issuer)
            .setAudience('creator-local')
            .setSubject(grant.sub)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey);
          send(200, {
            access_token: randomUUID(),
            token_type: 'Bearer',
            expires_in: 300,
            id_token,
          });
        })();
      });
      return;
    }
    send(404, {});
  });
  state.issuer = `http://127.0.0.1:${await listen(idp)}`;
  return {
    state,
    close: () => new Promise<void>((r) => idp.close(() => r())),
  };
}

/** Runs one browser-style OIDC sign-in against the API; returns the callback and its answer. */
export async function oidcSignIn(base: string) {
  const start = await fetch(`${base}/auth/oidc/login`, { redirect: 'manual' });
  if (start.status !== 302) throw new Error(`login start ${start.status}`);
  const authorize = new URL(start.headers.get('location') ?? '');
  const atIdp = await fetch(authorize, { redirect: 'manual' });
  const callback = atIdp.headers.get('location') ?? '';
  return {
    authorize,
    callback,
    response: await fetch(callback, { redirect: 'manual' }),
  };
}
