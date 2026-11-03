import { useEffect, useState } from 'react';
import { z } from '@creator/contracts';
import { api, message } from './oversight.js';
import { mayHaveOlder, olderPath, withOlder } from './older-pages.js';

/**
 * A list read newest first in pages (audit L-9). `first` is the first page, as the page's own
 * load just read it; "Show older" fetches the next page from `path` and appends it. What was
 * already shown is kept across refreshes of the first page (so a new record pushing one out of
 * the first page never hides it), and dropped when `path` changes. Records past the first page
 * show as they were when fetched.
 */
export function useOlder<T extends { id: string }>(
  first: T[] | null | undefined,
  schema: z.ZodType<T>,
  path: string,
  pageSize: number,
) {
  const [older, setOlder] = useState<T[]>([]);
  const [lastLength, setLastLength] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setOlder([]);
    setLastLength(null);
    setError('');
  }, [path]);
  const items = withOlder(first ?? [], older);
  const more = mayHaveOlder(lastLength ?? first?.length ?? 0, pageSize);
  async function showOlder() {
    const last = items[items.length - 1];
    if (!last || busy) return;
    setBusy(true);
    setError('');
    try {
      const page = await api(z.array(schema), olderPath(path, last));
      // Everything shown so far, then the new page: see `withOlder`.
      setOlder([...items, ...page]);
      setLastLength(page.length);
    } catch (e) {
      setError(message(e));
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
