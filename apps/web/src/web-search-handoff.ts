// ADR-0091: "Find evidence on the web" from Compare and decide fills Discover's Search the web
// form. Pages stay mounted, so the hand-off is an event, kept until the form takes it.

export type WebSearchPrefill = { question: string; interests: string };

const EVENT = 'creator:web-search-prefill';
/** A waiting request: a prefill, or `null` to only bring the section into view. */
let pending: { prefill: WebSearchPrefill | null } | null = null;

/**
 * Asks Discover's Search the web to show itself, filled with `prefill` when there is one.
 * Without one (Sources' "Search the web" link, review 1 of #197, L-5) it only scrolls to the
 * section and moves focus to its heading.
 */
export function requestWebSearch(prefill: WebSearchPrefill | null = null) {
  pending = { prefill };
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls `use` with a waiting request now and whenever one is made; returns the unsubscribe. */
export function onWebSearchPrefill(use: (p: WebSearchPrefill | null) => void) {
  const take = () => {
    if (!pending) return;
    const { prefill } = pending;
    pending = null;
    use(prefill);
  };
  take();
  window.addEventListener(EVENT, take);
  return () => window.removeEventListener(EVENT, take);
}
