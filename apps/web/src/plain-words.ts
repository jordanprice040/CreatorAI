// P-8 (final UX pass, accepted by Jordan on November 14): one label map for actions, record
// kinds and the codes that stored history lines carry, so the Standard view reads as words.
// Advanced keeps the stored text, ids and versions. Pure functions with no imports, so the
// rules load in tests without a browser.

/** What each admitted action does, in the words the pages use for it. */
export const ACTION_LABEL: Record<string, string> = {
  'record.revise': 'Revise a record',
  'assumption.log': 'Log an assumption',
  'model.generate': 'Model writing',
  'model.summarize': 'Model summaries',
  'model.embed': 'Model embeddings',
  'tool.search_public': 'Search the web',
  'source.fetch': 'Fetch sources',
  'candidate.select': 'Record a selection',
  'spec.freeze': 'Freeze a spec',
  'product.commit_build': 'Build',
  'release.publish': 'Publish a release',
  'message.send': 'Send a message',
  'payment.charge': 'Take a payment',
  'grant.create': 'Create an approval',
  'policy.change': 'Change a policy',
  'budget.increase': 'Raise a budget',
  'github.repo_create': 'Create a GitHub repository',
  'github.write': 'Write to GitHub',
  'github.workflow_change': 'Change a GitHub workflow',
  'github.merge': 'Merge on GitHub',
  'claim.admit': 'Add web claims',
};

/** Record kinds by the names the pages give them. Any other kind reads as its words. */
const KIND_LABEL: Record<string, string> = {
  alternative: 'option',
  specification: 'spec',
  envelope: 'budget',
  reservation: 'budget hold',
  admission: 'approval check',
  retrieval: 'fetch',
  claim_support: 'claim evidence',
  search_brief: 'brief',
  humility_review: 'humility review',
  grant: 'approval',
  routine_policy: 'routine approval',
  web_discovery: 'web search',
  web_discovery_claim: 'web claim',
};

/** Stored codes that read better as a phrase than as their words. */
const CODE_LABEL: Record<string, string> = {
  allow: 'allowed',
  request_human: 'needs your approval',
  deny: 'refused',
  covered: 'an approval covers it',
  outside_grant: 'no approval covers it',
  approve_once: 'approved once',
  approve_standing: 'approved for a while',
  human_in_loop: 'human-in-the-loop',
  human_led: 'human-led',
  use_existing: 'use an existing tool',
  change_process: 'change the process',
  not_recommended: 'not recommended',
  new_version: 'new version',
  source_assertion: 'the source says so',
  derived_from: 'from',
  part_of: 'part of',
};

const spaced = (code: string) => code.replace(/[._]+/g, ' ').trim();

/** A record kind in the pages' words ("alternative" → "option"). */
export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? spaced(kind);

/** An action type in plain words ("spec.freeze" → "Freeze a spec"). */
export const actionLabel = (action: string) =>
  ACTION_LABEL[action] ?? upperFirst(spaced(action));

/** Any stored code in plain words ("outside_grant" → "no approval covers it"). */
export const codeLabel = (code: string) =>
  CODE_LABEL[code] ?? ACTION_LABEL[code] ?? spaced(code);

function upperFirst(s: string) {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}

/** A history line in parts: text, and amounts to show as money. */
export type EventPart = string | { nano: string };

const DECIMAL = /^-?\d{1,15}\.\d{1,9}$/;
const NANO = 1_000_000_000n;

/** "0.05577" as nano units; the line's own amounts are exact decimals. */
function nanoOf(decimal: string) {
  const neg = decimal.startsWith('-');
  const [w, f] = decimal.replace(/^-/, '').split('.');
  const v = BigInt(w!) * NANO + BigInt(f!.padEnd(9, '0'));
  return (neg ? -v : v).toString();
}

/**
 * A stored history line (packages/db/src/store.ts `summarize`) in the Standard view's words:
 * version suffixes and internal codes give way to the pages' words, and amounts become parts
 * so they show in cents with the exact value on request (P-9). A line in no known shape keeps
 * its text, with any code in it spelled as words.
 */
export function plainEvent(summary: string): EventPart[] {
  const s = summary.trim();
  const k = kindLabel;
  let m: RegExpExecArray | null;
  // Older events kept their action code as their whole summary.
  if (/^[a-z_]+(\.[a-z_]+)+$/.test(s)) return [upperFirst(spaced(s))];
  if ((m = /^Created ([a-z_]+) v\d+$/.exec(s))) return [`Created ${k(m[1]!)}`];
  if ((m = /^Revised ([a-z_]+) to v\d+$/.exec(s)))
    return [`Revised ${k(m[1]!)}`];
  if ((m = /^Corrected ([a-z_]+) v\d+ with v\d+$/.exec(s)))
    return [`Corrected ${k(m[1]!)}`];
  if ((m = /^Archived ([a-z_]+) at v\d+$/.exec(s)))
    return [`Archived ${k(m[1]!)}`];
  if ((m = /^Redacted ([a-z_]+);/.exec(s))) return [`Redacted ${k(m[1]!)}`];
  if (
    (m =
      /^(Linked|Retracted link) ([a-z_]+) v\d+ ([a-z_]+) ([a-z_]+) v\d+$/.exec(
        s,
      ))
  )
    return [
      `${m[1] === 'Linked' ? 'Linked' : 'Unlinked'} ${k(m[2]!)} ${codeLabel(m[3]!)} ${k(m[4]!)}`,
    ];
  if ((m = /^(Created|Revised|Revoked|Consumed) ([a-z_]+) grant v\d+$/.exec(s)))
    return [`${m[1]} ${spaced(m[2]!)} approval`];
  if ((m = /^Action ([a-z_.]+): ([a-z_]+) \(([a-z_]+)\)$/.exec(s)))
    return [
      `${actionLabel(m[1]!)}: ${codeLabel(m[2]!)}${m[3] === m[2] ? '' : ` (${codeLabel(m[3]!)})`}`,
    ];
  if ((m = /^Answered decision: ([a-z_]+)$/.exec(s)))
    return [`Answered an approval: ${codeLabel(m[1]!)}`];
  if ((m = /^Requested ([a-z_]+) decision \(([a-z_]+)\)$/.exec(s)))
    return [`Asked for your ${spaced(m[1]!)} (${codeLabel(m[2]!)})`];
  if ((m = /^Closed decision as ([a-z_]+)$/.exec(s)))
    return [`Closed an approval request as ${codeLabel(m[1]!)}`];
  if ((m = /^Registered ([a-z_]+) run$/.exec(s)))
    return [`Registered a ${codeLabel(m[1]!)} run`];
  if (/^Fetch fetched \(new_version\); new source version$/.test(s))
    return ['Fetched a new version of a source'];
  if ((m = /^Fetch ([a-z_]+) \(([a-z_]+)\)(; new source version)?$/.exec(s)))
    return [
      `Fetch ${codeLabel(m[1]!)}${m[2] === m[1] ? '' : ` (${codeLabel(m[2]!)})`}${m[3] ? '; new source version' : ''}`,
    ];
  if (
    (m =
      /^Recorded ([a-z_]+) evidence \(([a-z_ ]+)\) for claim v\d+ from source v\d+$/.exec(
        s,
      ))
  )
    return [
      `Recorded ${m[1] === 'supports' ? 'supporting' : codeLabel(m[1]!)} evidence for a claim (${codeLabel(m[2]!)})`,
    ];
  if (
    (m =
      /^Changed the overall spending ceiling from \$(\S+) to \$(\S+) \(version \d+\)$/.exec(
        s,
      ))
  )
    return amounts(
      'Changed the overall spending ceiling from $',
      m[1]!,
      ' to $',
      m[2]!,
    );
  if (
    /^Changed the per-run and per-model spending limits \(version \d+\)$/.test(
      s,
    )
  )
    return ['Changed the per-run and per-model spending limits'];
  if (
    (m = /^(Funded|Allocated) ([a-z_]+) budget of (\S+)( \(simulated\))?$/.exec(
      s,
    ))
  )
    return amounts(`${m[1]} ${spaced(m[2]!)} budget of `, m[3]!, m[4] ?? '');
  if ((m = /^Closed budget; returned (\S+) to its parent$/.exec(s)))
    return amounts('Closed budget; returned ', m[1]!, ' to its parent');
  if ((m = /^Reserved (\S+) for ([a-z_.]+) attempt (\d+)$/.exec(s)))
    return amounts('Held ', m[1]!, ` for ${actionLabel(m[2]!).toLowerCase()}`);
  if ((m = /^Charged (\S+) of (\S+) reserved$/.exec(s)))
    return amounts('Charged ', m[1]!, ' of ', m[2]!, ' held');
  if ((m = /^Released (\S+) uncharged \(([a-z_]+)\)$/.exec(s)))
    return amounts('Released ', m[1]!, ` uncharged (${codeLabel(m[2]!)})`);
  if ((m = /^Holding (\S+) for an unknown outcome \(([a-z_]+)\)$/.exec(s)))
    return amounts(
      'Holding ',
      m[1]!,
      ` for an unknown outcome (${codeLabel(m[2]!)})`,
    );
  if ((m = /^Did not send ([a-z_.]+) \(([a-z_]+)\)$/.exec(s)))
    return [
      `Did not send: ${actionLabel(m[1]!).toLowerCase()} (${codeLabel(m[2]!)})`,
    ];
  if ((m = /^Registered ([a-z_]+) package for spec v\d+$/.exec(s)))
    return [`Registered a ${codeLabel(m[1]!)} package`];
  // Anything else: the stored wording, with codes in it as words.
  return [s.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (code) => codeLabel(code))];
}

/** Text and amount parts, in order; a part that is not an exact decimal stays text. */
function amounts(...pieces: string[]): EventPart[] {
  return pieces
    .map((p, i) => (i % 2 === 1 && DECIMAL.test(p) ? { nano: nanoOf(p) } : p))
    .filter((p) => p !== '');
}

/**
 * A record's version as a tag. The Standard view leaves out "v1", since a first version is
 * not news; "v2" and later still show, because they mark a revision (P-8).
 */
export const versionTag = (version: number, standard: boolean) =>
  standard && version <= 1 ? '' : `v${version}`;
