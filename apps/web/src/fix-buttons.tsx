import { useEffect, useState } from 'react';
import {
  PlanConnectionDetailSchema,
  PlanQualificationSchema,
  type PlanConnection,
  planWaitMs,
  z,
  type PlanConnectionDetail,
  type PlanQualification,
  DiscoveryBenchmarksSchema,
  type DiscoveryBenchmark,
  PLAN_EXTRA_HOURS,
  PLAN_EXTRA_REQUESTS,
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
import { extraConfirmText } from './extra-requests-text.js';
import { manifestRole } from './qualification-role.js';
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
  /**
   * Where the fixes are drawn (for example `assess`, `build:<product>` or `card:<id>`): a fix's
   * outcome is kept for that place only (review 7 L-2).
   */
  place: string;
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

/** What the last fix that changed something said, per workspace and place, until dismissed. */
type Note = { text: string; error: string };
type Where = Pick<FixContext, 'base' | 'place'>;
const notes = new Map<string, Note>();
const listeners = new Set<() => void>();
const noteKey = (w: Where) => `${w.base}|${w.place}`;
export function announce(where: Where, note: Note) {
  if (note.text || note.error) notes.set(noteKey(where), note);
  else notes.delete(noteKey(where));
  for (const f of listeners) f();
}

/**
 * After a press: when it saved anything, the page reads again and the refusal (with this
 * button) usually goes, so the outcome is kept where it was pressed (`FixOutcome`) and the
 * button's own lines are cleared; a press that saved nothing keeps its error in the open panel.
 * Returns whether the panel closes.
 */
export function settlePress(
  where: Where,
  saved: boolean,
  text: string,
  failure: string,
): boolean {
  if (saved) announce(where, { text, error: failure });
  return saved;
}

/**
 * The outcome of the last fix pressed in this place (for example "scoring on gpt-6-astra:
 * qualified (6 of 6 held-out cases passed)"). Drawn by the page where it stays when the
 * refusal and its buttons go away after the fix worked.
 */
export function FixOutcome({
  fix,
}: {
  fix: Pick<FixContext, 'base' | 'place' | 'owner'> | null | undefined;
}) {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN((x) => x + 1);
    listeners.add(f);
    return () => {
      listeners.delete(f);
    };
  }, []);
  const n = fix?.owner ? notes.get(noteKey(fix)) : undefined;
  if (!fix || !n) return null;
  // One live region (review 7 N-5): the error is part of the status, not a nested alert.
  return (
    <p className="small fix-outcome" role="status">
      {n.text}
      {n.error && <span className="error">{n.error}</span>}{' '}
      <button
        type="button"
        className="text"
        onClick={() => announce(fix, { text: '', error: '' })}
      >
        Dismiss
      </button>
    </p>
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

/**
 * Which route a bundled benchmark qualifies for, from every case's check kind (P34's
 * `manifestRole`): the assessment and discovery routes as tagged, Search the web `null` (no fix
 * starts it), and a manifest with no role tag a plan role.
 */
export function roleOf(manifest: {
  cases: readonly { check?: unknown }[];
}): QualifyRole | null {
  const r = manifestRole(manifest);
  return r === 'web_discovery' ? null : (r ?? 'plan');
}

/**
 * A benchmark a fix can start for a task in a role (ADR-0087): a bundled one, started with its
 * manifest, or one the server offers (P34 #175, `GET plan-benchmarks`), started by name with
 * `{ expected_version, model_id, benchmark }` and carrying its manifest_hash. A page that
 * offers discovery fixes calls `useQualifyOffers(base)`; while that list is not read (or a
 * read failed with none before), discovery has no qualify fix.
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
const BUNDLED: readonly QualifyOffer[] = BENCHMARKS.filter(
  (b) => roleOf(b.manifest) !== null,
).map((b) => ({
  name: b.name,
  task_class: b.task_class,
  role: roleOf(b.manifest)!,
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
}));

/**
 * The discovery benchmarks the server offers (ADR-0089: `GET plan-benchmarks`); the manifest
 * stays on the server, which starts one by name.
 */
export const serverOffers = (
  list: readonly DiscoveryBenchmark[],
): QualifyOffer[] =>
  list.map((b) => ({
    name: b.name,
    task_class: b.task_class,
    role: 'discovery' as const,
    development: b.development,
    held_out: b.held_out,
    hash: async () => b.manifest_hash,
    start: (expected_version: number, model_id: string) => ({
      expected_version,
      model_id,
      benchmark: b.name,
    }),
  }));

/**
 * The body that queues these benchmarks for a model (ADR-0088): each item is what would start
 * it alone, less the version and model the queue carries once (a bundled manifest, or an
 * offered discovery benchmark by name, ADR-0089).
 */
export function queueRequest(
  offers: readonly QualifyOffer[],
  expected_version: number,
  model_id: string,
) {
  return {
    expected_version,
    model_id,
    items: offers.map((b) => {
      const {
        expected_version: _v,
        model_id: _m,
        ...item
      } = b.start(expected_version, model_id) as Record<string, unknown>;
      return item;
    }),
  };
}

/** The server's offers for the workspace last read, and that workspace's API path. */
let offered: { base: string; list: readonly QualifyOffer[] } | null = null;
const reading = new Map<string, Promise<void>>();

/**
 * Read the server's discovery offers for a workspace (once per workspace, or again with
 * `fresh`, since the server refuses a name it no longer offers). A failed read keeps the list
 * read before for that workspace (fourth review L-1); with none read yet it caches nothing,
 * so the next page tries again (fifth review L-1). Until then the workspace offers none.
 */
export function loadOffers(base: string, fresh = false): Promise<void> {
  if (!fresh && offered?.base === base) return Promise.resolve();
  const pending = reading.get(base);
  if (pending) return pending;
  const p = api(DiscoveryBenchmarksSchema, `${base}/plan-benchmarks`)
    .then(
      (r) => {
        offered = { base, list: serverOffers(r.benchmarks) };
      },
      () => {
        // Keep a list read before for this workspace; otherwise leave nothing cached.
        if (offered?.base !== base) offered = null;
      },
    )
    .finally(() => reading.delete(base));
  reading.set(base, p);
  return p;
}

/**
 * For a page that offers fixes: reads the server's offers for its workspace and draws again
 * when they arrive, so `canQualifyFor('discovery')` sees them.
 */
export function useQualifyOffers(base: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    void loadOffers(base).then(() => live && setN((x) => x + 1));
    return () => {
      live = false;
    };
  }, [base]);
  return n;
}

/** Every benchmark a fix can start, in every role: the bundled ones and the server's. */
const allOffers = (): readonly QualifyOffer[] => [
  ...BUNDLED,
  ...(offered?.list ?? []),
];

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

/**
 * A known benchmark's name (any role) from its manifest hash, or "another benchmark": every
 * offer, and every bundled manifest, including Search the web's, which no fix offers but whose
 * started run can share a task with one (third review N-2).
 */
const bundledHashes = BENCHMARKS.map((b) => ({
  name: b.name,
  hash: memo(() => manifestHash(b.manifest)),
}));
async function nameOf(hash: string): Promise<string> {
  for (const b of [...allOffers(), ...bundledHashes])
    if ((await b.hash()) === hash) return b.name;
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
  // Review 7 M-1: a running qualification queue holds the connection for presses that qualify.
  const busy = detail ? queueBlocks(a, detail) : null;
  const path = `${fix.base}/plan-connections/${a.connection_id}`;
  // Passthrough as every page reads it: the detail carries more than this schema lists.
  const read = () => api(PlanConnectionDetailSchema.passthrough(), path);

  async function show() {
    setError('');
    setOutcome('');
    try {
      const [d] = await Promise.all([read(), loadOffers(fix.base, true)]);
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
    if (!b) throw new Error(noBenchmark(task));
    const d = await read();
    if (d.connection.fixture)
      throw new Error('A fixture connection is not qualified in the app.');
    if (d.qualification_queue?.state === 'running') throw new Error(QUEUE_BUSY);
    if (d.qualifications.some((x) => x.executing === true))
      throw new Error(RUN_BUSY);
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

  /**
   * Queue qualifications of the model for the tasks on the server (ADR-0088): one request
   * starts them all, and the studio runs each in turn. A started run of the same benchmark is
   * run on; the server refuses one of another benchmark, as the confirmation already says.
   */
  async function queue(
    model: string,
    tasks: readonly string[],
    role: QualifyRole,
    saved: () => void,
  ): Promise<string> {
    const offers = tasks.map((t) => {
      const b = benchmarkFor(t, role);
      if (!b) throw new Error(noBenchmark(t));
      return b;
    });
    // The allow just saved the settings, so the version is read again.
    const d = await read();
    if (d.connection.fixture)
      throw new Error('A fixture connection is not qualified in the app.');
    // The server refuses a second queue too; this says why before anything else is sent.
    if (d.qualification_queue?.state === 'running') throw new Error(QUEUE_BUSY);
    if (d.qualifications.some((x) => x.executing === true))
      throw new Error(RUN_BUSY);
    await post(
      `plan-connections/${d.connection.id}/qualification-queues`,
      queueRequest(offers, d.connection.version, model),
    );
    saved();
    return `Queued: ${model} for ${tasks.map(words).join(', ')}. The studio runs them one after another, stops at the first that does not pass, and carries on if you leave this page; progress shows under Models and connections.`;
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
    let failure = '';
    const fail = (e: string) => {
      failure = e;
      setError(e);
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
            fail,
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
          // Qualifying needs accepted caps; without them the allow is all that happens. The
          // tasks go to the studio's qualification queue (ADR-0088, P24), which runs them one
          // after another, stops at the first that does not pass, and carries on when the
          // person leaves the page.
          if (a.kind === 'allow_tasks' && qualifies(a, detail)) {
            done.push(await queue(a.model_id!, a.qualify, a.role, save));
          }
          break;
        }
        case 'qualify':
          done.push(
            (await qualify(a.model_id, a.task_class, a.role, save)).text,
          );
          break;
        case 'extra_requests':
          await post(`plan-connections/${c.id}/extra-requests`, {
            expected_version: c.version,
            requests: PLAN_EXTRA_REQUESTS,
          });
          save();
          done.push(
            `Added ${PLAN_EXTRA_REQUESTS} requests for the next ${PLAN_EXTRA_HOURS} hours.`,
          );
          break;
      }
    } catch (e) {
      fail(message(e));
    } finally {
      setWorking(false);
      const text = done.filter(Boolean).join(' ');
      setOutcome(text);
      // Whatever was saved, the panel's copy of the connection is old now: close it and let
      // the page read again, even after a later step failed (review L-1). The read usually
      // clears the refusal and this button with it, so the outcome is said where the page
      // keeps it (`FixOutcome`), not on the button (walk of November 11).
      if (settlePress(fix, saved, text, failure)) {
        setOutcome('');
        setError('');
        setOpen(false);
        fix.onDone?.();
      }
    }
  }

  // A press that runs a qualification here says what running means; an allow that queues
  // qualifications says so in its confirmation, and the queue runs on the server.
  const runs = a.kind === 'qualify';

  return (
    <span className="fix-here">
      {open && detail ? (
        <span
          className="notice small fix-panel"
          role="group"
          aria-label={fixLabel(a)}
        >
          {confirmText(a, detail)}{' '}
          {started.map((x) =>
            x.other === null ? (
              <span key={x.task}>
                A started {words(x.task)} qualification on this benchmark is run
                on, and its answered cases are skipped.{' '}
              </span>
            ) : (
              <span key={x.task} className="error">
                A {words(x.task)} qualification on {x.other} is started; finish
                it under Models and connections first.
              </span>
            ),
          )}
          {busy && <span className="error">{busy}</span>}
          {working && runs && (
            <>
              Running: one plan request per case; this can take several minutes,
              and it carries on if you leave this page.{' '}
            </>
          )}
          <button
            type="button"
            disabled={
              working || clash.length > 0 || busy !== null || !ready(a, detail)
            }
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
        <span className="small fix-line" role="status">
          {outcome}
        </span>
      )}
      {error && (
        <span className="error" role="alert">
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
      : a.kind === 'extra_requests'
        ? `Add ${PLAN_EXTRA_REQUESTS} requests`
        : 'Allow';

/** Said when a benchmark the fix was drawn for is no longer offered (fourth review L-1). */
const noBenchmark = (task: string) =>
  `The app no longer offers a benchmark for ${words(task)}; reload the page.`;

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
    case 'extra_requests':
      return dailyFull(d);
    case 'qualify':
      return (
        Boolean(benchmarkFor(a.task_class, a.role)) &&
        !c.fixture &&
        (c.settings.allowed_task_classes as readonly string[]).includes(
          a.task_class,
        ) &&
        c.caps_accepted_at !== null &&
        verified(d, a.model_id)
      );
  }
}

/** Review 7 M-1: what a press that qualifies says while a P24 queue holds the connection. */
export const QUEUE_BUSY =
  'A queue is qualifying tasks on this connection; wait for it to finish, or cancel it under Models and connections › Qualify several tasks.';
/** Review 8 N-2: and while a Run is executing there (by hand, or another fix's Qualify now). */
export const RUN_BUSY =
  'A qualification is running on this connection now, and it sends one request at a time; wait for it to finish.';

/**
 * Why this press may not run now (review 7 M-1, review 8 N-2): while a qualification queue
 * runs on the connection (ADR-0088), or a Run executes there (ADR-0084), a press that
 * qualifies would be refused part-way (after its allow was saved), or leave a started run the
 * queue later meets; it waits. A press that only allows (or accepts caps) still works.
 */
export function queueBlocks(
  a: FixAction,
  d: PlanConnectionDetail,
): string | null {
  const qualifying =
    a.kind === 'qualify' || (a.kind === 'allow_tasks' && qualifies(a, d));
  if (!qualifying) return null;
  if (d.qualification_queue?.state === 'running') return QUEUE_BUSY;
  if (d.qualifications.some((q) => q.executing === true)) return RUN_BUSY;
  return null;
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

/** ADR-0094: whether the daily cap, with any unexpired extra, is used up. */
const dailyFull = (d: PlanConnectionDetail) =>
  d.usage.last_24h_requests >=
  d.connection.settings.caps.shared.max_model_requests_per_day +
    d.usage.extra_requests;

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
      : noBenchmark(task);
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
        a.kind === 'allow_tasks' && a.qualify.length && qualifies(a, d)
          ? [
              a.qualify.length > 1
                ? 'The studio queues them and qualifies them one after another, stopping at the first that does not pass; you can leave this page.'
                : 'The studio queues it and runs it; you can leave this page.',
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
    case 'extra_requests': {
      const configured = c.settings.caps.shared.max_model_requests_per_day;
      return dailyFull(d)
        ? extraConfirmText(configured, configured + d.usage.extra_requests)
        : 'This connection has room for more requests today again.';
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
