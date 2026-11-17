import { createPrivateKey, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  ContractError,
  GITHUB_API_VERSION,
  GITHUB_APP_SETUP_MS,
  type GitHubAppSetup,
  type GitHubConnection,
  type GitHubIdentity,
} from '@creator/contracts';
import type { CommandContext, GitHubStore } from '@creator/db';
import { appJwt } from './github.js';
import { newGitHubAppKeyRef, type PlanVault } from './plan-vault.js';
import { openSystemBrowser } from './plan-service.js';

// ADR-0132 (P32): create and install the studio's GitHub App from the browser (GitHub's App
// manifest flow, docs.github.com "Registering a GitHub App from a manifest", read 2026-11-17).
// A one-shot 127.0.0.1 listener serves the page that posts the app description to GitHub,
// receives GitHub's one-time code, exchanges it for the app's key (sealed in the protected
// vault at once) and sends the browser on to the installation page. The installation is then
// read with the app's own JWT; nothing GitHub's redirect says is trusted on its own.

export interface GitHubAppEndpoints {
  /** https://api.github.com, or a loopback stand-in in tests. */
  api: string;
  /** https://github.com, or a loopback stand-in in tests. */
  web: string;
}
export const OFFICIAL_GITHUB_ENDPOINTS: GitHubAppEndpoints = {
  api: 'https://api.github.com',
  web: 'https://github.com',
};
const LOOPBACK = new Set(['127.0.0.1', '[::1]', 'localhost']);
function checked(e: GitHubAppEndpoints, allowLoopback: boolean) {
  const ok = (raw: string, official: string) => {
    const u = new URL(raw);
    const norm = u.toString().replace(/\/$/, '');
    if (norm === official) return norm;
    if (allowLoopback && u.protocol === 'http:' && LOOPBACK.has(u.hostname))
      return norm;
    throw new Error('GitHub endpoints must be the official GitHub hosts.');
  };
  return {
    api: ok(e.api, OFFICIAL_GITHUB_ENDPOINTS.api),
    web: ok(e.web, OFFICIAL_GITHUB_ENDPOINTS.web),
  };
}

/**
 * Least privilege for what the studio's adapter calls (docs/GITHUB.md endpoint table). Workflow
 * files stay out: `github.workflow_change` needs the owner to add Workflows on GitHub later.
 */
export const GITHUB_APP_PERMISSIONS = {
  administration: 'write',
  contents: 'write',
  issues: 'write',
  pull_requests: 'write',
  checks: 'read',
  statuses: 'read',
  metadata: 'read',
} as const;
export const SETUP_PATHS = {
  start: '/github-app/start',
  created: '/github-app/created',
  installed: '/github-app/installed',
} as const;

/** The manifest GitHub registers: private, no webhook (the studio's API is loopback only). */
export function githubAppManifest(o: {
  name: string;
  redirect_url: string;
  setup_url: string;
}) {
  return {
    name: o.name,
    url: 'https://github.com',
    description:
      'Creator Agent studio on one computer: private repositories, branches, pull requests and checks it is allowed to use.',
    public: false,
    redirect_url: o.redirect_url,
    setup_url: o.setup_url,
    setup_on_update: false,
    request_oauth_on_install: false,
    default_permissions: { ...GITHUB_APP_PERMISSIONS },
    default_events: [] as string[],
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
/** The loopback page: one form that posts the manifest to GitHub, sent by a nonce'd script. */
export function startPage(o: { action: string; manifest: unknown }) {
  const nonce = randomBytes(16).toString('base64');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Create the Creator Agent GitHub App</title></head><body>
<p>Sending the app description to GitHub. If nothing happens, press the button.</p>
<form id="f" method="post" action="${esc(o.action)}">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(o.manifest))}">
<button type="submit">Continue to GitHub</button></form>
<script nonce="${nonce}">document.getElementById('f').submit();</script>
</body></html>`;
  const origin = new URL(o.action).origin;
  return {
    html,
    csp: `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${origin}; base-uri 'none'; frame-ancestors 'none'`,
  };
}

const IDENTITY_TYPES = new Set(['User', 'Organization']);
function identityOf(v: unknown): GitHubIdentity | null {
  const a = v as Record<string, unknown> | null | undefined;
  return a &&
    typeof a.login === 'string' &&
    typeof a.id === 'number' &&
    Number.isSafeInteger(a.id) &&
    IDENTITY_TYPES.has(String(a.type))
    ? { login: a.login, id: a.id, type: a.type as GitHubIdentity['type'] }
    : null;
}

/** GitHub's answer to the code exchange, checked field by field; the key is checked too. */
export function parseConversion(d: unknown): {
  app: NonNullable<GitHubAppSetup['app']>;
  pem: string;
} | null {
  const r = d as Record<string, unknown> | null;
  const owner = identityOf(r?.owner);
  if (
    !r ||
    !owner ||
    typeof r.id !== 'number' ||
    !Number.isSafeInteger(r.id) ||
    r.id < 1 ||
    typeof r.slug !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(r.slug) ||
    typeof r.client_id !== 'string' ||
    !/^[A-Za-z0-9._-]{1,100}$/.test(r.client_id) ||
    typeof r.pem !== 'string' ||
    typeof r.html_url !== 'string' ||
    !/^https?:\/\//.test(r.html_url)
  )
    return null;
  try {
    // Only that it is a private key; its text never reaches a message.
    createPrivateKey(r.pem);
  } catch {
    return null;
  }
  return {
    app: {
      id: r.id,
      slug: r.slug,
      client_id: r.client_id,
      name: typeof r.name === 'string' ? r.name.slice(0, 200) : r.slug,
      owner,
      html_url: r.html_url.slice(0, 500),
    },
    pem: r.pem,
  };
}

export interface GitHubAppSetupOptions {
  /** API process environment: CREATOR_GITHUB=live is required, as for every live connection. */
  env: Record<string, string | undefined>;
  vault: PlanVault | null;
  /** Tests only: loopback stand-ins for GitHub (official hosts otherwise). */
  endpoints?: GitHubAppEndpoints;
  allowLoopbackEndpoints?: boolean;
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void;
  /** Tests: shorter than GitHub's hour. */
  timeoutMs?: number;
}

interface Attempt {
  state: string;
  ctx: CommandContext;
  ws: string;
  setup_id: string;
  /** http://127.0.0.1:<port> of this attempt's listener. */
  local: string;
  /** Review M-1: the one code exchange; a second "created" request waits for it. */
  exchanging?:
    Promise<GitHubAppSetup | { status: number; text: string }> | undefined;
  close: () => void;
}

/**
 * ADR-0132: the three steps of the in-app GitHub App setup. Store methods hold every rule
 * (owner only, real workspace, forward-only status); this class talks to GitHub and the vault.
 */
export class GitHubAppSetupService {
  readonly #endpoints: GitHubAppEndpoints;
  readonly #fetch: typeof fetch;
  #attempts = new Map<string, Attempt>();
  constructor(
    private readonly store: GitHubStore,
    private readonly opts: GitHubAppSetupOptions,
  ) {
    this.#endpoints = checked(
      opts.endpoints ?? OFFICIAL_GITHUB_ENDPOINTS,
      opts.allowLoopbackEndpoints === true,
    );
    this.#fetch = opts.fetch ?? fetch;
  }
  #vault(): PlanVault {
    if (!this.opts.vault)
      throw new ContractError(
        'INVALID_CONFIG',
        'The studio has no protected place for the app key (on Windows the installed app sets one up).',
      );
    return this.opts.vault;
  }
  #live() {
    if ((this.opts.env.CREATOR_GITHUB ?? 'off') !== 'live')
      throw new ContractError(
        'LIVE_DISABLED',
        'Live GitHub is off (CREATOR_GITHUB=live is not set), so no GitHub App can be created.',
      );
  }
  async #github(method: string, path: string, auth?: string) {
    try {
      const res = await this.#fetch(`${this.#endpoints.api}${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': 'creator-agent-studio',
          ...(auth ? { Authorization: auth } : {}),
        },
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      return { status: res.status, data };
    } catch (e) {
      return {
        status: null,
        data: null,
        error: (e as Error).name === 'TimeoutError' ? 'timeout' : 'network',
      };
    }
  }

  /** Step 1: a waiting setup and a loopback page that sends the manifest to GitHub. */
  async begin(
    ctx: CommandContext,
    ws: string,
    o: { organization: string | null; open_browser: boolean },
  ) {
    this.#live();
    this.#vault();
    const setup = await this.store.beginGitHubAppSetup(ctx, ws, o.organization);
    for (const [id, a] of this.#attempts)
      if (a.ws === setup.workspace_id) {
        a.close();
        this.#attempts.delete(id);
      }
    const state = randomBytes(24).toString('base64url');
    const server = await this.#listen(setup.id);
    const port = (server.address() as { port: number }).port;
    const local = `http://127.0.0.1:${port}`;
    const timer = setTimeout(
      () => this.#closeAttempt(setup.id),
      this.opts.timeoutMs ?? GITHUB_APP_SETUP_MS,
    );
    timer.unref?.();
    this.#attempts.set(setup.id, {
      state,
      ctx,
      ws: setup.workspace_id,
      setup_id: setup.id,
      local,
      close: () => {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.();
      },
    });
    const start_url = `${local}${SETUP_PATHS.start}?state=${state}`;
    if (o.open_browser) (this.opts.openBrowser ?? openSystemBrowser)(start_url);
    return {
      setup,
      start_url,
      expires_in_s: Math.round(
        (this.opts.timeoutMs ?? GITHUB_APP_SETUP_MS) / 1000,
      ),
    };
  }
  #closeAttempt(id: string) {
    this.#attempts.get(id)?.close();
    this.#attempts.delete(id);
  }

  async #listen(setupId: string): Promise<Server> {
    const server = createServer((req, res) => {
      const done = (status: number, text: string, headers = {}) => {
        res.writeHead(status, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          ...headers,
        });
        res.end(text);
      };
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const a = this.#attempts.get(setupId);
      if (
        req.method !== 'GET' ||
        !Object.values(SETUP_PATHS).includes(u.pathname as never)
      ) {
        done(404, 'Not found.');
        return;
      }
      // Review L-2: GitHub's install redirect has no state when the installation was started
      // from GitHub or the studio's own link. Nothing is trusted from it; it only asks the app's
      // own JWT again (as Check installation does) and answers neutrally.
      if (
        u.pathname === SETUP_PATHS.installed &&
        u.searchParams.get('state') !== a?.state
      ) {
        if (a)
          void this.checkInstallation(a.ctx, a.ws, a.setup_id).catch(() => {});
        done(
          200,
          'Return to Creator Agent. If it does not show the installation yet, press Check installation there. You can close this tab.',
        );
        return;
      }
      if (!a || u.searchParams.get('state') !== a.state) {
        done(
          400,
          'This link is not the GitHub App setup Creator Agent started. Close this tab.',
        );
        return;
      }
      void this.#route(a, u)
        .then((r) => {
          if (r.close) res.once('finish', () => this.#closeAttempt(a.setup_id));
          return r.redirect
            ? done(302, 'Continuing to GitHub.', { Location: r.redirect })
            : r.html
              ? done(200, r.html.html, {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Content-Security-Policy': r.html.csp,
                })
              : done(r.status ?? 200, r.text ?? '');
        })
        .catch(() =>
          done(
            500,
            'Creator Agent could not finish this step. Return to the studio.',
          ),
        );
    });
    await new Promise<void>((ok, bad) => {
      server.once('error', bad);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', bad);
        ok();
      });
    });
    return server;
  }

  async #route(
    a: Attempt,
    u: URL,
  ): Promise<{
    redirect?: string;
    html?: { html: string; csp: string };
    text?: string;
    status?: number;
    /** Close the listener once this answer has been sent. */
    close?: boolean;
  }> {
    const local = a.local;
    if (u.pathname === SETUP_PATHS.start) {
      const setup = await this.store.getGitHubAppSetup(a.ctx, a.ws, a.setup_id);
      if (setup.status !== 'waiting_for_github')
        return {
          status: 409,
          text: 'This setup already went to GitHub. Return to Creator Agent.',
        };
      const where = setup.organization
        ? `/organizations/${setup.organization}/settings/apps/new`
        : '/settings/apps/new';
      return {
        html: startPage({
          action: `${this.#endpoints.web}${where}?state=${a.state}`,
          manifest: githubAppManifest({
            name: `Creator Agent ${randomBytes(3).toString('hex')}`,
            redirect_url: `${local}${SETUP_PATHS.created}`,
            setup_url: `${local}${SETUP_PATHS.installed}`,
          }),
        }),
      };
    }
    if (u.pathname === SETUP_PATHS.created) {
      // Review M-1: one exchange per attempt, started before any await, so a reload or double
      // redirect can neither spend the code twice nor fail an app that was created.
      a.exchanging ??= this.#exchangeOnce(a, u.searchParams.get('code') ?? '');
      const out = await a.exchanging;
      if (!('id' in out)) return out;
      if (out.status !== 'app_created' || !out.app)
        return {
          status: 502,
          text: `The app was not set up: ${out.failure ?? 'see Creator Agent'}. Return to the studio.`,
        };
      return {
        redirect: `${this.#endpoints.web}/apps/${out.app.slug}/installations/new?state=${a.state}`,
      };
    }
    // Installed: GitHub's installation_id is only a hint; the app's own JWT decides.
    try {
      await this.checkInstallation(a.ctx, a.ws, a.setup_id);
    } catch (e) {
      return {
        status: 200,
        text: `${e instanceof Error ? e.message : 'Not installed yet.'} Return to Creator Agent and check the installation there.`,
      };
    }
    return {
      text: 'Installed. Return to Creator Agent to finish the connection. You can close this tab.',
      close: true,
    };
  }

  async #exchangeOnce(
    a: Attempt,
    code: string,
  ): Promise<GitHubAppSetup | { status: number; text: string }> {
    const now = await this.store.getGitHubAppSetup(a.ctx, a.ws, a.setup_id);
    if (now.status === 'app_created') return now;
    if (now.status !== 'waiting_for_github')
      return {
        status: 409,
        text: 'This setup is no longer waiting for GitHub. Return to Creator Agent.',
      };
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(code)) {
      a.exchanging = undefined; // a later redirect with a usable code may still come
      return { status: 400, text: 'GitHub sent no usable code.' };
    }
    return this.#created(a, code);
  }

  /** Step 2: exchange GitHub's one-time code; the key goes to the vault before anything else. */
  async #created(a: Attempt, code: string): Promise<GitHubAppSetup> {
    const r = await this.#github(
      'POST',
      `/app-manifests/${encodeURIComponent(code)}/conversions`,
    );
    const parsed = r.status === 201 ? parseConversion(r.data) : null;
    if (!parsed) {
      const why =
        r.status === null
          ? `GitHub did not answer (${'error' in r ? r.error : 'network'})`
          : r.status === 201
            ? 'GitHub answered without a usable app or key'
            : `GitHub refused the code (${r.status})`;
      return this.store.failGitHubAppSetup(a.ctx, a.ws, a.setup_id, `${why}.`);
    }
    const vault = this.#vault();
    const ref = newGitHubAppKeyRef();
    await vault.putGitHubAppKey(ref, parsed.pem);
    try {
      return await this.store.recordGitHubAppCreated(a.ctx, a.ws, a.setup_id, {
        app: parsed.app,
        key_ref: ref,
      });
    } catch (e) {
      await vault.delete(ref).catch(() => {});
      throw e;
    }
  }

  /** Lists the app's installations with its own JWT and records the one on the app's owner. */
  async checkInstallation(ctx: CommandContext, ws: string, id: string) {
    const { setup, key_ref } = await this.store.githubAppSetupForInstallation(
      ctx,
      ws,
      id,
    );
    const app = setup.app!;
    const pem = await this.#vault().getGitHubAppKey(key_ref);
    if (!pem)
      throw new ContractError(
        'INVALID_CONFIG',
        'The app key is missing from this computer. Abandon this setup and start again.',
      );
    const r = await this.#github(
      'GET',
      '/app/installations?per_page=100',
      `Bearer ${appJwt(app.client_id, pem)}`,
    );
    if (r.status !== 200 || !Array.isArray(r.data))
      throw new ContractError(
        'LIVE_DISABLED',
        r.status === null
          ? 'GitHub did not answer; try again.'
          : `GitHub refused to list the app's installations (${r.status}).`,
      );
    // A private app can only be installed on the account that owns it.
    const found = (r.data as Record<string, unknown>[])
      .map((i) => ({
        id: i.id,
        account: identityOf(i.account),
        selection: i.repository_selection,
      }))
      .filter(
        (i) =>
          typeof i.id === 'number' &&
          Number.isSafeInteger(i.id) &&
          i.account?.id === app.owner.id &&
          (i.selection === 'all' || i.selection === 'selected'),
      );
    if (found.length !== 1)
      throw new ContractError(
        'NOT_FOUND',
        found.length === 0
          ? `The app is not installed on ${app.owner.login} yet.`
          : 'GitHub lists more than one installation for this app.',
      );
    const i = found[0]!;
    return this.store.recordGitHubAppInstallation(ctx, ws, id, {
      id: i.id as number,
      account: i.account!,
      repository_selection: i.selection as 'all' | 'selected',
    });
  }

  /** Step 3: the ordinary connection; Verify, grants and admission still apply to it. */
  async connect(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<{ setup: GitHubAppSetup; connection: GitHubConnection }> {
    const out = await this.store.connectGitHubAppSetup(ctx, ws, id, raw);
    this.#closeAttempt(id);
    return out;
  }

  /** Drops the sealed key of an unfinished setup; the app on GitHub is the owner's to delete. */
  async abandon(ctx: CommandContext, ws: string, id: string) {
    const { setup, key_ref } = await this.store.abandonGitHubAppSetup(
      ctx,
      ws,
      id,
    );
    this.#closeAttempt(id);
    if (key_ref) await this.#vault().delete(key_ref);
    return setup;
  }

  /** The API process is stopping: no listener outlives it. */
  close() {
    for (const id of [...this.#attempts.keys()]) this.#closeAttempt(id);
  }
}
