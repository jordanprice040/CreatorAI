import { useEffect, useRef, useState } from 'react';
import { DecisionSchema, WorkflowSchema, z } from '@creator/contracts';
import { api, STUDIO_CHANGED } from './oversight.js';
import {
  buildMark,
  decisionsMark,
  runsMark,
  unseenViews,
  updateSeen,
  type MarkedView,
  type Marks,
  type Seen,
} from './activity-marks.js';
import type { View } from './pages.js';

/**
 * Sent on `window` when something finishes that only this window knows about: a model reply
 * coming back in Chat, which is answered inside the request that asked for it.
 */
export const ACTIVITY = 'creator:activity';
export function announceActivity(view: 'chat', workspace: string) {
  window.dispatchEvent(
    new CustomEvent(ACTIVITY, { detail: { view, workspace } }),
  );
}

// Only what the build mark needs from the products list (apps/api/src/products.ts).
const ProductsSchema = z.array(
  z.object({
    product: z.object({ id: z.string() }),
    builds: z.array(
      z.object({
        started_at: z.string(),
        state: z.string(),
        package: z.object({ state: z.string() }).nullable(),
      }),
    ),
  }),
);

/** The seen marks, per workspace, in this browser only; a blocked store just forgets them. */
const SEEN = 'creator.activity-seen';

function readSeen(): Record<string, Seen> {
  try {
    return JSON.parse(localStorage.getItem(SEEN) ?? '{}') as Record<
      string,
      Seen
    >;
  } catch {
    return {};
  }
}
function storeSeen(all: Record<string, Seen>) {
  try {
    localStorage.setItem(SEEN, JSON.stringify(all));
  } catch {
    // Private windows: dots start again from what is there now, which is harmless.
  }
}

async function readMarks(ws: string): Promise<Marks> {
  const base = `workspaces/${ws}`;
  // Each list stands alone: one that cannot be read leaves its tab without a mark (no dot).
  const [workflows, decisions, products] = await Promise.all([
    api(z.array(WorkflowSchema), `${base}/workflows`).catch(() => null),
    api(z.array(DecisionSchema), `${base}/decisions`).catch(() => null),
    api(ProductsSchema, `${base}/products`).catch(() => null),
  ]);
  return {
    ...(workflows ? { runs: runsMark(workflows) } : {}),
    ...(decisions ? { decisions: decisionsMark(decisions) } : {}),
    ...(products ? { build: buildMark(products) } : {}),
  };
}

/**
 * The tabs with something new since the person last had them open. Lists are read when the
 * workspace opens, after any action the studio sends, and every 15 seconds while the window is
 * visible. Chat replies are answered inside the request that asked, so only this window knows
 * of them: they arrive as an ACTIVITY event and are kept for this window only. The tab that is
 * open never has a dot.
 */
export function useActivityDots(ws: string | null, here: View): MarkedView[] {
  const [marks, setMarks] = useState<Marks>({});
  const [seenAll, setSeenAll] = useState<Record<string, Seen>>(readSeen);
  // Workspaces with a Chat reply the person has not seen yet.
  const [chatNews, setChatNews] = useState<ReadonlySet<string>>(new Set());
  const hereRef = useRef(here);
  hereRef.current = here;
  const seq = useRef(0);
  useEffect(() => {
    setMarks({});
    if (!ws) return;
    const read = () => {
      const mine = ++seq.current;
      readMarks(ws)
        .then((m) => {
          if (mine === seq.current) setMarks(m);
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
  useEffect(() => {
    const replied = (e: Event) => {
      const d = (e as CustomEvent<{ view?: string; workspace?: string }>)
        .detail;
      if (d?.view !== 'chat' || !d.workspace) return;
      const where = d.workspace;
      // A reply that lands while Chat of that workspace is open is seen already.
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
  // Take in the marks of tabs seen for the first time and of the tab now open.
  useEffect(() => {
    if (!ws) return;
    const current = seenAll[ws] ?? {};
    const next = updateSeen(marks, current, here);
    if (next === current) return;
    const all = { ...seenAll, [ws]: next };
    setSeenAll(all);
    storeSeen(all);
  }, [ws, marks, here, seenAll]);
  if (!ws) return [];
  const polled = unseenViews(marks, seenAll[ws] ?? {}, here);
  return chatNews.has(ws) && here !== 'chat' ? ['chat', ...polled] : polled;
}
