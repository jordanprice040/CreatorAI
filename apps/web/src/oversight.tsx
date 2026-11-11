import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useOnShow, usePageActive } from './page-drafts.js';
import { RoutinePolicies } from './routine-policy.js';
import { runLabel } from './labels.js';
import { Fold, FoldAll, useFolds, type Folds } from './fold.js';
import { clearOtherTransfers, resetTransfers } from './transfers.js';
import {
  clearNoteDrafts,
  clearOtherNoteDrafts,
  hasNoteDrafts,
  noteSavesSettled,
} from './note-drafts.js';
import {
  AuthStatusSchema,
  DecisionSchema,
  GrantSchema,
  RoutinePolicyViewSchema,
  RunControlSchema,
  SessionInfoSchema,
  parse,
  z,
  type Decision,
  type Grant,
  type RoutinePolicyView,
  type RunControl,
  type SessionInfo,
  type Workspace,
  dataClassName,
} from '@creator/contracts';

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
/**
 * Sent on `window` after every request that changes something (any POST), whether it worked
 * or was refused, so the what's-next line and other summaries read again right away.
 */
export const STUDIO_CHANGED = 'creator:studio-changed';

export async function api<T>(
  schema: z.ZodType<T>,
  path: string,
  init: {
    body?: unknown;
    csrf?: string;
    timeoutMs?: number;
    idempotencyKey?: string;
    /** A write that changes nothing other pages show (sidebar notes): do not announce it. */
    quiet?: boolean;
    /** ADR-0083: a Chat card's send; its audit events name the card's send as their cause. */
    trace?: { causation: string; correlation: string };
  } = {},
): Promise<T> {
  const sent = fetch(`/api/${path}`, {
    ...(init.body === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(init.csrf ? { 'X-CSRF-Token': init.csrf } : {}),
            ...(init.idempotencyKey
              ? { 'Idempotency-Key': init.idempotencyKey }
              : {}),
            ...(init.trace
              ? {
                  'X-Causation-Id': init.trace.causation,
                  'X-Correlation-Id': init.trace.correlation,
                }
              : {}),
          },
          body: JSON.stringify(init.body),
        }),
    signal: AbortSignal.timeout(init.timeoutMs ?? 5000),
  });
  // A write that timed out may still have landed, so announce it however it ended.
  if (init.body !== undefined && !init.quiet && typeof window !== 'undefined') {
    const announce = () => window.dispatchEvent(new Event(STUDIO_CHANGED));
    sent.then(announce, announce);
  }
  const response = await sent;
  const body: unknown = await response.json();
  if (!response.ok) {
    const e =
      body && typeof body === 'object' && 'error' in body
        ? (body.error as { code?: string; message?: string; details?: unknown })
        : {};
    const details = Array.isArray(e.details)
      ? ` ${e.details.map(String).slice(0, 6).join('; ')}`
      : '';
    throw new ApiError(
      e.code ?? 'ERROR',
      `${e.message ?? `API error ${response.status}`}${details}`,
    );
  }
  return parse(schema, body);
}
export const message = (e: unknown) =>
  e instanceof Error ? e.message : 'The request failed.';
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
export const words = (s: string) =>
  s.replaceAll('_', ' ').replaceAll('.', ' · ');
const short = (h: string | null | undefined) =>
  h ? `${h.slice(0, 12)}…` : '—';

/** Signs in with the local development code (or OIDC) and keeps the session's CSRF token. */
export function useSession(persistent: boolean) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [mode, setMode] = useState<'dev_local' | 'oidc' | null>(null);
  const [managed, setManaged] = useState(false);
  const [error, setError] = useState('');
  // Review L-D: a session starting in this tab removes notes copies left by anyone else.
  function start(next: SessionInfo) {
    clearOtherNoteDrafts(next.actor_id);
    clearOtherTransfers(next.actor_id);
    setSession(next);
  }
  async function load() {
    try {
      const status = parse(
        AuthStatusSchema,
        await (await fetch('/api/auth/status')).json(),
      );
      setMode(status.mode);
      setManaged(status.managed_by === 'desktop_app');
      start(await api(SessionInfoSchema, 'auth/session'));
    } catch (e) {
      setSession(null);
      if (!(e instanceof ApiError && e.code === 'UNAUTHENTICATED'))
        setError(message(e));
    }
  }
  async function signIn(code: string) {
    setError('');
    try {
      start(await api(SessionInfoSchema, 'auth/dev-login', { body: { code } }));
    } catch (e) {
      setError(message(e));
    }
  }
  async function signOut() {
    if (!session) return;
    // Review L-E: signing out clears unsaved notes text, so say so first. PR #110 L-F: a save
    // already on its way (started by this click blurring the notes field) is waited for first.
    await noteSavesSettled();
    if (
      hasNoteDrafts(session.actor_id) &&
      !window.confirm(
        'You have notes that are not saved yet. Signing out deletes them. Sign out anyway?',
      )
    )
      return;
    setError('');
    try {
      await api(z.unknown(), 'auth/logout', {
        body: {},
        csrf: session.csrf_token,
      });
      // ADR-0060 review N-1: unsaved notes copies never outlive the person's session here.
      clearNoteDrafts();
      resetTransfers();
      setSession(null);
    } catch (e) {
      setError(`Sign-out was not confirmed. Try again. ${message(e)}`);
    }
  }
  useEffect(() => {
    if (!persistent) return;
    // A login link carries the code in the fragment, which never reaches a server log.
    function fromLink(): boolean {
      const code = /^#login=([A-Za-z0-9_-]{32,200})$/.exec(
        window.location.hash,
      )?.[1];
      if (!code) return false;
      history.replaceState(null, '', window.location.pathname);
      void signIn(code);
      return true;
    }
    if (!fromLink()) void load();
    window.addEventListener('hashchange', fromLink);
    return () => window.removeEventListener('hashchange', fromLink);
  }, [persistent]);
  return { session, mode, managed, error, signIn, signOut };
}

export function SignIn({
  mode,
  managed = false,
  error,
  signIn,
}: {
  mode: 'dev_local' | 'oidc' | null;
  managed?: boolean;
  error: string;
  signIn: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    void signIn(code.trim());
  }
  return (
    <section className="panel records" aria-labelledby="signin-title">
      <h2 id="signin-title">Sign in to review decisions and records</h2>
      {managed ? (
        <p>
          This studio was started by the Creator Agent desktop app. Choose{' '}
          <strong>Creator Agent → Sign in as local owner</strong> in the window
          menu. Your sign-in is kept on this computer, protected by Windows,
          until it expires or you sign out.
        </p>
      ) : mode === 'oidc' ? (
        <a className="primary link" href="/api/auth/oidc/login">
          Sign in with your identity provider <span aria-hidden="true">↗</span>
        </a>
      ) : (
        <form onSubmit={submit}>
          <p className="small">
            Local development sign-in. The API prints a one-run login link and
            code when it starts. This mode is refused in hosted deployments.
          </p>
          <label htmlFor="code">Login code</label>
          <input
            id="code"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            className="primary"
            disabled={code.trim().length < 32}
            type="submit"
          >
            Sign in <span aria-hidden="true">→</span>
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function Coverage({ d }: { d: Decision }) {
  const b = d.binding;
  if (!b)
    return (
      <p className="small">
        This question authorizes no action; answering it records your input
        only.
      </p>
    );
  return (
    <dl className="coverage">
      <div>
        <dt>Action</dt>
        <dd>{words(b.action_type)}</dd>
      </div>
      <div>
        <dt>Target</dt>
        <dd>
          {b.target
            ? `${b.target.kind} ${b.target.id.slice(0, 8)} · v${b.target.version}`
            : 'none'}
        </dd>
      </div>
      <div>
        <dt>Content hash</dt>
        <dd>
          <code>{short(b.target?.content_hash)}</code>
        </dd>
      </div>
      <div>
        <dt>Spec hash</dt>
        <dd>
          <code>{short(b.spec_hash)}</code>
        </dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>
          {b.amount_nano_usd === null
            ? 'no spend'
            : `${b.amount_nano_usd} nano-USD`}
        </dd>
      </div>
      <div>
        <dt>Data</dt>
        <dd>{dataClassName(b.data_class)} data</dd>
      </div>
      <div>
        <dt>Request expires</dt>
        <dd>{when(d.expires_at)}</dd>
      </div>
    </dl>
  );
}

function DecisionCard({
  d,
  focused,
  folds,
  names,
  csrf,
  workspace,
  onDone,
}: {
  d: Decision;
  focused: boolean;
  folds: Folds;
  names: (id: string) => string;
  csrf: string;
  workspace: string;
  onDone: () => void;
}) {
  const opened = useRef(Date.now());
  const [rationale, setRationale] = useState('');
  const [standing, setStanding] = useState(false);
  const [days, setDays] = useState(7);
  const [interruption, setInterruption] = useState<
    '' | 'useful' | 'unnecessary'
  >('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = d.status === 'pending';
  async function answer(choice: string, option: string | null = null) {
    setBusy(true);
    setError('');
    try {
      await api(
        DecisionSchema,
        `workspaces/${workspace}/decisions/${d.id}/answer`,
        {
          csrf,
          body: {
            choice,
            option_id: option,
            rationale: rationale.trim(),
            coverage_hash: d.coverage.coverage_hash,
            standing_expires_at:
              choice === 'approve_standing'
                ? new Date(Date.now() + days * 86_400_000).toISOString()
                : null,
            time_spent_ms: Date.now() - opened.current,
            interruption: interruption || null,
          },
        },
      );
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || !rationale.trim() || !d.coverage.current;
  return (
    <article
      className={`decision${focused ? ' focused' : ''}`}
      aria-label={`${d.kind} decision`}
    >
      <Fold
        id={d.id}
        folds={folds}
        summary={
          <>
            <span className={`badge kind-${d.kind}`}>
              {d.kind.toUpperCase()}
            </span>{' '}
            {/* Review L-5: the card's heading is in the summary, so it is read once and a
                closed card still has a heading. */}
            <h3 className="question fold-title">
              {d.status === 'pending' ? 'Decision needed' : 'Decision'}:{' '}
              {d.question}
            </h3>
            <span className="fold-line small">
              {words(d.reason)} · {d.status}
              {d.closed_reason ? ` (${words(d.closed_reason)})` : ''}
              {pending ? ` · expires ${when(d.expires_at)}` : ''}
              {d.response ? ` · answered: ${words(d.response.choice)}` : ''}
              {!d.coverage.current && pending && (
                <>
                  {' · '}
                  <span className="fold-attention">
                    cannot be approved: the target changed
                  </span>
                </>
              )}
            </span>
          </>
        }
      >
        <p className="small">
          Asked by {names(d.requested_by)} on {when(d.created_at)} for run{' '}
          {d.run_id.slice(0, 8)}
        </p>
        <dl>
          <div>
            <dt>Evidence</dt>
            <dd>
              {d.evidence_refs.length
                ? d.evidence_refs
                    .map((r) => `${r.id.slice(0, 8)} v${r.version}`)
                    .join(', ')
                : 'none cited'}
            </dd>
          </div>
          <div>
            <dt>Uncertainty</dt>
            <dd>{d.uncertainty}</dd>
          </div>
          <div>
            <dt>If wrong</dt>
            <dd>{d.consequence_if_wrong}</dd>
          </div>
          <div>
            <dt>Blocks</dt>
            <dd>{d.blocked_work.join('; ') || '—'}</dd>
          </div>
          <div>
            <dt>Can continue</dt>
            <dd>{d.unblocked_work.join('; ') || '—'}</dd>
          </div>
          {d.recommendation && (
            <div>
              <dt>Recommendation</dt>
              <dd>
                {d.recommendation}: {d.recommendation_reason}
              </dd>
            </div>
          )}
        </dl>
        <h3>What this decision covers</h3>
        <Coverage d={d} />
        {!d.coverage.current && pending && (
          <p className="error" role="alert">
            The target changed after this request. It cannot be approved; a new
            request is needed.
          </p>
        )}
        {d.response && (
          <p className="small">
            Answered by {names(d.response.responder_id)} on{' '}
            {when(d.response.responded_at)}:{' '}
            <strong>{words(d.response.choice)}</strong>
            {d.response.option_id ? ` (${d.response.option_id})` : ''} ·{' '}
            {d.response.rationale}
          </p>
        )}
        {pending && (
          <>
            <label htmlFor={`why-${d.id}`}>Your reason (required, brief)</label>
            <textarea
              id={`why-${d.id}`}
              rows={2}
              maxLength={1200}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <label htmlFor={`int-${d.id}`}>
              Was this question worth asking?
            </label>
            <select
              id={`int-${d.id}`}
              value={interruption}
              onChange={(e) =>
                setInterruption(e.target.value as typeof interruption)
              }
            >
              <option value="">No answer</option>
              <option value="useful">Yes, useful</option>
              <option value="unnecessary">
                No, an unnecessary interruption
              </option>
            </select>
            <div className="actions">
              {d.kind === 'authorization' ? (
                <>
                  <button
                    className="secondary strong"
                    disabled={disabled}
                    onClick={() => void answer('approve_once')}
                  >
                    Approve this action once
                  </button>
                  {d.coverage.standing && (
                    <button
                      className="secondary"
                      disabled={busy || !d.coverage.current}
                      onClick={() => setStanding((v) => !v)}
                    >
                      Approve as a standing policy…
                    </button>
                  )}
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => void answer('reject')}
                  >
                    Reject
                  </button>
                </>
              ) : (
                d.options.map((o) => (
                  <button
                    key={o.id}
                    className="secondary"
                    title={o.consequence}
                    disabled={disabled}
                    onClick={() => void answer('choose_option', o.id)}
                  >
                    {o.label}
                  </button>
                ))
              )}
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void answer('request_evidence')}
              >
                Request evidence
              </button>
              {(d.kind === 'authorization' ||
                !d.options.some((o) => o.id === 'defer')) && (
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => void answer('defer')}
                >
                  Defer
                </button>
              )}
            </div>
            {standing && d.coverage.standing && (
              <aside
                className="notice policy"
                aria-label="Standing policy preview"
              >
                <strong>This changes policy, not just this action.</strong>
                <span>
                  It lets every future{' '}
                  {words(d.coverage.standing.action_types.join(', '))} on{' '}
                  {d.coverage.standing.target_kind ?? 'any target'} with{' '}
                  {d.coverage.standing.data_classes.join(', ')} data in this run
                  proceed without asking, until the expiry below. You can revoke
                  it at any time.
                </span>
                <label htmlFor={`days-${d.id}`}>
                  Expires after (days, up to 90)
                </label>
                <input
                  id={`days-${d.id}`}
                  type="number"
                  min={1}
                  max={90}
                  value={days}
                  onChange={(e) =>
                    setDays(
                      Math.min(90, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                />
                <button
                  className="secondary strong"
                  disabled={disabled}
                  onClick={() => void answer('approve_standing')}
                >
                  Create standing policy for {days} days
                </button>
              </aside>
            )}
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </Fold>
    </article>
  );
}

/** Pending human decisions, standing policies and runs under oversight. */
export function Oversight({
  session,
  workspace: current,
  focus,
  names,
}: {
  session: SessionInfo;
  workspace: Workspace;
  /** A decision to show first (from a link elsewhere in the page). */
  focus: string;
  names: (id: string) => string;
}) {
  const workspace = current.id;
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [policies, setPolicies] = useState<RoutinePolicyView[]>([]);
  const [runNames, setRunNames] = useState<Map<string, string>>(new Map());
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  // Each load gets a number; only the latest may write, so a slow poll that started before a
  // toggle cannot replace the list the toggle asked for.
  const loadSeq = useRef(0);
  /** `background`: a poll or return refresh, which keeps an error from an action on screen. */
  async function load(background = false) {
    if (!workspace) return;
    const mine = ++loadSeq.current;
    const stale = () => mine !== loadSeq.current;
    if (!background) setError('');
    try {
      const list = await api(
        z.array(DecisionSchema),
        `workspaces/${workspace}/decisions${showAll ? '' : '?status=pending'}`,
      );
      // A linked decision is shown first even when it is no longer pending.
      const linked =
        focus && !list.some((d) => d.id === focus)
          ? await api(
              DecisionSchema,
              `workspaces/${workspace}/decisions/${focus}`,
            )
              .then((d) => [d])
              .catch(() => [])
          : [];
      const grants = await api(
        z.array(GrantSchema),
        `workspaces/${workspace}/grants`,
      );
      const runs = await api(
        z.array(RunControlSchema),
        `workspaces/${workspace}/runs`,
      );
      const policies = await api(
        z.array(RoutinePolicyViewSchema),
        `workspaces/${workspace}/routine-policies`,
      );
      // Run names come from the run records; a run without a readable record has none.
      const named = await api(
        z.array(z.object({ id: z.string(), title: z.string() })),
        `workspaces/${workspace}/entities?kind=run`,
      ).catch(() => []);
      if (stale()) return;
      setRunNames(new Map(named.map((r) => [r.id, r.title])));
      setDecisions(
        [...linked, ...list].sort(
          (a, b) => Number(b.id === focus) - Number(a.id === focus),
        ),
      );
      setGrants(grants);
      setPolicies(policies);
      setRuns(
        [...runs].sort(
          (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
        ),
      );
    } catch (e) {
      if (!stale()) setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, [workspace, showAll, focus]);
  // The page stays mounted while hidden, so coming back (another page sent you here, or the
  // sidebar) loads again, and an open page picks up decisions that runs raise meanwhile.
  const active = usePageActive();
  const latestLoad = useRef(load);
  latestLoad.current = load;
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) void latestLoad.current(true);
    wasActive.current = active;
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void latestLoad.current(true);
    }, 15_000);
    return () => clearInterval(t);
  }, [active]);
  // A failed Revoke or Stop keeps its message on screen (PR #90 re-review N-4): the error is
  // cleared when the action starts, and the reload afterwards is a background one, which
  // never clears it.
  async function revoke(g: Grant) {
    setError('');
    try {
      await api(GrantSchema, `workspaces/${workspace}/grants/${g.id}/revoke`, {
        csrf: session.csrf_token,
        body: {
          expected_version: g.version,
          reason: 'Revoked from the web page',
        },
      });
    } catch (e) {
      setError(message(e));
    }
    await load(true);
  }
  async function cancel(r: RunControl) {
    setError('');
    try {
      await api(
        RunControlSchema,
        `workspaces/${workspace}/runs/${r.run_id}/cancel`,
        {
          csrf: session.csrf_token,
          body: { reason: 'Stopped by the owner from the web page' },
        },
      );
    } catch (e) {
      setError(message(e));
    }
    await load(true);
  }
  // A routine approval policy's own grant is shown with the policy, not as a standing policy.
  const policyGrants = new Set(policies.map((v) => v.policy.grant_id));
  const standing = grants.filter(
    (g) =>
      g.scope === 'standing' &&
      g.status === 'active' &&
      !policyGrants.has(g.id),
  );
  // P18: every waiting decision is open (each needs the person); answered and closed ones,
  // shown with "Show answered and closed", fold to one line.
  const decisionFolds = useFolds(
    decisions
      .filter((d) => d.status === 'pending' || d.id === focus)
      .map((d) => d.id),
  );
  // Review L-7: a decision someone was sent to opens, even if they had collapsed it.
  useEffect(() => {
    if (focus) decisionFolds.set(focus, true);
  }, [focus]);
  // Re-review R-1: the page stays mounted with the same id, so also open it on each return.
  useOnShow(() => {
    if (focus) decisionFolds.set(focus, true);
  });
  const policyRun = (runId: string) => {
    const r = runs.find((x) => x.run_id === runId);
    return r ? runLabel(r, runNames) : `run ${runId.slice(0, 8)}`;
  };
  return (
    <section className="panel records" aria-labelledby="oversight-title">
      <h2 id="oversight-title">Approvals, policies and runs</h2>
      <p>
        Only work that needs a person appears here. Covered, reversible routine
        actions proceed without asking. Approving once permits exactly the
        action shown; a standing policy changes what future actions may do.
      </p>
      <div className="connection">
        <button className="secondary" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Pending only' : 'Show answered and closed'}
        </button>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="records-grid">
        <div>
          <div className="fold-head">
            <h3>{showAll ? 'All decisions' : 'Waiting for you'}</h3>
            <FoldAll
              ids={decisions.map((d) => d.id)}
              folds={decisionFolds}
              label="decisions"
            />
          </div>
          {decisions.length === 0 ? (
            <p className="small">
              {showAll ? 'No decisions yet.' : 'Nothing needs you right now.'}
            </p>
          ) : (
            decisions.map((d) => (
              <DecisionCard
                key={`${d.id}-${d.version}`}
                d={d}
                focused={d.id === focus}
                folds={decisionFolds}
                names={names}
                csrf={session.csrf_token}
                workspace={workspace}
                onDone={() => void load()}
              />
            ))
          )}
        </div>
        <div>
          <h3>Runs under oversight</h3>
          {runs.length === 0 ? (
            <p className="small">No registered runs.</p>
          ) : (
            <ul>
              {runs.map((r) => (
                <li key={r.run_id}>
                  <span className="kind">{words(r.autonomy_mode)}</span>{' '}
                  {runLabel(r, runNames)} · {r.state}
                  <small>
                    {' '}
                    gates: {r.stage_gates.map(words).join(', ') || 'none'}
                  </small>{' '}
                  {r.state === 'active' && (
                    <button className="text" onClick={() => void cancel(r)}>
                      Stop run
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <RoutinePolicies
            policies={policies}
            runName={policyRun}
            session={session}
            workspace={workspace}
            runDataClasses={(runId) => [
              ...new Set([
                ...decisions
                  .filter((d) => d.run_id === runId && d.binding)
                  .map((d) => d.binding!.data_class),
                ...grants
                  .filter(
                    (g) =>
                      g.run_id === runId &&
                      g.status === 'active' &&
                      !policies.some((v) => v.policy.grant_id === g.id),
                  )
                  .flatMap((g) => g.data_classes),
              ]),
            ]}
            eligibleRuns={runs
              .filter(
                (r) =>
                  r.state === 'active' &&
                  (r.autonomy_mode === 'supervised' ||
                    r.autonomy_mode === 'human_in_loop') &&
                  !policies.some(
                    (v) =>
                      v.policy.run_id === r.run_id &&
                      v.policy.status === 'active',
                  ),
              )
              .map((r) => r.run_id)}
            onDone={() => void load()}
          />
          <h3>Standing policies</h3>
          {standing.length === 0 ? (
            <p className="small">
              No standing policies. Every uncovered action asks first.
            </p>
          ) : (
            <ul>
              {standing.map((g) => (
                <li key={g.id}>
                  <span className="kind">v{g.version}</span>{' '}
                  {g.action_types.map(words).join(', ')} ·{' '}
                  {g.run_id ? `run ${g.run_id.slice(0, 8)}` : 'whole workspace'}{' '}
                  · until {when(g.expires_at)}{' '}
                  <button className="text" onClick={() => void revoke(g)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
