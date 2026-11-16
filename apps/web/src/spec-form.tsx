import { useState, type FormEvent, type ReactNode } from 'react';
import {
  BROWSER_STEP_HELP,
  FeedbackSchema,
  SpecStatusSchema,
  formatBrowserStep,
  heldOutOf,
  parseBrowserSteps,
  specCaseProblems,
  type BrowserStep,
  type SessionInfo,
  type SpecContent,
  type SpecDraft as ModelDraft,
  type SpecDraftCheck,
  type SpecStatus,
  type StoredEntity,
} from '@creator/contracts';
import { ApiError, api, message } from './oversight.js';
import {
  browserCaseDraft,
  buildNotes,
  caseDraft,
  checkForDraft,
  draftFromContent,
  draftToContent,
  emptyBrowserCase,
  emptyCase,
  emptySpecDraft,
  FEEDBACK_REASON_MAX,
  FEEDBACK_REVISION_STALE,
  feedbackReason,
  nextKey,
  problemKey,
  SPEC_DEFAULTS,
  argsShowable,
  storedKeys,
  type DataClass,
  type Method,
  type Role,
  type SpecContentShape,
  type SpecDraft,
} from './spec-fields.js';
import { Routine, WhatWillHappen } from './routine.js';
import {
  CheckedAgainst,
  DraftRoutePicker,
  EdgeCaseOffer,
  Explanation,
  SpecDraftOffer,
  DraftReads,
  useDraftAsk,
  useSpecDrafts,
} from './spec-drafts.js';
import { Term } from './term.js';

const METHODS: { value: Method; label: string }[] = [
  { value: 'automated_test', label: 'Automated test (cases below)' },
  { value: 'browser_check', label: 'Browser check (web page; cases below)' },
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
  /**
   * The spec's status and its stored current version (the body to start from). With
   * feedback, the revision is saved through that accepted preview feedback, which the
   * studio then marks revised (audit L-8).
   */
  | {
      kind: 'revise';
      spec: SpecStatus;
      entity: StoredEntity;
      /**
       * `others`: the other accepted items on the same spec version. One revision is all a
       * package's feedback can start, so they belong in this one (PR #121 review L-1).
       */
      feedback?: {
        id: string;
        version: number;
        text: string;
        others: string[];
      };
    };

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
  openBuild,
  owner = false,
  choice = null,
  openModels,
}: {
  base: string;
  session: SessionInfo;
  mode: SpecFormMode;
  /** ADR-0107: only the owner may ask a model to draft. */
  owner?: boolean;
  /** The person's current model (top bar); drafts go there when it may draft specs. */
  choice?: { connection_id: string; model_id: string } | null;
  saved: (s: SpecStatus) => void;
  cancel: () => void;
  /** Where a feedback revision that went stale sends the owner instead. */
  openBuild?: () => void;
  /** Opens Models and connections, where a model is qualified to draft specs. */
  openModels?: () => void;
}) {
  // The draft the form opened with, so the folds can say what was changed here.
  const [start] = useState<SpecDraft>(() =>
    mode.kind === 'revise'
      ? draftFromContent(
          mode.entity.title,
          mode.entity.body as unknown as SpecContentShape,
          (step) => formatBrowserStep(step as BrowserStep),
        )
      : emptySpecDraft({ ...mode.prefill, maintainer: session.display_name }),
  );
  const [d, setD] = useState<SpecDraft>(() => structuredClone(start));
  const fromFeedback = mode.kind === 'revise' ? mode.feedback : undefined;
  const [reason, setReason] = useState(() =>
    fromFeedback ? feedbackReason(fromFeedback.text) : '',
  );
  // Set once a feedback revision is saved but the spec could not be read back.
  const [done, setDone] = useState(false);
  // The spec moved on while the form was open: Save can only be refused again (L-2).
  const [stale, setStale] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // ADR-0107 (B2): model drafts. The subject is the option the spec is written for.
  const subject =
    mode.kind === 'create'
      ? { selection_id: mode.selection_id, alternative: mode.alternative }
      : {
          selection_id: String(mode.entity.body?.selection_id ?? ''),
          alternative: (mode.entity.body?.alternative ?? {
            id: '',
            version: 1,
          }) as { id: string; version: number },
        };
  const canDraft = owner && !!subject.selection_id && !!subject.alternative.id;
  const drafts = useSpecDrafts(base, canDraft ? subject.alternative.id : '');
  const ask = useDraftAsk({
    base,
    session,
    choice,
    owner: canDraft,
    selection: subject.selection_id,
    drafted: drafts.refresh,
  });
  /** The whole-spec draft the form now holds, and the edge cases added from drafts. */
  const [usedSpec, setUsedSpec] = useState<string | null>(null);
  const [addedEdges, setAddedEdges] = useState<string[]>([]);
  /** Edge cases and explanations asked in this form (by the button that asked), and dismissed. */
  const [mine, setMine] = useState<{ key: string; draft: ModelDraft }[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [helperError, setHelperError] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const newestSpec = drafts.data?.find((x) => x.kind === 'spec');
  const shown = (key: string) =>
    mine.filter((m) => m.key === key && !dismissed.includes(m.draft.id));
  const route = canDraft ? ask.route : null;
  const routesKnown = !ask.routes.loading && !ask.routes.error;
  async function helper(
    key: string,
    i: number,
    kind: 'edge_case' | 'explain_case',
    caseIndex: number | null,
  ) {
    setHelperError(null);
    const c = checkForDraft(d, i, parseBrowserSteps);
    if (c.error !== null) {
      setHelperError({ key, text: c.error });
      return;
    }
    const got = await ask.ask(key, {
      kind,
      selection_id: subject.selection_id,
      alternative: subject.alternative,
      product: 'cli',
      check: c.check as SpecDraftCheck,
      case_index: caseIndex,
    });
    if (got) setMine((m) => [...m, { key, draft: got }]);
  }
  const helperNote = (key: string) =>
    (helperError?.key === key ? helperError.text : null) ??
    (ask.error?.key === key ? ask.error.text : null);
  const fmt = (step: unknown) => formatBrowserStep(step as BrowserStep);
  async function draftSpec() {
    await ask.ask('spec', {
      kind: 'spec',
      selection_id: subject.selection_id,
      alternative: subject.alternative,
      product: 'cli',
      check: null,
      case_index: null,
    });
  }
  /** Puts a whole-spec draft in the form; who maintains it stays as typed. */
  function takeDraft(x: ModelDraft) {
    if (x.result?.kind !== 'spec') return;
    const next = draftFromContent(
      x.result.title,
      x.result.content as unknown as SpecContentShape,
      fmt,
    );
    setD((prev) => ({ ...next, maintenance: prev.maintenance }));
    setUsedSpec(x.id);
    setAddedEdges([]);
    setErrors({});
  }
  /** Adds a suggested edge case to its check (by key, so a removed check is never hit). */
  function addEdge(x: ModelDraft): (() => void) | null {
    const r = x.result?.kind === 'edge_case' ? x.result : null;
    if (!r || addedEdges.includes(x.id)) return null;
    const c = d.checks.find((y) => y.key === r.check);
    if (!c) return null;
    if (r.case ? c.cases.length >= 10 : c.browser_cases.length >= 10)
      return null;
    return () => {
      set((y) => {
        const t = y.checks.find((z) => z.key === r.check);
        if (!t) return;
        if (r.case) t.cases.push(caseDraft(r.case));
        else if (r.browser_case)
          t.browser_cases.push(browserCaseDraft(r.browser_case, fmt));
      });
      setAddedEdges((a) => [...a, x.id]);
      setDismissed((a) => [...a, x.id]);
    };
  }
  const helperButton = (
    key: string,
    label: string,
    asking: string,
    run: () => void,
  ) =>
    route ? (
      <div className="sf-helpers">
        <button
          type="button"
          className="text"
          disabled={!!ask.busy}
          aria-busy={ask.busy === key}
          onClick={run}
        >
          {ask.busy === key ? asking : label}
        </button>
        {helperNote(key) && (
          <span className="error" role="alert">
            {' '}
            {helperNote(key)}
          </span>
        )}
      </div>
    ) : null;
  const dismiss = (id: string) => setDismissed((a) => [...a, id]);
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
  const parsed = draftToContent(d, parseBrowserSteps);
  const notes = parsed.content ? buildNotes(parsed.content) : [];

  /** ADR-0107: the drafts whose text is in the form; the studio checks and records them. */
  const used = [...(usedSpec ? [usedSpec] : []), ...addedEdges];
  const draftIds = used.length ? { draft_ids: used } : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const out = draftToContent(d, parseBrowserSteps);
    const errs = { ...(out.errors ?? {}) };
    if (mode.kind === 'revise' && !reason.trim())
      errs.reason = 'Say what changed and why.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    if (mode.kind === 'revise' && mode.feedback) {
      const fb = mode.feedback;
      let revised;
      try {
        revised = await api(
          FeedbackSchema,
          `${base}/feedback/${fb.id}/revision`,
          {
            csrf: session.csrf_token,
            body: {
              expected_version: fb.version,
              expected_spec_version: mode.spec.spec.version,
              title: out.title,
              content: out.content,
              reason: reason.trim().slice(0, FEEDBACK_REASON_MAX),
            },
          },
        );
      } catch (x) {
        if (x instanceof ApiError && x.code === 'VERSION_CONFLICT') {
          setStale(true);
          setError(FEEDBACK_REVISION_STALE);
        } else setError(message(x));
        setBusy(false);
        return;
      }
      try {
        saved(
          await api(SpecStatusSchema, `${base}/specs/${mode.spec.spec.id}`),
        );
      } catch (x) {
        // The revision is stored; saving again would be refused, so say so instead.
        setDone(true);
        setError(
          `Saved as spec v${revised.revision?.version ?? '?'}, but the spec could not be read back (${message(x)}). Open Build to see it.`,
        );
      } finally {
        setBusy(false);
      }
      return;
    }
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
                  ...draftIds,
                }
              : {
                  expected_version: mode.spec.spec.version,
                  title: out.title,
                  content: out.content,
                  reason: reason.trim().slice(0, 300),
                  ...draftIds,
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
  // ADR-0107: the studio's checks of the cases, in plain words, beside each case. The held-out
  // rule is already among the notes below, so it is not repeated here.
  const content = parsed.content as unknown as SpecContent | null;
  const caseProblems = content
    ? specCaseProblems(content).filter((p) => p.code !== 'no_held_out')
    : [];
  const problemsAt = (k: string) => {
    const ps = caseProblems.filter((p) => problemKey(p, checkKeys) === k);
    return ps.length ? (
      <ul className="small case-problems">
        {ps.map((p, n) => (
          <li key={n} className={p.level === 'error' ? 'error' : undefined}>
            {p.level === 'error' ? 'Fix: ' : 'Look: '}
            {p.text}
          </li>
        ))}
      </ul>
    ) : null;
  };
  const usedDraft = usedSpec
    ? drafts.data?.find((x) => x.id === usedSpec)
    : undefined;
  const pickKept = (() => {
    if (usedDraft?.result?.kind !== 'spec' || !content) return null;
    const key = (p: { check: string; list: string; index: number }) =>
      `${p.check}/${p.list}/${p.index}`;
    const a = usedDraft.result.picks.map(key).sort().join();
    return {
      kept: a === heldOutOf(content).map(key).sort().join(),
      n: usedDraft.result.picks.length,
    };
  })();
  const edited = JSON.stringify(d) !== JSON.stringify(start);
  const newFlow = nextKey('F', flowKeys, given);
  const newCheck = nextKey('A', checkKeys, given);
  const newTask = nextKey('T', taskKeys, given);
  const noKey = (what: string, last: string) => (
    <p className="small">
      No more {what} keys: {last} has been used, and keys stop at 99.
    </p>
  );

  // ADR-0082 (P19): routine values and where they came from, for the folds' summaries. A new
  // spec starts from studio defaults; a revision starts from the stored version.
  const origin =
    mode.kind === 'revise'
      ? `as in v${mode.spec.spec.version}`
      : 'studio defaults';
  const sameTask = (t: SpecDraft['tasks'][number]) => {
    const was = start.tasks.find((x) => x.key === t.key);
    return was
      ? was.role === t.role &&
          was.file_scope === t.file_scope &&
          was.depends_on.join() === t.depends_on.join()
      : t.role === SPEC_DEFAULTS.role &&
          !t.file_scope.trim() &&
          !t.depends_on.length;
  };
  const taskSummary = (t: SpecDraft['tasks'][number]) => {
    const scope = t.file_scope.trim()
      ? `${t.file_scope.split('\n').filter((l) => l.trim()).length} path(s)`
      : 'any path';
    const waits = t.depends_on.length
      ? `waits for ${t.depends_on.join(', ')}`
      : 'waits for none';
    const was = start.tasks.some((x) => x.key === t.key);
    return `${t.key} routine: ${t.role || 'no role'} · ${scope} · ${waits} · ${sameTask(t) ? (was ? origin : 'studio defaults') : 'changed here'}`;
  };
  const sameUpkeep =
    JSON.stringify([d.data_contracts, d.risks, d.maintenance]) ===
    JSON.stringify([start.data_contracts, start.risks, start.maintenance]);
  const upkeepSummary = `Data, risks and upkeep: ${d.data_contracts.length === 0 ? 'no data contracts' : `${d.data_contracts.length} data contract(s)`} · ${d.risks.length === 0 ? 'no risks listed' : `${d.risks.length} risk(s)`} · maintained by ${d.maintenance.owner.trim() || 'nobody yet'}, reviewed ${d.maintenance.review_interval.trim().toLowerCase() || 'never'} · ${sameUpkeep ? origin : 'changed here'}`;
  return (
    <form
      className="spec-form"
      onSubmit={(e) => void submit(e)}
      aria-labelledby="sf-title-h"
    >
      <h3 id="sf-title-h">
        {mode.kind === 'create'
          ? 'Write a spec'
          : `Revise ${mode.spec.spec.title} (now v${mode.spec.spec.version})${fromFeedback ? ' from preview feedback' : ''}`}
      </h3>
      {fromFeedback && (
        <blockquote className="sf-feedback">
          <strong>The feedback:</strong> {fromFeedback.text}
        </blockquote>
      )}
      {fromFeedback && fromFeedback.others.length > 0 && (
        <div className="notice" role="note">
          <strong>
            {fromFeedback.others.length === 1
              ? 'Also accepted on'
              : `${fromFeedback.others.length} more items accepted on`}{' '}
            v{mode.kind === 'revise' ? mode.spec.spec.version : ''}:
          </strong>
          <ul>
            {fromFeedback.others.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
          <span>
            Make their changes in this revision too. Once it is saved, the spec
            is on a new version and{' '}
            {fromFeedback.others.length === 1 ? 'that item' : 'those items'} can
            no longer start a revision.
          </span>
        </div>
      )}
      <p className="small">
        A spec says what will be built and how it will be checked. Write the
        lists one item per line. Keys (F1, A1, T1) are given for you and stay
        fixed, so a revision only changes the tasks you edit.
        {mode.kind === 'revise' &&
          mode.spec.frozen_current &&
          ' This version is frozen: saving a revision means freezing again before the next build.'}
      </p>
      {canDraft && mode.kind === 'create' && (
        <fieldset className="spec-drafting">
          <legend>Draft it with a model</legend>
          {routesKnown && !route && (
            <div className="small notice">
              <p>
                No model may draft specs yet. A model drafts specs once it is
                qualified on the spec-cases-v2 benchmark under Models and
                connections, on a connection that allows specification work and
                this problem&rsquo;s data. Until then, write the spec yourself
                below.
              </p>
              {openModels && (
                <button type="button" className="text" onClick={openModels}>
                  Open Models and connections
                </button>
              )}
            </div>
          )}
          {route && (
            <>
              <p className="small">
                {route.model_id} proposes the requirements, acceptance checks
                and suggested cases for this option as a command-line program.
                The studio checks the cases and holds about a third of them out
                at random. You check and edit everything; nothing is saved until
                you press Save spec.
              </p>
              <p className="small">
                Drafting is for command-line programs only: the drafting
                qualification (spec-cases-v2) tests command-line cases only. For
                a static web page, write the spec yourself.
              </p>
              <DraftRoutePicker ask={ask} />
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!!ask.busy}
                  aria-busy={ask.busy === 'spec'}
                  onClick={() => void draftSpec()}
                >
                  {ask.busy === 'spec'
                    ? `Drafting with ${route.model_id}…`
                    : newestSpec
                      ? `Draft again with ${route.model_id}`
                      : `Draft with ${route.model_id}`}
                </button>
              </div>
              {helperNote('spec') && (
                <p className="error" role="alert">
                  {helperNote('spec')}
                </p>
              )}
            </>
          )}
          <DraftReads drafts={drafts} ask={ask} />
          {newestSpec && (
            <SpecDraftOffer
              key={newestSpec.id}
              draft={newestSpec}
              used={usedSpec === newestSpec.id}
              replaces={edited}
              use={() => takeDraft(newestSpec)}
            />
          )}
        </fieldset>
      )}
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
        <legend>
          <Term term="acceptance_check">Acceptance checks</Term>
        </legend>
        <p className="small">
          The studio builds a task only when every check it delivers is an
          automated test with frozen cases (a command-line program) or every
          check is a browser check with frozen browser cases (a static web
          page), and at least one case is{' '}
          <Term term="held_out_case">held out</Term>: QA runs it, but neither
          the builder nor the reviewer sees it.
        </p>
        {pickKept && (
          <p className="small notice" role="note">
            {pickKept.kept
              ? `The studio held out ${pickKept.n} drafted case${pickKept.n === 1 ? '' : 's'} at random. You can change which by ticking or unticking Held out on any case.`
              : 'You changed which cases are held out from the studio’s random pick. The saved spec records that.'}
          </p>
        )}
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
                    if (
                      m === 'browser_check' &&
                      !x.checks[i]!.browser_cases.length
                    )
                      x.checks[i]!.browser_cases.push(emptyBrowserCase());
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
                            last is empty).{' '}
                            {t.stored.length === 1 ? 'It is' : 'They are'} kept
                            exactly unless you edit this box.
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
                      {problemsAt(k)}
                      {canDraft &&
                        c.method === 'automated_test' &&
                        helperButton(
                          `explain.${c.key}.cases.${j}`,
                          'Explain this case',
                          'Asking for an explanation…',
                          () =>
                            void helper(
                              `explain.${c.key}.cases.${j}`,
                              i,
                              'explain_case',
                              j,
                            ),
                        )}
                      {shown(`explain.${c.key}.cases.${j}`).map(({ draft }) => (
                        <Explanation
                          key={draft.id}
                          draft={draft}
                          dismiss={() => dismiss(draft.id)}
                        />
                      ))}
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
            {(c.method === 'browser_check' || c.browser_cases.length > 0) && (
              <div className="sf-cases">
                <details className="small">
                  <summary>How to write browser steps</summary>
                  <p>
                    One step per line. The reviewed checker opens the page in a
                    headless browser and runs the steps in order; each expect
                    step waits up to 3 seconds. A selector is a CSS selector
                    that matches exactly one element, such as <code>#name</code>{' '}
                    or <code>button.save</code>.
                  </p>
                  <ul className="mono">
                    {BROWSER_STEP_HELP.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </details>
                {c.browser_cases.map((t, j) => {
                  const k = `checks.${i}.browser_cases.${j}`;
                  const up = (
                    f: (y: (typeof c.browser_cases)[number]) => void,
                  ) => set((x) => f(x.checks[i]!.browser_cases[j]!));
                  return (
                    <div key={j} className="sf-case">
                      <strong>Browser case {j + 1}</strong>
                      {box(`${k}.page`, 'Page to open', t.page, (v) =>
                        up((y) => (y.page = v)),
                      )}
                      {box(
                        `${k}.steps`,
                        'Steps (one per line)',
                        t.steps,
                        (v) => up((y) => (y.steps = v)),
                        { rows: 6, mono: true },
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
                          drop((x) => remove(x.checks[i]!.browser_cases, j))
                        }
                      >
                        Remove browser case {j + 1}
                      </button>
                      {problemsAt(k)}
                      {shown(`explain.${c.key}.browser_cases.${j}`).map(
                        ({ draft }) => (
                          <Explanation
                            key={draft.id}
                            draft={draft}
                            dismiss={() => dismiss(draft.id)}
                          />
                        ),
                      )}
                    </div>
                  );
                })}
                {err(`checks.${i}.browser_cases`)}
                {c.browser_cases.length < 10 && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      set((x) =>
                        x.checks[i]!.browser_cases.push(emptyBrowserCase()),
                      )
                    }
                  >
                    Add a browser case
                  </button>
                )}
              </div>
            )}
            {err(`checks.${i}.covered`)}
            {problemsAt(`checks.${i}`)}
            {canDraft &&
              c.method === 'automated_test' &&
              helperButton(
                `edge.${c.key}`,
                'Add an edge case',
                'Asking for an edge case…',
                () => void helper(`edge.${c.key}`, i, 'edge_case', null),
              )}
            {shown(`edge.${c.key}`).map(({ draft }) => (
              <EdgeCaseOffer
                key={draft.id}
                draft={draft}
                add={addEdge(draft)}
                dismiss={() => dismiss(draft.id)}
              />
            ))}
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
                  browser_cases: [],
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
            <Routine
              summary={taskSummary(t)}
              open={[
                `tasks.${i}.role`,
                `tasks.${i}.file_scope`,
                `tasks.${i}.depends_on`,
              ].some((k) => Boolean(errors[k]))}
            >
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
            </Routine>
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
                  role: SPEC_DEFAULTS.role,
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

      <Routine
        summary={upkeepSummary}
        open={Object.keys(errors).some(
          (k) =>
            k.startsWith('data_contracts') ||
            k.startsWith('risks') ||
            k.startsWith('maintenance'),
        )}
      >
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
      </Routine>

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
        box('reason', 'What changed and why', reason, setReason, {
          max: fromFeedback ? FEEDBACK_REASON_MAX : 300,
        })}
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
          {stale && openBuild && (
            <>
              {' '}
              <button type="button" className="text" onClick={openBuild}>
                Open Build
              </button>
            </>
          )}
        </p>
      )}
      {content && <CheckedAgainst content={content} />}
      <WhatWillHappen
        items={[
          {
            label: 'Spec',
            value:
              mode.kind === 'create'
                ? `Saves “${d.title.trim() || 'this spec'}” as a draft spec, version 1`
                : `Saves version ${mode.spec.spec.version + 1} of ${mode.spec.spec.title}${mode.spec.frozen_current ? '; the frozen version stays as it was' : ''}`,
          },
          {
            label: 'Contents',
            value: `${d.flows.length} flow${d.flows.length === 1 ? '' : 's'}, ${d.checks.length} acceptance check${d.checks.length === 1 ? '' : 's'}, ${d.tasks.length} task${d.tasks.length === 1 ? '' : 's'}`,
          },
          { label: 'Upkeep', value: upkeepSummary },
          ...(used.length
            ? [
                {
                  label: 'Model drafts',
                  value: `Records that ${used.length === 1 ? 'a model draft' : `${used.length} model drafts`} went into this spec, so it shows as drafted by the model and checked by you`,
                },
              ]
            : []),
          {
            label: 'Next',
            value:
              'Freeze it under Scores and specs; nothing is built until a frozen version has a humility review and you start a build',
          },
        ]}
        note="Nothing is saved until you press the button below, and the server checks the spec again."
      />
      <div className="actions">
        <button type="submit" disabled={busy || done || stale}>
          {mode.kind === 'create' ? 'Save spec' : 'Save new version'}
        </button>
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
