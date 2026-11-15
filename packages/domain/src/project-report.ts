import { inlineText, RESPONSE_WORDS, urlText } from './proposal.js';
import { DISPOSITION_WORDS, redactText, type Redactions } from './runbook.js';
import { usd } from './analysis.js';

// ADR-0117 (F3): the project report. One Markdown file for a workspace, built only from its
// records: no model is called and nothing is stored. Every record string is escaped to one
// line (or fenced), credentials and personal folder paths are removed, and the file says which
// records are fixture (synthetic) data. It reports what the records say; it does not claim that
// anything was validated, carried out or works.

/** One quoted passage behind a claim, with where it is in its source. */
export interface ReportSource {
  source_id: string;
  source_version: number;
  title: string;
  url: string;
  stance: string;
  freshness: string;
  quote: string | null;
  /** "paragraph 3, characters 120–260", or null when no passage was recorded. */
  locator: string | null;
}
export interface ReportClaim {
  id: string;
  version: number;
  statement: string;
  basis: string | null;
  /** How the claim bears on the problem, or on the option named in `for_option`. */
  relation: 'supports' | 'contradicts';
  /** The option title a claim backs, when it is linked to an option rather than the problem. */
  for_option: string | null;
  evidence_status: string;
  labels: string[];
  sources: ReportSource[];
}
export interface ReportOption {
  id: string;
  version: number;
  title: string;
  kind: string;
  status: string;
  rationale: string;
  tradeoffs: string[];
  uncertainty: string;
  /** From the live comparison; null when the option is not in it (archived, or unscored). */
  rank: number | null;
  score: string | null;
  score_status: string | null;
  /** Reviewers who rated a criterion differently. */
  disagreements: { criterion: string; ratings: string[] }[];
  /** Ethics and access concerns raised, and whether they are cleared. */
  gates: { gate: string; state: string; concerns: string[] }[];
}
export interface ReportSelection {
  id: string;
  created_at: string;
  current: boolean;
  /** "a person (Jordan)", "the autopilot" … */
  by: string;
  rationale: string;
  override_reason: string | null;
  dispositions: {
    option_id: string;
    option_title: string;
    disposition: string;
    reasons: string[];
    reverse_if: string;
  }[];
}
export interface ReportProblem {
  id: string;
  version: number;
  status: string;
  title: string;
  statement: string;
  affected_group: string;
  uncertainty: string;
  claims: ReportClaim[];
  claims_omitted: number;
  options: ReportOption[];
  /** Why the live comparison could not be read, when it could not. */
  comparison_note: string | null;
  selections: ReportSelection[];
}
export interface ReportHumility {
  id: string;
  version: number;
  subject_id: string;
  subject_version: number;
  disposition: string;
  rationale: string;
  ethical_status: string;
  dissent: string[];
}
export interface ReportIntervention {
  at: string;
  /** Who acted, e.g. "Jordan (person)". */
  who: string;
  what: string;
  detail: string;
}
export interface ReportCheck {
  key: string;
  statement: string;
  method: string;
  /** Shown cases and held-out cases (never shown). */
  cases: number;
  held_out: number;
}
export interface ReportSpec {
  id: string;
  version: number;
  status: string;
  title: string;
  /** The latest freeze, and whether it is of the current version. */
  freeze: {
    version: number;
    at: string;
    content_hash: string;
    by: string;
  } | null;
  checks: ReportCheck[];
}
export interface ReportBuild {
  artifact_id: string;
  created_at: string;
  state: string;
  spec_id: string;
  spec_version: number;
  commit: string;
  recipe: string;
  fixture_roles: boolean;
  unqualified_trial: boolean;
  calls: number;
  repairs: number;
  qa: { key: string; passed: boolean; reason: string | null }[];
  package: { key: string; passed: boolean; reason: string | null }[];
  settled_nano: string;
  unsettled_attempts: number;
  plan_requests: number;
  limitations: string[];
  feedback: { category: string; status: string; text: string }[];
}
export interface ReportProposal {
  id: string;
  version: number;
  title: string;
  response: string;
  /** The newest review of any version, or null. */
  review: { version: number; verdict: string } | null;
}
export interface ReportMoney {
  /** Paid-request attempts by state, from the budget reservations. */
  attempts: Record<string, number>;
  /** Exact nano-USD, as decimal strings. */
  settled_nano: string;
  /** Upper bound still held by attempts whose outcome is unknown or in flight. */
  unknown_exposure_nano: string;
  unknown_attempts: number;
  in_flight_attempts: number;
  /** Attempts by provider (fixture, openai, brave …). */
  providers: Record<string, number>;
  envelopes: {
    name: string;
    kind: string;
    status: string;
    cap_nano: string;
    incurred_nano: string;
  }[];
  /** Plan-connection requests (no dollar cost; they use the plan's quota), by state. */
  plan_requests: Record<string, number>;
}
export interface ReportAutopilot {
  id: string;
  created_at: string;
  state: string;
  stage: string;
  outcome: string | null;
  explanation: string;
}
export interface ProjectReportInput {
  workspace: { id: string; name: string; record_mode: 'fixture' | 'real' };
  /** When the newest audit event in the workspace was written, or null. */
  records_as_of: string | null;
  generated_at: string;
  problems: ReportProblem[];
  problems_omitted: number;
  /** Active claims in the workspace that no listed problem or option section shows. */
  claims_not_listed: number;
  humility: ReportHumility[];
  interventions: ReportIntervention[];
  interventions_omitted: number;
  specs: ReportSpec[];
  builds: ReportBuild[];
  proposals: ReportProposal[];
  autopilots: ReportAutopilot[];
  money: ReportMoney;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const short = (id: string) => id.slice(0, 8);
const kindWords = (k: string) => RESPONSE_WORDS[k] ?? k.replaceAll('_', ' ');
const dispositionWords = (d: string) =>
  DISPOSITION_WORDS[d] ?? d.replaceAll('_', ' ');
const t = (s: string) => inlineText(s);
/** A recorded code word ("in_flight") as plain words. */
const w = (s: string) => inlineText(s.replaceAll('_', ' '));
/** Text without its closing full stop, so a sentence can follow it. */
const stop = (s: string) => s.replace(/[.\s]+$/u, '');
const dollars = (nano: string) => `$${usd(BigInt(nano))}`;

/** Every string in a JSON-like value with credentials and personal paths removed. */
function redactAll<T>(value: T, count: Redactions): T {
  if (typeof value === 'string') return redactText(value, count) as T;
  if (Array.isArray(value)) return value.map((v) => redactAll(v, count)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactAll(v, count)]),
    ) as T;
  return value;
}

/** A safe file name: the workspace name and the day the report was made. */
export function projectReportFileName(name: string, generatedAt: string) {
  const base =
    name
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '')
      .toLowerCase() || 'project';
  const n: Redactions = { secrets: 0, paths: 0 };
  redactText(base, n);
  return `${n.secrets || n.paths ? 'project' : base}-report-${generatedAt.slice(0, 10)}.md`;
}

function problemSection(p: ReportProblem, fixture: string): string[] {
  const out = [
    `## Problem: ${t(p.title)}`,
    '',
    `- Problem ${short(p.id)}, version ${p.version}${p.status === 'active' ? '' : ` (${t(p.status)})`}${fixture}`,
    `- Statement: ${t(p.statement) || '_not recorded_'}`,
    `- Affected users: ${t(p.affected_group) || '_not recorded_'}`,
    `- Uncertainty: ${t(p.uncertainty) || '_not recorded_'}`,
    '',
    '### Claims and evidence',
    '',
  ];
  if (!p.claims.length) out.push('No claims are linked to this problem.');
  for (const c of p.claims) {
    out.push(
      `- **${c.relation === 'contradicts' ? 'Contrary' : 'Supporting'} claim**${c.for_option ? ` for the option “${t(c.for_option)}”` : ''} ${short(c.id)} v${c.version}${c.basis ? ` (${t(c.basis)})` : ''}: ${t(c.statement)}`,
      `  - Evidence status: ${t(c.evidence_status)}${c.labels.length ? `; ${c.labels.map(t).join('; ')}` : ''}`,
    );
    if (!c.sources.length) out.push('  - No source rows are recorded.');
    for (const s of c.sources)
      out.push(
        `  - ${t(s.title) ? `${t(s.title)}: ` : ''}${urlText(s.url)} (source ${short(s.source_id)} v${s.source_version}; ${w(s.stance)}; ${w(s.freshness)}${s.locator ? `; ${t(s.locator)}` : '; no passage recorded'})${s.quote ? ` — “${t(s.quote)}”` : ''}`,
      );
  }
  if (p.claims_omitted)
    out.push(
      `- …and ${plural(p.claims_omitted, 'more claim')}, not listed here.`,
    );
  out.push('', '### Options compared', '');
  if (p.comparison_note) out.push(`_${t(p.comparison_note)}_`, '');
  if (!p.options.length) out.push('No options are recorded for this problem.');
  for (const o of p.options) {
    const score =
      o.rank !== null
        ? `rank ${o.rank}, score ${t(o.score ?? 'none')}`
        : o.score_status
          ? `not ranked (${t(o.score_status)})`
          : 'not in the current comparison';
    out.push(
      `- **${t(o.title)}** — ${kindWords(o.kind)}; option ${short(o.id)} v${o.version}${o.status === 'active' ? '' : ` (${t(o.status)})`}; ${score}`,
      `  - Rationale: ${t(o.rationale) || '_not recorded_'}`,
    );
    if (o.tradeoffs.length)
      out.push(`  - Trade-offs: ${o.tradeoffs.map(t).join('; ')}`);
    if (o.uncertainty) out.push(`  - Uncertainty: ${t(o.uncertainty)}`);
    for (const d of o.disagreements)
      out.push(
        `  - Reviewers disagree on ${t(d.criterion)}: ${d.ratings.map(t).join('; ')}`,
      );
    for (const g of o.gates.filter((x) => x.concerns.length))
      out.push(
        `  - ${t(g.gate)} gate ${w(g.state)}: ${g.concerns.map(t).join('; ')}`,
      );
  }
  out.push('', '### Selections', '');
  if (!p.selections.length) out.push('No selection is recorded.');
  for (const s of p.selections) {
    out.push(
      `- **Selection ${short(s.id)}** (${s.created_at}${s.current ? ', current' : ', replaced by a later one'}) by ${t(s.by)}: ${t(s.rationale)}`,
    );
    if (s.override_reason)
      out.push(`  - Override of the ranking: ${t(s.override_reason)}`);
    for (const d of s.dispositions)
      out.push(
        `  - ${t(stop(d.option_title))}: ${dispositionWords(d.disposition)}. Reasons: ${d.reasons.map((r) => t(stop(r))).join('; ')}. Would change if: ${t(d.reverse_if)}`,
      );
  }
  out.push('');
  return out;
}

/**
 * The report as Markdown, and how many credentials and paths were removed. Every string from
 * the records is redacted first, then escaped where it is written.
 */
export function projectReportMarkdown(raw: ProjectReportInput): {
  markdown: string;
  redactions: Redactions;
} {
  const redactions: Redactions = { secrets: 0, paths: 0 };
  const r = redactAll(raw, redactions);
  const isFixture = r.workspace.record_mode === 'fixture';
  const fixture = isFixture ? ' — **fixture (synthetic) record**' : '';
  const out: string[] = [`# Project report: ${t(r.workspace.name)}`, ''];
  if (isFixture)
    out.push(
      '> **Fixture workspace.** Every record in this report is synthetic test data from the studio’s fixture mode. None of it describes real people, sources, money or software.',
      '',
    );
  out.push(
    `- Workspace ${r.workspace.id} (${isFixture ? 'fixture' : 'real'} records)`,
    `- Records as of ${r.records_as_of ?? 'no recorded events'}; report made ${r.generated_at}`,
    '- Built from the studio’s records only. No model was asked to write it.',
    '',
    '_This report says what was recorded. A claim is what a source says, not a proven fact; a plan is not a result; a passing check shows only what that check tests._',
    '',
    '## Contents',
    '',
    '1. Problems: affected users, claims and evidence, options compared, selections',
    '2. Should-this-be-software reviews',
    '3. Human decisions and interventions',
    '4. Frozen specs and their cases',
    '5. Builds, reviews and QA',
    '6. Proposals',
    '7. Requests and money',
    '8. Limitations',
    '',
  );

  if (!r.problems.length)
    out.push('## Problems', '', 'No problems are recorded yet.', '');
  for (const p of r.problems) out.push(...problemSection(p, fixture));
  if (r.problems_omitted)
    out.push(
      `_…and ${plural(r.problems_omitted, 'more problem')}, not included._`,
      '',
    );

  out.push('## Should-this-be-software reviews', '');
  if (!r.humility.length) out.push('No humility review is recorded.');
  for (const h of r.humility) {
    out.push(
      `- **Review ${short(h.id)}** v${h.version} of ${short(h.subject_id)} v${h.subject_version}: ${kindWords(h.disposition)}; ethics ${w(h.ethical_status)}. ${t(h.rationale)}`,
    );
    for (const d of h.dissent) out.push(`  - Dissent: ${t(d)}`);
  }
  out.push('', '## Human decisions and interventions', '');
  out.push(
    'Where the work stopped for a person, and what people decided. Agent and system actions are not listed here.',
    '',
  );
  if (!r.interventions.length) out.push('No human decision is recorded.');
  for (const i of r.interventions)
    out.push(
      `- ${i.at} — ${t(i.who)}: ${t(i.detail ? stop(i.what) : i.what)}${i.detail ? `. ${t(i.detail)}` : ''}`,
    );
  if (r.interventions_omitted)
    out.push(
      `- …and ${plural(r.interventions_omitted, 'older one')}, not listed here.`,
    );
  if (r.autopilots.length) {
    out.push('', '### Autopilot runs', '');
    for (const a of r.autopilots)
      out.push(
        `- Autopilot ${short(a.id)} (${a.created_at}): ${a.state === 'finished' ? `finished, ${w(a.outcome ?? 'unknown')}` : `${t(a.state)}, at ${t(a.stage)}`}${a.explanation ? ` — ${t(a.explanation)}` : ''}`,
      );
  }

  out.push('', '## Frozen specs and their cases', '');
  if (!r.specs.length) out.push('No specification is recorded.');
  for (const s of r.specs) {
    const f = s.freeze;
    out.push(
      `### ${t(s.title)}`,
      '',
      `- Spec ${short(s.id)}, version ${s.version}${s.status === 'active' ? '' : ` (${t(s.status)})`}${fixture}`,
      f
        ? `- Frozen: version ${f.version} on ${f.at} by ${t(f.by)}, content hash ${f.content_hash}${f.version === s.version ? '' : ` — **the current version ${s.version} is not frozen**`}`
        : '- **Not frozen.** These requirements are a draft.',
      '',
    );
    if (s.checks.length) {
      out.push(
        '| Check | Method | Statement | Cases |',
        '| --- | --- | --- | --- |',
      );
      for (const c of s.checks)
        out.push(
          `| ${t(c.key)} | ${w(c.method)} | ${t(c.statement)} | ${c.cases + c.held_out ? `${c.cases} shown${c.held_out ? `, ${c.held_out} held out (not shown)` : ''}` : 'none'} |`,
        );
      out.push('');
    }
  }

  out.push('## Builds, reviews and QA', '');
  if (!r.builds.length) out.push('No build is recorded.', '');
  for (const b of r.builds) {
    const qaPassed = b.qa.filter((q) => q.passed).length;
    const pkgPassed = b.package.filter((q) => q.passed).length;
    out.push(
      `### Build ${short(b.artifact_id)} — ${t(b.state)}`,
      '',
      `- Built ${b.created_at} from spec ${short(b.spec_id)} v${b.spec_version}, commit ${t(b.commit)}, recipe ${t(b.recipe)}`,
      `- Roles: ${b.fixture_roles ? '**fixture roles (no model wrote this code)**' : 'model roles'}${b.unqualified_trial ? '; **unqualified trial** (the roles are not qualified for this recipe)' : ''}`,
      `- ${plural(b.calls, 'role request')}, ${plural(b.repairs, 'repair')} after review`,
      `- QA (frozen cases, including held-out ones): ${qaPassed} of ${b.qa.length} passed`,
      `- Package check (re-extracted package): ${pkgPassed} of ${b.package.length} passed`,
      `- Cost recorded in the manifest: ${dollars(b.settled_nano)} settled${b.unsettled_attempts ? `, ${plural(b.unsettled_attempts, 'attempt')} unsettled` : ''}${b.plan_requests ? `; ${plural(b.plan_requests, 'plan request')}` : ''}; local compute is not metered`,
    );
    for (const q of [...b.qa, ...b.package].filter((x) => !x.passed))
      out.push(`- Failed ${t(q.key)}: ${t(q.reason ?? 'no reason recorded')}`);
    for (const l of b.limitations) out.push(`- Limitation: ${t(l)}`);
    for (const fb of b.feedback)
      out.push(
        `- Feedback (${w(fb.category)}, ${t(fb.status)}): ${t(fb.text)}`,
      );
    out.push('');
  }

  out.push('## Proposals', '');
  if (!r.proposals.length) out.push('No proposal is recorded.');
  for (const p of r.proposals)
    out.push(
      `- **${t(p.title)}** — ${kindWords(p.response)}; proposal ${short(p.id)} v${p.version}; ${p.review ? `latest review: ${t(p.review.verdict)} (of version ${p.review.version})` : 'not reviewed'}`,
    );
  out.push('', '## Requests and money', '');
  const m = r.money;
  const attempts = Object.values(m.attempts).reduce((a, b) => a + b, 0);
  out.push(
    `From the workspace’s budget records${isFixture ? ' (fixture: no real money)' : ''}. Amounts are exact US dollars.`,
    '',
    `- Paid-request attempts: ${attempts}${
      attempts
        ? ` (${Object.entries(m.attempts)
            .map(([k, v]) => `${v} ${w(k)}`)
            .join(', ')})`
        : ''
    }`,
  );
  if (attempts)
    out.push(
      `- By provider: ${Object.entries(m.providers)
        .map(([k, v]) => `${t(k)} ${v}`)
        .join(', ')}`,
    );
  out.push(`- Settled spend: ${dollars(m.settled_nano)}`);
  if (m.unknown_attempts || m.in_flight_attempts)
    out.push(
      `- **Not settled:** ${plural(m.unknown_attempts, 'attempt')} with an unknown outcome and ${m.in_flight_attempts} in flight, holding up to ${dollars(m.unknown_exposure_nano)}. Unknown is not zero.`,
    );
  const plan = Object.values(m.plan_requests).reduce((a, b) => a + b, 0);
  out.push(
    `- Plan-connection requests: ${plan}${
      plan
        ? ` (${Object.entries(m.plan_requests)
            .map(([k, v]) => `${v} ${w(k)}`)
            .join(', ')})`
        : ''
    }. These have no dollar cost; they use the plan’s own quota.`,
  );
  if (m.envelopes.length) {
    out.push(
      '',
      '| Budget | Kind | Status | Cap | Incurred |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const e of m.envelopes)
      out.push(
        `| ${t(e.name)} | ${t(e.kind)} | ${t(e.status)} | ${dollars(e.cap_nano)} | ${dollars(e.incurred_nano)} |`,
      );
  }

  out.push('', '## Limitations', '');
  const limits: string[] = [];
  if (isFixture)
    limits.push(
      'Every record is fixture (synthetic) data; nothing here is evidence about the real world.',
    );
  limits.push(
    'The report shows records, not outcomes: no claim, plan or build here has been validated with real users by this report.',
    'Held-out test cases are counted but never shown.',
    'Local compute is not metered, so the money section covers only paid requests.',
    'Evidence freshness is computed when the report is made and can change later.',
  );
  const capped =
    r.problems_omitted +
    r.interventions_omitted +
    r.problems.reduce((n, p) => n + p.claims_omitted, 0);
  if (capped)
    limits.push(
      `Long lists are cut: ${plural(capped, 'record')} not listed (see the notes above).`,
    );
  if (r.claims_not_listed)
    limits.push(
      `${plural(r.claims_not_listed, 'claim is', 'claims are')} recorded but not listed, because ${r.claims_not_listed === 1 ? 'it is' : 'they are'} not linked to a listed problem or its options (or the list was cut). See Sources › Sources and claims.`,
    );
  if (m.unknown_attempts)
    limits.push(
      'Some paid attempts have an unknown outcome; the settled spend may be lower than the true cost.',
    );
  if (r.builds.some((b) => b.unqualified_trial))
    limits.push(
      'At least one build ran as an unqualified trial; its result says less about the route.',
    );
  if (redactions.secrets || redactions.paths)
    limits.push(
      `Removed from the records before writing: ${plural(redactions.secrets, 'credential')} and ${plural(redactions.paths, 'personal folder path')}.`,
    );
  for (const l of limits) out.push(`- ${l}`);
  return { markdown: `${out.join('\n')}\n`, redactions };
}
