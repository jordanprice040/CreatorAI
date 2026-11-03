import { createContext, useContext, useEffect, useRef, useState } from 'react';

// Pages stay mounted while hidden (PageDrafts keeps their typed fields), so a page's lists go
// stale while someone works elsewhere. This context says whether the page is the one shown,
// and `useOnShow` lets a page read its lists again each time it comes back.

export const PageActive = createContext(true);
export const usePageActive = () => useContext(PageActive);

/**
 * Runs `reload` each time this page is shown again after being hidden; not on first mount,
 * where the page loads anyway. Typed fields are untouched: only the page's own reads run.
 */
export function useOnShow(reload: () => void) {
  const active = usePageActive();
  const was = useRef(active);
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    if (active && !was.current) latest.current();
    was.current = active;
  }, [active]);
}

/**
 * A number that goes up each time this page is shown again (audit L-10). Add it to the
 * dependencies of an effect that reads something the page shows, such as an open record, so
 * the read runs again on return without resetting what the person picked or typed.
 */
export function useShown() {
  const [shown, setShown] = useState(0);
  useOnShow(() => setShown((n) => n + 1));
  return shown;
}
