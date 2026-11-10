import { posix } from 'node:path';
import { createHash } from 'node:crypto';

/**
 * X10 full-product readiness. The register (config/readiness.json) records, per requirement
 * and per integration, which verification states were actually reached. These rules decide
 * the verdict deterministically: a row is ready only when every state it requires is
 * verified with evidence on disk, and the product is ready only when every row is ready and
 * the owner pilot has been run. Nothing here can mark itself verified; it only checks what
 * the register claims against the evidence paths and the requirement table.
 */
export const DIMENSIONS = [
  'implemented',
  'fixture',
  'contract',
  'live',
  'activated',
  'native',
] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export const STATES = [
  'verified',
  'not_verified',
  'deferred',
  'unsupported',
  'not_applicable',
] as const;
export type State = (typeof STATES)[number];

export interface ReadinessRow {
  id: string;
  title?: string;
  states: Record<Dimension, State>;
  required: Dimension[];
  evidence: string[];
  blocked_on: string | null;
}
export interface Register {
  schema: 'readiness/1';
  as_of: string;
  states_mean?: Record<Dimension, string>;
  requirements: ReadinessRow[];
  integrations: ReadinessRow[];
}

export interface OwnerPilot {
  schema: 'owner-pilot/1';
  status: 'not_started' | 'running' | 'stopped' | 'completed';
  decided_by: string | null;
  decided_at: string | null;
  budget_nano_usd: string | null;
  window: { starts_at: string | null; ends_at: string | null };
  schedules: unknown[] | null;
  enabled_accounts: string[];
  platforms: string[];
  /** Who recorded the pilot as completed, and when (set with status 'completed'). */
  finished_by?: string | null;
  finished_at?: string | null;
  stop_rules: {
    max_spend_nano_usd: string | null;
    max_consecutive_failures: number | null;
    max_owner_minutes: number | null;
    stop_on_unknown_cost: boolean;
  };
  evidence: string[];
}

export interface RowResult {
  id: string;
  ready: boolean;
  missing: Dimension[];
  blocked_on: string | null;
}
export interface ReadinessResult {
  verdict: 'ready' | 'not_ready';
  problems: string[];
  requirements: RowResult[];
  integrations: RowResult[];
  pilot: { ready: boolean; refusals: string[] };
  counts: Record<Dimension, Record<State, number>>;
  register_sha256: string;
}

/** Platforms the owner pilot may name, and the integration whose native state backs each. */
export const PILOT_PLATFORMS: Record<string, string | null> = {
  'local-web': null,
  'windows-desktop': 'windows-desktop',
  'wsl2-worker': 'wsl2-isolation',
  hosted: 'hosted-operation',
};

/** The pilot's own record; it cannot be its own evidence. */
export const PILOT_CONFIG = 'config/owner-pilot.json';

const NANO = /^(0|[1-9][0-9]{0,24})$/;
const ISO =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** An ISO time that names a real calendar date and clock time (no month 13, no Feb 30). */
function validTime(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const day = new Date(Date.UTC(y, m - 1, d));
  return (
    day.getUTCFullYear() === y &&
    day.getUTCMonth() === m - 1 &&
    day.getUTCDate() === d &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * A pilot evidence path in canonical repository-relative form, or null. Equivalent
 * spellings (`./x`, `a//b`, `a/./b`) normalise to one form so they compare equal.
 */
function pilotEvidencePath(p: unknown): string | null {
  if (typeof p !== 'string' || p.trim() === '' || p.includes('\\')) return null;
  if (p.startsWith('/')) return null;
  const n = posix.normalize(p).replace(/\/+$/, '');
  if (n === '.' || n === '' || n === '..' || n.startsWith('../')) return null;
  return n;
}

/** Requirement ids in the traceability table (context/REQUIREMENTS.md), in order. */
export function requirementIds(markdown: string): string[] {
  return [...markdown.matchAll(/^\| (C\d{2}) \|/gm)].map((m) => m[1]!);
}

function checkRow(
  kind: string,
  row: ReadinessRow,
  exists: (path: string) => boolean,
  problems: string[],
): RowResult {
  const at = `${kind} ${row.id}`;
  const states = row.states ?? ({} as ReadinessRow['states']);
  for (const d of DIMENSIONS)
    if (!STATES.includes(states[d]))
      problems.push(
        `${at}: state "${d}" is missing or not one of ${STATES.join(', ')}.`,
      );
  for (const k of Object.keys(states))
    if (!DIMENSIONS.includes(k as Dimension))
      problems.push(`${at}: unknown state "${k}".`);
  if (!Array.isArray(row.required) || row.required.length === 0)
    problems.push(`${at}: lists no required states.`);
  for (const d of row.required ?? []) {
    if (!DIMENSIONS.includes(d))
      problems.push(`${at}: unknown required state "${d}".`);
    else if (states[d] === 'not_applicable')
      problems.push(`${at}: "${d}" is required but marked not_applicable.`);
  }
  const evidence = Array.isArray(row.evidence) ? row.evidence : [];
  const verified = DIMENSIONS.filter((d) => states[d] === 'verified');
  if (verified.length > 0 && evidence.length === 0)
    problems.push(
      `${at}: claims ${verified.join(', ')} verified with no evidence.`,
    );
  for (const p of evidence) {
    if (
      typeof p !== 'string' ||
      p.startsWith('/') ||
      p.includes('..') ||
      p.includes('\\')
    )
      problems.push(
        `${at}: evidence path "${String(p)}" must be repository-relative.`,
      );
    else if (!exists(p))
      problems.push(`${at}: evidence "${p}" does not exist.`);
  }
  // A later state cannot stand on an earlier one that was never reached.
  const needs: [Dimension, Dimension][] = [
    ['fixture', 'implemented'],
    ['contract', 'implemented'],
    ['live', 'implemented'],
    ['native', 'implemented'],
    ['activated', 'live'],
  ];
  for (const [later, earlier] of needs)
    if (states[later] === 'verified' && states[earlier] !== 'verified')
      problems.push(`${at}: "${later}" verified but "${earlier}" is not.`);
  const missing = (row.required ?? []).filter((d) => states[d] !== 'verified');
  if (missing.length > 0 && !row.blocked_on)
    problems.push(
      `${at}: not ready (${missing.join(', ')}) but blocked_on is empty.`,
    );
  return {
    id: row.id,
    ready: missing.length === 0,
    missing,
    blocked_on: row.blocked_on ?? null,
  };
}

/**
 * The owner pilot's gate, with every refusal. Before it has finished, the plan is judged: it
 * may start only inside its window. Once `completed`, the record is judged instead: who
 * finished it and when (inside or after its window, not in the future), and evidence files
 * other than the pilot config itself.
 */
export function checkPilot(
  pilot: OwnerPilot,
  register: Register,
  isFile: (path: string) => boolean,
  now = new Date(),
): { ready: boolean; refusals: string[] } {
  const r: string[] = [];
  if (!pilot.decided_by || !pilot.decided_at)
    r.push(
      'Owner has not recorded the pilot decision (decided_by, decided_at).',
    );
  if (!pilot.budget_nano_usd || !NANO.test(pilot.budget_nano_usd))
    r.push('Owner has not chosen a pilot budget (exact nano-USD).');
  const s = pilot.stop_rules ?? ({} as OwnerPilot['stop_rules']);
  if (!s.max_spend_nano_usd || !NANO.test(s.max_spend_nano_usd))
    r.push('Stop rule max_spend_nano_usd is not set.');
  else if (
    pilot.budget_nano_usd &&
    NANO.test(pilot.budget_nano_usd) &&
    BigInt(s.max_spend_nano_usd) > BigInt(pilot.budget_nano_usd)
  )
    r.push('Stop rule max_spend_nano_usd exceeds the pilot budget.');
  if (
    !Number.isInteger(s.max_consecutive_failures) ||
    (s.max_consecutive_failures ?? 0) < 1
  )
    r.push('Stop rule max_consecutive_failures is not set.');
  if (!Number.isInteger(s.max_owner_minutes) || (s.max_owner_minutes ?? 0) < 1)
    r.push('Stop rule max_owner_minutes is not set.');
  if (s.stop_on_unknown_cost !== true)
    r.push(
      'Stop rule stop_on_unknown_cost must be true: unknown billing is not zero.',
    );
  const start = pilot.window?.starts_at;
  const end = pilot.window?.ends_at;
  if (!validTime(start) || !validTime(end))
    r.push('Owner has not chosen the pilot window (starts_at, ends_at).');
  else if (Date.parse(end) <= Date.parse(start))
    r.push('Pilot window ends before it starts.');
  // A pilot that has not finished cannot run outside its window; a completed one is
  // judged by its evidence instead, since its window has necessarily passed.
  else if (pilot.status !== 'completed' && Date.parse(end) <= now.getTime())
    r.push('Pilot window has already ended.');
  // null means not chosen; [] is the owner's choice of manual runs only (decision #29).
  if (!Array.isArray(pilot.schedules))
    r.push(
      'Owner has not chosen pilot schedules (use [] for manual runs only).',
    );
  if (!Array.isArray(pilot.platforms) || pilot.platforms.length === 0)
    r.push('Owner has not chosen supported platforms.');
  const integration = new Map(register.integrations.map((i) => [i.id, i]));
  for (const p of pilot.platforms ?? []) {
    if (!(p in PILOT_PLATFORMS)) {
      r.push(`Platform "${p}" is not one this studio supports.`);
      continue;
    }
    const backing = PILOT_PLATFORMS[p];
    const row = backing ? integration.get(backing) : null;
    if (
      backing &&
      (!row || !row.required.every((d) => row.states[d] === 'verified'))
    )
      r.push(`Platform "${p}" is not verified ready (${backing}).`);
  }
  if (
    !Array.isArray(pilot.enabled_accounts) ||
    pilot.enabled_accounts.length === 0
  )
    r.push('Owner has not chosen which accounts the pilot may use.');
  for (const a of pilot.enabled_accounts ?? []) {
    const row = integration.get(a);
    if (!row) r.push(`Account "${a}" is not an integration in the register.`);
    else if (row.states.live !== 'verified')
      r.push(`Account "${a}" has no verified live path.`);
    else if (row.states.activated !== 'verified')
      r.push(`Account "${a}" has not been activated by the owner.`);
  }
  if (pilot.status === 'completed') {
    if (
      typeof pilot.finished_by !== 'string' ||
      pilot.finished_by.trim() === ''
    )
      r.push('Pilot marked completed without who finished it (finished_by).');
    const fin = pilot.finished_at;
    if (!validTime(fin))
      r.push('Pilot marked completed without a finish time (finished_at).');
    else if (validTime(start) && Date.parse(fin) < Date.parse(start))
      r.push('Pilot finished before its window started.');
    else if (Date.parse(fin) > now.getTime())
      r.push('Pilot finish time is in the future.');
    if (!Array.isArray(pilot.evidence) || pilot.evidence.length === 0)
      r.push('Pilot marked completed without evidence.');
    for (const p of Array.isArray(pilot.evidence) ? pilot.evidence : []) {
      const path = pilotEvidencePath(p);
      if (path === null)
        r.push(
          `Pilot evidence path "${String(p)}" must be a repository-relative file path.`,
        );
      // Case-insensitive: Windows and macOS file systems treat these spellings as one file.
      else if (path.toLowerCase() === PILOT_CONFIG.toLowerCase())
        r.push(`Pilot evidence cannot be the pilot config itself (${p}).`);
      else if (!isFile(path))
        r.push(`Pilot evidence "${p}" is not a file in the repository.`);
    }
  }
  return { ready: r.length === 0, refusals: r };
}

export function evaluateReadiness(
  register: Register,
  pilot: OwnerPilot,
  requirementsMarkdown: string,
  exists: (path: string) => boolean,
  isFile: (path: string) => boolean,
  registerBytes: string,
  now = new Date(),
): ReadinessResult {
  const problems: string[] = [];
  if (register.schema !== 'readiness/1')
    problems.push('Register schema must be readiness/1.');
  const want = requirementIds(requirementsMarkdown);
  const have = register.requirements.map((r) => r.id);
  for (const id of want)
    if (!have.includes(id))
      problems.push(`Requirement ${id} has no readiness row.`);
  for (const id of have)
    if (!want.includes(id))
      problems.push(`Readiness row ${id} is not in the requirement table.`);
  for (const list of [have, register.integrations.map((i) => i.id)]) {
    const dup = list.filter((id, i) => list.indexOf(id) !== i);
    for (const id of new Set(dup))
      problems.push(`Duplicate readiness row ${id}.`);
  }
  const requirements = register.requirements.map((r) =>
    checkRow('requirement', r, exists, problems),
  );
  const integrations = register.integrations.map((r) =>
    checkRow('integration', r, exists, problems),
  );
  const pilotResult = checkPilot(pilot, register, isFile, now);
  const counts = Object.fromEntries(
    DIMENSIONS.map((d) => [
      d,
      Object.fromEntries(
        STATES.map((s) => [
          s,
          [...register.requirements, ...register.integrations].filter(
            (r) => r.states?.[d] === s,
          ).length,
        ]),
      ),
    ]),
  ) as ReadinessResult['counts'];
  const ready =
    problems.length === 0 &&
    requirements.every((r) => r.ready) &&
    integrations.every((r) => r.ready) &&
    pilot.status === 'completed' &&
    pilotResult.ready;
  return {
    verdict: ready ? 'ready' : 'not_ready',
    problems,
    requirements,
    integrations,
    pilot: pilotResult,
    counts,
    register_sha256: createHash('sha256').update(registerBytes).digest('hex'),
  };
}

/** The readiness report as Markdown, bound to the commit and register hash it was made from. */
export function readinessMarkdown(
  result: ReadinessResult,
  register: Register,
  commit: string,
): string {
  const label = (rows: ReadinessRow[], res: RowResult[]) =>
    rows.map((row, i) => {
      const r = res[i]!;
      const cells = DIMENSIONS.map((d) => {
        const s = row.states[d];
        const mark =
          s === 'verified'
            ? 'yes'
            : s === 'not_applicable'
              ? '–'
              : s.replace('_', ' ');
        return row.required.includes(d) ? `**${mark}**` : mark;
      });
      return `| ${row.id} | ${row.title ?? ''} | ${cells.join(' | ')} | ${r.ready ? 'ready' : 'not ready'} |`;
    });
  const head = `| ID | What | ${DIMENSIONS.join(' | ')} | Row |\n| --- | --- | ${DIMENSIONS.map(() => '---').join(' | ')} | --- |`;
  const blockers = [...result.requirements, ...result.integrations].filter(
    (r) => !r.ready,
  );
  return [
    '# Full-product readiness report',
    '',
    `Verdict: **${result.verdict === 'ready' ? 'READY' : 'NOT READY'}**. Generated from commit \`${commit}\`, register \`config/readiness.json\` (as of ${register.as_of}, sha256 \`${result.register_sha256}\`).`,
    '',
    'Bold cells are the states a row requires. "yes" means verified with the cited evidence; anything else is not verified. This report never upgrades a state: it only checks the register against evidence on disk and the requirement table.',
    '',
    result.problems.length
      ? `Register problems (${result.problems.length}):\n\n${result.problems.map((p) => `- ${p}`).join('\n')}`
      : 'Register problems: none.',
    '',
    '## Owner pilot',
    '',
    result.pilot.ready
      ? 'The pilot plan passes every gate.'
      : `The pilot may not start:\n\n${result.pilot.refusals.map((p) => `- ${p}`).join('\n')}`,
    '',
    `## Not ready (${blockers.length})`,
    '',
    ...blockers.map(
      (b) =>
        `- **${b.id}** needs ${b.missing.join(', ')}: ${b.blocked_on ?? ''}`,
    ),
    '',
    '## Requirements',
    '',
    head,
    ...label(register.requirements, result.requirements),
    '',
    '## Integrations',
    '',
    head,
    ...label(register.integrations, result.integrations),
    '',
  ].join('\n');
}
