import { useState, type ReactNode } from 'react';
import { viewLabel, type Route } from './ui.js';
import { PageActive } from './page-active.js';

export { usePageActive, useOnShow } from './page-active.js';

/** Views with nothing to reset: Path is read-only, and Chat keeps what was sent. */
const NO_RESET = new Set(['path', 'chat']);

/**
 * P01 (R06): what Reset also clears on pages whose filters live in the address. Reset returns
 * a page to its defaults (empty words, every type, any kind and status, Newest); it is not a
 * refresh, and other pages' fields and saved records are untouched.
 */
const RESET_NOTE: Partial<Record<string, string>> = {
  search:
    ' This also clears the search words and returns the sort to Newest; the address stops naming the search.',
  activity: ' This also clears the words and shows everything again.',
  catalog:
    ' This also clears a kind filter in the address and returns the sort to Newest.',
};

/** Session-memory only: retain visited forms, never serialize credentials or drafts. */
export function PageDrafts({
  route,
  render,
  onReset,
}: {
  route: Route;
  render: (route: Route) => ReactNode;
  /** Clears what the page keeps outside its fields (address words, a remembered sort). */
  onReset?: (route: Route) => void;
}) {
  const key = `${route.ws}:${route.view}`;
  const [pages, setPages] = useState(() => [{ key, route, revision: 0 }]);
  const [resetKey, setResetKey] = useState<string | null>(null);
  const current = pages.find((page) => page.key === key);
  if (!current || current.route !== route) {
    setPages((previous) =>
      current
        ? previous.map((page) => (page.key === key ? { ...page, route } : page))
        : [...previous, { key, route, revision: 0 }],
    );
  }
  return (
    <>
      {resetKey === key && (
        <div
          className="notice"
          role="group"
          aria-label="Reset page fields confirmation"
        >
          <p>
            Reset fields on {viewLabel(route.view)} to their starting values?
            {RESET_NOTE[route.view] ?? ''} Other pages and saved records are
            unchanged. Already submitted work continues.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => setResetKey(null)}
          >
            Keep fields
          </button>{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => {
              onReset?.(route);
              setPages((previous) =>
                previous.map((page) =>
                  page.key === key
                    ? { ...page, revision: page.revision + 1 }
                    : page,
                ),
              );
              setResetKey(null);
            }}
          >
            Reset these fields
          </button>
        </div>
      )}
      {pages.map((page) => (
        <PageActive.Provider key={page.key} value={page.key === key}>
          <div
            className={
              NO_RESET.has(page.route.view)
                ? 'draft-page no-reset'
                : 'draft-page'
            }
            hidden={page.key !== key}
          >
            {!NO_RESET.has(page.route.view) && (
              <button
                type="button"
                className="text page-reset"
                onClick={() => setResetKey(page.key)}
              >
                Reset fields
              </button>
            )}
            <div className="draft-content" key={page.revision}>
              {render(page.route)}
            </div>
          </div>
        </PageActive.Provider>
      ))}
    </>
  );
}
