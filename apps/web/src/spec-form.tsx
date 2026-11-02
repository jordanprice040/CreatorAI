import { useState, type FormEvent, type ReactNode } from 'react';
import {
  SpecStatusSchema,
  type SessionInfo,
  type SpecStatus,
  type StoredEntity,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import {
  buildNotes,
  draftFromContent,
  draftToContent,
  emptyCase,
  emptySpecDraft,
  nextKey,
  argsShowable,
  storedKeys,
  type DataClass,
  type Method,
  type Role,
  type SpecContentShape,
  type SpecDraft,
} from './spec-fields.js';

const METHODS: { value: Method; label: string }[] = [
  { value: 'automated_test', label: 'Automated test (cases below)' },
  { value: 'browser_check', label: 'Browser check' },
  { value: 'manual_review', label: 'Manual review' },
  { value: 'metric', label: 'Metric' },
];
const ROLES: Role[] = ['builder', 'reviewer', 'qa', 'designer', 'owner'];
const CLASSES: { value: DataClass; label: string }[] = [
  { value: 'synthetic', label: 'Synthetic' },
  { value: 'public', label: 'Public' },
  { value: 'private_approved', label: 'Private (approved)' },
];

export type SpecFormMode =
  | {
      kind: 'create';
      selection_id: string;
      alternative: { id: string; version: number };
      prefill: {
        title?: string;
        audience?: string;
        problem_statement?: string;
      };
    }
  /** The spec's status and its stored current version (the body to start from). */
  | { kind: 'revise'; spec: SpecStatus; entity: StoredEntity };

/**
 * "Write a spec" on Build: the spec/1 content for an option a current selection chose for
 * build, or the next version of an existing spec. Freezing stays under Scores and specs.
 */
export function SpecForm({
  base,
  session,
  mode,
  saved,
  cancel,
}: {
  base: string;
  session: SessionInfo;
  mode: SpecFormMode;
  saved: (s: SpecStatus) => void;
  cancel: () => void;
}) {
  const [d, setD] = useState<SpecDraft>(() =>
    mode.kind === 'revise'
      ? draftFromContent(
          mode.entity.title,
          mode.entity.body as unknown as SpecContentShape,
        )
      : emptySpecDraft(mode.prefill),
  );
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (f: (x: SpecDraft) => void) =>
    setD((x) => {
      const y = structuredClone(x);
      f(y);
      return y;
    });
  const err = (k: string) =>
    errors[k] ? (
      <span id={`sf-${k}-error`} className="error">
        {errors[k]}
      </span>
    ) : null;
  const aria = (k: string) =>
    errors[k]
      ? { 'aria-invalid': true, 'aria-describedby': `sf-${k}-error` }
      : {};
  /** A labelled text box bound to one draft field. */
  const box = (
    k: string,
    label: ReactNode,
    value: string,
    onChange: (v: string) => void,
    o: { rows?: number; max?: number; mono?: boolean } = {},
  ) => (
    <div className="sf-field">
      <label htmlFor={`sf-${k}`}>
        {label}
        {o.rows ? (
          <textarea
            id={`sf-${k}`}
            rows={o.rows}
            maxLength={o.max}
            className={o.mono ? 'mono' : undefined}
            value={value}
            {...aria(k)}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            id={`sf-${k}`}
            maxLength={o.max}
            value={value}
            {...aria(k)}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </label>
      {err(k)}
    </div>
  );
  const parsed = draftToContent(d);
  const notes = parsed.content ? buildNotes(parsed.content) : [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const out = draftToContent(d);
    const errs = { ...(out.errors ?? {}) };
    if (mode.kind === 'revise' && !reason.trim())
      errs.reason = 'Say what changed and why.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const s = await api(
        SpecStatusSchema,
        mode.kind === 'create'
          ? `${base}/specs`
          : `${base}/specs/${mode.spec.spec.id}/revisions`,
        {
          csrf: session.csrf_token,
          body:
            mode.kind === 'create'
              ? {
                  selection_id: mode.selection_id,
                  alternative: mode.alternative,
                  title: out.title,
                  content: out.content,
                }
              : {
                  expected_version: mode.spec.spec.version,
                  title: out.title,
                  content: out.content,
                  reason: reason.trim().slice(0, 300),
                },
        },
      );
      saved(s);
    } catch (x) {
      setError(message(x));
    } finally {
      setBusy(false);
    }
  }

  const remove = <T,>(list: T[], i: number) => list.splice(i, 1);
  /** Removes an item; field errors are keyed by position, so they are cleared (L-2). */
  const drop = (f: (x: SpecDraft) => void) => {
    setErrors({});
    set(f);
  };
  // Keys the version being revised gave out: never reused for a new item (L-1).
  const given =
    mode.kind === 'revise'
      ? storedKeys(mode.entity.body as unknown as SpecContentShape)
      : [];
  const flowKeys = d.flows.map((f) => f.key);
  const checkKeys = d.checks.map((c) => c.key);
  const taskKeys = d.tasks.map((t) => t.key);
  const newFlow = nextKey('F', flowKeys, given);
  const newCheck = nextKey('A', checkKeys, given);
  const newTask = nextKey('T', taskKeys, given);
  const noKey = (what: string, last: string) => (
    <p className="small">
      No more {what} keys: {last} has been used, and keys stop at 99.
    </p>
  );

  return (
    <form
      className="spec-form"
      onSubmit={(e) => void submit(e)}
      aria-labelledby="sf-title-h"
    >
      <h3 id="sf-title-h">
        {mode.kind === 'create'
          ? 'Write a spec'
          : `Revise ${mode.spec.spec.title} (now v${mode.spec.spec.version})`}
      </h3>
      <p className="small">
        A spec says what will be built and how it will be checked. Write the
        lists one item per line. Keys (F1, A1, T1) are given for you and stay
        fixed, so a revision only changes the tasks you edit.
        {mode.kind === 'revise' &&
          mode.spec.frozen_current &&
          ' This version is frozen: saving a revision means freezing again before the next build.'}
      </p>
      <fieldset>
        <legend>What and for whom</legend>
        {box('title', 'Title', d.title, (v) => set((x) => (x.title = v)), {
          max: 300,
        })}
        {box(
          'audience',
          'Who it is for',
          d.audience,
          (v) => set((x) => (x.audience = v)),
          { max: 300 },
        )}
        {box(
          'problem_statement',
          'The problem it addresses',
          d.problem_statement,
          (v) => set((x) => (x.problem_statement = v)),
          { rows: 3, max: 1200 },
        )}
        {box(
          'scope',
          'In scope (one per line)',
          d.scope,
          (v) => set((x) => (x.scope = v)),
          { rows: 3 },
        )}
        {box(
          'non_goals',
          'Not in scope (one per line)',
          d.non_goals,
          (v) => set((x) => (x.non_goals = v)),
          { rows: 3 },
        )}
      </fieldset>

      <fieldset>
        <legend>User flows</legend>
        {d.flows.map((f, i) => (
          <div key={f.key} className="sf-item">
            <strong>{f.key}</strong>
            {box(`flows.${i}.name`, 'Name', f.name, (v) =>
              set((x) => (x.flows[i]!.name = v)),
            )}
            {box(
              `flows.${i}.steps`,
              'Steps (one per line)',
              f.steps,
              (v) => set((x) => (x.flows[i]!.steps = v)),
              { rows: 3 },
            )}
            {d.flows.length > 1 && (
              <button
                type="button"
                className="text"
                onClick={() =>
                  drop((x) => {
                    remove(x.flows, i);
                    for (const c of x.checks) if (c.flow === f.key) c.flow = '';
                  })
                }
              >
                Remove {f.key}
              </button>
            )}
          </div>
        ))}
        {err('flows')}
        {d.flows.length < 10 && !newFlow && noKey('flow', 'F99')}
        {d.flows.length < 10 && newFlow && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              set((x) =>
                x.flows.push({
                  key: newFlow,
                  name: '',
                  steps: '',
                }),
              )
            }
          >
            Add a flow
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Acceptance checks</legend>
        <p className="small">
          The studio builds a task only when every check it delivers is an
          automated test with frozen cases, and at least one case is held out:
          QA runs it, but neither the builder nor the reviewer sees it.
        </p>
        {d.checks.map((c, i) => (
          <div key={c.key} className="sf-item">
            <strong>{c.key}</strong>
            {box(
              `checks.${i}.statement`,
              'What must hold',
              c.statement,
              (v) => set((x) => (x.checks[i]!.statement = v)),
              { max: 300 },
            )}
            {box(
              `checks.${i}.measure`,
              'What is measured or observed',
              c.measure,
              (v) => set((x) => (x.checks[i]!.measure = v)),
              { max: 300 },
            )}
            <div className="inline-form">
              <label htmlFor={`sf-checks.${i}.method`} className="inline">
                How it is checked
              </label>
              <select
                id={`sf-checks.${i}.method`}
                value={c.method}
                {...aria(`checks.${i}.method`)}
                onChange={(e) =>
                  set((x) => {
                    const m = e.target.value as Method;
                    x.checks[i]!.method = m;
                    if (m === 'automated_test' && !x.checks[i]!.cases.length)
                      x.checks[i]!.cases.push(emptyCase());
                  })
                }
              >
                <option value="">Choose</option>
                {METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <label htmlFor={`sf-checks.${i}.flow`} className="inline">
                Flow
              </label>
              <select
                id={`sf-checks.${i}.flow`}
                value={c.flow}
                {...aria(`checks.${i}.flow`)}
                onChange={(e) =>
                  set((x) => (x.checks[i]!.flow = e.target.value))
                }
              >
                <option value="">None</option>
                {d.flows.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.key}
                    {f.name ? ` · ${f.name.slice(0, 40)}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {err(`checks.${i}.method`)}
            {err(`checks.${i}.flow`)}
            {(c.method === 'automated_test' || c.cases.length > 0) && (
              <div className="sf-cases">
                {c.cases.map((t, j) => {
                  const k = `checks.${i}.cases.${j}`;
                  const up = (f: (y: (typeof c.cases)[number]) => void) =>
                    set((x) => f(x.checks[i]!.cases[j]!));
                  return (
                    <div key={j} className="sf-case">
                      <strong>Case {j + 1}</strong>
                      {box(
                        `${k}.args`,
                        'Arguments (one per line; leave empty for none)',
                        t.args,
                        (v) => up((y) => (y.args = v)),
                        { rows: 2, mono: true },
                      )}
                      {t.stored &&
                        !argsShowable(t.stored) &&
                        t.args === t.stored.join('\n') && (
                          <p className="small notice">
                            {t.stored.length === 1
                              ? "This stored argument can't be"
                              : `These ${t.stored.length} stored arguments can't be`}{' '}
                            shown one per line (one has a line break, or the
                            last is empty). They are kept exactly unless you
                            edit this box.
                          </p>
                        )}
                      {box(
                        `${k}.stdin`,
                        'Input typed in (stdin)',
                        t.stdin,
                        (v) => up((y) => (y.stdin = v)),
                        { rows: 2, max: 4000, mono: true },
                      )}
                      {box(
                        `${k}.stdout`,
                        'Exact expected output (stdout)',
                        t.stdout,
                        (v) => up((y) => (y.stdout = v)),
                        { rows: 3, mono: true },
                      )}
                      <label className="sf-check">
                        <input
                          type="checkbox"
                          checked={t.newline}
                          onChange={(e) =>
                            up((y) => (y.newline = e.target.checked))
                          }
                        />
                        Output ends with a newline
                      </label>
                      {box(`${k}.exit_code`, 'Exit code', t.exit_code, (v) =>
                        up((y) => (y.exit_code = v)),
                      )}
                      <label className="sf-check">
                        <input
                          type="checkbox"
                          checked={t.held_out}
                          onChange={(e) =>
                            up((y) => (y.held_out = e.target.checked))
                          }
                        />
                        Held out (only QA sees this case)
                      </label>
                      <button
                        type="button"
                        className="text"
                        onClick={() =>
                          drop((x) => remove(x.checks[i]!.cases, j))
                        }
                      >
                        Remove case {j + 1}
                      </button>
                    </div>
                  );
                })}
                {err(`checks.${i}.cases`)}
                {c.cases.length < 10 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      set((x) => x.checks[i]!.cases.push(emptyCase()))
                    }
                  >
                    Add a case
                  </button>
                )}
              </div>
            )}
            {err(`checks.${i}.covered`)}
            {d.checks.length > 1 && (
              <button
                type="button"
                className="text"
                onClick={() =>
                  drop((x) => {
                    remove(x.checks, i);
                    for (const t of x.tasks)
                      t.acceptance = t.acceptance.filter((k) => k !== c.key);
                  })
                }
              >
                Remove {c.key}
              </button>
            )}
          </div>
        ))}
        {err('checks')}
        {d.checks.length < 30 && !newCheck && noKey('check', 'A99')}
        {d.checks.length < 30 && newCheck && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              set((x) =>
                x.checks.push({
                  key: newCheck,
                  flow: '',
                  statement: '',
                  measure: '',
                  method: '',
                  cases: [],
                }),
              )
            }
          >
            Add a check
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Tasks</legend>
        {d.tasks.map((t, i) => (
          <div key={t.key} className="sf-item">
            <strong>{t.key}</strong>
            {box(`tasks.${i}.title`, 'Title', t.title, (v) =>
              set((x) => (x.tasks[i]!.title = v)),
            )}
            <div className="inline-form">
              <label htmlFor={`sf-tasks.${i}.role`} className="inline">
                Role
              </label>
              <select
                id={`sf-tasks.${i}.role`}
                value={t.role}
                {...aria(`tasks.${i}.role`)}
                onChange={(e) =>
                  set((x) => (x.tasks[i]!.role = e.target.value as Role))
                }
              >
                <option value="">Choose</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            {err(`tasks.${i}.role`)}
            {box(
              `tasks.${i}.file_scope`,
              'Paths it may change (one per line, like src)',
              t.file_scope,
              (v) => set((x) => (x.tasks[i]!.file_scope = v)),
              { rows: 2, mono: true },
            )}
            <div
              role="group"
              aria-label={`Checks ${t.key} delivers`}
              className="sf-picks"
              {...aria(`tasks.${i}.acceptance`)}
            >
              <span className="small">Delivers:</span>
              {checkKeys.map((k) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={t.acceptance.includes(k)}
                    onChange={(e) =>
                      set((x) => {
                        const a = x.tasks[i]!.acceptance;
                        x.tasks[i]!.acceptance = e.target.checked
                          ? [...a, k]
                          : a.filter((y) => y !== k);
                      })
                    }
                  />
                  {k}
                </label>
              ))}
            </div>
            {err(`tasks.${i}.acceptance`)}
            {taskKeys.length > 1 && (
              <div
                role="group"
                aria-label={`Tasks ${t.key} waits for`}
                className="sf-picks"
              >
                <span className="small">Waits for:</span>
                {taskKeys
                  .filter((k) => k !== t.key)
                  .map((k) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        checked={t.depends_on.includes(k)}
                        onChange={(e) =>
                          set((x) => {
                            const a = x.tasks[i]!.depends_on;
                            x.tasks[i]!.depends_on = e.target.checked
                              ? [...a, k]
                              : a.filter((y) => y !== k);
                          })
                        }
                      />
                      {k}
                    </label>
                  ))}
              </div>
            )}
            {err(`tasks.${i}.depends_on`)}
            {box(`tasks.${i}.deliverable`, 'Deliverable', t.deliverable, (v) =>
              set((x) => (x.tasks[i]!.deliverable = v)),
            )}
            {d.tasks.length > 1 && (
              <button
                type="button"
                className="text"
                onClick={() =>
                  drop((x) => {
                    remove(x.tasks, i);
                    for (const y of x.tasks)
                      y.depends_on = y.depends_on.filter((k) => k !== t.key);
                  })
                }
              >
                Remove {t.key}
              </button>
            )}
          </div>
        ))}
        {err('tasks')}
        {d.tasks.length < 40 && !newTask && noKey('task', 'T99')}
        {d.tasks.length < 40 && newTask && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              set((x) =>
                x.tasks.push({
                  key: newTask,
                  title: '',
                  role: '',
                  file_scope: '',
                  depends_on: [],
                  acceptance: [],
                  deliverable: '',
                }),
              )
            }
          >
            Add a task
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>Data, risks and upkeep</legend>
        {d.data_contracts.map((c, i) => (
          <div key={i} className="sf-item">
            <strong>Data {i + 1}</strong>
            {box(`data_contracts.${i}.name`, 'Name', c.name, (v) =>
              set((x) => (x.data_contracts[i]!.name = v)),
            )}
            {box(
              `data_contracts.${i}.description`,
              'Description',
              c.description,
              (v) => set((x) => (x.data_contracts[i]!.description = v)),
            )}
            <div className="inline-form">
              <label
                htmlFor={`sf-data_contracts.${i}.data_class`}
                className="inline"
              >
                Data class
              </label>
              <select
                id={`sf-data_contracts.${i}.data_class`}
                value={c.data_class}
                {...aria(`data_contracts.${i}.data_class`)}
                onChange={(e) =>
                  set(
                    (x) =>
                      (x.data_contracts[i]!.data_class = e.target
                        .value as DataClass),
                  )
                }
              >
                <option value="">Choose</option>
                {CLASSES.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text"
                onClick={() => drop((x) => remove(x.data_contracts, i))}
              >
                Remove
              </button>
            </div>
            {err(`data_contracts.${i}.data_class`)}
          </div>
        ))}
        {d.data_contracts.length < 20 && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              set((x) =>
                x.data_contracts.push({
                  name: '',
                  description: '',
                  data_class: '',
                }),
              )
            }
          >
            Add data it uses
          </button>
        )}
        {d.risks.map((r, i) => (
          <div key={i} className="sf-item">
            <strong>Risk {i + 1}</strong>
            {box(`risks.${i}.risk`, 'Risk', r.risk, (v) =>
              set((x) => (x.risks[i]!.risk = v)),
            )}
            {box(`risks.${i}.mitigation`, 'Mitigation', r.mitigation, (v) =>
              set((x) => (x.risks[i]!.mitigation = v)),
            )}
            <button
              type="button"
              className="text"
              onClick={() => drop((x) => remove(x.risks, i))}
            >
              Remove
            </button>
          </div>
        ))}
        {d.risks.length < 20 && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              set((x) => x.risks.push({ risk: '', mitigation: '' }))
            }
          >
            Add a risk
          </button>
        )}
        {box(
          'maintenance.owner',
          'Who maintains it',
          d.maintenance.owner,
          (v) => set((x) => (x.maintenance.owner = v)),
        )}
        {box(
          'maintenance.obligations',
          'Upkeep obligations (one per line)',
          d.maintenance.obligations,
          (v) => set((x) => (x.maintenance.obligations = v)),
          { rows: 2 },
        )}
        {box(
          'maintenance.review_interval',
          'How often it is reviewed',
          d.maintenance.review_interval,
          (v) => set((x) => (x.maintenance.review_interval = v)),
        )}
      </fieldset>

      {notes.length > 0 && (
        <div className="notice" role="status">
          <strong>Valid, but the studio could not build it yet:</strong>
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {mode.kind === 'revise' &&
        box('reason', 'What changed and why', reason, setReason, { max: 300 })}
      {Object.keys(errors).length > 0 && (
        <p className="error" role="alert">
          {Object.keys(errors).length} field
          {Object.keys(errors).length === 1 ? ' needs' : 's need'} a look
          (marked above).
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {mode.kind === 'create' ? 'Save spec' : 'Save new version'}
        </button>
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
