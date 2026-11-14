// ADR-0101 (UX pass P-5): which model drafts a proposal's sections are offered, and the default
// "What changed" line when drafts are used. Pure rules with no imports, so they can be tested
// without a browser; the studio checks every draft mark when the version is saved.

export type DraftValue =
  { state: 'written'; text: string } | { state: 'unknown'; text: string };
export type DraftRecord = {
  id: string;
  state: string;
  model_id: string;
  created_at: string;
  values: Partial<Record<string, DraftValue>>;
};
export type SectionNow = {
  state: string;
  text: string;
  draft?: { id: string } | undefined;
};
export type Offer = {
  draft: string;
  model: string;
  at: string;
  value: DraftValue;
};

/**
 * Per section, the newest completed draft that has something for it, offered while the
 * section is still unknown in the page and that draft was not dismissed. Drafts arrive newest
 * first. A section already using a draft, or written by the person, is offered nothing.
 */
export function draftOffers(
  drafts: readonly DraftRecord[],
  sections: Readonly<Record<string, SectionNow>>,
  dismissed: ReadonlySet<string>,
): Record<string, Offer> {
  const out: Record<string, Offer> = {};
  for (const d of drafts) {
    if (d.state !== 'completed') continue;
    for (const [k, value] of Object.entries(d.values)) {
      if (!value || out[k] || dismissed.has(`${d.id}:${k}`)) continue;
      const now = sections[k];
      if (!now || now.state !== 'unknown') continue;
      out[k] = { draft: d.id, model: d.model_id, at: d.created_at, value };
    }
  }
  return out;
}

/**
 * Review 1 N-1: whether a section's text in the page differs from the draft it came from, the
 * same check the studio makes on save; the saved mark's own flag when the draft is not listed.
 */
export function draftEdited(
  key: string,
  section: SectionNow & {
    draft?: { id: string; edited?: boolean } | undefined;
  },
  drafts: readonly DraftRecord[],
): boolean {
  const from = drafts.find((d) => d.id === section.draft?.id)?.values[key];
  if (from?.state !== 'written') return !!section.draft?.edited;
  return section.text.trim() !== from.text.trim();
}

/** Sections whose text in the page newly comes from a model draft, for "What changed". */
export function newlyDrafted(
  before: Readonly<Record<string, SectionNow>>,
  now: Readonly<Record<string, SectionNow>>,
): string[] {
  return Object.keys(now).filter(
    (k) => now[k]?.draft && now[k]!.draft!.id !== before[k]?.draft?.id,
  );
}

/** The default reason for a save that uses drafts, e.g. "Used model drafts: Methods, Roles". */
export function draftReason(labels: readonly string[]): string {
  if (!labels.length) return 'Edited';
  const line = `Used model drafts: ${labels.join(', ')}`;
  return line.length <= 300 ? line : `${line.slice(0, 297)}…`;
}
