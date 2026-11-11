// P19 follow-up (ADR-0082): what Standard folds on the Decide selection form and the Proposals
// form, and what their "What will happen" lists say. Pure rules, no React, so they are tested
// directly. Folding never changes a request: the forms submit exactly what they did before.

/** The run a selection is recorded under, and where that choice came from. */
export function runSource(
  runId: string,
  foundBy: string | null,
): 'found' | 'other' | 'none' {
  if (!runId) return 'none';
  return runId === foundBy ? 'found' : 'other';
}

/**
 * The override reason is a judgment, so it stays in view whenever it matters: when the choices
 * need one, when an earlier one needs a look, or when one is typed (the page then says it is
 * not recorded). Only an empty reason the choices do not need folds under Standard.
 */
export function overrideInView(
  gate: { override_needed: boolean; override_review: boolean } | null,
  override: string,
): boolean {
  return (
    !gate || gate.override_needed || gate.override_review || !!override.trim()
  );
}

/** The one-line summary of the Decide form's routine group. */
export function decideRoutineSummary(
  run: { label: string; source: 'found' | 'other' | 'none' },
  overrideFolded: boolean,
): string {
  const head =
    run.source === 'none'
      ? 'No active run to record under: open to see why'
      : `Recorded under ${run.label}${run.source === 'found' ? ' (the run that found this problem)' : ''}`;
  return overrideFolded ? `${head} · no override reason needed` : head;
}

/** "2 select for a bounded build, 1 defer", in the form's own words, for "What will happen". */
export function dispositionCounts(
  dispositions: readonly string[],
  labels: Readonly<Record<string, string>>,
): string {
  const n = new Map<string, number>();
  for (const d of dispositions) if (d) n.set(d, (n.get(d) ?? 0) + 1);
  return [...n].map(([d, k]) => `${k} × ${labels[d] ?? d}`).join(', ');
}

// Proposals. Required sections and the two that keep a proposal honest (contrary evidence and
// decision-changing assumptions, invariants 1 and 2) always stay in view. The other optional
// sections fold together under Standard; each still has its own P18 fold inside.
export const FOLDED_PROPOSAL_SECTIONS = [
  'background',
  'materials',
  'roles',
  'timeline',
  'costs',
  'limitations',
] as const;

type SectionState = 'written' | 'unknown' | 'not_applicable';

/** "6 more sections (optional): 1 written, 5 unknown yet". */
export function foldedSectionsSummary(states: readonly SectionState[]): string {
  const n = (s: SectionState) => states.filter((x) => x === s).length;
  const parts = [
    n('written') && `${n('written')} written`,
    n('unknown') && `${n('unknown')} unknown yet`,
    n('not_applicable') && `${n('not_applicable')} not applicable`,
  ].filter(Boolean);
  return `${states.length} more sections (optional): ${parts.join(', ') || 'none'}`;
}

/** The proposal save's "Sections" line. */
export function sectionCounts(
  sections: readonly { required: boolean; state: SectionState }[],
): string {
  const req = sections.filter((s) => s.required);
  const opt = sections.filter((s) => !s.required);
  const written = (l: typeof sections) =>
    l.filter((s) => s.state === 'written').length;
  return `${written(req)} of ${req.length} required written; ${written(opt)} of ${opt.length} optional written, the rest marked unknown yet or not applicable`;
}

/** The "What changed" note a revision records; empty means the default "Edited". */
export function revisionReasonSummary(reason: string): string {
  const r = reason.trim();
  return r
    ? `What changed: “${r.length > 60 ? `${r.slice(0, 59)}…` : r}”`
    : 'What changed: “Edited” (default)';
}

/** The review marks' summary: how many are still "not checked", and any concerns. */
export function marksSummary(
  marks: Readonly<Record<string, 'pass' | 'concern' | 'not_checked'>>,
): string {
  const v = Object.values(marks);
  const count = (m: string) => v.filter((x) => x === m).length;
  if (count('not_checked') === v.length)
    return `Marks: all ${v.length} not checked (default)`;
  return `Marks: ${[
    count('pass') && `${count('pass')} looks right`,
    count('concern') &&
      `${count('concern')} concern${count('concern') === 1 ? '' : 's'}`,
    count('not_checked') && `${count('not_checked')} not checked`,
  ]
    .filter(Boolean)
    .join(', ')}`;
}
