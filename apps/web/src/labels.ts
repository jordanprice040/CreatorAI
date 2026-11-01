// Pure label helpers for record and run pickers: short, distinct labels that put the part
// of a title that differs first, then when it was made, so a dropdown of look-alike records
// can be told apart at a glance. No imports, so they can be tested without a browser.

/** Shortens text at a word boundary, marking the cut with an ellipsis. */
export function clipText(text: string, max: number) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const upper = (s: string) => (s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s);

/**
 * Splits a title into the theme it opens with and the part that is its own. Discovery
 * titles read "<theme>: <what this record says>", so records from the same discovery
 * share everything up to the colon. A short lead-in after the theme ("Candidate
 * observation: …") is dropped too, since every record of a kind repeats it. A title
 * without such a prefix is all its own.
 */
export function splitTitle(title: string): { theme: string; own: string } {
  const flat = title.replace(/\s+/g, ' ').trim();
  const at = flat.indexOf(': ');
  // A theme is a phrase, not a one-word tag like "Discovery:" or "Idea:".
  if (at < 20 || flat.length - at - 2 < 12) return { theme: '', own: flat };
  const theme = flat.slice(0, at);
  let own = flat.slice(at + 2);
  const lead = own.indexOf(': ');
  if (
    lead > 0 &&
    lead <= 30 &&
    own.slice(0, lead).split(' ').length <= 3 &&
    own.length - lead - 2 >= 12
  )
    own = own.slice(lead + 2);
  return { theme, own: upper(own) };
}

/** A short date and time ("Oct 30, 3:12 PM") for telling same-day records apart. */
export const shortWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** A record's picker label: its own part, clipped, then when it was made. */
export function recordLabel(
  r: { title: string; created_at: string; version?: number },
  max = 64,
) {
  const version = r.version && r.version > 1 ? ` · v${r.version}` : '';
  return `${clipText(splitTitle(r.title).own, max)} · ${shortWhen(r.created_at)}${version}`;
}

/** The name a run is shown by: its record’s title without the "Discovery:" (or "Fixture discovery:") tag. */
export function runName(
  runId: string,
  names: ReadonlyMap<string, string>,
): string {
  const title = names.get(runId)?.trim() ?? '';
  return title.replace(/^(fixture )?discovery:\s*/i, '');
}

/**
 * A run's picker label: its name (the discovery theme, for discovery runs), when it
 * started and its short id, so two runs on the same theme still read differently.
 * Without a name it falls back to the oversight mode.
 */
export function runLabel(
  run: { run_id: string; created_at: string; autonomy_mode: string },
  names: ReadonlyMap<string, string>,
  max = 48,
) {
  const name = runName(run.run_id, names);
  const head = name
    ? clipText(name, max)
    : `${upper(run.autonomy_mode.replace(/_/g, ' '))} run`;
  return `${head} · ${shortWhen(run.created_at)} · ${run.run_id.slice(0, 8)}`;
}

/**
 * Groups records under their shared theme, keeping the given order inside each group and
 * ordering groups by their first record, so a newest-first list stays newest first. Records
 * without a theme form one group with an empty theme.
 */
export function groupByTheme<T extends { title: string }>(
  list: readonly T[],
): { theme: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const r of list) {
    const theme = splitTitle(r.title).theme;
    groups.set(theme, [...(groups.get(theme) ?? []), r]);
  }
  return [...groups.entries()].map(([theme, items]) => ({ theme, items }));
}

/**
 * Makes labels unique: when two records would read the same, each gets its short id, so a
 * picker never shows two identical options.
 */
export function distinctLabels<T extends { id: string }>(
  list: readonly T[],
  label: (r: T) => string,
): Map<string, string> {
  const raw = list.map((r) => [r.id, label(r)] as const);
  const seen = new Map<string, number>();
  for (const [, l] of raw) seen.set(l, (seen.get(l) ?? 0) + 1);
  return new Map(
    raw.map(([id, l]) => [
      id,
      (seen.get(l) ?? 0) > 1 ? `${l} · ${id.slice(0, 8)}` : l,
    ]),
  );
}
