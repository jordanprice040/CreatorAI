import { useState } from 'react';
import {
  PlanConnectionDetailSchema,
  PlanQualificationSchema,
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
  missingTaskFixes,
  refusalFixes,
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
  return [
    ...refusalFixes(p.refusals ?? [], input.role, canQualifyFor(input.role)),
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
    ...(input.model
      ? missingTaskFixes(
          c.id,
          input.model,
          input.missing,
          c.settings.allowed_task_classes,
          input.role,
          canQualifyFor(input.role),
        )
      : []),
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

/** The app's benchmark for a task in a role (ADR-0087), or none. */
export const benchmarkFor = (task: string, role: QualifyRole) =>
  BENCHMARKS.find((b) => b.task_class === task && roleOf(b.manifest) === role);

/** Whether the app can qualify a task for a role itself. */
export const canQualifyFor = (role: QualifyRole) => (task: string) =>
  Boolean(benchmarkFor(task, role));

function FixButton({ act: a, fix }: { act: FixAction; fix: FixContext }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<PlanConnectionDetail | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const path = `${fix.base}/plan-connections/${a.connection_id}`;
  // Passthrough as every page reads it: the detail carries more than this schema lists.
  const read = () => api(PlanConnectionDetailSchema.passthrough(), path);

  async function show() {
    setError('');
    setOutcome('');
    try {
      setDetail(await read());
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

  /** Start (or reuse a started) qualification of the model for the task, then run it. */
  async function qualify(
    model: string,
    task: string,
    role: QualifyRole,
  ): Promise<string> {
    const b = benchmarkFor(task, role);
    if (!b) return '';
    const d = await read();
    // The server keeps one started qualification per model and task, so a started one is
    // run on (its answered cases are skipped) instead of starting a second.
    let q: PlanQualification | undefined = d.qualifications.find(
      (x) =>
        x.state === 'running' && x.model_id === model && x.task_class === task,
    );
    if (!q)
      q = await api(PlanQualificationSchema, `${path}/qualifications`, {
        body: {
          expected_version: d.connection.version,
          model_id: model,
          manifest: b.manifest,
          min_held_out_cases: b.held_out,
          floor: { numerator: 1, denominator: 1 },
        },
        csrf: fix.csrf,
      });
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
    return runOutcome(q, out);
  }

  async function apply() {
    if (!detail) return;
    const c = detail.connection;
    setWorking(true);
    setError('');
    setOutcome('');
    const done: string[] = [];
    try {
      switch (a.kind) {
        case 'accept_caps':
          await post(`plan-connections/${c.id}/accept-caps`, {
            expected_version: c.version,
            settings_hash: c.settings_hash,
          });
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
          );
          if (!ok) break;
          done.push(
            a.kind === 'allow_data'
              ? 'Allowed.'
              : 'Allowed on this connection.',
          );
          // Qualifying needs accepted caps; without them the allow is all that happens.
          if (
            a.kind === 'allow_tasks' &&
            a.model_id &&
            c.caps_accepted_at &&
            verified(detail, a.model_id)
          )
            for (const t of a.qualify) {
              setOutcome(
                `${done.join(' ')} Qualifying ${a.model_id} for ${words(t)}…`,
              );
              done.push(await qualify(a.model_id, t, a.role));
            }
          break;
        }
        case 'qualify':
          done.push(await qualify(a.model_id, a.task_class, a.role));
          break;
      }
      if (done.length) setOpen(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setWorking(false);
      setOutcome(done.filter(Boolean).join(' '));
      if (done.length) fix.onDone?.();
    }
  }

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
          {working && a.kind !== 'accept_caps' && a.kind !== 'allow_data' && (
            <>
              Running: one plan request per case; this can take several minutes,
              and it carries on if you leave this page.{' '}
            </>
          )}
          <button
            type="button"
            disabled={working || !ready(a, detail)}
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
        (c.settings.allowed_task_classes as readonly string[]).includes(
          a.task_class,
        ) &&
        c.caps_accepted_at !== null &&
        verified(d, a.model_id)
      );
  }
}

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
        a.kind === 'allow_tasks' && a.model_id
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
      const later =
        a.kind === 'allow_tasks' && a.qualify.length && !accepted
          ? ['Qualify the model after you accept the caps.']
          : [];
      return [
        `Will change: ${changes.join('; ')}.`,
        reaccept,
        ...then,
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
      if (!verified(d, a.model_id))
        return `${a.model_id} is not verified on this connection; verify it under Models and connections first.`;
      const started = d.qualifications.some(
        (q) =>
          q.state === 'running' &&
          q.model_id === a.model_id &&
          q.task_class === a.task_class,
      );
      return `${bench(a.model_id, a.task_class, a.role)}${started ? ' A started qualification for this task is run, and its answered cases are skipped.' : ''}`;
    }
  }
}
