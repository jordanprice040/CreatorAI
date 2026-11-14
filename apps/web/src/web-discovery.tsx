import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  RunControlSchema,
  StoredEntitySchema,
  WEB_DISCOVERY_TASK_CLASS,
  WebDiscoveryPreviewSchema,
  WebDiscoverySchema,
  WebDiscoverySummarySchema,
  latestDecided,
  forWebDiscovery,
  z,
  type PlanConnectionDetail,
  type SessionInfo,
  type WebClaimProposal,
  type WebDiscovery,
  type WebDiscoveryPreview,
  type WebLead,
  type Workspace,
  AUTOPILOT_QUOTE_CHECK_LABEL,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { Status, reveal, useLoad } from './ui.js';
import {
  onWebSearchPrefill,
  type WebSearchPrefill,
} from './web-search-handoff.js';

// P12 "Search the web" (ADR-0086). One search request on the owner's ChatGPT plan connection
// uses the provider's own web search; the studio records its search calls and sources, fetches
// the chosen pages with its own guarded fetcher, and a second request reads the stored
// passages. Quotes are checked word for word; only checked claims can be added.

const list = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
const hosts = (s: string) =>
  list(s).map((h) =>
    h
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase(),
  );
const WORKING = new Set(['searching', 'fetching', 'reading']);
const STATE: Record<string, string> = {
  searching: 'Searching the web',
  fetching: 'Fetching the chosen pages',
  reading: 'Reading the stored passages',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};
const DISPOSITION: Record<WebLead['disposition'], string> = {
  selected: 'Chosen',
  not_from_search: 'Not among the search sources',
  excluded_website: 'Excluded website',
  excluded_topic: 'Excluded topic',
  duplicate: 'Duplicate',
  already_in_studio: 'Already in the studio',
  over_limit: 'Over the page limit',
  invalid_url: 'Not a usable web address',
};
const QUALITY: Record<string, string> = {
  usable: 'Usable text',
  challenge: 'Blocked or a sign-in page',
  empty: 'No text',
  low_text: 'Too little text',
  not_fetched: 'Not fetched',
};
const CHECK: Record<WebClaimProposal['check'], string> = {
  verified: 'Quote found on the page',
  unverified: 'Quote not found on the page',
  excluded: 'Excluded topic',
  duplicate: 'Already in the studio',
};

/** Whether this model's newest decided web discovery qualification passed. */
export const webQualified = (d: PlanConnectionDetail, model: string) =>
  latestDecided(
    forWebDiscovery(d.qualifications),
    model,
    WEB_DISCOVERY_TASK_CLASS,
  )?.state === 'qualified';

export function WebDiscover({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const base = `workspaces/${workspace.id}`;
  const owner = workspace.role === 'owner';
  const ctx = useLoad(async () => {
    const [connections, discoveries] = await Promise.all([
      api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
        () => [],
      ),
      api(z.array(WebDiscoverySummarySchema), `${base}/web-discoveries`),
    ]);
    const details = (
      await Promise.all(
        connections
          .filter((c) => c.kind === 'chatgpt_plan')
          .map((c) =>
            api(
              PlanConnectionDetailSchema.passthrough(),
              `${base}/plan-connections/${c.id}`,
            ).catch(() => null),
          ),
      )
    ).filter((d) => d !== null);
    return { details, discoveries: discoveries.slice(0, 10) };
  }, [workspace.id]);
  const c = ctx.data;

  const [interests, setInterests] = useState('');
  const [groups, setGroups] = useState('');
  const [question, setQuestion] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [skip, setSkip] = useState('');
  const [maxFetches, setMaxFetches] = useState(8);
  const [maxClaims, setMaxClaims] = useState(8);
  const [connectionId, setConnectionId] = useState('');
  const [planModel, setPlanModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState('');
  // ADR-0091: "Find evidence on the web" from Compare and decide fills this form.
  const sectionRef = useRef<HTMLElement>(null);
  const [offered, setOffered] = useState<WebSearchPrefill | null>(null);
  const typedRef = useRef({ question: '', interests: '' });
  typedRef.current = {
    question: question.trim(),
    interests: interests.trim(),
  };
  useEffect(
    () =>
      onWebSearchPrefill((p) => {
        // Review N-7: a question or interests the person already typed are kept; the
        // suggestion is offered beside them instead.
        if (typedRef.current.question || typedRef.current.interests)
          setOffered(p);
        else {
          setQuestion(p.question);
          setInterests(p.interests);
          setOffered(null);
        }
        // P-7: opens the Search the web panel first when another panel is open.
        setTimeout(() => reveal(sectionRef.current, 'web-title'), 50);
      }),
    [],
  );

  const plan =
    c?.details.find((p) => p.connection.id === connectionId) ??
    c?.details.find((p) =>
      p.model_access.some(
        (a) =>
          a.path === 'responses' &&
          a.access === 'verified' &&
          webQualified(p, a.model_id),
      ),
    ) ??
    c?.details[0];
  const verified =
    plan?.model_access
      .filter((a) => a.path === 'responses' && a.access === 'verified')
      .map((a) => a.model_id) ?? [];
  const model =
    (verified.includes(planModel) ? planModel : '') ||
    verified.find((m) => plan && webQualified(plan, m)) ||
    verified[0] ||
    '';

  const scope = {
    interests: list(interests),
    target_groups: list(groups),
    question: question.trim() || null,
    exclusions: list(exclusions),
    excluded_hosts: hosts(skip),
    max_search_calls: 3,
    max_fetches: maxFetches,
    max_claims: maxClaims,
  };
  const scopeKey = JSON.stringify(scope);
  const [preview, setPreview] = useState<{
    key: string;
    data: WebDiscoveryPreview | null;
    error: string;
  } | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      api(WebDiscoveryPreviewSchema, `${base}/web-discovery-preview`, {
        csrf: session.csrf_token,
        body: scope,
      }).then(
        (data) =>
          n === seq.current && setPreview({ key: scopeKey, data, error: '' }),
        (e) =>
          n === seq.current &&
          setPreview({ key: scopeKey, data: null, error: message(e) }),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [scopeKey, workspace.id]);
  const current = preview?.key === scopeKey ? preview : null;
  const cap = current?.data?.max_fetches_per_run;

  const live = c?.discoveries.some((d) => WORKING.has(d.state));
  const blockers = [
    ...(plan
      ? plan.blockers
      : [
          'Add and verify a ChatGPT plan connection under Models and connections.',
        ]),
    ...(plan && !model ? ['No verified model on this connection.'] : []),
    ...(plan &&
    !plan.connection.settings.allowed_data_classes.includes('public')
      ? ['This connection does not permit public data.']
      : []),
    ...(plan &&
    !plan.connection.settings.allowed_task_classes.includes(
      WEB_DISCOVERY_TASK_CLASS,
    )
      ? ['This connection does not allow research synthesis work.']
      : []),
    ...(plan && model && !webQualified(plan, model)
      ? [
          `${model} is not qualified for web discovery (the web-discovery-v2 benchmark). Qualify it under Models and connections first.`,
        ]
      : []),
    ...(current?.data?.fetching_available === false
      ? [
          'Live page fetching is turned off for this studio (CREATOR_SOURCE_FETCH=off), so no page could be fetched.',
        ]
      : current?.data?.max_fetches_per_run === null
        ? [
            'No evidence websites are approved for this workspace, so no page could be fetched. Add them in Settings.',
          ]
        : []),
    ...(live
      ? [
          'A web discovery is still working; one runs at a time in a workspace, so wait for it or cancel it.',
        ]
      : []),
  ];
  const ready =
    !busy && owner && !!current?.data && blockers.length === 0 && !!plan;

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!ready || !plan || !current?.data) return;
    setBusy(true);
    setError('');
    let runId = '';
    try {
      const stamp = new Date().toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const run = await api(StoredEntitySchema, `${base}/entities`, {
        csrf: session.csrf_token,
        body: {
          kind: 'run',
          title: `Search the web · ${stamp}`,
          body: {
            state: 'queued',
            experiment_condition: 'human_in_loop',
            discovery_method: 'structured',
            config_hash: null,
          },
        },
      });
      const control = await api(RunControlSchema, `${base}/runs`, {
        csrf: session.csrf_token,
        body: {
          run: { id: run.id, version: 1 },
          autonomy_mode: 'human_in_loop',
          stage_gates: null,
          initial_grants: [],
        },
      });
      runId = control.run_id;
      const d = await api(
        WebDiscoverySchema,
        `${base}/runs/${runId}/web-discoveries`,
        {
          csrf: session.csrf_token,
          body: {
            connection_id: plan.connection.id,
            model_id: model,
            scope: current.data.scope,
            input_hash: current.data.input_hash,
          },
          timeoutMs: 30_000,
        },
      );
      setOpenId(d.id);
      ctx.refresh();
    } catch (err) {
      setError(message(err));
      ctx.refresh();
      if (runId)
        await api(RunControlSchema, `${base}/runs/${runId}/cancel`, {
          csrf: session.csrf_token,
          body: { reason: 'Search the web did not start.' },
        }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const shown = openId || c?.discoveries[0]?.id || '';
  return (
    <section className="explore" aria-labelledby="web-title" ref={sectionRef}>
      <h3 id="web-title">Search the web</h3>
      <p>
        One request on your ChatGPT plan searches the web with the provider's
        own search; the studio keeps the search calls and the pages they
        consulted apart from the model's words. The studio's own fetcher then
        fetches up to {maxFetches} chosen pages under your evidence-site rules,
        and a second request reads the stored text and proposes claims. Every
        quote is checked word for word before a claim can be added, and nothing
        is added without you (or a routine policy that covers the evidence
        stage). No search or browser API is used and nothing is spent.
      </p>
      <Status
        loading={ctx.loading}
        error={ctx.error}
        stale={ctx.stale}
        retry={ctx.reload}
      >
        {c && (
          <>
            <form onSubmit={(e) => void start(e)} noValidate>
              <details>
                <summary>Narrow it (optional)</summary>
                <div className="two">
                  <div>
                    <label htmlFor="w-interests">Interests or fields</label>
                    <input
                      id="w-interests"
                      placeholder="e.g. volunteer scheduling"
                      value={interests}
                      onChange={(e) => setInterests(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="w-groups">Who it might help</label>
                    <input
                      id="w-groups"
                      placeholder="e.g. small clinics"
                      value={groups}
                      onChange={(e) => setGroups(e.target.value)}
                    />
                  </div>
                </div>
                {offered && (
                  <p className="notice small" role="status">
                    Suggested from Compare and decide: “{offered.question}”.
                    Your own entries are kept.{' '}
                    <button
                      type="button"
                      className="text"
                      onClick={() => {
                        setQuestion(offered.question);
                        setInterests(offered.interests);
                        setOffered(null);
                      }}
                    >
                      Use the suggestion
                    </button>{' '}
                    <button
                      type="button"
                      className="text"
                      onClick={() => setOffered(null)}
                    >
                      Dismiss
                    </button>
                  </p>
                )}
                <label htmlFor="w-question">A question to answer</label>
                <input
                  id="w-question"
                  placeholder="e.g. Do text reminders reduce missed appointments?"
                  value={question}
                  maxLength={300}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <div className="two">
                  <div>
                    <label htmlFor="w-exclusions">Topics to leave out</label>
                    <input
                      id="w-exclusions"
                      placeholder="Separate with commas"
                      value={exclusions}
                      onChange={(e) => setExclusions(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="w-skip">Websites not to use</label>
                    <input
                      id="w-skip"
                      placeholder="reddit.com, *.facebook.com"
                      value={skip}
                      onChange={(e) => setSkip(e.target.value)}
                    />
                  </div>
                </div>
                <div className="two">
                  <div>
                    <label htmlFor="w-fetches">Pages to fetch</label>
                    <select
                      id="w-fetches"
                      value={maxFetches}
                      onChange={(e) => setMaxFetches(Number(e.target.value))}
                    >
                      {[3, 5, 8, 12, 15].map((n) => (
                        <option key={n} value={n}>
                          Up to {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="w-claims">Claims to propose</label>
                    <select
                      id="w-claims"
                      value={maxClaims}
                      onChange={(e) => setMaxClaims(Number(e.target.value))}
                    >
                      {[4, 8, 12].map((n) => (
                        <option key={n} value={n}>
                          Up to {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </details>
              <details>
                <summary>
                  Model access: {plan?.connection.label ?? 'no ChatGPT plan'}
                  {model ? ` · ${model}` : ''} · $0
                </summary>
                <div className="two">
                  <div>
                    <label htmlFor="w-conn">Connection</label>
                    <select
                      id="w-conn"
                      value={plan?.connection.id ?? ''}
                      onChange={(e) => {
                        setConnectionId(e.target.value);
                        setPlanModel('');
                      }}
                    >
                      {!c.details.length && (
                        <option value="">No ChatGPT plan connection</option>
                      )}
                      {c.details.map((p) => (
                        <option key={p.connection.id} value={p.connection.id}>
                          {p.connection.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="w-model">Verified model</label>
                    <select
                      id="w-model"
                      value={model}
                      onChange={(e) => setPlanModel(e.target.value)}
                    >
                      {!model && <option value="">No verified model</option>}
                      {verified.map((m) => (
                        <option key={m} value={m}>
                          {m}
                          {plan && webQualified(plan, m)
                            ? ''
                            : ' (not qualified)'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="small">
                  Two requests on your plan (search, then reading), within the
                  connection's accepted caps, and the studio's own page fetches.
                  Public data only. Starting registers a new run; starting is
                  your approval for exactly this discovery's two requests and
                  the pages it chose.
                </p>
              </details>
              <details>
                <summary>
                  What the search request sends
                  {current?.data ? ` (${current.data.chars} characters)` : ''}
                </summary>
                {!current && <p className="small">Reading the preview…</p>}
                {current?.error && <p className="error">{current.error}</p>}
                {current?.data && (
                  <>
                    <p className="small">
                      Instructions, then this input, and nothing from your
                      workspace.
                      {current.data.blocked_domains.length > 0 &&
                        ` The search is told not to use ${current.data.blocked_domains.join(', ')}.`}
                    </p>
                    <pre className="small">{current.data.input}</pre>
                    <p className="small">
                      What you type above (interests, groups, question and
                      topics to leave out) goes to the provider and its web
                      search as public data.
                    </p>
                  </>
                )}
              </details>
              {typeof cap === 'number' && cap < maxFetches && (
                <p className="notice small">
                  Your evidence-site rules allow {cap} page fetch
                  {cap === 1 ? '' : 'es'} per run, so at most {cap} of the{' '}
                  {maxFetches} chosen pages will be fetched.
                </p>
              )}
              {blockers.length > 0 && (
                <ul className="error small">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {!owner && (
                <p className="small">
                  Only the workspace owner can search the web.
                </p>
              )}
              <button className="primary" type="submit" disabled={!ready}>
                {busy ? 'Starting…' : 'Search the web'}
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </form>
            {c.discoveries.length > 0 && (
              <>
                <label htmlFor="w-pick">Web discoveries</label>
                <select
                  id="w-pick"
                  value={shown}
                  onChange={(e) => setOpenId(e.target.value)}
                >
                  {c.discoveries.map((d) => (
                    <option key={d.id} value={d.id}>
                      {when(d.created_at)} · {STATE[d.state] ?? words(d.state)}
                      {d.fixture ? ' · fixture' : ''} · {d.admitted}/
                      {d.proposals} added
                    </option>
                  ))}
                </select>
              </>
            )}
            {shown && (
              <Discovery
                key={shown}
                base={base}
                session={session}
                id={shown}
                owner={owner}
                onChanged={ctx.refresh}
              />
            )}
          </>
        )}
      </Status>
    </section>
  );
}

/** One discovery: progress while it works, then its leads and checked claims. */
function Discovery({
  base,
  session,
  id,
  owner,
  onChanged,
}: {
  base: string;
  session: SessionInfo;
  id: string;
  owner: boolean;
  onChanged: () => void;
}) {
  const [d, setD] = useState<WebDiscovery | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  /** Bumped after an action so polling starts again (for example after Resume). */
  const [tick, setTick] = useState(0);
  const working = !!d && WORKING.has(d.state);
  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout> | undefined;
    let was = '';
    const read = () =>
      api(WebDiscoverySchema, `${base}/web-discoveries/${id}`).then(
        (next) => {
          if (stop) return;
          if (WORKING.has(was) && !WORKING.has(next.state)) onChanged();
          was = next.state;
          setD(next);
          setError('');
          if (WORKING.has(next.state) && next.active)
            t = setTimeout(read, 2500);
        },
        (e) => !stop && setError(message(e)),
      );
    void read();
    return () => {
      stop = true;
      if (t) clearTimeout(t);
    };
  }, [base, id, tick]);

  async function act(
    what: string,
    path: string,
    body: Record<string, unknown> = {},
  ) {
    setBusy(what);
    setError('');
    try {
      setD(
        await api(WebDiscoverySchema, `${base}/web-discoveries/${id}/${path}`, {
          csrf: session.csrf_token,
          body,
        }),
      );
      setTick((n) => n + 1);
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }

  if (!d)
    return error ? (
      <p className="error">{error}</p>
    ) : (
      <p className="small">Loading…</p>
    );
  const pending = d.proposals.filter(
    (p) => p.decision === 'pending' && p.check === 'verified',
  );
  const queries = d.search_calls.flatMap((s) => s.queries);
  const consulted = new Set(d.search_calls.flatMap((s) => s.sources)).size;
  return (
    <article className="card" aria-live="polite">
      <p>
        <strong>{STATE[d.state] ?? words(d.state)}</strong>
        {d.fixture && ' · fixture'} · {d.model_id} · started{' '}
        {when(d.created_at)}
      </p>
      {d.explanation && <p className="small">{d.explanation}</p>}
      {working && !d.active && (
        <p className="notice small">
          The studio stopped while this was working. Resume continues from the
          step it reached; a request that was already sent is not sent again.
        </p>
      )}
      {owner && working && (
        <p>
          {!d.active && (
            <button
              type="button"
              disabled={!!busy}
              onClick={() => void act('resume', 'resume')}
            >
              {busy === 'resume' ? 'Resuming…' : 'Resume'}
            </button>
          )}{' '}
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              void act('cancel', 'cancel', {
                reason: 'Cancelled by the owner.',
              })
            }
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {d.search_calls.length > 0 && (
        <details>
          <summary>
            Search: {d.search_calls.length} call
            {d.search_calls.length === 1 ? '' : 's'}, {consulted} page
            {consulted === 1 ? '' : 's'} consulted
          </summary>
          {queries.length > 0 && (
            <ul className="small">
              {queries.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          {d.draft_summary && (
            <p className="small">
              The model's own summary (a draft, not evidence): {d.draft_summary}
            </p>
          )}
        </details>
      )}
      {d.leads.length > 0 && (
        <details open={d.state !== 'done'}>
          <summary>
            Pages: {d.leads.filter((l) => l.disposition === 'selected').length}{' '}
            chosen of {d.leads.length} named,{' '}
            {d.leads.filter((l) => l.quality === 'usable').length} with usable
            text
          </summary>
          <ul className="small">
            {d.leads.map((l) => (
              <li key={l.ordinal}>
                {/* PR #173 review L-2: only pages the search reported are links. */}
                {l.origin === 'search_source' && /^https?:\/\//i.test(l.url) ? (
                  <a href={l.url} target="_blank" rel="noreferrer noopener">
                    {l.title || l.host}
                  </a>
                ) : (
                  <span>
                    {l.title || l.host} ({l.url})
                  </span>
                )}{' '}
                · {l.host} · {DISPOSITION[l.disposition]}
                {l.quality && ` · ${QUALITY[l.quality] ?? l.quality}`}
                {(l.reason || l.quality_note) && (
                  <>
                    <br />
                    {l.reason ?? l.quality_note}
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {d.proposals.length > 0 && (
        <>
          <h4>Proposed claims</h4>
          <ol>
            {d.proposals.map((p) => (
              <li key={p.id}>
                <Proposal
                  p={p}
                  owner={owner}
                  busy={!!busy}
                  onAdd={() =>
                    void act(`admit-${p.id}`, 'admit', {
                      proposal_ids: [p.id],
                    })
                  }
                  onDismiss={() =>
                    void act(`dismiss-${p.id}`, 'dismiss', {
                      proposal_ids: [p.id],
                    })
                  }
                />
              </li>
            ))}
          </ol>
          {owner && pending.length > 1 && (
            <>
              <p className="small">
                Read each claim's sources and uncertainty first. A checked quote
                is on the page; it may not prove the claim.
              </p>
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void act('admit-all', 'admit', {
                    proposal_ids: pending.map((p) => p.id),
                  })
                }
              >
                {busy === 'admit-all'
                  ? 'Adding…'
                  : `Add all ${pending.length} checked claims`}
              </button>
            </>
          )}
        </>
      )}
      {d.not_covered.length > 0 && (
        <details>
          <summary>What the pages did not cover</summary>
          <ul className="small">
            {d.not_covered.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function Proposal({
  p,
  owner,
  busy,
  onAdd,
  onDismiss,
}: {
  p: WebClaimProposal;
  owner: boolean;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <p>
        <strong>{p.title}</strong> · {CHECK[p.check]} ·{' '}
        {p.basis === 'observation' ? 'Observation' : 'Inference'} ·{' '}
        {p.supporting_sources} supporting source
        {p.supporting_sources === 1 ? '' : 's'}
        {p.contradicting_sources > 0 &&
          `, ${p.contradicting_sources} contradicting`}
      </p>
      <p>{p.statement}</p>
      <p className="small">Uncertainty: {p.uncertainty}</p>
      <ul className="small">
        {p.evidence.map((e, i) => (
          <li key={i}>
            {e.stance === 'contradicts' ? 'Against: ' : ''}“{e.quote}”{' '}
            {e.url ? (
              <a href={e.url} target="_blank" rel="noreferrer noopener">
                {e.ref}
              </a>
            ) : (
              e.ref
            )}{' '}
            · {e.verified ? 'found on the page' : 'not found on the page'}
          </li>
        ))}
      </ul>
      {p.reasons.length > 0 && (
        <ul className="small">
          {p.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {p.decision === 'pending' && owner && p.check === 'verified' && (
        <p>
          <button type="button" disabled={busy} onClick={onAdd}>
            Add claim
          </button>{' '}
          <button type="button" disabled={busy} onClick={onDismiss}>
            Dismiss
          </button>
        </p>
      )}
      {p.decision !== 'pending' && (
        <p className="small">
          {p.decision === 'admitted'
            ? `Added${p.admitted_via === 'routine_policy' ? ' by your routine policy' : p.admitted_via === 'autopilot' ? `: ${AUTOPILOT_QUOTE_CHECK_LABEL}` : ''}`
            : 'Dismissed'}
          {p.decided_at ? ` ${when(p.decided_at)}` : ''}
        </p>
      )}
    </>
  );
}
