import { useEffect, useState, type FormEvent } from 'react';
import {
  ClaimEvidenceSchema,
  RetrievalSchema,
  RunControlSchema,
  SourceBrokerStatusSchema,
  SourceDetailSchema,
  SourceSummarySchema,
  StoredEntitySchema,
  WorkspaceSchema,
  z,
  type ClaimEvidence,
  type Retrieval,
  type RunControl,
  type SessionInfo,
  type SourceDetail,
  type SourceSummary,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';

const TYPE_LABEL: Record<string, string> = {
  source_assertion: 'source asserts',
  quotation: 'quoted',
  observation: 'observed in source',
  inference: 'our inference',
};

/**
 * Sources the broker retrieved, their passages, and what each claim's evidence shows. Fetching
 * goes through the server's source broker under its policy; this page never fetches pages.
 */
export function Evidence({ session }: { session: SessionInfo }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [claims, setClaims] = useState<StoredEntity[]>([]);
  const [retrievals, setRetrievals] = useState<Retrieval[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [evidence, setEvidence] = useState<ClaimEvidence | null>(null);
  const [runId, setRunId] = useState('');
  const [url, setUrl] = useState('');
  const [last, setLast] = useState<Retrieval | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `workspaces/${workspace}`;

  async function load() {
    if (!workspace) return;
    try {
      const [s, c, r, runList] = await Promise.all([
        api(z.array(SourceSummarySchema), `${base}/sources`),
        api(z.array(StoredEntitySchema), `${base}/entities?kind=claim`),
        api(z.array(RetrievalSchema), `${base}/retrievals`),
        api(z.array(RunControlSchema), `${base}/runs`),
      ]);
      setSources(s);
      setClaims(c);
      setRetrievals(r.slice(0, 12));
      const active = runList.filter((x) => x.state === 'active');
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
        const list = await api(z.array(WorkspaceSchema), 'workspaces');
        setWorkspaces(list);
        setWorkspace((c) => c || (list[0]?.id ?? ''));
      } catch (e) {
        setError(message(e));
      }
    })();
  }, []);
  useEffect(() => {
    setSource(null);
    setEvidence(null);
    setLast(null);
    void load();
  }, [workspace]);

  async function openSource(id: string) {
    setError('');
    try {
      setSource(await api(SourceDetailSchema, `${base}/sources/${id}`));
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
  const fixture =
    workspaces.find((w) => w.id === workspace)?.record_mode === 'fixture';

  return (
    <section className="panel records" aria-labelledby="ev-title">
      <div className="eyebrow">06 / SOURCES AND EVIDENCE</div>
      <h2 id="ev-title">Sources and claim evidence</h2>
      <p>
        Pages are fetched only by the server’s source broker, from approved
        hosts, after the run’s grant admits the fetch. Their text is kept as
        evidence and never acted on. A claim counts as supported only by current
        passages it actually quotes; reposts of one story count once.
      </p>
      {status && <p className="small">{status}</p>}
      <div className="connection">
        <label htmlFor="evws" className="inline">
          Workspace
        </label>
        <select
          id="evws"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          {workspaces.length === 0 && (
            <option value="">No workspaces yet</option>
          )}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.record_mode === 'fixture' ? 'FIXTURE' : 'real'}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {fixture && (
        <p className="notice">
          Fixture workspace: pages come from the synthetic corpus on
          .fixture.test hosts (try <code>pnpm cli seed-research</code>). None of
          it is real reporting.
        </p>
      )}
      <form className="connection" onSubmit={(e) => void fetchSource(e)}>
        <label htmlFor="evurl" className="inline">
          Fetch
        </label>
        <input
          id="evurl"
          type="url"
          placeholder="https://approved.host/page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select
          aria-label="Run"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
        >
          {runs.length === 0 && <option value="">No registered runs</option>}
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {words(r.autonomy_mode)} run {r.run_id.slice(0, 8)}
            </option>
          ))}
        </select>
        <button disabled={busy || !runId || !url.trim()}>
          {busy ? 'Fetching…' : 'Fetch'}
        </button>
      </form>
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
              <ul className="links">
                {evidence.rows.map((r) => (
                  <li
                    key={r.support.id}
                    className={r.counted ? '' : 'retracted'}
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
              <ol className="versions">
                {source.passages.map((p) => (
                  <li key={p.id}>
                    <small>
                      ¶{p.locator.paragraph} · {p.locator.start}–{p.locator.end}
                      {p.instruction_like ? ' · instruction-like' : ''}
                    </small>{' '}
                    {p.excerpt ?? (
                      <em>Not retained under this source’s policy.</em>
                    )}
                  </li>
                ))}
              </ol>
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
