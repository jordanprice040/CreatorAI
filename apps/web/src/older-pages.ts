// Audit L-9: long lists are read newest first, one page at a time; "Show older" asks for the
// page after the last record shown. Pure functions with no imports, so tests load them
// without a browser.

/**
 * The list on screen: the first page as just read, then what was shown before (the earlier
 * list plus the older pages fetched), each record once. A refresh that adds a new record pushes
 * the first page's last record out of it; it stays on screen from `older`, in order.
 */
export function withOlder<T extends { id: string }>(
  first: T[],
  older: T[],
): T[] {
  const seen = new Set(first.map((r) => r.id));
  return [...first, ...older.filter((r) => !seen.has(r.id))];
}

/**
 * Whether an older page may exist: the last page read was full. A page shorter than the page
 * size is the last one; a full page may be followed by an empty one.
 */
export function mayHaveOlder(lastPageLength: number, pageSize: number) {
  return lastPageLength >= pageSize;
}

/** The address of the page older than `last`, keeping any query the list already has. */
export function olderPath(path: string, last: { id: string }) {
  return `${path}${path.includes('?') ? '&' : '?'}before=${encodeURIComponent(last.id)}`;
}

/**
 * Reads again the records shown past the first page, after the first page was read again
 * (PR #125 review L-1): from the first page's last record, page by page, until at least as many
 * as were shown before, or the last page. So a record past the first page that changed (closed,
 * archived, cancelled) shows its new state, and one a new record pushed out of the first page
 * is still listed in order. `lastLength` is the length of the last page read, or null when the
 * first page is not full and nothing older exists.
 */
export async function rereadOlder<T extends { id: string }>(
  fetchPage: (before: string) => Promise<T[]>,
  first: T[],
  shownBeyond: number,
  pageSize: number,
): Promise<{ rows: T[]; lastLength: number | null }> {
  const rows: T[] = [];
  let lastLength: number | null = null;
  let last = first[first.length - 1];
  if (first.length < pageSize) return { rows, lastLength };
  while (last && rows.length < shownBeyond) {
    const page = await fetchPage(last.id);
    rows.push(...page);
    lastLength = page.length;
    if (page.length < pageSize) break;
    last = page[page.length - 1];
  }
  return { rows, lastLength };
}
