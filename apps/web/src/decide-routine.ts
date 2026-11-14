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
 * The override reason is a judgment, so its fold opens whenever it matters: when the choices
 * need one, when an earlier one needs a look, or when one is typed (the page then says it is
 * not recorded). Before the report loads nothing is known, so it does not open yet. The field
 * keeps one place in the page either way (review M-1): the fold only opens, never moves it.
 */
export function overrideMatters(
  gate: { override_needed: boolean; override_review: boolean } | null,
  override: string,
): boolean {
  return (
    !!gate &&
    (gate.override_needed || gate.override_review || !!override.trim())
  );
}

/** The override reason fold's one line. */
export function overrideSummary(
  gate: { override_needed: boolean; override_review: boolean } | null,
  override: string,
): string {
  const r = override.trim();
  if (gate?.override_needed && !r)
    return 'Override reason: needed before you can record';
  if (gate?.override_review) return 'Override reason: review it';
  if (r)
    return `Override reason: “${r.length > 60 ? `${r.slice(0, 59)}…` : r}”${gate && !gate.override_needed ? ' (not needed, not recorded)' : ''}`;
  return 'Override reason: not needed for these choices';
}

/** The one-line summary of the Decide form's run fold. */
export function decideRoutineSummary(run: {
  label: string;
  source: 'found' | 'other' | 'none';
}): string {
  return run.source === 'none'
    ? 'No active run to record under: start or resume one first'
    : `Recorded under ${run.label}${run.source === 'found' ? ' (the run that found this problem)' : ''}`;
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
export function foldedSectionsSummary(
  states: readonly SectionState[],
  /** Folded sections a check blocks (review N-1): named in the summary, never only inside. */
  blocked = 0,
): string {
  const n = (s: SectionState) => states.filter((x) => x === s).length;
  const parts = [
    n('written') && `${n('written')} written`,
    n('unknown') && `${n('unknown')} unknown yet`,
    n('not_applicable') && `${n('not_applicable')} not applicable`,
  ].filter(Boolean);
  return `${states.length} more sections (optional): ${parts.join(', ') || 'none'}${blocked ? ` · ${blocked} blocked` : ''}`;
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

/** UX pass section 6: the folded "Assumptions for this run" line on Decide. */
export function assumptionsSummary(n: number): string {
  return n === 0
    ? 'Assumptions for this run: none recorded'
    : `Assumptions for this run: ${n} recorded`;
}

/** UX pass section 6: the folded "Selection history" line on Decide. */
export function historySummary(
  selections: readonly { current: boolean; created_at: string }[],
  when: (iso: string) => string,
): string {
  if (!selections.length) return 'Selection history: none recorded yet';
  const n = selections.length;
  const cur = selections.find((s) => s.current);
  return `Selection history: ${n} selection${n === 1 ? '' : 's'}${cur ? `, current from ${when(cur.created_at)}` : ''}`;
}
