import { useEffect, useState } from 'react';
import {
  RecipeBenchmarkOffersSchema,
  RecipeQualificationListSchema,
  type PlanConnection,
  type PlanQualification,
  type RecipeBenchmarkOffers,
  type RecipeQualificationRecord,
} from '@creator/contracts';
import {
  attemptLine,
  latestRecord,
  recordLine,
  startBlockers,
  startPacket,
} from './build-qualification.js';
import { api, message } from './oversight.js';

/** How often a running build qualification is read again while this section is open. */
const POLL_MS = 10_000;

/**
 * ADR-0105 (B1): qualify building on this connection. Three live builds of one frozen in-app
 * benchmark with the model as builder and reviewer, run by the studio in the background. Only a
 * qualified, non-fixture record lifts the "unqualified trial" label (web builds, and larger Python
 * builds per ADR-0112), and only for builds on this connection, this model and today's role prompts.
 */
export function QualifyBuilding({
  base,
  connection,
  models,
  qualifications,
  busy,
  preferred = null,
  act,
}: {
  base: string;
  connection: Pick<PlanConnection, 'id' | 'fixture' | 'settings'>;
  /** Models verified on the Responses path of this connection. */
  models: string[];
  qualifications: PlanQualification[];
  busy: boolean;
  preferred?: string | null;
  act: (
    path: string,
    body: unknown,
    timeoutMs?: number,
    local?: (error: string) => void,
  ) => Promise<unknown>;
}) {
  const [offers, setOffers] = useState<RecipeBenchmarkOffers | null>(null);
  const [records, setRecords] = useState<RecipeQualificationRecord[]>([]);
  const [model, setModel] = useState('');
  const [bench, setBench] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [reads, setReads] = useState(0);
  const [open, setOpen] = useState('');
  const path = `plan-connections/${connection.id}/recipe-qualifications`;
  useEffect(() => {
    let live = true;
    Promise.all([
      api(RecipeBenchmarkOffersSchema, `${base}/recipe-benchmarks`),
      api(RecipeQualificationListSchema, `${base}/${path}`),
    ]).then(
      ([o, r]) => {
        if (!live) return;
        setOffers(o);
        setRecords(r);
        setLoadError('');
      },
      (e: unknown) =>
        live &&
        setLoadError(`Could not load build qualifications: ${message(e)}`),
    );
    return () => {
      live = false;
    };
  }, [base, path, reads]);
  const running = records.find((r) => r.state === 'running') ?? null;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setReads((n) => n + 1), POLL_MS);
    return () => clearTimeout(t);
  }, [running, reads]);
  const pick =
    (models.includes(model) ? model : '') ||
    (preferred && models.includes(preferred) ? preferred : '') ||
    models[0] ||
    '';
  const offer = offers?.benchmarks.find((b) => b.id === bench) ?? null;
  const blockers = offer
    ? startBlockers({
        allowedTasks: connection.settings.allowed_task_classes,
        allowedData: connection.settings.allowed_data_classes,
        verified: models,
        qualifications,
        records,
        model: pick,
        offer,
      })
    : [];
  const latest = offer ? latestRecord(records, pick, offer.id) : null;
  async function start() {
    if (!offer) return;
    setError('');
    const out = await act(
      path,
      { benchmark_id: offer.id, model_id: pick },
      30_000,
      setError,
    );
    setConfirm(false);
    if (out) setReads((n) => n + 1);
  }
  async function stop(r: RecipeQualificationRecord) {
    setError('');
    const out = await act(
      `recipe-qualifications/${r.id}/stop`,
      {},
      undefined,
      setError,
    );
    if (out) setReads((n) => n + 1);
  }
  const prompts = offers?.role_prompts ?? null;
  return (
    <fieldset>
      <legend>Qualify building</legend>
      <p>
        Building is qualified separately from the builder and reviewer tasks:
        the studio builds a frozen benchmark three times with this model as
        builder and reviewer, and checks every result itself. Until a model
        passes the web benchmark (p15-small-signup-v5) here, its web packages
        are labelled unqualified trials. Until it passes the larger Python
        benchmark (p14-larger-ledgercheck-v5 or v6), so are its larger Python
        packages (more than one Python file or more than 10 cases); small Python
        builds need no pass here.
      </p>
      {loadError && <p className="small">{loadError}</p>}
      {models.length === 0 ? (
        <p className="small">Verify a model above first.</p>
      ) : (
        offers && (
          <>
            <div className="inline-form">
              <label htmlFor={`b-model-${connection.id}`} className="inline">
                Model
              </label>
              <select
                id={`b-model-${connection.id}`}
                value={pick}
                onChange={(e) => {
                  setModel(e.target.value);
                  setConfirm(false);
                }}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <label htmlFor={`b-bench-${connection.id}`} className="inline">
                Benchmark
              </label>
              <select
                id={`b-bench-${connection.id}`}
                value={bench}
                onChange={(e) => {
                  setBench(e.target.value);
                  setConfirm(false);
                }}
              >
                <option value="">Choose what to build</option>
                {offers.benchmarks.map((b) => {
                  const l = latestRecord(records, pick, b.id);
                  return (
                    <option key={b.id} value={b.id}>
                      {b.label}
                      {l ? ` · ${l.state.replace('_', ' ')}` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            {offer && (
              <>
                {latest && latest.state !== 'running' && (
                  <p className="small">
                    Last result: {recordLine(latest, prompts)}.
                  </p>
                )}
                {blockers.length > 0 ? (
                  <ul className="small">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                ) : confirm ? (
                  <div
                    className="notice"
                    role="group"
                    aria-label="Confirm build qualification"
                  >
                    <ul className="small">
                      {startPacket(offer, pick, connection.fixture).map(
                        (line) => (
                          <li key={line}>{line}</li>
                        ),
                      )}
                    </ul>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void start()}
                    >
                      Start {offer.attempts} builds
                    </button>{' '}
                    <button
                      type="button"
                      className="text"
                      onClick={() => setConfirm(false)}
                    >
                      Not now
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy || !pick}
                    onClick={() => {
                      setError('');
                      setConfirm(true);
                    }}
                  >
                    {latest?.state === 'qualified'
                      ? 'Qualify again'
                      : 'Qualify building'}
                    {` (up to ${offer.max_requests} plan requests)`}
                  </button>
                )}
              </>
            )}
          </>
        )
      )}
      {running && (
        <div className="qualify-row" role="group">
          <span>
            {recordLine(running, prompts)}.{' '}
            {running.reason
              ? running.reason
              : running.executing
                ? 'Building now; this can take several minutes an attempt and carries on if you leave this page.'
                : 'Waiting for the studio to pick it up.'}
          </span>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void stop(running)}
          >
            Stop
          </button>
          <ul className="small">
            {running.attempts.map((a) => (
              <li key={a.id}>{attemptLine(a)}</li>
            ))}
          </ul>
        </div>
      )}
      {records.some((r) => r.state !== 'running') && (
        <>
          <h4>Build qualifications here</h4>
          <ul>
            {records
              .filter((r) => r.state !== 'running')
              .map((r) => (
                <li key={r.id}>
                  {recordLine(r, prompts)}
                  {r.reason && r.state !== 'qualified' && (
                    <span className="small"> · {r.reason}</span>
                  )}
                  {r.evidence && (
                    <span className="small"> · evidence: {r.evidence}</span>
                  )}{' '}
                  {r.attempts.length > 0 && (
                    <button
                      type="button"
                      className="text"
                      aria-expanded={open === r.id}
                      onClick={() => setOpen(open === r.id ? '' : r.id)}
                    >
                      {open === r.id ? 'Hide attempts' : 'Show attempts'}
                    </button>
                  )}
                  {open === r.id && (
                    <ul className="small">
                      {r.attempts.map((a) => (
                        <li key={a.id}>
                          {attemptLine(a)}
                          {a.result?.bars.length ? (
                            <ul>
                              {a.result.bars.map((b) => (
                                <li key={b.key}>
                                  {b.passed ? 'Passed' : 'Missed'}: {b.detail}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
