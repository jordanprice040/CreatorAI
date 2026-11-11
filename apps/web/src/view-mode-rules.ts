// ADR-0082 (P19): which view mode a person sees before and after the server answers. Pure
// functions with no imports, so the rules load in tests without a browser.

export type ViewMode = 'standard' | 'advanced';

/** This browser's copy of the person's choice, for the first paint before the server answers. */
export const viewModeKey = (actor: string) => `creator.viewMode.${actor}`;
/** ADR-0071's Discover-only choice ('guided' | 'advanced'), read once as a starting point. */
export const legacyPresentationKey = (actor: string) =>
  `creator.presentation.${actor}`;

/**
 * The mode to show. A choice saved on the server wins (version above 0). Before the person has
 * ever chosen, this browser's cached copy, then Discover's older Guided/Advanced choice, keep
 * what they saw; otherwise Standard.
 */
export function effectiveMode(
  server: { view_mode: ViewMode; version: number } | null,
  cached: string | null,
  legacy: string | null,
): ViewMode {
  if (server && server.version > 0) return server.view_mode;
  if (cached === 'standard' || cached === 'advanced') return cached;
  return legacy === 'advanced' ? 'advanced' : 'standard';
}
