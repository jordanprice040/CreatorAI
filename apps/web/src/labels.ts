import type { WorkflowRole } from '@creator/contracts';

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
 * Without a name it falls back to the oversight mode. P-8: the Standard view passes
 * `id: false`, since ids are Advanced detail; the start time still tells runs apart.
 */
/**
 * An autonomy mode as the Standard view words it, matching `codeLabel` in plain-words.ts
 * ("human-in-the-loop"; review 2 of #197, N-d). Kept here so labels.ts stays import-free.
 */
const modeWords = (mode: string) =>
  mode === 'human_in_loop'
    ? 'human-in-the-loop'
    : mode === 'human_led'
      ? 'human-led'
      : mode.replace(/_/g, ' ');

export function runLabel(
  run: { run_id: string; created_at: string; autonomy_mode: string },
  names: ReadonlyMap<string, string>,
  max = 48,
  id = true,
) {
  const name = runName(run.run_id, names);
  const head = name
    ? clipText(name, max)
    : `${upper(id ? run.autonomy_mode.replace(/_/g, ' ') : modeWords(run.autonomy_mode))} run`;
  // A title that already carries its start time ("Autopilot · Nov 14, 2026, 1:07 AM") does not
  // repeat it (final UX pass).
  // Only the stamp the studio itself writes ("Nov 14, 2026, 1:07 AM"), not any year and time
  // in a theme (review 1 of #192, N-5).
  const dated = /\b[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2}\s?[AP]M\b/.test(
    head,
  );
  return `${head}${dated ? '' : ` · ${shortWhen(run.created_at)}`}${id ? ` · ${run.run_id.slice(0, 8)}` : ''}`;
}

/**
 * A run named inside a sentence (P-8). Advanced keeps "run 3fa2b1c0"; Standard gives the
 * run's name in quotes, or "a run with no name", and never the id (review 1 of #197, L-2).
 */
export function runRef(
  runId: string,
  names: ReadonlyMap<string, string>,
  id = true,
  max = 48,
) {
  if (id) return `run ${runId.slice(0, 8)}`;
  const name = runName(runId, names);
  return name ? `run “${clipText(name, max)}”` : 'a run with no name';
}

/**
 * Final UX pass: a discovery's stored uncertainty text, easier to scan. The run's full id
 * becomes its short id (P-8: left out when `ids` is false, as in the Standard view), and the run of "No claim in the packet addresses X." sentences
 * becomes one "Not covered by any claim: X, Y and Z." The stored text is unchanged.
 */
export function plainUncertainty(text: string, ids = true): string {
  const missing: string[] = [];
  const rest = text
    .replace(
      /( ?)\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g,
      (_, space: string, short: string) => (ids ? `${space}${short}` : ''),
    )
    // An item ends at the period that ends its sentence, not at one inside it such as "e.g."
    // (review 1 of #192, N-6).
    .replace(
      /\s*No claim in the packet addresses (.+?)\.(?=\s+[A-Z]|\s*$)/g,
      (_, what: string) => {
        missing.push(what.trim());
        return '';
      },
    )
    .trim();
  if (missing.length === 0) return rest;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
  return `${rest}${rest ? ' ' : ''}Not covered by any claim: ${list}.`;
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

/**
 * Each workflow role as the pages name it, shared by Overview and Monitor › Runs. A record,
 * so a new role fails typecheck instead of reading as another role (reviews 3 and 4 of #197).
 */
export const ROLE_NAME: Record<WorkflowRole, string> = {
  r02_discovery: 'Discovery',
  r01_exploration: 'Explore for me',
  r08_assessment: 'Automatic assessment',
  r05_skeptic: 'Skeptic review',
};

/** A role carried as text (Overview's attention list), named from `ROLE_NAME`. */
export const roleName = (role: string) =>
  ROLE_NAME[role as WorkflowRole] ?? role.replace(/_/g, ' ');
