// Rules for the owner actions that used to be command-line only (closing a budget, archiving a
// record, retracting claim evidence). No imports, so tests load it without a browser.
// The server enforces every rule again; these only decide what the app offers and explain why.

/** The server's reason limits: budget close 200 characters, archive 500, retract 500. */
export const REASON_MAX = { budget: 200, archive: 500, retract: 500 } as const;

/** A typed reason, trimmed, or why it can't be sent. */
export function reasonCheck(
  raw: string,
  max: number,
): { reason: string } | { error: string } {
  const reason = raw.trim();
  if (!reason) return { error: 'Say why, in a few words.' };
  if (reason.length > max)
    return {
      error: `Keep the reason to ${max} characters (it has ${reason.length}).`,
    };
  return { reason };
}

type EnvelopeLike = {
  status: string;
  reserved: string;
  unknown: string;
  allocated: string;
};

/**
 * Why a budget can't be closed yet, or null when it can. Mirrors `closeEnvelope`: nothing may
 * be reserved in flight, held as unknown, or moved to a child budget that is still open.
 */
export function budgetCloseBlocker(e: EnvelopeLike): string | null {
  if (e.status === 'closed') return 'This budget is already closed.';
  const held: string[] = [];
  if (BigInt(e.reserved) !== 0n) held.push('a call is still in flight');
  if (BigInt(e.unknown) !== 0n)
    held.push('a call with an unknown outcome is still held (settle it below)');
  if (BigInt(e.allocated) !== 0n)
    held.push('part of it is still moved to a child budget (close that first)');
  return held.length ? `It can't be closed yet: ${held.join('; ')}.` : null;
}

/**
 * Record kinds the Library offers to archive: things people curate by hand. Runs, specs,
 * products, artifacts, decisions, grants, sources, claims, scorecards and reviews change
 * through their own pages and lifecycles, so the Library leaves them alone.
 */
export const ARCHIVABLE_KINDS: readonly string[] = [
  'idea',
  'problem',
  'alternative',
  'assumption',
  'search_brief',
  'theme_intent',
];

/** Whether the Library offers "Archive" for this record and this member. */
export function canArchive(
  e: { kind: string; status: string },
  role: string,
): boolean {
  return (
    role !== 'viewer' &&
    e.status === 'active' &&
    ARCHIVABLE_KINDS.includes(e.kind)
  );
}
