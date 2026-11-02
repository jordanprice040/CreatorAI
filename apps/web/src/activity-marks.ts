// Activity dots (step 9): a small dot on a page in the sidebar, and on its tab, when something
// finished there while the person was on another page: a run ended, an approval was asked for or
// answered, a build or package finished, or a model reply came back in Chat. The dot clears when
// that tab is opened. Pure functions with type-only imports, so the rules load in tests without a
// browser; the hook that reads the lists lives in activity-dots.tsx.

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
 * One short fingerprint per tab of what has finished there (not Chat: its replies come back in
 * the request that asked, so activity-dots.tsx tracks them for the window that asked). A tab whose list could not be read
 * has no mark, which never shows a dot (a failed read is not news).
 */
export type Marks = Partial<Record<MarkedView, string>>;
/** The fingerprint each tab had the last time the person had it open, per workspace. */
export type Seen = Partial<Record<MarkedView, string>>;

/** What each dot says, for its tooltip and for screen readers. */
export const MARK_TEXT: Record<MarkedView, string> = {
  chat: 'A model reply came back',
  runs: 'A run finished',
  decisions: 'An approval was asked for or answered',
  build: 'A build or package finished',
};

/** A short stable fingerprint of a list of keys; order does not matter. */
export function fingerprint(keys: readonly string[]): string {
  const sorted = [...keys].sort();
  // FNV-1a over the joined keys: small enough to keep in localStorage per workspace.
  let h = 0x811c9dc5;
  const text = sorted.join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${sorted.length}:${(h >>> 0).toString(36)}`;
}

/** Runs tab: workflows that have finished, however they ended. Starting one is not news. */
export function runsMark(
  workflows: readonly {
    id: string;
    state: string;
    finished_at: string | null;
  }[],
): string {
  return fingerprint(
    workflows
      .filter((w) => w.finished_at !== null)
      .map((w) => `${w.id}:${w.state}`),
  );
}

/** Approvals tab: every approval request and where it stands, so a new ask or an answer shows. */
export function decisionsMark(
  decisions: readonly { id: string; status: string }[],
): string {
  return fingerprint(decisions.map((d) => `${d.id}:${d.status}`));
}

/**
 * Build tab: builds and packages that are no longer running. A build that starts, or is still
 * running, changes nothing; one that ends (verified, failed, checkpoint, interrupted) does.
 */
export function buildMark(
  products: readonly {
    product: { id: string };
    builds: readonly {
      started_at: string;
      state: string;
      package: { state: string } | null;
    }[];
  }[],
): string {
  const keys: string[] = [];
  for (const p of products)
    for (const b of p.builds) {
      const at = `${p.product.id}:${b.started_at}`;
      if (b.state !== 'running') keys.push(`${at}:${b.state}`);
      if (b.package && b.package.state !== 'running')
        keys.push(`${at}:package:${b.package.state}`);
    }
  return fingerprint(keys);
}

/**
 * The seen marks after looking at the current ones: a tab seen for the first time takes its
 * current mark without a dot (nothing is news on a first visit to the studio), and the tab the
 * person has open takes its current mark, which clears its dot. Returns the same object when
 * nothing changed, so callers can skip a write.
 */
export function updateSeen(marks: Marks, seen: Seen, here: View | null): Seen {
  let next = seen;
  for (const v of MARKED_VIEWS) {
    const mark = marks[v];
    if (mark === undefined) continue;
    if (seen[v] === undefined || (here === v && seen[v] !== mark)) {
      if (next === seen) next = { ...seen };
      next[v] = mark;
    }
  }
  return next;
}

/** The tabs with a dot: their mark moved on since they were last open, and they are not open now. */
export function unseenViews(
  marks: Marks,
  seen: Seen,
  here: View | null,
): MarkedView[] {
  return MARKED_VIEWS.filter((v) => {
    const mark = marks[v];
    return (
      v !== here &&
      mark !== undefined &&
      seen[v] !== undefined &&
      seen[v] !== mark
    );
  });
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
