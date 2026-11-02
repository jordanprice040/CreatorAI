import { useState } from 'react';
import type { PlanQualification } from '@creator/contracts';
import specification from '../../../config/connections/benchmarks/specification-synthetic-v1.json';
import summarization from '../../../config/connections/benchmarks/summarization-synthetic-v1.json';
import builder from '../../../config/connections/benchmarks/t12-builder-v1.json';
import reviewer from '../../../config/connections/benchmarks/t12-reviewer-v2.json';
import { words } from './oversight.js';

/**
 * The frozen benchmarks this app can start a plan qualification with (audit item 4, piece 4).
 * They are the files under config/connections/benchmarks that a Responses plan role uses
 * today; t12-reviewer-v1 is left out because its reviewer prompt was replaced (ADR-0049) and
 * the server refuses it. The server checks the manifest, the task class, the data class and
 * that the model is verified before it records anything.
 */
export const BENCHMARKS = [specification, summarization, builder, reviewer].map(
  (m) => ({
    manifest: m,
    name: m.name,
    task_class: m.task_class,
    held_out: m.cases.filter((c) => c.split === 'held_out').length,
    development: m.cases.filter((c) => c.split !== 'held_out').length,
  }),
);

/** Start, run and finish a qualification of one verified model on one bundled benchmark. */
export function QualifyModel({
  connection,
  models,
  allowed,
  running,
  busy,
  act,
}: {
  connection: { id: string; version: number; fixture: boolean };
  /** Models verified on the Responses path of this connection. */
  models: string[];
  /** Task classes this connection's settings allow. */
  allowed: readonly string[];
  running: PlanQualification[];
  busy: boolean;
  act: (path: string, body: unknown, timeoutMs?: number) => Promise<unknown>;
}) {
  const [model, setModel] = useState('');
  const [bench, setBench] = useState('');
  const chosen = BENCHMARKS.find((b) => b.name === bench);
  const p = `plan-connections/${connection.id}`;
  const pick = model || models[0] || '';
  return (
    <fieldset>
      <legend>Qualify a model for a task</legend>
      <p>
        A qualification runs one frozen benchmark against a verified model. It
        sends one plan request per case, counted against this connection&apos;s
        caps, and stays at $0 on a plan. Every held-out case must pass for the
        model to qualify. Starting records the qualification only; nothing is
        sent until you press Run.
      </p>
      {connection.fixture ? (
        <p className="small">
          These benchmarks are real (synthetic data, not fixtures), so they
          qualify only real connections.
        </p>
      ) : models.length === 0 ? (
        <p className="small">
          Verify a model above first: only a verified model can be qualified.
        </p>
      ) : (
        <>
          <div className="inline-form">
            <label htmlFor={`q-model-${connection.id}`} className="inline">
              Model
            </label>
            <select
              id={`q-model-${connection.id}`}
              value={pick}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <label htmlFor={`q-bench-${connection.id}`} className="inline">
              Benchmark
            </label>
            <select
              id={`q-bench-${connection.id}`}
              value={bench}
              onChange={(e) => setBench(e.target.value)}
            >
              <option value="">Choose a task</option>
              {BENCHMARKS.map((b) => (
                <option
                  key={b.name}
                  value={b.name}
                  disabled={!allowed.includes(b.task_class)}
                >
                  {words(b.task_class)} · {b.name} ({b.development} practice +{' '}
                  {b.held_out} held out)
                  {allowed.includes(b.task_class)
                    ? ''
                    : ' · not allowed on this connection'}
                </option>
              ))}
            </select>
          </div>
          {chosen && (
            <p className="small">
              Uses up to {chosen.development + chosen.held_out} plan requests
              when run. Pass bar: all {chosen.held_out} held-out cases.
            </p>
          )}
          <button
            type="button"
            disabled={busy || !chosen || !pick}
            onClick={() =>
              void act(`${p}/qualifications`, {
                expected_version: connection.version,
                model_id: pick,
                manifest: chosen!.manifest,
                min_held_out_cases: chosen!.held_out,
                floor: { numerator: 1, denominator: 1 },
              })
            }
          >
            Start qualification
          </button>
        </>
      )}
      {running.map((q) => {
        const b = BENCHMARKS.find((x) => x.task_class === q.task_class);
        const n = b ? b.development + b.held_out : null;
        return (
          <div key={q.id} className="inline-form" role="group">
            <span>
              {words(q.task_class)} on {q.model_id} is started
              {q.development.total + q.held_out.total > 0
                ? ` (${q.development.passed + q.held_out.passed} of ${q.development.total + q.held_out.total} graded cases passed so far)`
                : ''}
              .
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(`plan-qualifications/${q.id}/run`, {}, 3_600_000)
              }
            >
              Run{n ? ` (up to ${n} plan requests)` : ''}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void act(`plan-qualifications/${q.id}/finish`, {})}
            >
              Finish and record the result
            </button>
          </div>
        );
      })}
    </fieldset>
  );
}
