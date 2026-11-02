// ADR-0060: safety copies of notes text not yet saved, so closing the notepad, a resize, a
// workspace switch or a reload cannot drop it. Kept per person and per workspace (review N-1),
// in this tab's session storage and, when storage is blocked, in memory for the page's life
// (review L-B). Cleared on sign-out so the next person on this tab never sees them.

export type NoteDraft = {
  text: string;
  /** The server version the text was based on. */
  base_version: number;
  /** Text of a save that was in flight when this copy was written (review L-A). */
  sent?: string;
};

const PREFIX = 'creator.notes-draft.';
const memory = new Map<string, NoteDraft>();
const key = (actor: string, ws: string) => `${PREFIX}${actor}.${ws}`;

export function readNoteDraft(actor: string, ws: string): NoteDraft | null {
  const k = key(actor, ws);
  try {
    const raw = sessionStorage.getItem(k);
    if (raw) {
      const d = JSON.parse(raw) as Partial<NoteDraft>;
      if (typeof d.text === 'string' && typeof d.base_version === 'number')
        return {
          text: d.text,
          base_version: d.base_version,
          ...(typeof d.sent === 'string' ? { sent: d.sent } : {}),
        };
    }
  } catch {
    // Fall back to the in-memory copy below.
  }
  return memory.get(k) ?? null;
}

export function writeNoteDraft(
  actor: string,
  ws: string,
  draft: NoteDraft | null,
) {
  const k = key(actor, ws);
  if (draft) memory.set(k, draft);
  else memory.delete(k);
  try {
    if (draft) sessionStorage.setItem(k, JSON.stringify(draft));
    else sessionStorage.removeItem(k);
  } catch {
    // Blocked storage: the in-memory copy still covers closing the notepad.
  }
}

/** Removes every notes safety copy in this tab; called on sign-out. */
export function clearNoteDrafts() {
  memory.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(PREFIX)) sessionStorage.removeItem(k);
    }
  } catch {
    // Nothing stored.
  }
}
