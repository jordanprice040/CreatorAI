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
