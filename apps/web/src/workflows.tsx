import { useEffect, useState, type FormEvent } from 'react';
import {
  EnvelopeSchema,
  PricingSnapshotSchema,
  RunControlSchema,
  StoredEntitySchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  z,
  type DiscoveryResult,
  type Envelope,
  type PricingSnapshot,
  type RunControl,
  type SessionInfo,
  type StoredEntity,
  type Workflow,
  type WorkflowDetail,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { newestFirst } from './versions.js';
import { envelopeFor } from './build-defaults.js';
import { money } from './budgets.js';
import { usePageActive } from './page-drafts.js';

const TERMINAL = ['succeeded', 'failed', 'cancelled'];
const SUBJECT_KINDS = ['idea', 'problem', 'alternative', 'specification'];

/**
 * Starts and monitors durable workflows. The page only reads state the server keeps: closing
 * it does not stop a workflow, and only Cancel does.
 */
export function Workflows({
  session,
  workspace: current,
  focus,
  onFocus,
}: {
  session: SessionInfo;
  workspace: Workspace;
  /** The workflow to open, kept in the page address so a refresh returns to it. */
  focus: string;
  onFocus: (id: string) => void;
}) {
  const workspace = current.id;
  const active = usePageActive();
  const [list, setList] = useState<Workflow[]>([]);
  const selected = focus;
  const setSelected = (u: string | ((c: string) => string)) =>
    onFocus(typeof u === 'function' ? u(focus) : u);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [subjects, setSubjects] = useState<StoredEntity[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [pricing, setPricing] = useState<PricingSnapshot[]>([]);
  const [subject, setSubject] = useState('');
  const [runId, setRunId] = useState('');
  const [perspectives, setPerspectives] = useState(
    'evidence, existing tools, maintenance burden',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `workspaces/${workspace}`;

  async function load() {
    if (!workspace) return;
    try {
      const [w, e, r, b, p] = await Promise.all([
        api(z.array(WorkflowSchema), `${base}/workflows`),
        api(z.array(StoredEntitySchema), `${base}/entities?status=active`),
        api(z.array(RunControlSchema), `${base}/runs`),
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
      ]);
      setList(w);
      const subj = e.filter((x) => SUBJECT_KINDS.includes(x.kind));
      setSubjects(subj);
      const busyRuns = new Set(
        w.filter((x) => !x.finished_at).map((x) => x.run_id),
      );
      const free = r.filter(
        (x) =>
          x.state === 'active' &&
          x.autonomy_mode !== 'human_only' &&
          !busyRuns.has(x.run_id),
      );
      setRuns(newestFirst(free));
      setEnvelopes(newestFirst(b.filter((x) => x.status === 'active')));
      setPricing(newestFirst(p));
      setSubject((c) =>
        subj.some((x) => x.id === c) ? c : (subj[0]?.id ?? ''),
      );
      setRunId((c) =>
        free.some((x) => x.run_id === c)
          ? c
          : (newestFirst(free)[0]?.run_id ?? ''),
      );
      setSelected((c) => c || (w[0]?.id ?? ''));
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    setDetail(null);
    void load();
  }, [workspace]);
  // Poll the durable state while the selected workflow is live.
  useEffect(() => {
    if (!active || !selected || !workspace) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const d = await api(
          WorkflowDetailSchema,
          `${base}/workflows/${selected}`,
        );
        if (stop) return;
        setDetail(d);
        if (!TERMINAL.includes(d.workflow.state))
          timer = setTimeout(poll, 2000);
        else void load();
      } catch (err) {
        if (!stop) setError(message(err));
      }
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [active, selected, workspace]);

  // A run or task budget belongs to its own run; this is the one the chosen run may draw on.
  const runEnvelope = runId ? envelopeFor(envelopes, runId) : undefined;

  async function start(e: FormEvent) {
    e.preventDefault();
    const entity = subjects.find((x) => x.id === subject);
    const envelope = runEnvelope;
    const price = pricing[0];
    if (!entity || !envelope || !price || !runId) return;
    const list = perspectives
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 4);
    setBusy(true);
    setError('');
    try {
      const d = await api(
        WorkflowDetailSchema,
        `${base}/runs/${runId}/workflows`,
        {
          csrf: session.csrf_token,
          body: {
            role: 'r05_skeptic',
            subject: { id: entity.id, version: entity.version },
            constraints: ['Use only the supplied record; it is synthetic.'],
            perspectives: list,
            envelope_id: envelope.id,
            pricing_snapshot_id: price.id,
            data_class: 'synthetic',
            limits: {
              max_children: 4,
              max_concurrency: 2,
              max_depth: 1,
              max_attempts: 1,
              max_repairs: 1,
              max_calls: 10,
              max_output_tokens: 600,
              call_timeout_ms: 60000,
              max_wall_seconds: 1800,
            },
          },
          timeoutMs: 15000,
        },
      );
      setSelected(d.workflow.id);
      setDetail(d);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
    await load();
  }
  async function control(action: 'pause' | 'resume' | 'cancel') {
    if (!detail) return;
    setError('');
    try {
      setDetail(
        await api(
          WorkflowDetailSchema,
          `${base}/workflows/${detail.workflow.id}/${action}`,
          {
            csrf: session.csrf_token,
            body: {
              expected_version: detail.workflow.version,
              reason: `Owner chose ${action} in the web page.`,
            },
          },
        ),
      );
    } catch (err) {
      setError(message(err));
    }
  }
  const wf = detail?.workflow;
  const live = wf && !wf.finished_at;
  const fixture = current.record_mode === 'fixture';
  return (
    <section className="panel records" aria-labelledby="wf-title">
      <h2 id="wf-title">Workflow runs</h2>
      <p>
        A skeptic review critiques one record from several perspectives, then
        combines them. Discovery runs (started from Submit a theme, the API or{' '}
        <code>creator seed-discovery</code>) also show here with each proposal's
        disposition and the skeptic's dissent. Each step is checkpointed in the
        database and runs on the server: closing this page does not stop it. Use
        Cancel to stop it.
      </p>
      <div className="connection">
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {fixture && (
        <p className="notice">
          Fixture workspace: the deterministic adapter answers, so critiques are
          placeholders and amounts are simulated units.
        </p>
      )}
      <div className="records-grid">
        <div>
          <h3>Runs</h3>
          {list.length === 0 ? (
            <p className="small">No workflows yet.</p>
          ) : (
            <ul>
              {list.map((w) => (
                <li key={w.id}>
                  <button
                    className="text"
                    aria-current={w.id === selected}
                    onClick={() => setSelected(w.id)}
                  >
                    <span className={`badge wf-${w.state}`}>
                      {words(w.state)}
                    </span>{' '}
                    {w.role === 'r02_discovery'
                      ? 'Discovery'
                      : 'Skeptic review'}{' '}
                    · {w.perspectives.length} perspectives ·{' '}
                    {when(w.created_at)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={start}>
            <h3>Start a skeptic review</h3>
            <label htmlFor="wsubject">Record</label>
            <select
              id="wsubject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            >
              {subjects.length === 0 && (
                <option value="">No idea or problem records</option>
              )}
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.kind} · {s.title} · v{s.version}
                </option>
              ))}
            </select>
            <label htmlFor="wrun">Run</label>
            <select
              id="wrun"
              value={runId}
              onChange={(e) => setRunId(e.target.value)}
            >
              {runs.length === 0 && (
                <option value="">No free registered run</option>
              )}
              {runs.map((r) => (
                <option key={r.run_id} value={r.run_id}>
                  {words(r.autonomy_mode)} · {r.run_id.slice(0, 8)}
                </option>
              ))}
            </select>
            <label htmlFor="wpersp">
              Perspectives (comma-separated, up to 4)
            </label>
            <input
              id="wpersp"
              value={perspectives}
              onChange={(e) => setPerspectives(e.target.value)}
            />
            <button
              className="primary"
              type="submit"
              disabled={
                busy || !subject || !runId || !runEnvelope || !pricing.length
              }
            >
              Start <span aria-hidden="true">→</span>
            </button>
            {(!envelopes.length || !pricing.length) && (
              <p className="small">
                Needs an active budget and a pricing snapshot.
              </p>
            )}
            {envelopes.length > 0 && runId && !runEnvelope && (
              <p className="small">
                No active budget can be used by this run: a run or task budget
                belongs to its own run. Pick another run or add a shared budget
                in Budgets.
              </p>
            )}
          </form>
        </div>
        <div>
          {!wf ? (
            <p className="small">Select or start a workflow.</p>
          ) : (
            <article className="decision" aria-live="polite">
              <div className="decision-head">
                <span className="kind">
                  {wf.role_version} · {wf.id.slice(0, 8)}
                </span>
                <span className={`badge wf-${wf.state}`}>
                  {words(wf.state)}
                </span>
              </div>
              <p className="small">
                {words(wf.reason)} · step {wf.steps} · deadline{' '}
                {when(wf.deadline_at)}
                {wf.control !== 'run' ? ` · ${wf.control} requested` : ''}
              </p>
              {live && (
                <div className="actions">
                  {wf.control === 'run' && (
                    <button
                      className="secondary"
                      onClick={() => void control('pause')}
                    >
                      Pause
                    </button>
                  )}
                  {wf.control === 'pause' && (
                    <button
                      className="secondary"
                      onClick={() => void control('resume')}
                    >
                      Resume
                    </button>
                  )}
                  {wf.control !== 'cancel' && (
                    <button
                      className="secondary"
                      onClick={() => void control('cancel')}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
              <h3>Steps</h3>
              <ul>
                {detail.tasks.map((t) => (
                  <li key={t.id}>
                    <span className={`kind task-${t.state}`}>
                      {words(t.state)}
                    </span>{' '}
                    {t.kind}
                    {t.context.perspective ? ` · ${t.context.perspective}` : ''}
                    {'proposal' in t.context && t.context.proposal
                      ? ` · ${t.context.proposal}`
                      : ''}
                    {t.round ? ` · round ${t.round}` : ''}
                    {t.repair ? ` · repair ${t.repair}` : ''}
                    <br />
                    <small>
                      {words(t.reason)} · delivered {t.deliveries}×
                      {t.state === 'waiting_human'
                        ? ' · answer it under Human decisions'
                        : ''}
                    </small>
                  </li>
                ))}
              </ul>
              {detail.subscription_usage ? (
                <p className="small">
                  {detail.subscription_usage.requests} subscription requests ·{' '}
                  {detail.subscription_usage.in_flight} in flight ·{' '}
                  {detail.subscription_usage.unresolved} unresolved. No API
                  money envelope is used; quota is shared with other plan use.
                </p>
              ) : (
                <p className="small">
                  {detail.usage.attempts} calls · charged{' '}
                  {money(detail.usage.incurred, wf.fixture)} · in flight{' '}
                  {money(detail.usage.reserved, wf.fixture)} · unknown (held){' '}
                  {money(detail.usage.unknown, wf.fixture)}
                </p>
              )}
              {wf.result && (
                <>
                  <h3>Result: {words(wf.result.outcome)}</h3>
                  <p>{wf.result.explanation}</p>
                  {wf.result.discovery && (
                    <Discovery result={wf.result.discovery} />
                  )}
                  {wf.result.synthesis && (
                    <p>
                      <strong>{words(wf.result.synthesis.disposition)}</strong>:{' '}
                      {wf.result.synthesis.summary}
                    </p>
                  )}
                </>
              )}
              <details>
                <summary>Inspect bindings, context hashes and outputs</summary>
                <pre>{JSON.stringify(detail, null, 2)}</pre>
              </details>
            </article>
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

/** One discovery run's outcome: every proposal, why it ended where it did, and the dissent. */
function Discovery({ result }: { result: DiscoveryResult }) {
  return (
    <div className="discovery">
      <p className="small">
        Evidence {words(result.sufficiency.verdict)} · mechanism{' '}
        {result.locator
          ? words(result.locator.mechanism_support)
          : 'not located'}{' '}
        · {result.skeptic_passes} skeptic passes · {result.revision_rounds}{' '}
        revision rounds · independence{' '}
        {result.independence.verified ? 'verified' : 'NOT verified'}
      </p>
      {result.sufficiency.reasons.length > 0 && (
        <ul className="small">
          {result.sufficiency.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <ul>
        {result.proposals.map((p) => (
          <li key={p.proposal}>
            <span className="kind">{words(p.disposition)}</span>{' '}
            <strong>
              {p.proposal} · {words(p.perspective)}
            </strong>
            {p.title ? `: ${p.title}` : ''}
            {p.reasons.map((r) => (
              <small key={r}>
                <br />
                {r}
              </small>
            ))}
            {p.dissent.length > 0 && (
              <details>
                <summary>Skeptic findings ({p.dissent.length})</summary>
                <ul>
                  {p.dissent.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
        {result.excluded.map((x) => (
          <li key={x.perspective}>
            <span className="kind">excluded</span>{' '}
            <strong>{words(x.perspective)}</strong>: {x.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
