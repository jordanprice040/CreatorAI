// ADR-0091: "Find evidence on the web" from Compare and decide fills Discover's Search the web
// form. Pages stay mounted, so the hand-off is an event, kept until the form takes it.

export type WebSearchPrefill = { question: string; interests: string };

const EVENT = 'creator:web-search-prefill';
let pending: WebSearchPrefill | null = null;

export function requestWebSearch(prefill: WebSearchPrefill) {
  pending = prefill;
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Calls `use` with a waiting prefill now and whenever one is requested; returns the unsubscribe. */
export function onWebSearchPrefill(use: (p: WebSearchPrefill) => void) {
  const take = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    use(p);
  };
  take();
  window.addEventListener(EVENT, take);
  return () => window.removeEventListener(EVENT, take);
}
