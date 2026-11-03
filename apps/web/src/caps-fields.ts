// Fields of the Models page "Change caps" form (audit item 5). No imports, so the tests can
// load it without a browser and check every range against PlanCapsSchema. The server is the
// authority: it validates the settings again, refuses anyone but the workspace owner, and
// clears the caps acceptance on every change.

export type CapsShape = {
  responses: {
    max_requests_per_run: number;
    request_timeout_ms: number;
    max_output_chars: number;
    max_input_chars: number;
  };
  codex: {
    max_builds_per_day: number;
    max_turns_per_build: number;
    max_model_requests_per_build: number;
    build_timeout_ms: number;
  };
  shared: { max_model_requests_per_day: number; max_in_flight: 1 };
};

export type CapField = {
  key: string;
  group: 'responses' | 'codex' | 'shared';
  name: string;
  label: string;
  /** Shown and entered in this unit; stored in the schema's unit (scale times larger). */
  unit: string;
  scale: number;
  min: number;
  /**
   * null: no upper limit (ADR-0062). Only the two timeouts keep one, the longest a timer can
   * wait (about 24.8 days), which is a technical bound rather than a cap.
   */
  max: number | null;
  /** Only ChatGPT plan connections have a Codex path. */
  codexOnly: boolean;
};

const f = (
  group: CapField['group'],
  name: string,
  label: string,
  unit: string,
  scale: number,
  min: number,
  max: number | null,
): CapField => ({
  key: `${group}.${name}`,
  group,
  name,
  label,
  unit,
  scale,
  min,
  max,
  codexOnly: group === 'codex',
});

// Ranges in display units; they must equal PlanCapsSchema's bounds divided by scale. The
// timer bounds are written out because this file has no imports: TIMER_MAX_MS (2^31 - 1 ms)
// rounded down to whole seconds and whole minutes.
export const CAP_FIELDS: readonly CapField[] = [
  f(
    'shared',
    'max_model_requests_per_day',
    'Model requests a day',
    'requests',
    1,
    1,
    null,
  ),
  f(
    'responses',
    'max_requests_per_run',
    'Requests per run',
    'requests',
    1,
    1,
    null,
  ),
  f(
    'responses',
    'request_timeout_ms',
    'Request timeout',
    'seconds',
    1000,
    5,
    2_147_483,
  ),
  f(
    'responses',
    'max_input_chars',
    'Input per request',
    'characters',
    1,
    500,
    null,
  ),
  f(
    'responses',
    'max_output_chars',
    'Output per request',
    'characters',
    1,
    500,
    null,
  ),
  f('codex', 'max_builds_per_day', 'Codex builds a day', 'builds', 1, 0, null),
  f(
    'codex',
    'max_turns_per_build',
    'Codex turns per build',
    'turns',
    1,
    1,
    null,
  ),
  f(
    'codex',
    'max_model_requests_per_build',
    'Model requests per Codex build',
    'requests',
    1,
    1,
    null,
  ),
  f(
    'codex',
    'build_timeout_ms',
    'Codex build timeout',
    'minutes',
    60_000,
    1,
    35_791,
  ),
];

/** "from 1 to 30" or, with no upper limit, "of 1 or more". */
export function capRange(x: CapField): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return x.max === null
    ? `of ${n(x.min)} or more`
    : `from ${n(x.min)} to ${n(x.max)}`;
}

/** The form label's hint, e.g. "requests, 1 or more" or "seconds, 5–2,147,483". */
export function capHint(x: CapField): string {
  const n = (v: number) => v.toLocaleString('en-US');
  return x.max === null
    ? `${x.unit}, ${n(x.min)} or more`
    : `${x.unit}, ${n(x.min)}–${n(x.max)}`;
}

export const capFieldsFor = (kind: string) =>
  CAP_FIELDS.filter((x) => !x.codexOnly || kind === 'chatgpt_plan');

const read = (caps: CapsShape, x: CapField) =>
  (caps[x.group] as Record<string, number>)[x.name]!;

/** Current caps as form text, in display units. */
export function capsToDraft(caps: CapsShape): Record<string, string> {
  const out: Record<string, string> = {};
  for (const x of CAP_FIELDS) out[x.key] = String(read(caps, x) / x.scale);
  return out;
}

/**
 * The form's text applied to the current caps. Fields not shown for this connection keep their
 * stored values. Returns per-field problems instead of caps when any entry is not a whole number
 * in range, so nothing out of range is ever sent.
 */
export function draftToCaps(
  current: CapsShape,
  draft: Record<string, string>,
  kind: string,
):
  | { caps: CapsShape; errors: null }
  | { caps: null; errors: Record<string, string> } {
  const next: CapsShape = {
    responses: { ...current.responses },
    codex: { ...current.codex },
    shared: { ...current.shared },
  };
  const errors: Record<string, string> = {};
  for (const x of capFieldsFor(kind)) {
    const text = (draft[x.key] ?? '').trim().replaceAll(',', '');
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    if (
      !Number.isSafeInteger(n) ||
      !Number.isSafeInteger(n * x.scale) ||
      n < x.min ||
      (x.max !== null && n > x.max)
    ) {
      errors[x.key] = `Enter a whole number ${capRange(x)} ${x.unit}.`;
      continue;
    }
    (next[x.group] as Record<string, number>)[x.name] = n * x.scale;
  }
  return Object.keys(errors).length
    ? { caps: null, errors }
    : { caps: next, errors: null };
}

/** Plain-language list of what changes, for the confirmation line and the saved reason. */
export function capChanges(before: CapsShape, after: CapsShape, kind: string) {
  return capFieldsFor(kind)
    .filter((x) => read(before, x) !== read(after, x))
    .map(
      (x) =>
        `${x.label}: ${(read(before, x) / x.scale).toLocaleString('en-US')} → ${(read(after, x) / x.scale).toLocaleString('en-US')} ${x.unit}`,
    );
}

// Allowed work (full audit 2026-11-02): which data and task classes a plan connection admits.
// Before, only `pnpm cli plan-settings` could change them, while the build and qualify forms
// told people to allow a class "in that connection's settings". Keys must match DataClassSchema
// and PlanTaskClassSchema (checked in web-caps-form.test.ts).

export type ClassChoice = { key: string; label: string; codexOnly: boolean };

export const DATA_CLASS_CHOICES: readonly ClassChoice[] = [
  { key: 'synthetic', label: 'Synthetic (made-up) data', codexOnly: false },
  { key: 'public', label: 'Public data', codexOnly: false },
  {
    key: 'private_approved',
    label: 'Approved private data',
    codexOnly: false,
  },
];

export const TASK_CLASS_CHOICES: readonly ClassChoice[] = [
  { key: 'research_synthesis', label: 'Research synthesis', codexOnly: false },
  {
    key: 'candidate_generation',
    label: 'Candidate generation',
    codexOnly: false,
  },
  { key: 'scoring', label: 'Scoring', codexOnly: false },
  { key: 'specification', label: 'Specification writing', codexOnly: false },
  { key: 'summarization', label: 'Summarization', codexOnly: false },
  { key: 'patch_build', label: 'Builder role (patch_build)', codexOnly: false },
  {
    key: 'independent_review',
    label: 'Reviewer role (independent_review)',
    codexOnly: false,
  },
  { key: 'code_build', label: 'Codex builds (code_build)', codexOnly: true },
];

/** The task classes a connection kind can take: Claude Code has no Codex path. */
export const taskChoicesFor = (kind: string) =>
  TASK_CLASS_CHOICES.filter((x) => !x.codexOnly || kind === 'chatgpt_plan');

/** Ticked keys in the canonical order, keeping only ones this kind can take. */
export function orderedClasses(
  choices: readonly ClassChoice[],
  ticked: readonly string[],
): string[] {
  const set = new Set(ticked);
  return choices.filter((x) => set.has(x.key)).map((x) => x.key);
}

/** Problems with the ticked classes, by field ('data' or 'tasks'); empty when they can be saved. */
export function classErrors(
  data: readonly string[],
  tasks: readonly string[],
  kind: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (orderedClasses(DATA_CLASS_CHOICES, data).length === 0)
    errors.data = 'Allow at least one kind of data.';
  if (orderedClasses(taskChoicesFor(kind), tasks).length === 0)
    errors.tasks = 'Allow at least one kind of task.';
  return errors;
}

/** Plain-language list of allowed-work changes, e.g. "Allows approved private data". */
export function classChanges(
  before: { data: readonly string[]; tasks: readonly string[] },
  after: { data: readonly string[]; tasks: readonly string[] },
): string[] {
  const out: string[] = [];
  const diff = (
    choices: readonly ClassChoice[],
    a: readonly string[],
    b: readonly string[],
  ) => {
    for (const x of choices) {
      const was = a.includes(x.key);
      const now = b.includes(x.key);
      if (was !== now)
        out.push(
          `${now ? 'Allows' : 'No longer allows'} ${x.label.charAt(0).toLowerCase()}${x.label.slice(1)}`,
        );
    }
  };
  diff(DATA_CLASS_CHOICES, before.data, after.data);
  diff(TASK_CLASS_CHOICES, before.tasks, after.tasks);
  return out;
}

/** The connection's allowed work in words, for the details list. */
export function classSummary(
  data: readonly string[],
  tasks: readonly string[],
): string {
  const names = (choices: readonly ClassChoice[], keys: readonly string[]) =>
    keys.map((k) => choices.find((x) => x.key === k)?.label ?? k).join(', ');
  return `${names(DATA_CLASS_CHOICES, data)} · tasks: ${names(TASK_CLASS_CHOICES, tasks)}`;
}
