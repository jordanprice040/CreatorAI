import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from '@creator/contracts';
import { api, message } from './oversight.js';
import {
  mayHaveOlder,
  olderPath,
  rereadOlder,
  withOlder,
} from './older-pages.js';

/**
 * A list read newest first in pages (audit L-9). `first` is the first page, as the page's own
 * load just read it; "Show older" fetches the next page from `path` and appends it. Each time
 * the first page is read again (on return, after an action), the older pages already shown are
 * read again too, as many as were shown (PR #125 review L-1), so their state and buttons stay
 * current. They are dropped when `path` changes.
 */
export function useOlder<T extends { id: string }>(
  first: T[] | null | undefined,
  schema: z.ZodType<T>,
  path: string,
  pageSize: number,
) {
  /** The records shown past the first page, newest first. */
  const [older, setOlder] = useState<T[]>([]);
  const [lastLength, setLastLength] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Only the latest read (a re-read or a "Show older") may write.
  const seq = useRef(0);
  const shownBeyond = useRef(0);
  shownBeyond.current = older.length;
  const fetchPage = (before: string) =>
    api(z.array(schema), olderPath(path, { id: before }));
  useEffect(() => {
    seq.current++;
    setOlder([]);
    setLastLength(null);
    setError('');
  }, [path]);
  useEffect(() => {
    if (!first || shownBeyond.current === 0) return;
    const mine = ++seq.current;
    rereadOlder(fetchPage, first, shownBeyond.current, pageSize)
      .then((r) => {
        if (mine !== seq.current) return;
        setOlder(r.rows);
        setLastLength(r.lastLength);
        setError('');
      })
      .catch((e: unknown) => {
        if (mine === seq.current) setError(message(e));
      });
  }, [first]);
  // The same array until the first page or the older pages change, so callers can use it as
  // an effect dependency.
  const items = useMemo(() => withOlder(first ?? [], older), [first, older]);
  const more = mayHaveOlder(lastLength ?? first?.length ?? 0, pageSize);
  async function showOlder() {
    const last = items[items.length - 1];
    if (!last || busy) return;
    const mine = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const page = await fetchPage(last.id);
      if (mine !== seq.current) return;
      // The older records shown so far (a record pushed out of the first page included,
      // see `withOlder`), then the new page.
      const seen = new Set((first ?? []).map((r) => r.id));
      setOlder([...items.filter((r) => !seen.has(r.id)), ...page]);
      setLastLength(page.length);
    } catch (e) {
      if (mine === seq.current) setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return { items, more, busy, error, showOlder };
}

/** The "Show older" button under a paged list; nothing once the last page is shown. */
export function ShowOlder({
  list,
  what,
}: {
  list: ReturnType<typeof useOlder<{ id: string }>>;
  what: string;
}) {
  if (!list.more && !list.error) return null;
  return (
    <p className="small">
      {list.more && (
        <button
          type="button"
          className="secondary"
          disabled={list.busy}
          onClick={() => void list.showOlder()}
        >
          {list.busy ? 'Loading…' : `Show older ${what}`}
        </button>
      )}
      {list.error && (
        <span role="alert">
          {' '}
          Older {what} could not be read: {list.error}
        </span>
      )}
    </p>
  );
}
