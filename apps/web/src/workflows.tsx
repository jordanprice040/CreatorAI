import { useEffect, useState, type FormEvent } from 'react';
import { useViewMode } from './view-mode.js';
import { Money } from './money.js';
import {
  EnvelopeSchema,
  EvidencePacketSchema,
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
import { useOnShow, usePageActive } from './page-drafts.js';
import {
  clipText,
  distinctLabels,
  recordLabel,
  ROLE_NAME,
  runLabel,
  runName,
} from './labels.js';
import { runNames } from './ui.js';
import { Term } from './term.js';
import { ClaimText, claimHref, usePacketClaims } from './claim-ref.js';

const TERMINAL = ['succeeded', 'failed', 'cancelled'];
/** Record kinds a skeptic review can examine, in the order the picker groups them. */
const SUBJECT_KINDS = ['problem', 'idea', 'alternative', 'specification'];
const KIND_GROUP: Record<string, string> = {
  problem: 'Problems',
  idea: 'Ideas',
  alternative: 'Options',
  specification: 'Specifications',
};

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
  const { standard } = useViewMode();
  const workspace = current.id;
  const active = usePageActive();
  const [list, setList] = useState<Workflow[]>([]);
  const selected = focus;
  const setSelected = (u: string | ((c: string) => string)) =>
    onFocus(typeof u === 'function' ? u(focus) : u);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [subjects, setSubjects] = useState<StoredEntity[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [pricing, setPricing] = useState<PricingSnapshot[]>([]);
  const [subject, setSubject] = useState('');
  const [runId, setRunId] = useState('');
  const [perspectives, setPerspectives] = useState(
    'evidence, existing tools, maintenance burden',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The evidence packet a discovery was given (was `pnpm cli discovery-packet` only).
  const [packet, setPacket] = useState<{
    workflow: string;
    packet: z.infer<typeof EvidencePacketSchema>;
    packet_hash: string;
  } | null>(null);
  // Keyed by workflow like `packet`, so an error never shows under another discovery
  // (PR #129 review L-4); `packetBusy` holds the one request in flight (N-3).
  const [packetError, setPacketError] = useState<{
    workflow: string;
    text: string;
  } | null>(null);
  const [packetBusy, setPacketBusy] = useState('');
  const base = `workspaces/${workspace}`;

  async function load() {
    if (!workspace) return;
    try {
      const [w, e, r, b, p, n] = await Promise.all([
        api(z.array(WorkflowSchema), `${base}/workflows`),
        api(z.array(StoredEntitySchema), `${base}/entities?status=active`),
        api(z.array(RunControlSchema), `${base}/runs`),
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
        runNames(base),
      ]);
      setList(newestFirst(w));
      setNames(n);
      const subj = newestFirst(e.filter((x) => SUBJECT_KINDS.includes(x.kind)));
      setSubjects(subj);
      // Default to the newest problem or idea, which is what a review usually examines.
      const preferred =
        subj.find((x) => x.kind === 'problem' || x.kind === 'idea') ?? subj[0];
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
        subj.some((x) => x.id === c) ? c : (preferred?.id ?? ''),
      );
      setRunId((c) =>
        free.some((x) => x.run_id === c)
          ? c
          : (newestFirst(free)[0]?.run_id ?? ''),
      );
      setSelected((c) => c || (newestFirst(w)[0]?.id ?? ''));
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    setDetail(null);
    void load();
  }, [workspace]);
  // Runs, subjects and budgets made elsewhere appear when this tab is shown again (audit
  // L-10); the picks stay when they still exist.
  useOnShow(() => void load());
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
        combines them. Discovery runs (started from Projects › Discover, the API
        or <code>creator seed-discovery</code>) also show here with each
        proposal's disposition and the skeptic's dissent. Each step is
        checkpointed in the database and runs on the server: closing this page
        does not stop it. Use Cancel to stop it.
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
                    {ROLE_NAME[w.role]}{' '}
                    {runName(w.run_id, names) &&
                      `· ${clipText(runName(w.run_id, names), 48)} `}
                    {w.role === 'r01_exploration' || w.role === 'r08_assessment'
                      ? '·'
                      : `· ${w.perspectives.length} perspectives ·`}{' '}
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
              {SUBJECT_KINDS.map((kind) => {
                const group = subjects.filter((s) => s.kind === kind);
                const labels = distinctLabels(group, (s) => recordLabel(s));
                return group.length === 0 ? null : (
                  <optgroup key={kind} label={KIND_GROUP[kind]}>
                    {group.map((s) => (
                      <option key={s.id} value={s.id} title={s.title}>
                        {labels.get(s.id)}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
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
                  {runLabel(r, names, 48, !standard)}
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
                  {standard
                    ? ROLE_NAME[wf.role]
                    : `${wf.role_version} · ${wf.id.slice(0, 8)}`}
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
                    {'perspective' in t.context && t.context.perspective
                      ? ` · ${t.context.perspective}`
                      : ''}
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
                  <Money nano={detail.usage.incurred} fixture={wf.fixture} /> ·{' '}
                  <Term term="reservation">in flight</Term>{' '}
                  <Money nano={detail.usage.reserved} fixture={wf.fixture} /> ·{' '}
                  <Term term="unknown_outcome">unknown (held)</Term>{' '}
                  <Money nano={detail.usage.unknown} fixture={wf.fixture} />
                </p>
              )}
              {wf.result && (
                <>
                  <h3>Result: {words(wf.result.outcome)}</h3>
                  <p>{wf.result.explanation}</p>
                  {wf.result.discovery && (
                    <Discovery
                      ws={workspace}
                      workflow={wf.id}
                      result={wf.result.discovery}
                    />
                  )}
                  {wf.result.exploration && (
                    <p className="small">
                      {wf.result.exploration.candidates.length} problem
                      {wf.result.exploration.candidates.length === 1
                        ? ''
                        : 's'}{' '}
                      proposed,{' '}
                      {
                        wf.result.exploration.candidates.filter(
                          (x) => x.disposition === 'candidate',
                        ).length
                      }{' '}
                      candidate(s). Open Discover › Explore for me to read the
                      shortlist and use one as a brief.
                    </p>
                  )}
                  {wf.result.synthesis && (
                    <p>
                      <strong>{words(wf.result.synthesis.disposition)}</strong>:{' '}
                      {wf.result.synthesis.summary}
                    </p>
                  )}
                </>
              )}
              {wf.role === 'r02_discovery' && (
                <>
                  <h3>Evidence it was given</h3>
                  {packet?.workflow === wf.id ? (
                    <PacketSummary
                      ws={workspace}
                      packet={packet.packet}
                      hash={packet.packet_hash}
                    />
                  ) : (
                    <button
                      className="secondary"
                      disabled={packetBusy === wf.id}
                      onClick={() => {
                        const id = wf.id;
                        if (packetBusy) return;
                        setPacketError(null);
                        setPacketBusy(id);
                        void api(
                          z.strictObject({
                            packet: EvidencePacketSchema,
                            packet_hash: z.string(),
                          }),
                          `${base}/workflows/${id}/packet`,
                        )
                          .then(
                            (p) => setPacket({ workflow: id, ...p }),
                            (err: unknown) =>
                              setPacketError({
                                workflow: id,
                                text: message(err),
                              }),
                          )
                          .finally(() => setPacketBusy(''));
                      }}
                    >
                      {packetBusy === wf.id
                        ? 'Reading the packet…'
                        : 'Show the evidence packet'}
                    </button>
                  )}
                  {packetError?.workflow === wf.id && (
                    <p className="error" role="alert">
                      {packetError.text}
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

/**
 * The evidence packet a discovery read: its brief, whether the evidence was judged enough,
 * the claims and catalog records it saw, and the exact packet with its hash. The packet is
 * untrusted evidence with no authority; it is shown as text, never acted on.
 */
function PacketSummary({
  ws,
  packet,
  hash,
}: {
  ws: string;
  packet: z.infer<typeof EvidencePacketSchema>;
  hash: string;
}) {
  return (
    <div className="packet">
      <p className="small">
        Brief “{packet.brief.title}” v{packet.brief.version} · evidence judged{' '}
        <strong>{packet.sufficiency.verdict}</strong> · assessed{' '}
        {when(packet.assessed_at)} · claims up to {packet.max_age_days} days old
        · packet hash <code>{hash.slice(0, 12)}</code>
      </p>
      {packet.sufficiency.reasons.length > 0 && (
        <ul className="small">
          {packet.sufficiency.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="small">
        {packet.claims.length} {packet.claims.length === 1 ? 'claim' : 'claims'}
        {' · '}
        {packet.catalog.length} existing{' '}
        {packet.catalog.length === 1 ? 'record' : 'records'} to compare with
      </p>
      <ul className="small">
        {packet.claims.map((c) => (
          <li key={c.claim_id}>
            <a href={claimHref(ws, c.claim_id)}>{c.ref}</a> · {c.statement}{' '}
            <small>({words(c.status)})</small>
          </li>
        ))}
      </ul>
      <details>
        <summary>The exact packet</summary>
        <pre>{JSON.stringify(packet, null, 2)}</pre>
      </details>
    </div>
  );
}

/** One discovery run's outcome: every proposal, why it ended where it did, and the dissent. */
function Discovery({
  ws,
  workflow,
  result,
}: {
  ws: string;
  workflow: string;
  result: DiscoveryResult;
}) {
  // Reasons and skeptic findings cite the packet's claim tags ("C3"); each links to its claim.
  const refs = usePacketClaims(ws, workflow, 'packet', [
    ...result.proposals.flatMap((p) => [...p.reasons, ...p.dissent]),
    ...result.excluded.map((x) => x.reason),
  ]);
  const text = (t: string) => <ClaimText ws={ws} text={t} refs={refs} />;
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
                {text(r)}
              </small>
            ))}
            {p.dissent.length > 0 && (
              <details>
                <summary>Skeptic findings ({p.dissent.length})</summary>
                <ul>
                  {p.dissent.map((d, i) => (
                    <li key={i}>{text(d)}</li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        ))}
        {result.excluded.map((x) => (
          <li key={x.perspective}>
            <span className="kind">excluded</span>{' '}
            <strong>{words(x.perspective)}</strong>: {text(x.reason)}
          </li>
        ))}
      </ul>
    </div>
  );
}
