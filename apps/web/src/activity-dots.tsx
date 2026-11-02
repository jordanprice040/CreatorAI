import { useEffect, useRef, useState } from 'react';
import { DecisionSchema, WorkflowSchema, z } from '@creator/contracts';
import { api, STUDIO_CHANGED } from './oversight.js';
import {
  decisionsMark,
  marksFor,
  storeSeenWith,
  runsMark,
  unseenViews,
  updateSeen,
  type MarkedView,
  type Marks,
  type Seen,
} from './activity-marks.js';
import type { View } from './pages.js';

/**
 * Sent on `window` when something finishes that only this window knows about: a model answer
 * (or its error) coming back in Chat, which is answered inside the request that asked for it.
 */
export const ACTIVITY = 'creator:activity';
export function announceActivity(view: 'chat', workspace: string) {
  window.dispatchEvent(
    new CustomEvent(ACTIVITY, { detail: { view, workspace } }),
  );
}

/** The seen keys, per workspace, in this browser only; a blocked store just forgets them. */
const SEEN = 'creator.activity-seen';

function readSeen(): Record<string, Seen> {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(SEEN) ?? '{}');
    if (!all || typeof all !== 'object') return {};
    // Keys stored by an earlier build of this feature were one string per tab; drop those.
    const out: Record<string, Seen> = {};
    for (const [ws, seen] of Object.entries(all as Record<string, unknown>)) {
      if (!seen || typeof seen !== 'object') continue;
      const tabs: Seen = {};
      for (const [v, keys] of Object.entries(seen as Record<string, unknown>))
        if (Array.isArray(keys) && keys.every((k) => typeof k === 'string'))
          tabs[v as MarkedView] = keys as string[];
      out[ws] = tabs;
    }
    return out;
  } catch {
    return {};
  }
}
/**
 * Writes only the tabs this window changed, over what is stored now, so another window's
 * clearing is not undone by this one's older copy. A blocked store keeps the in-memory state.
 */
function storeSeen(
  memory: Record<string, Seen>,
  ws: string,
  changed: Seen,
): Record<string, Seen> {
  return storeSeenWith(
    readSeen,
    (all) => localStorage.setItem(SEEN, JSON.stringify(all)),
    memory,
    ws,
    changed,
  );
}

async function readMarks(ws: string): Promise<Marks> {
  const base = `workspaces/${ws}`;
  // Each list stands alone: one that cannot be read leaves its tab without keys (no dot).
  const [workflows, decisions] = await Promise.all([
    api(z.array(WorkflowSchema), `${base}/workflows`).catch(() => null),
    api(z.array(DecisionSchema), `${base}/decisions`).catch(() => null),
  ]);
  return {
    ...(workflows ? { runs: runsMark(workflows) } : {}),
    ...(decisions ? { decisions: decisionsMark(decisions) } : {}),
  };
}

/**
 * The tabs with something new since the person last had them open. Runs and Approvals are read
 * when the workspace opens, after any action the studio sends, and every 15 seconds while the
 * window is visible; the Build keys come with the what's-next facts, which read the products and
 * artifacts lists on the same schedule. Chat answers are given inside the request that asked,
 * so only this window knows of them: they arrive as an ACTIVITY event and are kept for this
 * window only. The tab that is open never has a dot.
 */
export function useActivityDots(
  ws: string | null,
  here: View,
  build: { ws: string; keys: readonly string[] } | undefined,
): MarkedView[] {
  // Marks are tagged with their workspace: right after a switch the previous workspace's marks
  // are still in state for one render, and must not be taken as the new one's.
  const [polled, setPolled] = useState<{ ws: string; marks: Marks } | null>(
    null,
  );
  const [seenAll, setSeenAll] = useState<Record<string, Seen>>(readSeen);
  // Workspaces with a Chat answer the person has not seen yet.
  const [chatNews, setChatNews] = useState<ReadonlySet<string>>(new Set());
  const hereRef = useRef(here);
  hereRef.current = here;
  const seq = useRef(0);
  useEffect(() => {
    if (!ws) return;
    const read = () => {
      const mine = ++seq.current;
      readMarks(ws)
        .then((marks) => {
          if (mine === seq.current) setPolled({ ws, marks });
        })
        .catch(() => undefined);
    };
    read();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, 15_000);
    let soon: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(soon);
      soon = setTimeout(read, 300);
    };
    window.addEventListener(STUDIO_CHANGED, changed);
    return () => {
      clearInterval(t);
      clearTimeout(soon);
      window.removeEventListener(STUDIO_CHANGED, changed);
      seq.current++;
    };
  }, [ws]);
  // Another window cleared or took in a tab: follow it here too.
  useEffect(() => {
    const synced = (e: StorageEvent) => {
      if (e.key === SEEN || e.key === null) setSeenAll(readSeen());
    };
    window.addEventListener('storage', synced);
    return () => window.removeEventListener('storage', synced);
  }, []);
  useEffect(() => {
    const replied = (e: Event) => {
      const d = (e as CustomEvent<{ view?: string; workspace?: string }>)
        .detail;
      if (d?.view !== 'chat' || !d.workspace) return;
      const where = d.workspace;
      // An answer that lands while Chat of that workspace is open is seen already.
      if (hereRef.current === 'chat' && where === ws) return;
      setChatNews((old) => new Set(old).add(where));
    };
    window.addEventListener(ACTIVITY, replied);
    return () => window.removeEventListener(ACTIVITY, replied);
  }, [ws]);
  useEffect(() => {
    if (!ws || here !== 'chat' || !chatNews.has(ws)) return;
    setChatNews((old) => {
      const next = new Set(old);
      next.delete(ws);
      return next;
    });
  }, [ws, here, chatNews]);
  const marks = ws ? marksFor(ws, polled, build) : {};
  const markKey = JSON.stringify(marks);
  // Take in the keys of tabs seen for the first time and of the tab now open.
  useEffect(() => {
    if (!ws) return;
    const current = seenAll[ws] ?? {};
    const next = updateSeen(marks, current, here);
    if (next === current) return;
    const changed: Seen = {};
    for (const v of Object.keys(next) as MarkedView[])
      if (next[v] !== current[v]) changed[v] = next[v]!;
    setSeenAll(storeSeen(seenAll, ws, changed));
  }, [ws, markKey, here, seenAll]);
  if (!ws) return [];
  const dots = unseenViews(marks, seenAll[ws] ?? {}, here);
  return chatNews.has(ws) && here !== 'chat' ? ['chat', ...dots] : dots;
}
