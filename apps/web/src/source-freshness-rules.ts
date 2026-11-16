import type {
  ClaimEvidence,
  PassageCheck,
  SourceRecheckResult,
} from '@creator/contracts';

// F8 (ADR-0126): words for when a claim's sources were last checked and what a recheck found.
// Pure, so the page and its tests read the same rules.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 minutes ago", "3 hours ago", "12 days ago". A future time reads "just now". */
export function checkedAgo(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const n = (count: number, unit: string) =>
    `${count} ${unit}${count === 1 ? '' : 's'} ago`;
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return n(Math.floor(ms / MINUTE), 'minute');
  if (ms < DAY) return n(Math.floor(ms / HOUR), 'hour');
  return n(Math.floor(ms / DAY), 'day');
}

/** What each passage check means beside one cited passage; same_version says nothing. */
export const PASSAGE_NOTE: Record<PassageCheck, string> = {
  same_version: '',
  passage_kept: 'quoted passage still there',
  quote_kept: 'passage edited, quoted words still there',
  passage_changed: 'quoted passage changed or gone',
  page_gone: 'page gone or unreadable',
  cannot_tell: 'source changed; nothing quoted to look for',
};
/** Checks that flag the claim for the owner's look. */
export const FLAGGED: ReadonlySet<PassageCheck> = new Set([
  'passage_changed',
  'page_gone',
]);

export interface ClaimFreshness {
  /** The oldest last check among the claim's live sources, or null when one was never checked. */
  oldest: string | null;
  /** Live sources none of whose checks are recorded. */
  never: number;
  sources: number;
  changed: number;
  gone: number;
}

/** One claim's freshness over its live rows (not retracted, current claim version). */
export function claimFreshness(c: ClaimEvidence): ClaimFreshness {
  const live = c.rows.filter(
    (r) => r.freshness !== 'retracted' && r.freshness !== 'claim_changed',
  );
  const bySource = new Map<string, string | null>();
  for (const r of live) bySource.set(r.support.source_id, r.last_checked_at);
  const times = [...bySource.values()];
  const known = times.filter((t): t is string => t !== null);
  return {
    oldest: known.length
      ? known.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b))
      : null,
    never: times.length - known.length,
    sources: bySource.size,
    changed: live.filter((r) => r.passage_check === 'passage_changed').length,
    gone: live.filter((r) => r.passage_check === 'page_gone').length,
  };
}

/** The short line beside a claim: when its sources were checked, and any flag. */
export function claimFreshnessLine(f: ClaimFreshness, now: number): string {
  if (f.sources === 0) return '';
  if (f.never === f.sources)
    return f.sources === 1 ? 'source never checked' : 'sources never checked';
  if (f.never > 0)
    return `${f.never} source${f.never === 1 ? '' : 's'} never checked`;
  return `${f.sources === 1 ? 'source' : 'oldest source'} checked ${checkedAgo(f.oldest!, now)}`;
}

export function claimFlags(f: ClaimFreshness): string[] {
  const out: string[] = [];
  if (f.changed)
    out.push(
      f.changed === 1
        ? 'a quoted passage changed'
        : `${f.changed} quoted passages changed`,
    );
  if (f.gone)
    out.push(f.gone === 1 ? 'a page is gone' : `${f.gone} pages gone`);
  return out;
}

/** One sentence on what a recheck did, for the line under the button. */
export function recheckSummary(r: SourceRecheckResult): string {
  const count = (o: SourceRecheckResult['sources'][number]['outcome']) =>
    r.sources.filter((s) => s.outcome === o).length;
  const tried = r.sources.length - count('not_tried');
  if (r.sources.length === 0)
    return 'No sources to recheck: these claims cite none.';
  const parts = [
    count('unchanged') && `${count('unchanged')} unchanged`,
    count('changed') && `${count('changed')} changed`,
    count('page_gone') && `${count('page_gone')} gone or unreadable`,
    count('not_checked') && `${count('not_checked')} not checked`,
  ].filter(Boolean);
  let s = `Rechecked ${tried} source${tried === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}.`;
  if (r.stopped)
    s += ` Stopped early (${count('not_tried')} not tried): ${r.stopped.explanation}`;
  if (r.not_rechecked)
    s += ` ${r.not_rechecked} more cited source${r.not_rechecked === 1 ? '' : 's'} left for the next recheck.`;
  return s;
}
