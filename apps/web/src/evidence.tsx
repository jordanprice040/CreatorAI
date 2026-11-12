import type { Prefill } from './prefill.js';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ClaimEvidenceSchema,
  ClaimSupportSchema,
  GrantSchema,
  RetrievalSchema,
  RunControlSchema,
  SourceBrokerStatusSchema,
  SourceDetailSchema,
  SourceSummarySchema,
  StoredEntitySchema,
  z,
  type ClaimEvidence,
  type Retrieval,
  type RunControl,
  type SessionInfo,
  type SourceDetail,
  type SourceSummary,
  type SupportStance,
  type SupportType,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { newestFirst } from './versions.js';
import { useOnShow } from './page-active.js';
import { recordLabel, runLabel } from './labels.js';
import { runNames } from './ui.js';
import { REASON_MAX } from './owner-actions.js';
import { ReasonForm } from './reason-form.js';
import { Routine, WhatWillHappen } from './routine.js';
import { ClaimLinks } from './link-claims.js';

type Passage = SourceDetail['passages'][number];
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A few pages of the server's synthetic corpus (packages/research/src/fixture.ts). */
const FIXTURE_PAGES = [
  'https://health.fixture.test/reports/clinic-access-2025',
  'https://wire.fixture.test/stories/clinic-waits',
  'https://journal.fixture.test/articles/wait-time-survey',
  'https://health.fixture.test/reports/staffing-brief',
  'https://forum.fixture.test/threads/clinic-tips',
];

const TYPE_LABEL: Record<SupportType, string> = {
  source_assertion: 'source asserts',
  quotation: 'quoted',
  observation: 'observed in source',
  inference: 'our inference',
};

/**
 * Sources the broker retrieved, their passages, and what each claim's evidence shows. Fetching
 * goes through the server's source broker under its policy; this page never fetches pages.
 */
export function Evidence({
  session,
  workspace: current,
  focus,
  onFocus,
  prefill = null,
}: {
  session: SessionInfo;
  workspace: Workspace;
  /** `claim:<id>` or `source:<id>`, kept in the page address. */
  focus: string;
  onFocus: (focus: string) => void;
  /** An address handed over from Chat for the fetch form. */
  prefill?: Prefill;
}) {
  const workspace = current.id;
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [claims, setClaims] = useState<StoredEntity[]>([]);
  const [retrievals, setRetrievals] = useState<Retrieval[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [evidence, setEvidence] = useState<ClaimEvidence | null>(null);
  const [runId, setRunId] = useState('');
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!prefill) return;
    setUrl(prefill.value);
    prefill.used();
  }, [prefill?.nonce]);
  const [last, setLast] = useState<Retrieval | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cite, setCite] = useState<Passage | null>(null);
  // The claim evidence row whose "Retract…" form is open.
  const [retracting, setRetracting] = useState('');
  // A claim the cite form saved whose evidence step then failed. Kept here, not in the form,
  // so switching passages attaches to it instead of creating it again.
  const [unevidenced, setUnevidenced] = useState<StoredEntity | null>(null);
  const base = `workspaces/${workspace}`;
  const editor = current.role !== 'viewer';
  // Registering runs and granting permissions is the workspace owner's (server-enforced).
  const owner = current.role === 'owner';

  async function load() {
    if (!workspace) return;
    try {
      const [s, c, r, runList, n] = await Promise.all([
        api(z.array(SourceSummarySchema), `${base}/sources`),
        api(z.array(StoredEntitySchema), `${base}/entities?kind=claim`),
        api(z.array(RetrievalSchema), `${base}/retrievals`),
        api(z.array(RunControlSchema), `${base}/runs`),
        runNames(base),
      ]);
      setSources(s);
      setClaims(newestFirst(c));
      setNames(n);
      setRetrievals(r.slice(0, 12));
      const active = newestFirst(runList.filter((x) => x.state === 'active'));
      setRuns(active);
      setRunId((cur) =>
        active.some((x) => x.run_id === cur) ? cur : (active[0]?.run_id ?? ''),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const st = await api(SourceBrokerStatusSchema, 'sources/status');
        setStatus(st.note);
      } catch (e) {
        setError(message(e));
      }
    })();
  }, []);
  useEffect(() => {
    setSource(null);
    setEvidence(null);
    setLast(null);
    setUnevidenced(null);
    void load();
  }, [workspace]);
  // Shown again after work elsewhere: read sources, claims and runs again; open items stay.
  useOnShow(() => void load());
  useEffect(() => {
    const [kind, id] = focus.split(':');
    if (!id) return;
    if (kind === 'claim' && evidence?.claim.id !== id) void openClaim(id);
    if (kind === 'source' && source?.source.id !== id) void openSource(id);
  }, [focus, workspace]);

  async function openSource(id: string) {
    setError('');
    try {
      setSource(await api(SourceDetailSchema, `${base}/sources/${id}`));
      onFocus(`source:${id}`);
    } catch (e) {
      setError(message(e));
    }
  }
  async function openClaim(id: string) {
    setError('');
    try {
      setEvidence(
        await api(ClaimEvidenceSchema, `${base}/claims/${id}/evidence`),
      );
      onFocus(`claim:${id}`);
    } catch (e) {
      setError(message(e));
    }
  }
  async function fetchSource(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api(
        RetrievalSchema,
        `${base}/runs/${runId}/source-fetches`,
        {
          body: {
            url: url.trim(),
            task_id: null,
            logical_operation_id: crypto.randomUUID(),
            justification: 'Requested from the Evidence panel.',
          },
          csrf: session.csrf_token,
          timeoutMs: 30_000,
        },
      );
      setLast(r);
      await load();
      if (r.source_id) await openSource(r.source_id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  /**
   * Registers a run whose only permission is fetching public pages for 24 hours, so sources
   * can be gathered before any discovery. The grant is listed (and revocable) under Decisions.
   */
  async function registerRun() {
    setBusy(true);
    setError('');
    try {
      const run = await api(StoredEntitySchema, `${base}/entities`, {
        csrf: session.csrf_token,
        body: {
          kind: 'run',
          title: 'Evidence gathering',
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
      await api(GrantSchema, `${base}/grants`, {
        csrf: session.csrf_token,
        body: {
          run_id: control.run_id,
          action_types: ['source.fetch'],
          target_kind: null,
          max_amount_nano_usd: null,
          allow_irreversible: false,
          allow_external_effects: false,
          data_classes: ['public'],
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          rationale: 'Fetch public pages from the Evidence view.',
        },
      });
      await load();
      setRunId(control.run_id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const fixture = current.record_mode === 'fixture';

  return (
    <section className="panel records" aria-labelledby="ev-title">
      <h2 id="ev-title">Sources and claim evidence</h2>
      <p>
        Pages are fetched only by the server’s source broker, from approved
        hosts, after the run’s grant admits the fetch. Their text is kept as
        evidence and never acted on. A claim counts as supported only by current
        passages it actually quotes; reposts of one story count once.
      </p>
      {status && <p className="small">{status}</p>}
      <div className="connection">
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {fixture && (
        <p className="notice">
          Fixture workspace: pages come from the synthetic corpus on
          .fixture.test hosts (the address field suggests some). None of it is
          real reporting.
        </p>
      )}
      <form className="fetch-row" onSubmit={(e) => void fetchSource(e)}>
        <label htmlFor="evurl" className="inline">
          Fetch a page
        </label>
        <input
          id="evurl"
          type="url"
          placeholder="https://approved.host/page"
          list={fixture ? 'fixture-pages' : undefined}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {fixture && (
          <datalist id="fixture-pages">
            {FIXTURE_PAGES.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        )}
        <select
          aria-label="Run"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
        >
          {runs.length === 0 && <option value="">No registered runs</option>}
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {runLabel(r, names)}
            </option>
          ))}
        </select>
        <button
          disabled={busy || !runId || !url.trim()}
          title={
            !runId
              ? 'Register a run first; each fetch runs under a run’s permission'
              : !url.trim()
                ? 'Enter the page address to fetch'
                : undefined
          }
        >
          {busy ? 'Fetching…' : 'Fetch'}
        </button>
        {owner && runs.length === 0 && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void registerRun()}
          >
            Register a run for fetching
          </button>
        )}
      </form>
      {owner && runs.length === 0 && (
        <p className="small">
          Registering a run lets it fetch public pages for 24 hours and nothing
          else. You can revoke that under Monitor › Approvals.
          {!fixture &&
            ' Real pages are fetched only while live fetching is on.'}
        </p>
      )}
      {last && (
        <p className={`small ret-${last.state}`} role="status">
          <span className="badge">{words(last.state)}</span>{' '}
          {words(last.reason_code)}: {last.explanation}
        </p>
      )}
      <div className="records-grid">
        <div>
          <h3>Sources</h3>
          {sources.length === 0 ? (
            <p className="small">No retrieved sources.</p>
          ) : (
            <ul className="entities">
              {sources.map((s) => (
                <li key={s.id}>
                  <button
                    className="text"
                    aria-current={source?.source.id === s.id}
                    onClick={() => void openSource(s.id)}
                  >
                    <span className={`badge src-${s.retrieval_status}`}>
                      {s.retrieval_status}
                    </span>{' '}
                    {s.title}
                    <small>
                      {' '}
                      v{s.version}
                      {s.cluster_size > 1
                        ? ` · 1 of ${s.cluster_size} from one origin`
                        : ''}
                      {s.instruction_like ? ' · has instruction-like text' : ''}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3>Claims</h3>
          {unevidenced && !cite && (
            <p className="notice">
              “{unevidenced.title}” has no evidence yet. Cite a passage for it
              from a source (pick it in the claim list of the form).
            </p>
          )}
          {claims.length === 0 ? (
            <p className="small">No claims.</p>
          ) : (
            <ul className="entities">
              {claims.map((c) => (
                <li key={c.id}>
                  <button
                    className="text"
                    aria-current={evidence?.claim.id === c.id}
                    onClick={() => void openClaim(c.id)}
                  >
                    {c.title} <small>v{c.version}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h3>Recent fetches</h3>
          {retrievals.length === 0 ? (
            <p className="small">None yet.</p>
          ) : (
            <ol className="history">
              {retrievals.map((r) => (
                <li key={r.id} className={`ret-${r.state}`}>
                  <span>{words(r.state)}</span> {r.requested_url}
                  <small> {words(r.reason_code)}</small>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div>
          {evidence && (
            <>
              <h3>Claim: {evidence.claim.title}</h3>
              <p>
                <span className={`badge ev-${evidence.status}`}>
                  {words(evidence.status)}
                </span>{' '}
                {evidence.explanation}
              </p>
              {evidence.labels.length > 0 && (
                <ul className="small">
                  {evidence.labels.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              <ClaimLinks
                key={evidence.claim.id}
                session={session}
                workspace={current}
                claimId={evidence.claim.id}
                editor={editor}
              />
              <ul className="links">
                {evidence.rows.map((r) => (
                  <li
                    key={r.support.id}
                    // PR #129 review N-1: the row is not struck through while its retract
                    // form is open, so the form reads normally.
                    className={
                      r.counted || retracting === r.support.id
                        ? ''
                        : 'retracted'
                    }
                  >
                    <span className="relation">{words(r.support.stance)}</span>{' '}
                    {r.support.support_type
                      ? `${TYPE_LABEL[r.support.support_type]} · `
                      : ''}
                    <button
                      className="text"
                      onClick={() => void openSource(r.support.source_id)}
                    >
                      {r.source_title} · v{r.support.source_version}
                    </button>
                    <small>
                      {' '}
                      {words(r.freshness)}
                      {r.counted ? ' · counted' : ' · not counted'}
                    </small>
                    {r.support.quote && (
                      <blockquote>“{r.support.quote}”</blockquote>
                    )}
                    {r.support.retracted_at && (
                      <small className="retraction">
                        Retracted {when(r.support.retracted_at)}
                        {r.support.retraction_reason
                          ? `: ${r.support.retraction_reason}`
                          : ''}
                      </small>
                    )}
                    {/* Was `pnpm cli support-retract` only; editors and the owner may retract. */}
                    {editor &&
                      !r.support.retracted_at &&
                      (retracting === r.support.id ? (
                        <ReasonForm
                          id={`retract-${r.support.id}`}
                          label="Why this evidence is wrong"
                          placeholder="e.g. the quote is about a different clinic"
                          note="The link stays on record, marked retracted, and no longer counts toward this claim's support. It can't be undone; cite the passage again if you need it back."
                          confirm="Retract it"
                          busyLabel="Retracting…"
                          keep="Keep it"
                          max={REASON_MAX.retract}
                          onCancel={() => setRetracting('')}
                          onConfirm={async (reason) => {
                            try {
                              await api(
                                z.unknown(),
                                `${base}/claim-support/${r.support.id}/retract`,
                                {
                                  csrf: session.csrf_token,
                                  body: { reason },
                                },
                              );
                            } catch (err) {
                              return message(err);
                            }
                            setRetracting('');
                            await openClaim(evidence.claim.id);
                            return null;
                          }}
                        />
                      ) : (
                        <button
                          className="text"
                          onClick={() => setRetracting(r.support.id)}
                        >
                          Retract…
                        </button>
                      ))}
                  </li>
                ))}
              </ul>
            </>
          )}
          {source && (
            <>
              <h3>Source: {source.source.title}</h3>
              <p className="small">
                {source.source.url} · v{source.source.version} ·{' '}
                {source.source.retention === 'hash_only'
                  ? 'hashes only (no excerpts kept)'
                  : 'excerpts kept'}
                {source.source.published_at
                  ? ` · published ${when(source.source.published_at)}`
                  : ''}
                {source.source.last_fetched_at
                  ? ` · checked ${when(source.source.last_fetched_at)}`
                  : ''}
              </p>
              <p className="small">
                Origin: {source.source.cluster_reason}
                {source.same_origin.length > 0 &&
                  ` · same origin as ${source.same_origin.map((s) => s.url).join(', ')}`}
              </p>
              {source.source.instruction_like && (
                <p className="notice">
                  This page contains text that reads like instructions. It is
                  stored as evidence only; it cannot change grants, policy or
                  what gets fetched.
                </p>
              )}
              {(() => {
                const item = (p: Passage) => (
                  <li key={p.id}>
                    <small>
                      ¶{p.locator.paragraph} · {p.locator.start}–{p.locator.end}
                      {p.instruction_like ? ' · instruction-like' : ''}
                    </small>{' '}
                    {p.excerpt ?? (
                      <em>Not retained under this source’s policy.</em>
                    )}
                    {editor && p.excerpt && (
                      <>
                        {' '}
                        <button className="text" onClick={() => setCite(p)}>
                          Cite in a claim
                        </button>
                      </>
                    )}
                  </li>
                );
                // Walkthrough item 15: menus, buttons and other page furniture fold away.
                const furniture = source.passages.filter((p) => p.boilerplate);
                return (
                  <>
                    <ol className="versions">
                      {source.passages.filter((p) => !p.boilerplate).map(item)}
                    </ol>
                    {furniture.length > 0 && (
                      <details>
                        <summary>
                          Page furniture: {furniture.length} passage
                          {furniture.length === 1 ? '' : 's'} (menus, buttons,
                          headers and footers)
                        </summary>
                        <ol className="versions">{furniture.map(item)}</ol>
                      </details>
                    )}
                  </>
                );
              })()}
              {cite && source.passages.some((p) => p.id === cite.id) && (
                <CiteForm
                  key={cite.id}
                  passage={cite}
                  claims={claims}
                  base={base}
                  csrf={session.csrf_token}
                  created={unevidenced}
                  onCreated={(c) => {
                    setUnevidenced(c);
                    void load();
                  }}
                  release={() => setUnevidenced(null)}
                  cancel={() => setCite(null)}
                  done={async (claimId) => {
                    setUnevidenced(null);
                    setCite(null);
                    await load();
                    await openClaim(claimId);
                  }}
                />
              )}
            </>
          )}
          {!evidence && !source && (
            <p className="small">Choose a source or a claim.</p>
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

const STANCE_TEXT: Record<Exclude<SupportStance, 'inaccessible'>, string> = {
  supports: 'supports the claim',
  contradicts: 'contradicts the claim',
  does_not_support: 'does not support it',
};

/**
 * Records a claim's evidence from one stored passage, for a new claim or an existing one.
 * The server checks that a supporting or contradicting quote occurs verbatim in the passage.
 */
function CiteForm({
  passage,
  claims,
  base,
  csrf,
  created,
  onCreated,
  release,
  cancel,
  done,
}: {
  passage: Passage;
  claims: StoredEntity[];
  base: string;
  csrf: string;
  /** A claim already saved by this page whose evidence is still missing. */
  created: StoredEntity | null;
  onCreated: (claim: StoredEntity) => void;
  release: () => void;
  cancel: () => void;
  done: (claimId: string) => Promise<void>;
}) {
  const [claimId, setClaimId] = useState('new');
  const [statement, setStatement] = useState('');
  const [basis, setBasis] = useState<'observation' | 'inference'>(
    'observation',
  );
  const [uncertainty, setUncertainty] = useState('');
  const [stance, setStance] =
    useState<Exclude<SupportStance, 'inaccessible'>>('supports');
  const [type, setType] = useState<SupportType>('source_assertion');
  const [quote, setQuote] = useState((passage.excerpt ?? '').slice(0, 1000));
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One key per claim being created: a retried create returns the same claim; choosing
  // another claim starts a new key, so a different statement is never a replay conflict.
  const [key, setKey] = useState(() => crypto.randomUUID());
  // Opening the form moves focus (and the view) to it; it sits below the passages.
  useEffect(() => document.getElementById('cite-claim')?.focus(), []);
  const existing = created ?? claims.find((c) => c.id === claimId);
  const quoted = stance !== 'does_not_support';
  const q = squash(quote);
  const missing = [
    !existing && !statement.trim() && 'a statement',
    !existing && !uncertainty.trim() && 'what is still uncertain',
    (quoted || q) && q.length < 8 && 'a quote of at least 8 characters',
    !rationale.trim() && 'why it bears on the claim',
  ].filter(Boolean);
  // ADR-0082 (P19): the one routine choice here. Basis and stance stay open: they say what the
  // evidence is, so a default must never decide them unseen.
  const routineSummary = `Kind of evidence: ${TYPE_LABEL[type]} · ${type === 'source_assertion' ? 'studio default' : 'changed here'}`;
  // The server's check (quoteInPassage): the quote must occur in the passage, spaces aside.
  const verbatim = !q || squash(passage.excerpt ?? '').includes(q);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (missing.length) return;
    if (!verbatim) {
      setError(
        'The quote must appear exactly in the passage. Copy it from the passage text.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const claim =
        existing ??
        (await api(StoredEntitySchema, `${base}/entities`, {
          csrf,
          idempotencyKey: key,
          body: {
            kind: 'claim',
            title: statement.trim().slice(0, 120),
            body: {
              statement: statement.trim(),
              basis,
              uncertainty: uncertainty.trim(),
            },
          },
        }));
      if (!existing) onCreated(claim);
      await api(ClaimSupportSchema, `${base}/claims/${claim.id}/support`, {
        csrf,
        body: {
          evidence: 'passage',
          claim_version: claim.version,
          passage_id: passage.id,
          stance,
          support_type: type,
          quote: q ? quote.trim() : null,
          rationale: rationale.trim(),
        },
      });
      await done(claim.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="cite" onSubmit={(e) => void submit(e)}>
      <h4>Cite ¶{passage.locator.paragraph} in a claim</h4>
      {created ? (
        <p className="small" id="cite-claim" tabIndex={-1}>
          “{created.title}” is saved but has no evidence yet. Fix what is below
          and save again to attach this passage to it, or{' '}
          <button
            type="button"
            className="text"
            onClick={() => {
              setKey(crypto.randomUUID());
              release();
            }}
          >
            choose another claim
          </button>{' '}
          (it stays in the list without evidence).
        </p>
      ) : (
        <label htmlFor="cite-claim">Claim</label>
      )}
      {!created && (
        <select
          id="cite-claim"
          value={claimId}
          onChange={(e) => setClaimId(e.target.value)}
        >
          <option value="new">New claim</option>
          {claims.map((c) => (
            <option key={c.id} value={c.id} title={c.title}>
              {recordLabel(c, 80)}
            </option>
          ))}
        </select>
      )}
      {!existing && (
        <>
          <label htmlFor="cite-statement">Statement</label>
          <textarea
            id="cite-statement"
            rows={2}
            maxLength={2000}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
          />
          <label htmlFor="cite-basis">Basis</label>
          <select
            id="cite-basis"
            value={basis}
            onChange={(e) =>
              setBasis(e.target.value as 'observation' | 'inference')
            }
          >
            <option value="observation">Observation</option>
            <option value="inference">Inference</option>
          </select>
          <label htmlFor="cite-uncertainty">What is still uncertain</label>
          <input
            id="cite-uncertainty"
            maxLength={2000}
            value={uncertainty}
            onChange={(e) => setUncertainty(e.target.value)}
          />
        </>
      )}
      <label htmlFor="cite-stance">This passage</label>
      <select
        id="cite-stance"
        value={stance}
        onChange={(e) =>
          setStance(e.target.value as Exclude<SupportStance, 'inaccessible'>)
        }
      >
        <option value="supports">supports the claim</option>
        <option value="contradicts">contradicts the claim</option>
        <option value="does_not_support">does not support it</option>
      </select>
      <Routine summary={routineSummary}>
        <label htmlFor="cite-type">Kind of evidence</label>
        <select
          id="cite-type"
          value={type}
          onChange={(e) => setType(e.target.value as SupportType)}
        >
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Routine>
      <label htmlFor="cite-quote">
        Quote{quoted ? '' : ' (optional)'}. Shorten it to the words that bear on
        the claim, exactly as they appear in the passage.
      </label>
      <textarea
        id="cite-quote"
        rows={3}
        maxLength={1000}
        value={quote}
        onChange={(e) => setQuote(e.target.value)}
      />
      <label htmlFor="cite-rationale">Why it bears on the claim</label>
      <input
        id="cite-rationale"
        maxLength={1200}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
      />
      {missing.length > 0 && (
        <p className="small">Still needed: {missing.join(', ')}.</p>
      )}
      <WhatWillHappen
        items={[
          {
            label: 'Claim',
            value: existing
              ? `Adds evidence to “${recordLabel(existing, 80)}”`
              : `Saves a new claim${statement.trim() ? `: “${statement.trim().slice(0, 80)}”` : ''}`,
          },
          {
            label: 'Evidence',
            value: `¶${passage.locator.paragraph} of this source, marked as it ${STANCE_TEXT[stance]}${q ? ', quoting the words above' : ''}`,
          },
        ]}
        note="Only the passage you chose is attached, and the server checks that the quote is in it. Nothing is fetched or sent anywhere."
      />
      <div className="actions">
        <button className="primary" disabled={busy || missing.length > 0}>
          {busy ? 'Saving…' : 'Save evidence'}
        </button>
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
