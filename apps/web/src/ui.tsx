import { useEffect, useState, type ReactNode } from 'react';
import {
  ActorSummarySchema,
  StoredKindSchema,
  z,
  type ActorSummary,
  type Snippet,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';

// Shared pieces for every view. They take plain props and fetch through `api`, so a future
// desktop shell can host the same views around its own navigation.

export const VIEWS = [
  ['overview', 'Monitor'],
  ['submit', 'Submit a theme'],
  ['catalog', 'Catalog'],
  ['compare', 'Compare and decide'],
  ['evidence', 'Evidence'],
  ['decisions', 'Decisions'],
  ['runs', 'Runs'],
  ['budgets', 'Budgets'],
  ['scores', 'Scores and specs'],
  ['search', 'Search'],
  ['activity', 'Activity'],
  ['studies', 'Studies'],
  ['gallery', 'Gallery'],
] as const;
export type View = (typeof VIEWS)[number][0];

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
export type Route = {
  view: View;
  ws: string;
  /** The item the view has open (a record, workflow, decision, `claim:<id>` …). */
  id: string;
  q: string;
};
const isView = (v: string): v is View => VIEWS.some(([k]) => k === v);

/** Reads the route from `#/view?ws=…&id=…&q=…`, so a refresh reopens the same place. */
export function parseRoute(hash: string): Route {
  const m = /^#\/([a-z]+)(?:\?(.*))?$/.exec(hash);
  const p = new URLSearchParams(m?.[2] ?? '');
  const view = m?.[1] ?? '';
  return {
    view: isView(view) ? view : 'overview',
    ws: p.get('ws') ?? '',
    id: p.get('id') ?? '',
    q: p.get('q') ?? '',
  };
}
export function routeHash(r: Route): string {
  const p = new URLSearchParams();
  if (r.ws) p.set('ws', r.ws);
  if (r.id) p.set('id', r.id);
  if (r.q) p.set('q', r.q);
  const qs = p.toString();
  return `#/${r.view}${qs ? `?${qs}` : ''}`;
}
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => {
      if (!window.location.hash.startsWith('#login='))
        setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  /** A new view is a history step; changing what is open within a view replaces it. */
  function go(next: Partial<Route>, replace = false) {
    const r = { ...route, ...next };
    if (next.view && next.view !== route.view && next.id === undefined)
      r.id = '';
    if (next.view && next.view !== route.view && next.q === undefined) r.q = '';
    const hash = routeHash(r);
    if (replace) history.replaceState(null, '', hash);
    else history.pushState(null, '', hash);
    setRoute(r);
  }
  return { route, go };
}

/** Display names for actor ids in one workspace; unknown ids show abbreviated. */
export function useActors(workspace: string) {
  const [actors, setActors] = useState<ActorSummary[]>([]);
  useEffect(() => {
    setActors([]);
    if (!workspace) return;
    api(z.array(ActorSummarySchema), `workspaces/${workspace}/actors`)
      .then(setActors)
      .catch(() => setActors([]));
  }, [workspace]);
  const map = new Map(actors.map((a) => [a.id, a]));
  return (id: string) => {
    const a = map.get(id);
    return a
      ? `${a.display_name}${a.kind === 'human' ? '' : ` (${a.kind})`}`
      : `actor ${id.slice(0, 8)}`;
  };
}

/** Loads data for a view with explicit loading, error and retry states. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let stop = false;
    setLoading(true);
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
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
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
