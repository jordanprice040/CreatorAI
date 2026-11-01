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
  max: number;
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
  max: number,
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

// Ranges in display units; they must equal PlanCapsSchema's bounds divided by scale.
export const CAP_FIELDS: readonly CapField[] = [
  f(
    'shared',
    'max_model_requests_per_day',
    'Model requests a day',
    'requests',
    1,
    1,
    300,
  ),
  f(
    'responses',
    'max_requests_per_run',
    'Requests per run',
    'requests',
    1,
    1,
    50,
  ),
  f(
    'responses',
    'request_timeout_ms',
    'Request timeout',
    'seconds',
    1000,
    5,
    300,
  ),
  f(
    'responses',
    'max_input_chars',
    'Input per request',
    'characters',
    1,
    500,
    200_000,
  ),
  f(
    'responses',
    'max_output_chars',
    'Output per request',
    'characters',
    1,
    500,
    200_000,
  ),
  f('codex', 'max_builds_per_day', 'Codex builds a day', 'builds', 1, 0, 20),
  f('codex', 'max_turns_per_build', 'Codex turns per build', 'turns', 1, 1, 3),
  f(
    'codex',
    'max_model_requests_per_build',
    'Model requests per Codex build',
    'requests',
    1,
    1,
    60,
  ),
  f(
    'codex',
    'build_timeout_ms',
    'Codex build timeout',
    'minutes',
    60_000,
    1,
    30,
  ),
];

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
    if (!Number.isSafeInteger(n) || n < x.min || n > x.max) {
      errors[x.key] =
        `Enter a whole number from ${x.min.toLocaleString('en-US')} to ${x.max.toLocaleString('en-US')} ${x.unit}.`;
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
