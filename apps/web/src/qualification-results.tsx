import { useState } from 'react';
import {
  PlanQualificationResultsSchema,
  type PlanQualification,
  type PlanQualificationResults,
} from '@creator/contracts';
import { api, message } from './oversight.js';

// F10 (owner pilot): a qualification's answers and why each one passed or failed. Before this,
// a failed qualification showed only "failed" and the owner could not tell a model that
// declined from a broken grader. Answers are kept only for synthetic or public data (ADR-0049).

const JOB: Record<string, string> = {
  patch_build: 'builder',
  independent_review: 'reviewer',
  summarization: 'summarization',
  specification: 'specification',
};

const SIGNAL: Record<string, string> = {
  accepted: 'Passed',
  schema_invalid: 'Failed: the answer was not in the required format',
  acceptance_check_failed: 'Failed the checks',
  provider_error: 'Not graded: the studio or worker had a problem',
  wrong_answer: 'Failed: wrong answer',
};

function outcome(c: PlanQualificationResults['cases'][number]) {
  if (!c.state) return 'Not run';
  if (c.state !== 'completed')
    return `No answer (request ${c.state.replace('_', ' ')})`;
  if (!c.signal) return 'Not graded';
  return SIGNAL[c.signal] ?? `Failed (${c.signal})`;
}

/** Pretty-prints a JSON answer so a builder's blocker or patch is readable; other text as is. */
function readable(answer: string) {
  try {
    return JSON.stringify(JSON.parse(answer), null, 2);
  } catch {
    return answer;
  }
}

export function QualificationSummary({ q }: { q: PlanQualification }) {
  const job = JOB[q.task_class] ?? q.task_class;
  const decided = q.state === 'qualified' || q.state === 'failed';
  return (
    <>
      <strong>
        {q.model_id} · {job} job ·{' '}
        {q.state === 'qualified' && q.prompt_current === false
          ? 'historical pass (older prompt)'
          : q.state}
      </strong>
      {decided && (
        <>
          {' '}
          · practice {q.development.passed}/{q.development.total}, held out{' '}
          {q.held_out.passed}/{q.held_out.total}
        </>
      )}
      {q.decided_at && <> · {new Date(q.decided_at).toLocaleString()}</>}
      {q.state === 'qualified' && q.prompt_current === false && (
        <p className="small">
          Does not count for the current prompt. Qualify this model again for
          this job.
        </p>
      )}
    </>
  );
}

export function QualificationResults({
  base,
  q,
}: {
  base: string;
  q: PlanQualification;
}) {
  const [results, setResults] = useState<PlanQualificationResults | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      setResults(
        await api(
          PlanQualificationResultsSchema,
          `${base}/plan-qualifications/${q.id}`,
        ),
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  const cases = results?.cases ?? [];
  const passed = cases.filter((c) => c.signal === 'accepted').length;
  const notRun = cases.filter(
    (c) => !c.state || c.state === 'in_flight' || c.state === 'unknown',
  ).length;
  const failed = cases.length - passed - notRun;
  const heldOutShown = cases.some(
    (c) => c.split === 'held_out' && c.answer !== null,
  );
  return (
    <div className="qualification">
      <QualificationSummary q={q} />
      {q.reason && <p className="muted">{q.reason}</p>}
      {!results ? (
        <button disabled={loading} onClick={() => void load()}>
          {loading ? 'Loading answers…' : 'Show answers and reasons'}
        </button>
      ) : (
        <>
          <p>
            {results.manifest_name && (
              <>
                Benchmark <code>{results.manifest_name}</code>.{' '}
              </>
            )}
            {passed} passed, {failed} failed
            {notRun ? `, ${notRun} not run or still unresolved` : ''}.
            {failed > 0 &&
              ' The reason under each failed case says where it failed.'}
          </p>
          {heldOutShown && (
            <p className="muted">
              Held-out answers are shown below. If the role's prompt is changed
              after reading them, those held-out cases no longer test it fairly:
              requalify on fresh held-out cases (ADR-0052). The studio records
              that you opened these results and refuses a benchmark that reuses
              these held-out cases with a different prompt.
            </p>
          )}
          <ol className="qualification-cases">
            {results.cases.map((c) => (
              <li key={c.case_id}>
                <strong>{c.case_id}</strong> (
                {c.split === 'held_out' ? 'held out' : 'practice'}):{' '}
                {outcome(c)}
                {c.reason && c.signal !== 'accepted' && (
                  <p className="muted">{c.reason}</p>
                )}
                {c.answer !== null ? (
                  <details>
                    <summary>
                      Model's answer ({c.output_chars ?? c.answer.length}{' '}
                      characters)
                    </summary>
                    <pre>{readable(c.answer)}</pre>
                  </details>
                ) : (
                  c.state === 'completed' && (
                    <p className="muted">
                      The answer was not kept (only synthetic or public data
                      answers are stored).
                    </p>
                  )
                )}
              </li>
            ))}
          </ol>
          <button disabled={loading} onClick={() => setResults(null)}>
            Hide answers
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
