import { useState } from 'react';
import {
  PlanConnectionDetailSchema,
  PlanQualificationSchema,
  type PlanConnection,
  planWaitMs,
  z,
  type PlanConnectionDetail,
  type PlanQualification,
} from '@creator/contracts';
import { allowSequence } from './allow-tasks.js';
import {
  DATA_CLASS_CHOICES,
  capsLine,
  classChanges,
  classSummary,
  orderedClasses,
  taskChoicesFor,
} from './caps-fields.js';
import {
  fixKey,
  fixLabel,
  manifestHash,
  missingTaskFixes,
  refusalFixes,
  startedFor,
  type FixAction,
  type QualifyRole,
} from './fix-here.js';
import { api, message, words } from './oversight.js';
import { BENCHMARKS, runOutcome } from './qualify.js';

/**
 * ADR-0087 (P27): where a fix is pressed. Only the owner sees the buttons; the server still
 * refuses anyone else on every route. A model in Chat has no way to press or propose them:
 * they are drawn by the page from what the server reports, never from a reply.
 */
export type FixContext = {
  /** The workspace's API path, e.g. `workspaces/<id>`. */
  base: string;
  csrf: string;
  owner: boolean;
  /** Called after a fix changed something, so the page reads its state again. */
  onDone?: () => void;
};

/** The fixes for one refusal, side by side; nothing when the person is not the owner. */
export function FixButtons({
  acts,
  fix,
}: {
  acts: readonly FixAction[] | undefined;
  fix: FixContext | null | undefined;
}) {
  if (!fix?.owner || !acts?.length) return null;
  return (
    <>
      {acts.map((a) => (
        <span key={fixKey(a)}>
          {' '}
          <FixButton act={a} fix={fix} />
        </span>
      ))}
    </>
  );
}

/** The same as a line of its own, under a list of reasons; nothing when there is no fix. */
export function FixRow({
  acts,
  fix,
}: {
  acts: readonly FixAction[] | undefined;
  fix: FixContext | null | undefined;
}) {
  if (!fix?.owner || !acts?.length) return null;
  return (
    <p className="small fix-row">
      Fix it here:
      <FixButtons acts={acts} fix={fix} />
    </p>
  );
}

/**
 * The fixes for what a plan route is missing, as Explore for me and Automatic assessment check
 * it before starting: caps not accepted (by the server's code), the data class, and the task.
 */
export function routeFixes(input: {
  plan: Pick<PlanConnectionDetail, 'connection' | 'refusals'> | undefined;
  dataClass: string;
  model: string;
  /** The tasks the model lacks a current qualification for. */
  missing: readonly string[];
  role: QualifyRole;
}): FixAction[] {
  const p = input.plan;
  if (!p) return [];
  const c = p.connection;
  const canQualify = qualifierFor(input.role, c);
  return [
    ...refusalFixes(p.refusals ?? [], input.role, canQualify),
    ...((c.settings.allowed_data_classes as readonly string[]).includes(
      input.dataClass,
    )
      ? []
      : [
          {
            kind: 'allow_data' as const,
            connection_id: c.id,
            data_class: input.dataClass,
          },
        ]),
    // With no verified model the task can still be allowed; only qualifying waits (review N-2).
    ...missingTaskFixes(
      c.id,
      input.model || null,
      input.missing,
      c.settings.allowed_task_classes,
      input.role,
      canQualify,
    ),
  ];
}

/** Which route a bundled benchmark qualifies for, from its cases' check kind. */
function roleOf(manifest: {
  cases: readonly { check?: unknown }[];
}): QualifyRole {
  const kind = (manifest.cases[0]?.check as { kind?: string } | undefined)
    ?.kind;
  return kind === 'discovery_contract'
    ? 'discovery'
    : kind === 'assessment_contract'
      ? 'assessment'
      : 'plan';
}

/**
 * A benchmark a fix can start for a task in a role (ADR-0087). Today these are the bundled
 * benchmarks, started with their manifest. P34 (#175) serves the discovery benchmarks from the
 * server instead (GET plan-benchmarks, started by name with `{ expected_version, model_id,
 * benchmark }`, carrying their manifest_hash): whichever of #175 and P27 merges second adds
 * them in `offersFor`, and discovery's Qualify now and Allow and qualify turn on from there.
 * Until then discovery offers no qualify fix (review M-1).
 */
export type QualifyOffer = {
  name: string;
  task_class: string;
  role: QualifyRole;
  development: number;
  held_out: number;
  /** The manifest hash the server records, to recognise a started run of this benchmark. */
  hash: () => Promise<string>;
  /** The body that starts it on the connection's qualifications route. */
  start: (expected_version: number, model_id: string) => unknown;
};

const memo = <T,>(f: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= f());
};

// The web-discovery benchmark (ADR-0086) qualifies only Search the web, which no fix here
// starts, so it is never offered: its research synthesis counts for no route a fix serves.
const BUNDLED: readonly QualifyOffer[] = BENCHMARKS.filter((b) => !b.web).map(
  (b) => ({
    name: b.name,
    task_class: b.task_class,
    role: roleOf(b.manifest),
    development: b.development,
    held_out: b.held_out,
    hash: memo(() => manifestHash(b.manifest)),
    start: (expected_version: number, model_id: string) => ({
      expected_version,
      model_id,
      manifest: b.manifest,
      min_held_out_cases: b.held_out,
      floor: { numerator: 1, denominator: 1 },
    }),
  }),
);

/**
 * Every benchmark a fix can start, in every role. The P34 wiring point (see QualifyOffer): its
 * offers are read from the server, so the page loads them and passes them in here; a module
 * constant can't hold them.
 */
const allOffers = (): readonly QualifyOffer[] => BUNDLED;

/** Every benchmark a fix can start in a role. */
export const offersFor = (role: QualifyRole): readonly QualifyOffer[] =>
  allOffers().filter((b) => b.role === role);

/** The app's benchmark for a task in a role (ADR-0087), or none. */
export const benchmarkFor = (task: string, role: QualifyRole) =>
  offersFor(role).find((b) => b.task_class === task);

/** Whether the app can qualify a task for a role itself. */
export const canQualifyFor = (role: QualifyRole) => (task: string) =>
  Boolean(benchmarkFor(task, role));

/**
 * The same, for one connection: a fixture connection qualifies nothing, because the bundled
 * benchmarks qualify only real connections and the server refuses them there (review N-3).
 */
export const qualifierFor =
  (role: QualifyRole, c: Pick<PlanConnection, 'fixture'>) => (task: string) =>
    !c.fixture && canQualifyFor(role)(task);

/**
 * The started qualifications a press meets, by task (review M-2): a run of this benchmark is
 * run on, and one of another benchmark (named in `other`) blocks the press.
 */
type Started = { task: string; other: string | null };

async function startedRuns(
  a: FixAction,
  d: PlanConnectionDetail,
): Promise<Started[]> {
  const model =
    a.kind === 'qualify' || a.kind === 'allow_tasks' ? a.model_id : null;
  if (!model) return [];
  // A press that only allows meets no started run (re-review N-2).
  if (a.kind === 'allow_tasks' && !qualifies(a, d)) return [];
  const tasks =
    a.kind === 'qualify'
      ? [a.task_class]
      : a.kind === 'allow_tasks'
        ? a.qualify
        : [];
  const role = a.kind === 'qualify' || a.kind === 'allow_tasks' ? a.role : null;
  const out: Started[] = [];
  for (const t of tasks) {
    const b = role && benchmarkFor(t, role);
    if (!b) continue;
    const s = startedFor(d.qualifications, model, t, await b.hash());
    if (s.kind !== 'none')
      out.push({
        task: t,
        other: s.kind === 'other' ? await nameOf(s.hash) : null,
      });
  }
  return out;
}

/** A known benchmark's name (any role) from its manifest hash, or "another benchmark". */
async function nameOf(hash: string): Promise<string> {
  for (const b of allOffers()) if ((await b.hash()) === hash) return b.name;
  return 'another benchmark';
}

function FixButton({ act: a, fix }: { act: FixAction; fix: FixContext }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PlanConnectionDetail | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [started, setStarted] = useState<Started[]>([]);
  const clash = started.filter((x) => x.other !== null);
  const path = `${fix.base}/plan-connections/${a.connection_id}`;
  // Passthrough as every page reads it: the detail carries more than this schema lists.
  const read = () => api(PlanConnectionDetailSchema.passthrough(), path);

  async function show() {
    setError('');
    setOutcome('');
    try {
      const d = await read();
      setStarted(await startedRuns(a, d));
      setDetail(d);
      setOpen(true);
    } catch (e) {
      setError(message(e));
    }
  }

  /** One POST under the person's session; refusals go to this button's own error line. */
  const post = (to: string, body: unknown, timeoutMs?: number) =>
    api(z.unknown(), `${fix.base}/${to}`, {
      body,
      csrf: fix.csrf,
      ...(timeoutMs ? { timeoutMs } : {}),
    });

  /**
   * Start (or run on a started run of the same benchmark) a qualification of the model for the
   * task, then run it. `saved` is called once something was recorded on the connection.
   */
  async function qualify(
    model: string,
    task: string,
    role: QualifyRole,
    saved: () => void,
  ): Promise<{ text: string; qualified: boolean }> {
    const b = benchmarkFor(task, role);
    if (!b) return { text: '', qualified: false };
    const d = await read();
    if (d.connection.fixture)
      throw new Error('A fixture connection is not qualified in the app.');
    // The server keeps one started qualification per model and task: a started run of this
    // benchmark is run on (its answered cases are skipped); one of another is never run here.
    const s = startedFor(d.qualifications, model, task, await b.hash());
    if (s.kind === 'other')
      throw new Error(
        `A ${words(task)} qualification on ${await nameOf(s.hash)} is started; finish it under Models and connections first.`,
      );
    let q: Pick<PlanQualification, 'id' | 'task_class' | 'model_id'>;
    if (s.kind === 'same')
      q = {
        id: s.id,
        task_class: task as PlanQualification['task_class'],
        model_id: model,
      };
    else {
      q = await api(PlanQualificationSchema, `${path}/qualifications`, {
        body: b.start(d.connection.version, model),
        csrf: fix.csrf,
      });
      saved();
    }
    const cases = b.development + b.held_out;
    const out = await post(
      `plan-qualifications/${q.id}/run`,
      {},
      // As Qualify a model waits: one plan call per case, plus grading time (ADR-0062).
      Math.max(
        3_600_000,
        planWaitMs(
          d.connection.settings.caps.responses.request_timeout_ms + 120_000,
          cases,
        ),
      ),
    );
    saved();
    const o = out as { state?: string; qualification?: { state?: string } };
    return {
      text: runOutcome(q, out),
      qualified:
        o?.state === 'decided' && o.qualification?.state === 'qualified',
    };
  }

  async function apply() {
    if (!detail) return;
    const c = detail.connection;
    setWorking(true);
    setError('');
    setOutcome('');
    const done: string[] = [];
    let saved = false;
    const save = () => {
      saved = true;
    };
    try {
      switch (a.kind) {
        case 'accept_caps':
          await post(`plan-connections/${c.id}/accept-caps`, {
            expected_version: c.version,
            settings_hash: c.settings_hash,
          });
          save();
          done.push('Caps and allowed work accepted.');
          break;
        case 'allow_data':
        case 'allow_tasks': {
          const ok = await allowSequence(
            c,
            a.kind === 'allow_data'
              ? {
                  data: orderedClasses(DATA_CLASS_CHOICES, [
                    ...c.settings.allowed_data_classes,
                    a.data_class,
                  ]),
                }
              : {
                  tasks: orderedClasses(taskChoicesFor(c.kind), [
                    ...c.settings.allowed_task_classes,
                    ...a.tasks,
                  ]),
                },
            async (to, body, _t, local) => {
              try {
                return await post(to, body);
              } catch (e) {
                local?.(message(e));
                return null;
              }
            },
            setError,
            // Saved settings make the panel's copy old even when re-accepting then fails
            // (re-review L-1): close it and read again.
            save,
          );
          if (!ok) break;
          done.push(
            a.kind === 'allow_data'
              ? 'Allowed.'
              : 'Allowed on this connection.',
          );
          // Qualifying needs accepted caps; without them the allow is all that happens.
          if (a.kind === 'allow_tasks' && qualifies(a, detail)) {
            const model = a.model_id!;
            for (const [i, t] of a.qualify.entries()) {
              setOutcome(
                `${done.join(' ')} Qualifying ${model} for ${words(t)}…`,
              );
              const r = await qualify(model, t, a.role, save);
              done.push(r.text);
              // Stop at the first task that is not qualified: each run spends plan requests,
              // and a failure usually means the route or prompt needs attention first
              // (review L-2, the stop rule of ADR-0088).
              const rest = a.qualify.slice(i + 1);
              if (!r.qualified && rest.length) {
                done.push(`Not started: ${rest.map(words).join(', ')}.`);
                break;
              }
            }
          }
          break;
        }
        case 'qualify':
          done.push(
            (await qualify(a.model_id, a.task_class, a.role, save)).text,
          );
          break;
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
      setOutcome(done.filter(Boolean).join(' '));
      // Whatever was saved, the panel's copy of the connection is old now: close it and let
      // the page read again, even after a later step failed (review L-1).
      if (saved) {
        setOpen(false);
        fix.onDone?.();
      }
    }
  }

  // A press that runs a qualification says what running means; one that only allows does not.
  const runs =
    a.kind === 'qualify' ||
    (a.kind === 'allow_tasks' && detail !== null && qualifies(a, detail));
  const several = a.kind === 'allow_tasks' && a.qualify.length > 1;

  return (
    <span className="fix-here">
      {open && detail ? (
        <span
          className="notice small"
          role="group"
          aria-label={fixLabel(a)}
          style={{ display: 'block', textAlign: 'left' }}
        >
          {confirmText(a, detail)}{' '}
          {started.map((x) =>
            x.other === null ? (
              <span key={x.task}>
                A started {words(x.task)} qualification on this benchmark is run
                on, and its answered cases are skipped.{' '}
              </span>
            ) : (
              <span key={x.task} className="error" style={{ display: 'block' }}>
                A {words(x.task)} qualification on {x.other} is started; finish
                it under Models and connections first.
              </span>
            ),
          )}
          {working && runs && (
            <>
              {several
                ? 'Running: one plan request per case; this can take several minutes. Stay on this page until every task is done; the one running now carries on if you leave, the rest are not started.'
                : 'Running: one plan request per case; this can take several minutes, and it carries on if you leave this page.'}{' '}
            </>
          )}
          <button
            type="button"
            disabled={working || clash.length > 0 || !ready(a, detail)}
            onClick={() => void apply()}
          >
            {working ? 'Working…' : confirmButton(a)}
          </button>{' '}
          <button
            type="button"
            className="text"
            disabled={working}
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className="secondary" onClick={() => void show()}>
          {fixLabel(a)}
        </button>
      )}
      {outcome && (
        <span className="small" role="status" style={{ display: 'block' }}>
          {outcome}
        </span>
      )}
      {error && (
        <span className="error" role="alert" style={{ display: 'block' }}>
          {error}
        </span>
      )}
    </span>
  );
}

const confirmButton = (a: FixAction) =>
  a.kind === 'accept_caps'
    ? 'Accept these caps and allowed work'
    : a.kind === 'qualify'
      ? 'Qualify now'
      : 'Allow';

/** Whether the fix can still do something, read from the connection just now. */
function ready(a: FixAction, d: PlanConnectionDetail): boolean {
  const c = d.connection;
  switch (a.kind) {
    case 'accept_caps':
      return c.caps_accepted_at === null;
    case 'allow_data':
      return !c.settings.allowed_data_classes.includes(
        a.data_class as (typeof c.settings.allowed_data_classes)[number],
      );
    case 'allow_tasks':
      return a.tasks.some(
        (t) =>
          !(c.settings.allowed_task_classes as readonly string[]).includes(t),
      );
    case 'qualify':
      return (
        !c.fixture &&
        (c.settings.allowed_task_classes as readonly string[]).includes(
          a.task_class,
        ) &&
        c.caps_accepted_at !== null &&
        verified(d, a.model_id)
      );
  }
}

/** Whether an allow-and-qualify press goes on to qualify, read from the connection just now. */
const qualifies = (
  a: Extract<FixAction, { kind: 'allow_tasks' }>,
  d: PlanConnectionDetail,
) =>
  Boolean(
    a.model_id &&
    a.qualify.length &&
    !d.connection.fixture &&
    d.connection.caps_accepted_at &&
    verified(d, a.model_id),
  );

const verified = (d: PlanConnectionDetail, model: string) =>
  d.model_access.some(
    (x) =>
      x.model_id === model && x.path === 'responses' && x.access === 'verified',
  );

/** What the press will do, in the words Models and connections uses (ADR-0087). */
export function confirmText(a: FixAction, d: PlanConnectionDetail): string {
  const c = d.connection;
  const accepted = c.caps_accepted_at !== null;
  const caps = `Caps: ${capsLine(c.kind, c.settings.caps)}. Allowed: ${classSummary(c.settings.allowed_data_classes, c.settings.allowed_task_classes)}.`;
  const reaccept = accepted
    ? 'Your caps stay the same and are accepted again with this change.'
    : 'The caps are still not accepted; accept them before anything runs.';
  const bench = (model: string, task: string, role: QualifyRole) => {
    const b = benchmarkFor(task, role);
    return b
      ? `Qualifying ${model} for ${words(task)} runs ${b.name}: up to ${b.development + b.held_out} plan requests, counted against this connection's caps, $0 on a plan. Pass bar: all ${b.held_out} held-out cases.`
      : '';
  };
  switch (a.kind) {
    case 'accept_caps':
      return accepted
        ? 'These caps and allowed work are already accepted.'
        : `${caps} Accepting lets model calls on this connection run inside these caps.`;
    case 'allow_data':
    case 'allow_tasks': {
      const before = {
        data: c.settings.allowed_data_classes,
        tasks: c.settings.allowed_task_classes,
      };
      const after =
        a.kind === 'allow_data'
          ? {
              ...before,
              data: orderedClasses(DATA_CLASS_CHOICES, [
                ...before.data,
                a.data_class,
              ]),
            }
          : {
              ...before,
              tasks: orderedClasses(taskChoicesFor(c.kind), [
                ...before.tasks,
                ...a.tasks,
              ]),
            };
      const changes = classChanges(before, after);
      if (!changes.length)
        return a.kind === 'allow_data'
          ? 'This is already allowed on this connection.'
          : 'These tasks are already allowed on this connection.';
      const then =
        a.kind === 'allow_tasks' && a.model_id && !c.fixture
          ? a.qualify
              .map((t) =>
                !accepted
                  ? ''
                  : !verified(d, a.model_id!)
                    ? `${a.model_id} is not verified on this connection, so it can't be qualified yet.`
                    : `Then: ${bench(a.model_id!, t, a.role)}`,
              )
              .filter(Boolean)
          : [];
      const several =
        a.kind === 'allow_tasks' && a.qualify.length > 1 && qualifies(a, d)
          ? [
              'Tasks are qualified one after another, stopping at the first that does not pass.',
            ]
          : [];
      const later =
        a.kind === 'allow_tasks' && a.qualify.length && !accepted && !c.fixture
          ? ['Qualify the model after you accept the caps.']
          : [];
      return [
        `Will change: ${changes.join('; ')}.`,
        reaccept,
        ...then,
        ...several,
        ...later,
      ]
        .filter(Boolean)
        .join(' ');
    }
    case 'qualify': {
      if (
        !(c.settings.allowed_task_classes as readonly string[]).includes(
          a.task_class,
        )
      )
        return `${words(a.task_class)} is not allowed on this connection; allow it first.`;
      if (!accepted)
        return 'The caps on this connection are not accepted yet; accept them first.';
      if (c.fixture) return 'A fixture connection is not qualified in the app.';
      if (!verified(d, a.model_id))
        return `${a.model_id} is not verified on this connection; verify it under Models and connections first.`;
      // A started run of another benchmark is named under this text (review M-2).
      return bench(a.model_id, a.task_class, a.role);
    }
  }
}
