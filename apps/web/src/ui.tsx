import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useOnShow } from './page-active.js';
import {
  ActorSummarySchema,
  ProblemComparisonSchema,
  StoredKindSchema,
  z,
  type ActorSummary,
  type Snippet,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import {
  pageOf,
  parseRoute,
  routeHash,
  type PageKey,
  type Route,
  type View,
} from './pages.js';
import { distinctLabels, groupByTheme, recordLabel } from './labels.js';

// Shared pieces for every view. They take plain props and fetch through `api`, so a future
// desktop shell can host the same views around its own navigation.

export {
  PAGES,
  pageOf,
  placeLabel,
  sectionOf,
  tabsOf,
  viewLabel,
  type Page,
  type PageKey,
  type Route,
  type View,
} from './pages.js';

const ICONS = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66l1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14l-1.41-1.41M12 16a4 4 0 100-8 4 4 0 000 8z',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  alert:
    'M12 9v4m0 3.5v.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  info: 'M12 11v6m0-9.5v.01M12 21a9 9 0 100-18 9 9 0 000 18z',
} as const;
/** A small stroked icon; decorative, so text beside it carries the meaning. */
export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/**
 * The view that shows an audit subject, or null when no page shows that kind on its own
 * (grants, budgets, reservations): those stay plain text rather than a link that fails.
 */
export function subjectTarget(kind: string, id: string): [View, string] | null {
  if (kind === 'decision') return ['decisions', id];
  if (kind === 'workflow') return ['runs', id];
  if (kind === 'claim' || kind === 'source')
    return ['evidence', `${kind}:${id}`];
  if (kind === 'problem') return ['compare', id];
  if ((StoredKindSchema.options as readonly string[]).includes(kind))
    return ['catalog', id];
  return null;
}
/** Rewrites an address from before the page map (`#/runs?…`) to its page and tab, in place. */
function canonical(route: Route) {
  const hash = window.location.hash;
  if (hash.startsWith('#/') && hash !== routeHash(route))
    history.replaceState(null, '', routeHash(route));
}
export function useRoute() {
  const [route, setRoute] = useState(() => {
    const r = parseRoute(window.location.hash);
    canonical(r);
    return r;
  });
  // The latest route, so a late call from a view that is being replaced (a load finishing
  // after the user navigated away) merges into where the user is, not where they were.
  const latest = useRef(route);
  latest.current = route;
  const visited = useRef(new Map<string, Route>());
  /** Keeps the newest visit last, so `lastIn` finds the most recent tab of a page. */
  const remember = (r: Route) => {
    const key = `${r.ws}:${r.view}`;
    visited.current.delete(key);
    visited.current.set(key, r);
  };
  useEffect(() => {
    const on = () => {
      if (!window.location.hash.startsWith('#login=')) {
        remember(latest.current);
        latest.current = parseRoute(window.location.hash);
        canonical(latest.current);
        setRoute(latest.current);
      }
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  /** A new view is a history step; changing what is open within a view replaces it. */
  /** `from`: the view asking; a late request from a view the user already left is dropped. */
  function go(next: Partial<Route>, replace = false, from?: View) {
    const now = latest.current;
    if (from && from !== now.view) return;
    remember(now);
    const r = { ...now, ...next };
    const previous = visited.current.get(`${r.ws}:${r.view}`);
    // Decisions opens on what is waiting now, not a decision focused on an earlier visit
    // (by now possibly answered), unless the link names one.
    if (next.view && next.view !== now.view && next.id === undefined)
      r.id = next.view === 'decisions' ? '' : (previous?.id ?? '');
    if (next.view && next.view !== now.view && next.q === undefined)
      r.q = previous?.q ?? '';
    const hash = routeHash(r);
    if (replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
    latest.current = r;
    setRoute(r);
  }
  /** The tab of a page the person was last on in this workspace, if any. */
  function lastIn(page: PageKey): View | undefined {
    const now = latest.current;
    if (pageOf(now.view).key === page) return now.view;
    let found: Route | undefined;
    for (const r of visited.current.values())
      if (r.ws === now.ws && pageOf(r.view).key === page) found = r;
    return found?.view;
  }
  return { route, go, lastIn };
}

/** Display names for actor ids in one workspace; unknown ids show abbreviated. */
export function useActors(workspace: string) {
  const [actors, setActors] = useState<ActorSummary[]>([]);
  useEffect(() => {
    let stop = false;
    setActors([]);
    if (!workspace) return;
    api(z.array(ActorSummarySchema), `workspaces/${workspace}/actors`)
      .then((actors) => {
        if (!stop) setActors(actors);
      })
      .catch(() => {
        if (!stop) setActors([]);
      });
    return () => {
      stop = true;
    };
  }, [workspace]);
  const map = new Map(actors.map((a) => [a.id, a]));
  return (id: string) => {
    const a = map.get(id);
    return a
      ? `${a.display_name}${a.kind === 'human' ? '' : ` (${a.kind})`}`
      : `actor ${id.slice(0, 8)}`;
  };
}

/**
 * Loads data for a view with explicit loading, error and retry states. The page reads again,
 * quietly (keeping what it shows until the new answer arrives), each time it is shown again
 * after being hidden, so records added elsewhere appear without a manual refresh.
 */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const quiet = useRef(false);
  useOnShow(() => {
    quiet.current = true;
    setTick((t) => t + 1);
  });
  useEffect(() => {
    let stop = false;
    if (!quiet.current) setLoading(true);
    quiet.current = false;
    setError('');
    load()
      .then((d) => {
        if (!stop) setData(d);
      })
      .catch((e: unknown) => {
        if (!stop) {
          setData(null);
          setError(message(e));
        }
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [...deps, tick]);
  return {
    data,
    error,
    loading,
    reload: () => setTick((t) => t + 1),
    /** Reads again without the "Loading…" state, for polls and refreshes after an action. */
    refresh: () => {
      quiet.current = true;
      setTick((t) => t + 1);
    },
  };
}

export function Status({
  loading,
  error,
  retry,
  children,
}: {
  loading: boolean;
  error: string;
  retry?: () => void;
  children?: ReactNode;
}) {
  if (error)
    return (
      <div className="error-box" role="alert">
        <p className="error">{error}</p>
        {retry && (
          <button className="secondary" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    );
  if (loading)
    return (
      <p className="small loading" role="status">
        Loading…
      </p>
    );
  return <>{children}</>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="small empty-note">{children}</p>;
}

/** Highlighted search text as plain text nodes; stored text is never parsed as markup. */
export function SnippetText({ snippet }: { snippet: Snippet }) {
  if (snippet.length === 0) return null;
  return (
    <span className="snippet">
      {snippet.map((s, i) =>
        s.match ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
      )}
    </span>
  );
}

/** Who did something and when, in words. */
export function Stamp({
  actor,
  at,
  verb = '',
}: {
  actor: string;
  at: string;
  verb?: string;
}) {
  return (
    <small className="stamp">
      {verb ? `${verb} ` : ''}by {actor} · <time dateTime={at}>{when(at)}</time>
    </small>
  );
}

/** Execution states in plain words: what is happening and who it waits for. */
export const STATE_NOTE: Record<string, string> = {
  queued: 'Waiting to start',
  running: 'Running on the server',
  waiting_dependency: 'Waiting for earlier steps',
  waiting_human: 'Waiting for your decision',
  paused_operator: 'Paused by you',
  paused_budget: 'Paused: budget',
  reconciling: 'Blocked: an outcome is unknown and held until reconciled',
  succeeded: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`badge wf-${state}`} title={STATE_NOTE[state] ?? ''}>
      {words(state)}
    </span>
  );
}

export const shortId = (id: string) => id.slice(0, 8);

/**
 * History wording for display. Events recorded before they had their own wording kept the
 * internal action code ("study.assigned"); show those as words too.
 */
export const eventText = (summary: string) =>
  /^[a-z_]+(\.[a-z_]+)+$/.test(summary)
    ? `${summary[0]!.toUpperCase()}${summary.slice(1).replace(/[._]+/g, ' ')}`
    : summary;

/** Shortens text for a one-line label at a word boundary, marking the cut with an ellipsis. */
export function clip(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * How many alternatives each problem has, so a page can open on one with something to
 * compare instead of whichever problem happens to be listed first. Problems whose
 * comparison fails to load are left out rather than counted as empty.
 */
export async function alternativeCounts(
  base: string,
  problems: readonly { id: string }[],
) {
  const counts = new Map<string, number>();
  await Promise.all(
    problems.slice(0, 20).map(async (p) => {
      try {
        const c = await api(
          ProblemComparisonSchema,
          `${base}/problems/${p.id}/comparison`,
        );
        counts.set(p.id, c.alternatives.length);
      } catch {
        // An unreadable comparison still shows in the list; it just isn't preferred.
      }
    }),
  );
  return counts;
}
/**
 * A problem's option label: the part of its title that differs from its siblings, when it
 * was found, and a note when nothing was proposed for it.
 */
export const problemLabel = (
  p: { id: string; title: string; created_at: string; version?: number },
  counts: ReadonlyMap<string, number>,
  max = 64,
) =>
  `${recordLabel(p, max)}${counts.get(p.id) === 0 ? ' (no options proposed)' : ''}`;

/**
 * Options for a record picker, grouped under their shared theme when the list holds more
 * than one theme (or any theme at all), each labelled by `label` and given its full title
 * as a tooltip. Keep the list newest first: groups follow their newest record.
 */
export function RecordOptions<
  T extends { id: string; title: string; created_at: string; version?: number },
>({ list, label }: { list: readonly T[]; label?: (r: T) => string }) {
  const labels = distinctLabels(list, label ?? ((r) => recordLabel(r)));
  const option = (r: T) => (
    <option key={r.id} value={r.id} title={r.title}>
      {labels.get(r.id)}
    </option>
  );
  const groups = groupByTheme(list);
  if (groups.length === 1 && !groups[0]!.theme) return <>{list.map(option)}</>;
  return (
    <>
      {groups.map((g) => (
        <optgroup
          key={g.theme || '-'}
          label={g.theme ? clip(g.theme, 70) : 'Other'}
        >
          {g.items.map(option)}
        </optgroup>
      ))}
    </>
  );
}

/**
 * Each run's name, from the run record it was registered from (discovery runs are titled
 * "Discovery: <theme>"). A run whose record can't be read just has no name.
 */
export async function runNames(base: string): Promise<Map<string, string>> {
  try {
    const runs = await api(
      z.array(z.object({ id: z.string(), title: z.string() })),
      `${base}/entities?kind=run`,
    );
    return new Map(runs.map((r) => [r.id, r.title]));
  } catch {
    return new Map();
  }
}
