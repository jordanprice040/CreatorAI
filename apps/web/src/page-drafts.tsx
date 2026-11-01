import { createContext, useContext, useState, type ReactNode } from 'react';
import { viewLabel, type Route } from './ui.js';

const PageActive = createContext(true);
export const usePageActive = () => useContext(PageActive);

/** Session-memory only: retain visited forms, never serialize credentials or drafts. */
export function PageDrafts({
  route,
  render,
}: {
  route: Route;
  render: (route: Route) => ReactNode;
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
            Other pages and saved records are unchanged. Already submitted work
            continues.
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
          <div className="draft-page" hidden={page.key !== key}>
            {page.route.view !== 'path' && (
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
