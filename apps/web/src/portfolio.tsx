import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  z,
  PortfolioPolicyRequestSchema,
  KnowledgeProposalSchema,
  type Workspace,
  type SessionInfo,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { Money } from './money.js';
import { useOnShow } from './page-active.js';
import { ShowOlder, useOlder } from './older.js';

const Policy = PortfolioPolicyRequestSchema.extend({
  version: z.number(),
  workspace_id: z.string(),
  next_tick_at: z.string(),
});
const Candidate = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number(),
  body_hash: z.string(),
  status: z.string(),
  active: z.boolean().nullable(),
  body: KnowledgeProposalSchema,
});
const Schedule = z.object({
  id: z.string(),
  run_id: z.string(),
  lane: z.string(),
  next_due_at: z.string(),
  cancelled: z.boolean(),
  body: z.object({ label: z.string(), operation: z.unknown() }),
});
const View = z.object({
  state: z
    .object({
      policy: Policy,
      reserve_available: z.string(),
      maintenance_due: z.number(),
      review_backlog: z.number(),
      active: z.number(),
      unhealthy: z.number(),
    })
    .nullable(),
  schedules: z.array(Schedule),
  jobs: z.array(
    z.object({
      id: z.string(),
      schedule_id: z.string(),
      lane: z.string(),
      state: z.string(),
      result: z.unknown(),
    }),
  ),
  knowledge: z.array(Candidate),
  regressions: z.array(
    z.object({
      id: z.string(),
      candidate_id: z.string(),
      passed: z.boolean(),
      checks: z.unknown(),
    }),
  ),
  health: z.array(
    z.object({
      artifact_id: z.string(),
      job_id: z.string(),
      state: z.string(),
      report: z.unknown(),
    }),
  ),
  feedback: z.array(z.unknown()),
});
const templates = {
  policy: {
    expected_version: 0,
    mode: 'normal',
    root_envelope_id: '',
    maintenance_envelope_id: '',
    reserve_floor_nano_usd: '0',
    max_active: 2,
    max_review_backlog: 4,
    max_starts_per_tick: 1,
    tick_interval_seconds: 60,
    rationale: 'Owner-configured portfolio allocation.',
  },
  schedule: {
    label: 'Source maintenance',
    run_id: '',
    lane: 'maintenance',
    interval_seconds: 86400,
    first_due_at: '',
    operation: {
      kind: 'source_refresh',
      source_id: '',
      source_version: 1,
      source_hash: '',
    },
  },
  knowledge: {
    key: 'review-evidence',
    kind: 'lesson',
    title: 'Review evidence before building',
    guidance: ['Check contrary evidence before recommending a build.'],
    permitted_lanes: ['improvement'],
    data_class: 'synthetic',
    permitted_use: 'task_review_guidance',
    provenance: [
      {
        entity_id: '',
        version: 1,
        content_hash: '',
        locator: 'body.statement',
      },
    ],
    limitations: 'Usefulness needs task-level evaluation.',
  },
};
export function Portfolio({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
}) {
  const base = `workspaces/${workspace.id}`;
  const [view, setView] = useState<z.infer<typeof View> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState(
    'Owner reviewed the exact portfolio change.',
  );
  const [kind, setKind] = useState<keyof typeof templates>('policy');
  const [json, setJson] = useState(JSON.stringify(templates.policy, null, 2));
  const sequence = useRef(0);
  async function load() {
    const seq = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const next = await api(View, `${base}/portfolio`);
      if (seq === sequence.current) setView(next);
    } catch (e) {
      if (seq === sequence.current) setError(message(e));
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [workspace.id]);
  useOnShow(() => void load());
  // Newest first; schedules past the newest 200 come a page at a time (audit L-9).
  const schedules = useOlder(
    view?.schedules,
    Schedule,
    `${base}/portfolio-schedules`,
    200,
  );
  async function act(path: string, body: unknown) {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      await api(z.unknown(), `${base}/${path}`, {
        body,
        csrf: session.csrf_token,
        timeoutMs: 30000,
      });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const p = view?.state?.policy;
  function policyBody(mode: string) {
    if (!p) return null;
    const { version, workspace_id: _ws, next_tick_at: _tick, ...body } = p;
    return { ...body, expected_version: version, mode, rationale: reason };
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    let body: unknown;
    try {
      body = JSON.parse(json);
    } catch {
      setError('Enter a valid JSON document.');
      return;
    }
    await act(
      kind === 'policy'
        ? 'portfolio/policy'
        : kind === 'schedule'
          ? 'portfolio-schedules'
          : 'reusable-knowledge',
      body,
    );
  }
  return (
    <section
      className="panel"
      aria-labelledby="portfolio-title"
      style={{ overflowWrap: 'anywhere' }}
    >
      <h2 id="portfolio-title">Portfolio and maintenance</h2>
      <p>
        Maintenance reserves, review obligations and capacity constrain new
        work. Exploration and existing-product improvements keep separate run
        allocations.
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading portfolio…</p>}
      <button disabled={busy || loading} onClick={() => void load()}>
        Refresh portfolio
      </button>
      {view?.state ? (
        <>
          <dl>
            <dt>Mode</dt>
            <dd>{p?.mode}</dd>
            <dt>Maintenance reserve available</dt>
            <dd>
              <Money
                nano={view.state.reserve_available}
                fixture={workspace.record_mode === 'fixture'}
              />
            </dd>
            <dt>Due maintenance / review backlog / active capacity</dt>
            <dd>
              {view.state.maintenance_due} / {view.state.review_backlog} /{' '}
              {view.state.active} of {p?.max_active}
            </dd>
            <dt>Health items needing attention</dt>
            <dd>{view.state.unhealthy}</dd>
          </dl>
          <label>
            Reason for owner changes
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label>
            Conservation mode
            <select
              value={p?.mode}
              disabled={busy || !session}
              onChange={(e) =>
                void act('portfolio/policy', policyBody(e.target.value))
              }
            >
              <option value="normal">Normal</option>
              <option value="conserve">Conserve — pause exploration</option>
              <option value="maintenance_only">Maintenance only</option>
              <option value="paused">Paused — stop new dispatch</option>
            </select>
          </label>
          <p>
            Pausing stops new work; cancellation also fences the schedule's
            dedicated run. Already dispatched effects remain in history.
          </p>
          <button
            disabled={busy || !session || p?.mode === 'paused'}
            onClick={() => void act('portfolio/tick', {})}
          >
            Run one bounded scheduling pass
          </button>
        </>
      ) : (
        !loading && (
          <p>
            No portfolio policy. Allocate a dedicated maintenance period under a
            global budget in Budgets, then configure the exact IDs below.
          </p>
        )
      )}
      <h3>Schedules</h3>
      {view?.schedules.length === 0 && (
        <p>No maintenance or exploration schedules.</p>
      )}
      <ul>
        {schedules.items.map((s) => (
          <li key={s.id}>
            <strong>{s.body.label}</strong> · {s.lane} ·{' '}
            {s.cancelled ? 'cancelled' : 'next due ' + s.next_due_at}
            <details>
              <summary>Exact schedule binding</summary>
              <pre>{JSON.stringify(s, null, 2)}</pre>
            </details>
            <button
              disabled={busy || !session || s.cancelled}
              onClick={() =>
                void act(`portfolio-schedules/${s.id}/cancel`, { reason })
              }
            >
              Cancel schedule and its run
            </button>
          </li>
        ))}
      </ul>
      <ShowOlder list={schedules} what="schedules" />
      <h3>Scheduled outcomes</h3>
      {view?.jobs.length === 0 && (
        <p className="small">No scheduled work has run yet.</p>
      )}
      <ul>
        {view?.jobs.map((j) => (
          <li key={j.id}>
            {j.lane} · {j.state} · {j.id}
            <details>
              <summary>Observed outcome</summary>
              <pre>{JSON.stringify(j.result, null, 2)}</pre>
            </details>
            {['unknown', 'dispatching'].includes(j.state) && (
              <button
                disabled={busy || !session}
                onClick={() =>
                  void act('portfolio/reconcile', { job_id: j.id, reason })
                }
              >
                Reconcile without dispatching again
              </button>
            )}
          </li>
        ))}
      </ul>
      <h3>Product health and owner feedback</h3>
      <p>
        Health checks rehash the private package; they do not establish runtime
        uptime. Submit product feedback under Projects › Try.
      </p>
      <ul>
        {view?.health
          .filter((h) => h.state !== 'package_integrity_passed')
          .map((h) => (
            <li key={h.artifact_id}>
              {h.artifact_id} · {h.state}
              <button
                disabled={busy || !session}
                onClick={() =>
                  void act('portfolio/health', {
                    artifact_id: h.artifact_id,
                    expected_job_id: h.job_id,
                    choice: h.state === 'owner_deferred' ? 'reopen' : 'defer',
                    reason,
                  })
                }
              >
                {h.state === 'owner_deferred'
                  ? 'Reopen maintenance obligation'
                  : 'Defer obligation with owner reason'}
              </button>
            </li>
          ))}
      </ul>
      <details>
        <summary>Health observations and product feedback</summary>
        <pre>
          {JSON.stringify(
            { health: view?.health ?? [], feedback: view?.feedback ?? [] },
            null,
            2,
          )}
        </pre>
      </details>
      <h3>Reusable knowledge</h3>
      <p>
        Reviewed lessons, components, prompts and skills add bounded task
        guidance. They cannot change policy, credentials, budgets or frozen
        study tasks. Regression checks establish structural safety; usefulness
        remains unverified.
      </p>
      <ul>
        {view?.knowledge.map((k) => {
          const regression = view.regressions.find(
            (r) => r.candidate_id === k.id && r.passed,
          );
          const head = view.knowledge.find(
            (other) => other.key === k.key && other.active,
          );
          return (
            <li key={k.id}>
              <strong>{k.body.title}</strong> · {k.key}@{k.version} · {k.status}
              {k.active ? ' · active' : ''}
              <details>
                <summary>
                  Provenance, permitted use and regression evidence
                </summary>
                <pre>
                  {JSON.stringify(
                    {
                      candidate: k,
                      regressions: view.regressions.filter(
                        (r) => r.candidate_id === k.id,
                      ),
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              {k.status === 'proposed' && (
                <>
                  <button
                    disabled={busy || !session}
                    onClick={() =>
                      void act(`reusable-knowledge/${k.id}/verify`, {})
                    }
                  >
                    Execute structural regression
                  </button>
                  <button
                    disabled={busy || !session || !regression}
                    onClick={() =>
                      void act(`reusable-knowledge/${k.id}/review`, {
                        body_hash: k.body_hash,
                        regression_id: regression?.id,
                        reason,
                      })
                    }
                  >
                    Review exact version
                  </button>
                </>
              )}
              {k.status === 'reviewed' && !k.active && (
                <button
                  disabled={busy || !session}
                  onClick={() =>
                    void act('reusable-knowledge/activate', {
                      candidate_id: k.id,
                      expected_active_id: head?.id ?? null,
                      reason,
                    })
                  }
                >
                  {head && head.version > k.version
                    ? 'Roll back to this reviewed version'
                    : 'Activate reviewed version'}
                </button>
              )}
              <button
                disabled={busy || !session || k.status === 'revoked'}
                onClick={() =>
                  void act(`reusable-knowledge/${k.id}/revoke`, { reason })
                }
              >
                Revoke this version
              </button>
            </li>
          );
        })}
      </ul>
      <details>
        <summary>Configure a policy, schedule or knowledge proposal</summary>
        <p>
          Exact IDs and versions preserve reviewable scope. Blank template IDs
          require records from this workspace; schedule runs must already have
          scoped grants and budgets.
        </p>
        <form onSubmit={submit}>
          <label>
            New document
            <select
              value={kind}
              onChange={(e) => {
                const selected = e.target.value as keyof typeof templates;
                setKind(selected);
                setJson(
                  JSON.stringify(
                    selected === 'policy' && p
                      ? policyBody(p.mode)
                      : templates[selected],
                    null,
                    2,
                  ),
                );
              }}
            >
              <option value="policy">Portfolio policy</option>
              <option value="schedule">Schedule</option>
              <option value="knowledge">Knowledge proposal</option>
            </select>
          </label>
          <label>
            Reviewable configuration
            <textarea
              rows={18}
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
            />
          </label>
          <button disabled={busy || !session}>Save scoped configuration</button>
        </form>
      </details>
    </section>
  );
}
