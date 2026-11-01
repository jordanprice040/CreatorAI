import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  CLAUDE_CODE_MIN_VERSION,
  claudeCodeVersionSupported,
  ContractError,
  ErrorCodeSchema,
  type ChatAnswer,
  type PlanConnection,
  type PlanTaskClass,
  type Admission,
  type BenchmarkCheck,
} from '@creator/contracts';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_ROLE_TASK_CLASSES,
  canonicalHash,
  checkOutput,
  type BuildRole,
} from '@creator/domain';
import type {
  CommandContext,
  ConnectionStore,
  PlanObservation,
} from '@creator/db';
import {
  OFFICIAL_PLAN_ENDPOINTS,
  PLAN_USAGE_SCOPE,
  PlanAuthError,
  TERMINAL_REFRESH_ERRORS,
  authorizationUrl,
  checkedEndpoints,
  discover,
  exchangeCode,
  loopbackCallback,
  refreshTokens,
  revokeRefreshToken,
  verifyIdToken,
  type AuthorizationAttempt,
  type PlanEndpoints,
  type TokenResponse,
} from './plan-oauth.js';
import {
  callPlanResponses,
  classifyPlanError,
  type PlanObservedOutcome,
} from './plan-responses.js';

/** What the executor's Codex relay observed for one upstream request (structural copy). */
export interface CodexRelayOutcome {
  kind: 'completed' | 'failed' | 'rejected' | 'unknown';
  reason_code: string;
  http_status: number | null;
  error_code: string | null;
  error_param: string | null;
  output_tokens: number | null;
  output_chars: number;
  output_hash: string;
  response_id: string | null;
}
import {
  callClaudeCode,
  claudeCodeStatus,
  type ClaudeCodeHost,
} from './claude-code.js';
import {
  newCredentialRef,
  type PlanCredential,
  type PlanVault,
} from './plan-vault.js';

// Orchestrates one ChatGPT-plan connection: sign-in, token refresh, admission, the direct
// Responses call and settlement. The store decides admission; this service only carries
// out admitted requests and records exactly what happened.

export const VERIFICATION_INSTRUCTIONS =
  'This is a connection check from Creator Agent. Reply with exactly the word: ok';
export const VERIFICATION_INPUT = 'Reply with exactly: ok';
/** ADR-0057: a chat answer is cut at this many characters (or the connection's cap if lower). */
export const CHAT_OUTPUT_MAX = 12_000;
/**
 * Review M-1: rejections that happen before the text leaves the studio. Anything else that is
 * rejected was refused by the provider after receiving the text. The invoke catch turns a
 * studio-side error into its lowercased error code (or token_unavailable) before any call.
 */
const PRE_DISPATCH_REASONS = new Set<string>([
  'cancelled_before_dispatch',
  'claude_code_folder_unavailable',
  'claude_code_start_failed',
  'claude_code_unavailable',
  'claude_code_outdated',
  'claude_code_not_subscription',
  'token_unavailable',
  ...ErrorCodeSchema.options.map((c) => c.toLowerCase()),
]);
const REFRESH_MARGIN_MS = 5 * 60_000;
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export interface PlanServiceDeps {
  store: ConnectionStore;
  vault: PlanVault | null;
  /** Loopback stand-ins, honoured only for fixture connections (contract tests). */
  fixtureEndpoints?: PlanEndpoints;
  openBrowser?: (url: string) => void;
  fetchImpl?: typeof fetch;
  callbackPort?: number;
  /**
   * ADR-0050: the owner's own Claude Code CLI and the studio's dedicated folder for it. Absent
   * means claude_code connections are listed but cannot be checked or used.
   */
  claudeCode?: ClaudeCodeHost | null;
  /** Loopback stand-in environment for fixture claude_code connections (contract tests). */
  claudeCodeFixtureEnv?: Record<string, string>;
  /**
   * Trusted studio grader for patch_build qualification cases (ADR-0048): applies the patch to
   * the reviewed template and runs the cases in the isolated worker. Absent means those
   * qualifications refuse to start a run.
   */
  patchScorer?: (
    ctx: CommandContext,
    check: Extract<BenchmarkCheck, { kind: 'patch_cases' }>,
    text: string | null,
  ) => Promise<string | ScoreResult>;
}

/** A qualification grade with the grader's plain reason for a non-pass (F10). */
export interface ScoreResult {
  signal: string;
  detail: string | null;
}

type SignInStatus =
  | { state: 'pending'; started_at: string }
  | { state: 'completed'; plan_usage_granted: boolean; finished_at: string }
  | { state: 'failed'; code: string; message: string; finished_at: string };

/** Opens the system browser without a shell parsing the URL. */
export function openSystemBrowser(url: string) {
  if (process.platform === 'win32')
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  else if (process.platform === 'darwin')
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  else
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
      .on('error', () => {})
      .unref();
}

/** One direct request for invoke(); the connection's kind picks ChatGPT or Claude Code. */
export interface InvokeRequest {
  connection_id: string;
  purpose:
    'task' | 'verification' | 'availability_recheck' | 'qualification' | 'chat';
  model_id: string;
  task_class: PlanTaskClass | null;
  data_class: 'synthetic' | 'public' | 'private_approved';
  run_id: string | null;
  /** ADR-0054: a T12 build-role request names its build, whose one approval covers it. */
  build_id?: string | null;
  grant_id?: string | null;
  qualification_id?: string | null;
  qualification_case?: {
    case_id: string;
    split: 'development' | 'held_out';
  };
  instructions: string;
  input: string;
  logical_operation_id?: string;
  signal?: AbortSignal;
  workflow?: { task_id: string; lease_token: string; input_hash: string };
  timeout_ms?: number;
  max_output_chars?: number;
  score?: (
    text: string | null,
    outcome: PlanObservedOutcome,
  ) => string | ScoreResult | Promise<string | ScoreResult>;
  /** Called once admission has recorded the request, before anything is sent (ADR-0057). */
  onAdmitted?: () => void;
}

export class PlanConnectionService {
  readonly #signIns = new Map<string, SignInStatus>();
  readonly #refreshing = new Map<string, Promise<PlanCredential>>();
  constructor(readonly deps: PlanServiceDeps) {}

  endpointsFor(conn: PlanConnection): PlanEndpoints {
    if (!conn.fixture) return OFFICIAL_PLAN_ENDPOINTS;
    if (!this.deps.fixtureEndpoints)
      throw new ContractError(
        'LIVE_DISABLED',
        'Fixture connections need loopback stand-in endpoints.',
      );
    return checkedEndpoints(this.deps.fixtureEndpoints, true);
  }

  #vault(): PlanVault {
    if (!this.deps.vault)
      throw new ContractError(
        'INVALID_CONFIG',
        'No protected credential store is configured, so ChatGPT sign-in is unavailable. The installed Windows studio uses Windows DPAPI.',
      );
    return this.deps.vault;
  }

  #claudeHost(): ClaudeCodeHost {
    if (!this.deps.claudeCode)
      throw new ContractError(
        'INVALID_CONFIG',
        'Claude Code is not set up for the studio. Install Claude Code (native installer) and set CREATOR_CLAUDE_CODE_CONFIG_DIR, or use the installed app.',
      );
    return this.deps.claudeCode;
  }

  /**
   * Review M-1: like endpointsFor, a fixture connection runs only against a stand-in. Without
   * one it is refused, never sent to the owner's real Claude Code and labelled fixture.
   */
  #claudeFixtureEnv(conn: PlanConnection): Record<string, string> | undefined {
    if (!conn.fixture) return undefined;
    if (!this.deps.claudeCodeFixtureEnv)
      throw new ContractError(
        'LIVE_DISABLED',
        'Fixture connections need a stand-in Claude Code; this studio has none, so nothing was run.',
      );
    return this.deps.claudeCodeFixtureEnv;
  }

  /**
   * ADR-0050: checks the owner's Claude Code sign-in (`claude auth status`) and records what it
   * reported. Sends no model request and reads no credential.
   */
  async checkClaudeCode(ctx: CommandContext, ws: string, id: string) {
    const { connection } = await this.deps.store.planCredentialRef(ctx, ws, id);
    if (connection.kind !== 'claude_code')
      throw new ContractError(
        'INVALID_TRANSITION',
        'This check is for Claude Code connections.',
      );
    const host = this.#claudeHost();
    const fixtureEnv = this.#claudeFixtureEnv(connection);
    let observed;
    try {
      observed = await claudeCodeStatus(host, undefined, fixtureEnv);
    } catch (e) {
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        e instanceof Error ? e.message : 'Claude Code could not be checked.',
      );
    }
    const updated = await this.deps.store.recordClaudeCodeStatus(
      ctx,
      ws,
      id,
      observed,
    );
    return {
      connection: updated,
      config_dir: host.config_dir,
      cli_version: observed.cli_version,
    };
  }

  signInStatus(id: string): SignInStatus | null {
    return this.#signIns.get(id) ?? null;
  }

  /** Starts a browser sign-in. Returns the authorization URL; the callback finishes it. */
  async beginSignIn(
    ctx: CommandContext,
    ws: string,
    id: string,
    opts: { open_browser: boolean },
  ) {
    const { connection: conn, credential_ref } =
      await this.deps.store.planCredentialRef(ctx, ws, id);
    if (conn.kind !== 'chatgpt_plan')
      throw new ContractError(
        'INVALID_TRANSITION',
        'Claude Code signs in by itself: run claude auth login, then check the connection.',
      );
    const vault = this.#vault();
    if (this.#signIns.get(conn.id)?.state === 'pending')
      throw new ContractError(
        'DUPLICATE',
        'A sign-in is already waiting for the browser.',
      );
    const endpoints = this.endpointsFor(conn);
    const previous = credential_ref ? await vault.get(credential_ref) : null;
    let attempt: AuthorizationAttempt | null = null;
    const cb = await loopbackCallback(() => attempt, {
      timeout_ms: SIGN_IN_TIMEOUT_MS,
      ...(this.deps.callbackPort !== undefined
        ? { port: this.deps.callbackPort }
        : {}),
    });
    attempt = authorizationUrl({
      endpoints,
      host_id: conn.ext_agent_host_id,
      redirect_uri: cb.redirect_uri,
      client_id: conn.sign_in.issued_client_id,
      id_token_hint: previous?.id_token ?? null,
      login_hint: previous?.account_label ?? null,
    });
    this.#signIns.set(conn.id, {
      state: 'pending',
      started_at: new Date().toISOString(),
    });
    const a = attempt;
    void cb.result
      .then((r) =>
        this.#finishSignIn(
          ctx,
          ws,
          conn,
          a,
          r.code,
          r.client_id,
          previous,
          credential_ref,
        ),
      )
      .catch((e) => {
        this.#signIns.set(conn.id, {
          state: 'failed',
          code: e instanceof PlanAuthError ? e.code : 'sign_in_failed',
          message:
            e instanceof Error ? e.message.slice(0, 300) : 'Sign-in failed.',
          finished_at: new Date().toISOString(),
        });
      });
    if (opts.open_browser) (this.deps.openBrowser ?? openSystemBrowser)(a.url);
    return {
      authorization_url: a.url,
      redirect_uri: a.redirect_uri,
      expires_in_s: SIGN_IN_TIMEOUT_MS / 1000,
    };
  }

  async #finishSignIn(
    ctx: CommandContext,
    ws: string,
    conn: PlanConnection,
    a: AuthorizationAttempt,
    code: string,
    clientId: string,
    previous: PlanCredential | null,
    previousRef: string | null,
  ) {
    const endpoints = this.endpointsFor(conn);
    const f = this.deps.fetchImpl ?? fetch;
    const tokens = await exchangeCode({
      endpoints,
      client_id: clientId,
      code,
      verifier: a.verifier,
      redirect_uri: a.redirect_uri,
      fetchImpl: f,
    });
    if (!tokens.id_token)
      throw new PlanAuthError(
        'id_token_missing',
        'The token response had no ID token.',
      );
    const discovery = await discover(endpoints, f);
    const identity = await verifyIdToken({
      id_token: tokens.id_token,
      discovery,
      client_id: clientId,
      nonce: a.nonce,
      fetchImpl: f,
    });
    if (previous && previous.subject !== identity.subject)
      throw new PlanAuthError(
        'account_mismatch',
        'A different ChatGPT account signed in; the saved registration was kept.',
      );
    const ref = previousRef ?? newCredentialRef();
    const cred = this.#credential(
      conn,
      clientId,
      identity.subject,
      identity.issuer,
      identity.email,
      tokens,
      previous,
    );
    await this.#vault().put(ref, cred);
    await this.deps.store.recordPlanSignIn(ctx, ws, conn.id, {
      issued_client_id: clientId,
      account_label: cred.account_label,
      scopes: tokens.scope,
      access_expires_at: cred.expires_at,
      credential_ref: ref,
    });
    this.#signIns.set(conn.id, {
      state: 'completed',
      plan_usage_granted: tokens.scope.includes(PLAN_USAGE_SCOPE),
      finished_at: new Date().toISOString(),
    });
  }

  #credential(
    conn: PlanConnection,
    clientId: string,
    subject: string,
    issuer: string,
    email: string | null,
    t: TokenResponse,
    previous: PlanCredential | null,
  ): PlanCredential {
    return {
      issuer,
      subject,
      account_label: email ?? previous?.account_label ?? 'ChatGPT account',
      client_id: clientId,
      ext_agent_host_id: conn.ext_agent_host_id,
      id_token: t.id_token ?? previous?.id_token ?? null,
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? previous?.refresh_token ?? null,
      scopes: t.scope.length ? t.scope : (previous?.scopes ?? []),
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      saved_at: new Date().toISOString(),
    };
  }

  /** A current access token, refreshed once at a time per connection near expiry. */
  async accessToken(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<{ token: string; connection: PlanConnection }> {
    const { connection, credential_ref } =
      await this.deps.store.planCredentialRef(ctx, ws, id);
    if (connection.kind !== 'chatgpt_plan')
      throw new ContractError(
        'INVALID_TRANSITION',
        'Claude Code connections have no studio-held token.',
      );
    if (!credential_ref || connection.sign_in.state !== 'signed_in')
      throw new ContractError('UNAUTHENTICATED', 'Sign in with ChatGPT first.');
    const vault = this.#vault();
    let cred = await vault.get(credential_ref);
    if (!cred)
      throw new ContractError(
        'UNAUTHENTICATED',
        'The saved sign-in is missing; sign in again.',
      );
    if (Date.parse(cred.expires_at) - Date.now() < REFRESH_MARGIN_MS) {
      let pending = this.#refreshing.get(connection.id);
      if (!pending) {
        pending = this.#refresh(connection, credential_ref, cred).finally(() =>
          this.#refreshing.delete(connection.id),
        );
        this.#refreshing.set(connection.id, pending);
      }
      cred = await pending;
    }
    return { token: cred.access_token, connection };
  }

  async #refresh(
    conn: PlanConnection,
    ref: string,
    cred: PlanCredential,
  ): Promise<PlanCredential> {
    if (!cred.refresh_token) {
      await this.deps.store.markPlanReauthorizationRequired(
        conn.id,
        'No refresh token was granted; sign in again.',
      );
      throw new ContractError('UNAUTHENTICATED', 'Sign in with ChatGPT again.');
    }
    try {
      const t = await refreshTokens({
        endpoints: this.endpointsFor(conn),
        client_id: cred.client_id,
        refresh_token: cred.refresh_token,
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      });
      // Access token, expiry, scopes and the rotating refresh token are replaced together.
      const next: PlanCredential = {
        ...cred,
        access_token: t.access_token,
        refresh_token: t.refresh_token ?? cred.refresh_token,
        scopes: t.scope.length ? t.scope : cred.scopes,
        expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
        saved_at: new Date().toISOString(),
      };
      await this.#vault().put(ref, next);
      await this.deps.store.recordPlanAccessRefresh(conn.id, next.expires_at);
      return next;
    } catch (e) {
      if (e instanceof PlanAuthError && TERMINAL_REFRESH_ERRORS.has(e.code)) {
        await this.#vault().put(ref, {
          ...cred,
          access_token: 'revoked-'.padEnd(20, '0'),
          refresh_token: null,
          expires_at: new Date(0).toISOString(),
        });
        await this.deps.store.markPlanReauthorizationRequired(
          conn.id,
          `Token refresh refused (${e.code}); sign in again.`,
        );
        throw new ContractError(
          'UNAUTHENTICATED',
          'Sign in with ChatGPT again.',
        );
      }
      // Temporary failures keep the credentials (docs: never erase on a network error).
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        'Could not refresh the ChatGPT sign-in right now.',
      );
    }
  }

  async signOut(ctx: CommandContext, ws: string, id: string) {
    const { connection, credential_ref } =
      await this.deps.store.planCredentialRef(ctx, ws, id);
    let confirmed = false;
    if (credential_ref && this.deps.vault) {
      const cred = await this.deps.vault.get(credential_ref);
      if (cred?.refresh_token) {
        try {
          const discovery = await discover(
            this.endpointsFor(connection),
            this.deps.fetchImpl ?? fetch,
          );
          confirmed = await revokeRefreshToken({
            discovery,
            client_id: cred.client_id,
            refresh_token: cred.refresh_token,
            ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
          });
        } catch {
          confirmed = false;
        }
      }
      await this.deps.vault.delete(credential_ref);
    }
    return this.deps.store.recordPlanSignOut(ctx, ws, connection.id, confirmed);
  }

  /** One admitted direct Responses request; the caller never sees the token. */
  async invoke(
    ctx: CommandContext,
    ws: string,
    r: InvokeRequest,
  ): Promise<{
    request_id: string;
    outcome: PlanObservedOutcome;
    admission?: Admission;
  }> {
    const admitted = await this.deps.store.admitPlanRequest(
      ctx,
      ws,
      {
        connection_id: r.connection_id,
        logical_operation_id: r.logical_operation_id ?? randomUUID(),
        path: 'responses',
        purpose: r.purpose,
        model_id: r.model_id,
        task_class: r.task_class,
        data_class: r.data_class,
        run_id: r.run_id,
        build_id: r.build_id ?? null,
        grant_id: r.grant_id ?? null,
        qualification_id: r.qualification_id ?? null,
        input_chars: r.instructions.length + r.input.length,
      },
      r.qualification_case,
      r.workflow
        ? {
            ...r.workflow,
            input_hash: canonicalHash({
              instructions: r.instructions,
              input: r.input,
            }),
          }
        : undefined,
    );
    if (admitted.admission)
      return {
        request_id: '',
        admission: admitted.admission,
        outcome: {
          kind: 'rejected',
          reason_code: admitted.admission.reason_code,
          message: admitted.admission.explanation,
          response_id: null,
          output_chars: null,
          retry_allowed: false,
        },
      };
    if (admitted.replay) {
      const p = admitted.replay;
      if (p.state === 'completed' && typeof p.output_text === 'string') {
        if (
          createHash('sha256').update(p.output_text).digest('hex') !==
          p.output_hash
        )
          throw new ContractError(
            'EVIDENCE_MISMATCH',
            'Stored plan output hash changed.',
          );
        return {
          request_id: admitted.request_id,
          outcome: {
            kind: 'completed',
            text: p.output_text,
            output_hash: String(p.output_hash),
            output_chars: Number(p.output_chars),
            output_tokens:
              p.output_tokens == null ? null : Number(p.output_tokens),
            response_id: p.upstream_request_id as string | null,
          },
        };
      }
      return {
        request_id: admitted.request_id,
        outcome: {
          kind:
            p.state === 'failed' ||
            p.state === 'rejected' ||
            p.state === 'reconciled'
              ? 'failed'
              : 'unknown',
          reason_code: String(p.reason_code ?? 'prior_outcome_unresolved'),
          message: 'Prior request preserved; no redispatch.',
          response_id: null,
          output_chars: null,
          retry_allowed: false,
        },
      };
    }
    r.onAdmitted?.();
    let outcome: PlanObservedOutcome;
    try {
      const { connection } = await this.deps.store.planCredentialRef(
        ctx,
        ws,
        r.connection_id,
      );
      if (connection.kind === 'claude_code')
        outcome = await this.#claudeCall(connection, r);
      else outcome = await this.#chatgptCall(ctx, ws, r);
    } catch (e) {
      // Nothing was sent: the token or the Claude Code sign-in could not be confirmed.
      outcome = {
        kind: 'rejected',
        reason_code:
          e instanceof ContractError
            ? e.code.toLowerCase()
            : 'token_unavailable',
        message: e instanceof Error ? e.message.slice(0, 200) : 'No token.',
        response_id: null,
        output_chars: null,
        retry_allowed: false,
      };
    }
    return this.#settle(admitted.request_id, r, outcome);
  }

  async #chatgptCall(
    ctx: CommandContext,
    ws: string,
    r: InvokeRequest,
  ): Promise<PlanObservedOutcome> {
    const { token, connection } = await this.accessToken(
      ctx,
      ws,
      r.connection_id,
    );
    const caps = connection.settings.caps.responses;
    return callPlanResponses({
      api_base: this.endpointsFor(connection).api_base,
      access_token: token,
      model: r.model_id,
      instructions: r.instructions,
      input: r.input,
      timeout_ms: Math.min(
        caps.request_timeout_ms,
        r.timeout_ms ?? caps.request_timeout_ms,
      ),
      max_output_chars: Math.min(
        caps.max_output_chars,
        r.max_output_chars ?? caps.max_output_chars,
      ),
      ...(r.signal ? { signal: r.signal } : {}),
      ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
    });
  }

  /**
   * ADR-0050: re-reads `claude auth status` right before each request, so a sign-in that
   * changed to an API key or expired since the owner's check refuses before anything is sent.
   */
  async #claudeCall(
    connection: PlanConnection,
    r: InvokeRequest,
  ): Promise<PlanObservedOutcome> {
    const host = this.#claudeHost();
    const fixtureEnv = this.#claudeFixtureEnv(connection);
    let status;
    try {
      status = await claudeCodeStatus(host, undefined, fixtureEnv);
    } catch (e) {
      return {
        kind: 'rejected',
        reason_code: 'claude_code_unavailable',
        message:
          e instanceof Error
            ? e.message.slice(0, 200)
            : 'Claude Code could not be checked.',
        response_id: null,
        output_chars: null,
        retry_allowed: false,
      };
    }
    if (!claudeCodeVersionSupported(status.cli_version))
      return {
        kind: 'rejected',
        reason_code: 'claude_code_outdated',
        message: `Claude Code ${status.cli_version} is older than ${CLAUDE_CODE_MIN_VERSION}; run claude update, then Check Claude Code.`,
        response_id: null,
        output_chars: null,
        retry_allowed: false,
        // Not a sign-in problem (review L-B): this gate refuses every request until the
        // owner updates, and the next check records the version reason.
      };
    if (
      !status.logged_in ||
      status.auth_method !== 'claude.ai' ||
      (status.api_provider !== null && status.api_provider !== 'firstParty')
    )
      return {
        kind: 'rejected',
        reason_code: 'claude_code_not_subscription',
        message: `Claude Code is ${status.logged_in ? `signed in with ${status.auth_method}` : 'not signed in'}, not a Claude subscription login.`,
        response_id: null,
        output_chars: null,
        retry_allowed: false,
        sign_in_invalid: true,
      };
    const caps = connection.settings.caps.responses;
    return callClaudeCode({
      host,
      model: r.model_id,
      instructions: r.instructions,
      input: r.input,
      timeout_ms: Math.min(
        caps.request_timeout_ms,
        r.timeout_ms ?? caps.request_timeout_ms,
      ),
      max_output_chars: Math.min(
        caps.max_output_chars,
        r.max_output_chars ?? caps.max_output_chars,
      ),
      ...(r.signal ? { signal: r.signal } : {}),
      ...(fixtureEnv ? { fixture_env: fixtureEnv } : {}),
    });
  }

  async #settle(
    requestId: string,
    r: InvokeRequest,
    outcome: PlanObservedOutcome,
  ): Promise<{ request_id: string; outcome: PlanObservedOutcome }> {
    const observed: PlanObservation =
      outcome.kind === 'completed'
        ? r.workflow || r.qualification_id
          ? { workflow_output_text: outcome.text }
          : {}
        : {
            ...(outcome.eligibility
              ? { eligibility: outcome.eligibility }
              : {}),
            ...(outcome.quota ? { quota: outcome.quota } : {}),
            ...(outcome.sign_in_invalid ? { sign_in_invalid: true } : {}),
            ...(outcome.model_refused ? { model_refused: true } : {}),
            reason_code: outcome.reason_code,
            upstream_request_id: outcome.response_id,
          };
    // A grader that throws (disk, git, worker) is a non-pass, never an unsettled request.
    if (r.score)
      try {
        const scored = await r.score(
          outcome.kind === 'completed' ? outcome.text : null,
          outcome,
        );
        if (typeof scored === 'string') observed.signal = scored;
        else {
          observed.signal = scored.signal;
          if (scored.detail) observed.grader_detail = scored.detail;
        }
      } catch (e) {
        observed.signal = 'provider_error';
        observed.grader_error = e instanceof Error ? e.message : String(e);
      }
    await this.deps.store.settlePlanRequest(
      requestId,
      outcome.kind === 'completed'
        ? {
            state: 'completed',
            upstream_request_id: outcome.response_id,
            output_tokens: outcome.output_tokens,
            output_chars: outcome.output_chars,
            output_hash: outcome.output_hash,
          }
        : {
            state: outcome.kind,
            reason_code: outcome.reason_code,
            upstream_request_id: outcome.response_id,
            output_chars: outcome.output_chars,
          },
      observed,
    );
    return { request_id: requestId, outcome };
  }

  /**
   * Admission for the Codex relay (Path B): each upstream request Codex makes is admitted and
   * settled here like a direct request, so the per-build, daily and in-flight caps hold. The
   * returned token stays in the studio process; Codex itself only holds the relay capability.
   */
  codexAdmission(
    ctx: CommandContext,
    ws: string,
    b: {
      connection_id: string;
      model_id: string;
      run_id: string | null;
      build_id: string;
      data_class: 'synthetic' | 'public' | 'private_approved';
    },
  ) {
    return async (): Promise<{
      api_base: string;
      access_token: string;
      settle(o: CodexRelayOutcome): Promise<void>;
    }> => {
      const admitted = await this.deps.store.admitPlanRequest(ctx, ws, {
        connection_id: b.connection_id,
        logical_operation_id: randomUUID(),
        path: 'codex',
        purpose: 'codex_build',
        model_id: b.model_id,
        task_class: 'code_build',
        data_class: b.data_class,
        run_id: b.run_id,
        build_id: b.build_id,
        grant_id: null,
        qualification_id: null,
        input_chars: 0,
      });
      let token: string;
      let connection: PlanConnection;
      try {
        ({ token, connection } = await this.accessToken(
          ctx,
          ws,
          b.connection_id,
        ));
      } catch (e) {
        await this.deps.store.settlePlanRequest(
          admitted.request_id,
          {
            state: 'rejected',
            reason_code: 'token_unavailable',
            upstream_request_id: null,
            output_chars: null,
          },
          { reason_code: 'token_unavailable' },
        );
        throw e;
      }
      return {
        api_base: this.endpointsFor(connection).api_base,
        access_token: token,
        settle: async (o) => {
          const c =
            o.kind === 'completed'
              ? null
              : classifyPlanError(
                  o.http_status ?? 0,
                  o.error_code,
                  o.error_param,
                );
          await this.deps.store.settlePlanRequest(
            admitted.request_id,
            o.kind === 'completed'
              ? {
                  state: 'completed',
                  upstream_request_id: o.response_id,
                  output_tokens: o.output_tokens,
                  output_chars: o.output_chars,
                  output_hash: o.output_hash,
                }
              : {
                  state: o.kind,
                  reason_code: o.reason_code.slice(0, 120),
                  upstream_request_id: o.response_id,
                  output_chars: o.output_chars,
                },
            c
              ? {
                  ...(c.eligibility ? { eligibility: c.eligibility } : {}),
                  ...(c.quota ? { quota: c.quota } : {}),
                  ...(c.sign_in_invalid ? { sign_in_invalid: true } : {}),
                  ...(c.model_refused ? { model_refused: true } : {}),
                  reason_code: o.reason_code.slice(0, 120),
                  upstream_request_id: o.response_id,
                }
              : {},
          );
        },
      };
    };
  }

  /**
   * ADR-0057: one chat answer from the workspace's chosen plan. The store records what will be
   * sent, admission decides under the owner's chat setting and the connection's caps, and the
   * outcome is saved with the answer. A refusal sends nothing and never falls back to another
   * route. The answer is words only: nothing here starts, approves or spends anything.
   */
  async chatAnswer(
    ctx: CommandContext,
    ws: string,
    conversationId: string,
    messageId: string,
    body: unknown,
  ): Promise<ChatAnswer> {
    const begun = await this.deps.store.beginChatAnswer(
      ctx,
      ws,
      conversationId,
      messageId,
      body,
    );
    if (begun.replay) return begun.answer;
    const a = begun.answer;
    let settled: {
      state: 'completed' | 'failed' | 'refused';
      plan_request_id: string | null;
      text: string | null;
      reason: string | null;
    };
    let admitted = false;
    const who = a.connection_kind === 'claude_code' ? 'Claude' : 'ChatGPT';
    try {
      const r = await this.invoke(ctx, ws, {
        connection_id: a.connection_id,
        purpose: 'chat',
        model_id: a.model_id,
        task_class: null,
        data_class: 'private_approved',
        run_id: null,
        instructions: begun.instructions,
        input: begun.input,
        logical_operation_id: begun.logical_operation_id,
        max_output_chars: CHAT_OUTPUT_MAX,
        onAdmitted: () => {
          admitted = true;
        },
      });
      const o = r.outcome;
      if (o.kind === 'completed')
        settled = {
          state: 'completed',
          plan_request_id: r.request_id || null,
          text: o.text,
          reason: null,
        };
      else if (o.kind === 'rejected' && PRE_DISPATCH_REASONS.has(o.reason_code))
        settled = {
          state: 'refused',
          plan_request_id: r.request_id || null,
          text: null,
          reason: `${o.message} (${o.reason_code})`,
        };
      else
        // Review M-1: the provider received the text and refused, failed or did not finish.
        settled = {
          state: 'failed',
          plan_request_id: r.request_id || null,
          text: null,
          reason:
            o.kind === 'rejected'
              ? `${who} refused it after receiving the text: ${o.message} (${o.reason_code})`
              : `${o.message} (${o.reason_code})`,
        };
    } catch (e) {
      // Review L-2: before admission recorded the request nothing was sent, whatever the
      // error. After it, the outcome is unclear, so it is a failure that may have been sent.
      const details = e instanceof ContractError ? [...e.details] : [];
      settled = {
        state: admitted ? 'failed' : 'refused',
        plan_request_id: null,
        text: null,
        reason:
          details.length > 0
            ? details.join(' ')
            : e instanceof Error
              ? e.message
              : 'The request was not admitted.',
      };
    }
    return this.deps.store.finishChatAnswer(ctx, ws, a.id, settled);
  }

  /**
   * One T12 build-role call (ADR-0048): the fixed role prompt as a fresh direct request under
   * the role's task class, so qualification, caps and the run's state all apply. No dollar
   * broker is involved; the plan-request ledger records it.
   */
  async buildRole(
    ctx: CommandContext,
    ws: string,
    connectionId: string,
    b: {
      role: BuildRole;
      model_id: string;
      run_id: string;
      build_id: string;
      data_class: 'synthetic' | 'public' | 'private_approved';
      input: string;
      timeout_ms: number;
      logical_operation_id: string;
    },
  ) {
    const { connection } = await this.deps.store.planConnectionDetail(
      ctx,
      ws,
      connectionId,
    );
    const r = await this.invoke(ctx, ws, {
      connection_id: connectionId,
      purpose: 'task',
      model_id: b.model_id,
      task_class: BUILD_ROLE_TASK_CLASSES[b.role],
      data_class: b.data_class,
      run_id: b.run_id,
      build_id: b.build_id,
      instructions: BUILD_ROLE_PROMPTS[b.role],
      input: b.input,
      logical_operation_id: b.logical_operation_id,
      timeout_ms: b.timeout_ms,
    });
    return {
      request_id: r.request_id,
      status:
        r.outcome.kind === 'completed'
          ? ('succeeded' as const)
          : ('failed' as const),
      reason_code:
        r.outcome.kind === 'completed' ? 'ok' : r.outcome.reason_code,
      text: r.outcome.kind === 'completed' ? r.outcome.text : null,
      fixture: connection.fixture,
    };
  }

  /**
   * Why a T12 build's plan roles would be refused right now (ADR-0048), checked before the
   * build uses its grant or sends the builder. Empty means both roles are admissible; the
   * run's own admission and caps are still checked per request.
   */
  async buildRolesReady(
    ctx: CommandContext,
    ws: string,
    connectionId: string,
    b: {
      model_id: string;
      run_id: string;
      data_class: 'synthetic' | 'public' | 'private_approved';
    },
  ): Promise<string[]> {
    const d = await this.deps.store.planConnectionDetail(ctx, ws, connectionId);
    const out = [
      ...d.blockers,
      ...(await this.deps.store.planBuildRolesRunBlockers(
        ctx,
        ws,
        b.run_id,
        connectionId,
      )),
    ];
    if (!d.connection.settings.allowed_data_classes.includes(b.data_class))
      out.push(`Data class ${b.data_class} is not allowed on this connection.`);
    if (
      !d.model_access.some(
        (a) =>
          a.model_id === b.model_id &&
          a.path === 'responses' &&
          a.access === 'verified',
      )
    )
      out.push(
        `Model ${b.model_id} has no verified access on the responses path.`,
      );
    // Only qualifications decided on the current role prompts count (ADR-0049).
    const admitting = await this.deps.store.planAdmittingQualifications(
      ctx,
      ws,
      connectionId,
    );
    for (const role of ['builder', 'reviewer'] as const) {
      const tc = BUILD_ROLE_TASK_CLASSES[role];
      if (!d.connection.settings.allowed_task_classes.includes(tc))
        out.push(`Task class ${tc} is not allowed on this connection.`);
      if (
        !admitting.some(
          (q) =>
            q.model_id === b.model_id &&
            q.task_class === tc &&
            q.state === 'qualified',
        )
      )
        out.push(
          `Model ${b.model_id} is not qualified for ${tc} (the T12 ${role}) under its current prompt.`,
        );
    }
    return out;
  }

  /** Uses the owner's one-shot approval for one live call that verifies model access. */
  async verifyModel(
    ctx: CommandContext,
    ws: string,
    id: string,
    grant: { id: string; model_id: string },
  ) {
    const r = await this.invoke(ctx, ws, {
      connection_id: id,
      purpose: 'verification',
      model_id: grant.model_id,
      task_class: null,
      data_class: 'synthetic',
      run_id: null,
      grant_id: grant.id,
      instructions: VERIFICATION_INSTRUCTIONS,
      input: VERIFICATION_INPUT,
    });
    return {
      request_id: r.request_id,
      verified: r.outcome.kind === 'completed',
      outcome: summarize(r.outcome),
    };
  }

  /** Fresh one-shot availability check; never overwrites established access/qualifications. */
  async recheckAvailability(
    ctx: CommandContext,
    ws: string,
    id: string,
    grant: { id: string; model_id: string },
  ) {
    const r = await this.invoke(ctx, ws, {
      connection_id: id,
      purpose: 'availability_recheck',
      model_id: grant.model_id,
      task_class: null,
      data_class: 'synthetic',
      run_id: null,
      grant_id: grant.id,
      instructions: VERIFICATION_INSTRUCTIONS,
      input: VERIFICATION_INPUT,
    });
    return {
      request_id: r.request_id,
      available: r.outcome.kind === 'completed',
      outcome: summarize(r.outcome),
    };
  }

  /** Runs every not-yet-attempted case once, then decides. Stops early on any refusal. */
  async runQualification(ctx: CommandContext, ws: string, qid: string) {
    const {
      qualification: q,
      manifest,
      attempted_cases,
    } = await this.deps.store.planQualificationManifest(ctx, ws, qid);
    const seen = new Set(attempted_cases);
    const scorer = this.deps.patchScorer;
    // Patch cases run code; without the studio's worker grader nothing is sent at all.
    if (manifest.cases.some((c) => c.check.kind === 'patch_cases') && !scorer)
      return {
        state: 'stopped' as const,
        reason: 'patch_scorer_unavailable',
      };
    for (const c of manifest.cases) {
      if (seen.has(c.case_id)) continue;
      const system = c.input
        .filter((m) => m.role === 'system')
        .map((m) => m.text)
        .join('\n\n');
      const user = c.input
        .filter((m) => m.role === 'user')
        .map((m) => m.text)
        .join('\n\n');
      const r = await this.invoke(ctx, ws, {
        connection_id: q.connection_id,
        purpose: 'qualification',
        model_id: q.model_id,
        task_class: q.task_class,
        data_class: manifest.data_class,
        run_id: null,
        qualification_id: qid,
        qualification_case: { case_id: c.case_id, split: c.split },
        instructions: system || 'Follow the user instructions.',
        input: user,
        score: (text, outcome) => {
          if (c.check.kind === 'patch_cases')
            return outcome.kind === 'completed'
              ? scorer!(ctx, c.check, text)
              : 'provider_error';
          let json: unknown = null;
          if (text !== null && c.output_format === 'json')
            try {
              json = JSON.parse(text);
            } catch {
              return 'schema_invalid';
            }
          return checkOutput(c.check, text === null ? null : { text, json }, {
            succeeded: outcome.kind === 'completed',
            reason_code:
              outcome.kind === 'completed' ? 'ok' : outcome.reason_code,
          });
        },
      });
      if (
        r.outcome.kind !== 'completed' &&
        !r.outcome.retry_allowed &&
        r.outcome.kind !== 'failed'
      )
        return { state: 'stopped' as const, reason: r.outcome.reason_code };
    }
    return {
      state: 'decided' as const,
      qualification: await this.deps.store.finishPlanQualification(
        ctx,
        ws,
        qid,
      ),
    };
  }
}

export function summarize(o: PlanObservedOutcome) {
  return o.kind === 'completed'
    ? {
        kind: o.kind,
        output_chars: o.output_chars,
        output_tokens: o.output_tokens,
        response_id: o.response_id,
      }
    : {
        kind: o.kind,
        reason_code: o.reason_code,
        message: o.message,
        response_id: o.response_id,
      };
}
