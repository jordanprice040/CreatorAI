// F12 term help: the studio's own words that a new person won't know, each with one short
// definition, and when a definition shows. Pure data and functions with no imports, so the
// glossary and the open/close rules load in tests without a browser. One term per concept
// (UX pass 6.E and 6.J): pages wrap a term's first appearance in `<Term>` from `term.tsx`.

export const TERMS = {
  claim: {
    label: 'Claim',
    definition:
      'A statement about the problem or the market that the studio may rely on. It counts as supported only by passages it quotes from fetched pages, and a claim with no passage stays unsupported.',
  },
  passage: {
    label: 'Passage',
    definition:
      'A stretch of text quoted word for word from a page the studio fetched. Claims cite passages as their evidence, and the studio never follows instructions written in them.',
  },
  gate: {
    label: 'Gate',
    definition:
      'A check an option must clear before it can advance: ethics (should this be built at all) and access (can your team get and run what it needs). Who may clear a gate is set in Settings › Team profile.',
  },
  humility_review: {
    label: 'Humility review',
    definition:
      'Before building, an honest comparison of custom software with an existing tool, a change of process, human judgment, a mix, or not doing it. Only a review that recommends building lets that exact version be built.',
  },
  freeze: {
    label: 'Freeze',
    definition:
      'Fixing a version of a spec so it can no longer change. A build is held to the frozen version; later edits make a new version.',
  },
  acceptance_check: {
    label: 'Acceptance check',
    definition:
      'A test that decides whether a built task is done: an automated test with fixed cases, or a browser check of a web page. Some of its cases are held out.',
  },
  held_out_case: {
    label: 'Held-out case',
    definition:
      'A test case kept back from whatever is being tested: the builder, reviewer or model never sees it, and only the final check runs it. Passing shows the work holds up on cases it was never shown.',
  },
  qualification: {
    label: 'Qualification',
    definition:
      'A recorded trial of one model on a fixed set of cases for one kind of task. The model is offered for that task only if every held-out case passes.',
  },
  routine_approval: {
    label: 'Routine approval',
    definition:
      'A standing approval you give one run: steps in the stages and kinds of data you chose go ahead without asking you, up to your count, amount and end time. Anything outside it still waits for you.',
  },
  reservation: {
    label: 'Reserved (in flight)',
    definition:
      'Before a paid call is sent, its largest possible cost is set aside from the budget. When the provider reports usage, the actual cost is charged and the rest is released.',
  },
  unknown_outcome: {
    label: 'Unknown outcome',
    definition:
      'A call whose result the studio could not confirm, for example because the connection dropped. Its set-aside cost stays counted until it is reconciled; it is never treated as free.',
  },
} as const satisfies Record<string, { label: string; definition: string }>;

export type TermKey = keyof typeof TERMS;

/** Every term, in the order a person meets them (evidence, deciding, building, spending). */
export const TERM_KEYS = Object.keys(TERMS) as TermKey[];

/** Whether a term's definition is showing, and whether a click pinned it open. */
export type TipState = { open: boolean; pinned: boolean };

export type TipEvent =
  | 'enter' // pointer over the term or its definition
  | 'leave' // pointer left both
  | 'focus' // keyboard focus reached the term
  | 'blur' // focus left the term
  | 'click' // click, tap, Enter or Space on the term
  | 'escape'; // Escape anywhere while it shows

export const TIP_CLOSED: TipState = { open: false, pinned: false };

/**
 * The definition's next state. Hover and focus show it; a click pins it (touch has no hover)
 * or unpins it; leaving closes it unless pinned; blur and Escape always close it, so it can
 * be dismissed without moving the pointer or focus (WCAG 1.4.13).
 */
export function nextTip(s: TipState, e: TipEvent): TipState {
  switch (e) {
    case 'enter':
    case 'focus':
      return s.open ? s : { open: true, pinned: false };
    case 'leave':
      return s.pinned ? s : TIP_CLOSED;
    case 'click':
      return s.pinned ? TIP_CLOSED : { open: true, pinned: true };
    case 'blur':
    case 'escape':
      return TIP_CLOSED;
  }
}
