// Pure ordering helpers for version lists: the latest item comes first and is the default,
// older ones stay one choice away. No imports, so they can be tested without a browser.

/**
 * Newest first by creation time (equal times keep their order), so a list or dropdown
 * opens on the latest item and older ones follow. Returns a copy.
 */
export function newestFirst<T extends { created_at: string }>(
  list: readonly T[],
): T[] {
  return [...list].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
}

type ProductLike = {
  product: { id: string; binding: { spec_id: string; spec_version: number } };
  builds: readonly { started_at: string }[];
};

/** When a product was last worked on; one with no builds yet was just made, so it counts as newest. */
const lastWork = (p: ProductLike) =>
  p.builds.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.max(...p.builds.map((b) => Date.parse(b.started_at)));

/** Sort order for times, later first; equal (including two unbuilt) keeps the given order. */
const later = (x: number, y: number) => (x === y ? 0 : y > x ? 1 : -1);

/**
 * Products grouped by spec, each group's latest first: the highest spec version, then the
 * most recently worked on (products carry no creation time). Groups are ordered by their
 * latest product the same way, so the spec being worked on now leads.
 */
export function productVersions<T extends ProductLike>(
  products: readonly T[],
): { specId: string; versions: T[] }[] {
  const newer = (a: T, b: T) =>
    b.product.binding.spec_version - a.product.binding.spec_version ||
    later(lastWork(a), lastWork(b));
  const groups = new Map<string, T[]>();
  for (const p of products) {
    const key = p.product.binding.spec_id;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .map(([specId, list]) => ({ specId, versions: [...list].sort(newer) }))
    .sort((a, b) => later(lastWork(a.versions[0]!), lastWork(b.versions[0]!)));
}
