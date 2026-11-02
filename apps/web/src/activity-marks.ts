// Activity dots (step 9): a small dot on a page in the sidebar, and on its tab, when something
// finished there while the person was on another page: a run ended, an approval was asked for or
// answered, a build ended or a package was made, or a model answer came back in Chat. The dot
// clears when that tab is opened. Pure functions with type-only imports, so the rules load in
// tests without a browser; the hook that reads the lists lives in activity-dots.tsx.

import type { View } from './pages.js';

/** The tabs that can carry an activity dot. */
export type MarkedView = 'chat' | 'runs' | 'decisions' | 'build';
export const MARKED_VIEWS: readonly MarkedView[] = [
  'chat',
  'runs',
  'decisions',
  'build',
];

/**
 * Per tab, one short key for each thing that has finished there (not Chat: its answers come
 * back in the request that asked, so activity-dots.tsx tracks them for the window that asked).
 * Only a key that was not there before is news: a key that drops out (an old item past the end
 * of a capped list, a state the server forgot on restart) never shows a dot. A tab whose list
 * could not be read has no keys, which never shows a dot either.
 */
export type Marks = Partial<Record<MarkedView, readonly string[]>>;
/** The keys each tab had the last time the person had it open, per workspace. */
export type Seen = Partial<Record<MarkedView, readonly string[]>>;

/** What each dot says, for its tooltip and for screen readers. */
export const MARK_TEXT: Record<MarkedView, string> = {
  chat: 'A model answer or error came back in Chat',
  runs: 'A run finished',
  decisions: 'An approval was asked for or answered',
  build: 'A build ended or a package was made',
};

/** A short stable key for one item, small enough to keep a few hundred per workspace. */
export function shortKey(text: string): string {
  // FNV-1a, 32 bits: a collision only hides one dot, never invents one.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Runs tab: workflows that have finished, however they ended. Starting one is not news. */
export function runsMark(
  workflows: readonly {
    id: string;
    state: string;
    finished_at: string | null;
  }[],
): string[] {
  return workflows
    .filter((w) => w.finished_at !== null)
    .map((w) => shortKey(`${w.id}:${w.state}`));
}

/** Approvals tab: every approval request and where it stands, so a new ask or an answer shows. */
export function decisionsMark(
  decisions: readonly { id: string; status: string }[],
): string[] {
  return decisions.map((d) => shortKey(`${d.id}:${d.status}`));
}

/**
 * Build tab: builds that are no longer running, and packages made (Gallery artifacts, which are
 * kept on disk). A build that ended counts once however it ended, because the API forgets an
 * outcome it only held in memory after a restart and reports it as interrupted instead; the
 * package job's own state is in memory only, so it is not used.
 */
export function buildMark(
  products: readonly {
    product: { id: string };
    builds: readonly { started_at: string; state: string }[];
  }[],
  artifacts: readonly { id: string }[],
): string[] {
  const keys: string[] = [];
  for (const p of products)
    for (const b of p.builds)
      if (b.state !== 'running')
        keys.push(shortKey(`build:${p.product.id}:${b.started_at}`));
  for (const a of artifacts) keys.push(shortKey(`artifact:${a.id}`));
  return keys;
}

const news = (mark: readonly string[], seen: readonly string[]) => {
  const old = new Set(seen);
  return mark.some((k) => !old.has(k));
};

/**
 * The seen keys after looking at the current ones: a tab seen for the first time takes its
 * current keys without a dot (nothing is news on a first visit to the studio), and the tab the
 * person has open takes its current keys, which clears its dot. Returns the same object when
 * nothing changed, so callers can skip a write.
 */
export function updateSeen(marks: Marks, seen: Seen, here: View | null): Seen {
  let next = seen;
  for (const v of MARKED_VIEWS) {
    const mark = marks[v];
    if (mark === undefined) continue;
    const was = seen[v];
    if (was === undefined || (here === v && !sameKeys(was, mark))) {
      if (next === seen) next = { ...seen };
      next[v] = [...new Set(mark)];
    }
  }
  return next;
}
function sameKeys(a: readonly string[], b: readonly string[]) {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((k) => y.has(k));
}

/** The tabs with a dot: a key appeared since they were last open, and they are not open now. */
export function unseenViews(
  marks: Marks,
  seen: Seen,
  here: View | null,
): MarkedView[] {
  return MARKED_VIEWS.filter((v) => {
    const mark = marks[v];
    const was = seen[v];
    return (
      v !== here && mark !== undefined && was !== undefined && news(mark, was)
    );
  });
}

/**
 * Seen keys from two windows of the same browser: the one that wrote last must not undo what the
 * other cleared. Per workspace and tab, a tab only this side changed takes this side's keys; the
 * rest keep what is stored.
 */
export function mergeSeen(
  stored: Record<string, Seen>,
  ws: string,
  changed: Seen,
): Record<string, Seen> {
  return { ...stored, [ws]: { ...(stored[ws] ?? {}), ...changed } };
}

/**
 * Writes the changed tabs over what is stored now and returns the new seen state. Workspaces that
 * only memory holds are written too. When the write
 * fails (blocked or full storage) what is stored is stale or empty, so the in-memory state is kept
 * instead; taking the stored copy would forget the other tabs and workspaces and drop their dots.
 */
export function storeSeenWith(
  read: () => Record<string, Seen>,
  write: (all: Record<string, Seen>) => void,
  memory: Record<string, Seen>,
  ws: string,
  changed: Seen,
): Record<string, Seen> {
  // PR #113 L-1: a workspace held only in memory (first seen while writes were failing) is
  // kept when a later write succeeds; workspaces the store has keep the stored copy.
  const all = mergeSeen({ ...memory, ...read() }, ws, changed);
  try {
    write(all);
    return all;
  } catch {
    return mergeSeen(memory, ws, changed);
  }
}

/**
 * The marks that belong to the open workspace. Right after a switch the previous workspace's
 * lists are still held for a moment; taking them as the new workspace's first sight would store
 * them as seen there and show false dots once its own lists arrive.
 */
export function marksFor(
  ws: string,
  polled: { ws: string; marks: Marks } | null,
  build: { ws: string; keys: readonly string[] } | undefined,
): Marks {
  return {
    ...(polled && polled.ws === ws ? polled.marks : {}),
    ...(build && build.ws === ws ? { build: build.keys } : {}),
  };
}

/** The tooltip for a sidebar page or tab holding these views, or '' when none has a dot. */
export function dotText(
  views: readonly View[],
  unseen: readonly MarkedView[],
): string {
  return unseen
    .filter((v) => views.includes(v))
    .map((v) => MARK_TEXT[v])
    .join('; ');
}
