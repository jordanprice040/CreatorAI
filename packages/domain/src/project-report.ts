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
  /** ADR-0138: choices whose gates the owner passed, with the reasons as they read then. */
  gate_overrides: {
    option_title: string;
    disposition: string;
    reasons: string[];
  }[];
  gate_override_reason: string | null;
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
  options_omitted: number;
  /** Why the live comparison could not be read, when it could not. */
  comparison_note: string | null;
  selections: ReportSelection[];
  selections_omitted: number;
}
export interface ReportHumility {
  id: string;
  version: number;
  subject_id: string;
  subject_version: number;
  /** The reviewed option's or spec's title, when it can still be read. */
  subject_title: string | null;
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
  /** The version's body did not parse, so its checks could not be listed. */
  checks_unreadable: boolean;
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
  feedback_omitted: number;
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
  /** Paid-request attempts by state, from the budget reservations; denied ones are not here. */
  attempts: Record<string, number>;
  /** Evaluations refused before anything was sent (denied reservations). */
  denied: number;
  /** Exact nano-units (US dollars, or simulated units in a fixture workspace). */
  settled_nano: string;
  /** Upper bound still held by attempts whose outcome is unknown or in flight. */
  unknown_exposure_nano: string;
  unknown_attempts: number;
  in_flight_attempts: number;
  /** Sent attempts by provider (fixture, openai, brave …). */
  providers: Record<string, number>;
  envelopes: {
    name: string;
    kind: string;
    status: string;
    cap_nano: string;
    incurred_nano: string;
  }[];
  /**
   * Every request through the workspace's plan connections (runs, builds, chat, verification,
   * qualification). No dollar cost; they use the plan's own quota.
   */
  plan_requests: {
    total: number;
    /** In flight or with an unknown outcome. */
    open: number;
    by_purpose: Record<string, number>;
    by_state: Record<string, number>;
  };
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
  humility_omitted: number;
  /** Artifact records with no package manifest, which the Builds list cannot show. */
  unpackaged_artifacts: number;
  /** Active product (catalog) records. They are not builds; the report does not cover them. */
  product_records: number;
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
const t = (s: string) => inlineText(s);
/** A recorded code word ("in_flight") as plain words, escaped like any record text. */
const w = (s: string) => inlineText(s.replaceAll('_', ' '));
// Known words come from fixed tables; anything else is record text and is escaped.
const kindWords = (k: string) => RESPONSE_WORDS[k] ?? w(k);
const dispositionWords = (d: string) => DISPOSITION_WORDS[d] ?? w(d);
/** Text without its closing full stop, so a sentence can follow it. */
const stop = (s: string) => s.replace(/[.\s]+$/u, '');
/** Two sentences joined; no full stop is added after a question or an exclamation. */
const sentences = (a: string, b: string) =>
  `${/[.?!]\s*$/u.test(a) ? a.trimEnd() : `${a}.`} ${b.charAt(0).toUpperCase()}${b.slice(1)}`;
/** Exact decimal with trailing zeros trimmed, keeping at least two places: 100.00, 0.69665. */
function exact(nano: string): string {
  const [whole, frac = ''] = usd(BigInt(nano)).split('.');
  return `${whole}.${frac.replace(/0+$/, '').padEnd(2, '0')}`;
}

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
  if (p.options_omitted)
    out.push(
      `- …and ${plural(p.options_omitted, 'more option')}, not listed here.`,
    );
  out.push('', '### Selections', '');
  if (!p.selections.length) out.push('No selection is recorded.');
  for (const s of p.selections) {
    out.push(
      `- **Selection ${short(s.id)}** (${s.created_at}${s.current ? ', current' : ', replaced by a later one'}) by ${t(s.by)}: ${t(s.rationale)}`,
    );
    if (s.override_reason)
      out.push(`  - Override of the ranking: ${t(s.override_reason)}`);
    if (s.gate_overrides.length) {
      out.push(
        `  - Owner override, gates passed without their checks. Reason: ${t(s.gate_override_reason ?? '')}`,
      );
      for (const g of s.gate_overrides)
        out.push(
          `    - ${t(stop(g.option_title))}, ${dispositionWords(g.disposition)}: ${g.reasons.map((r) => t(stop(r))).join('; ')}`,
        );
    }
    for (const d of s.dispositions)
      out.push(
        `  - ${t(stop(d.option_title))}: ${dispositionWords(d.disposition)}. Reasons: ${d.reasons.map((r) => t(stop(r))).join('; ')}. Would change if: ${t(d.reverse_if)}`,
      );
  }
  if (p.selections_omitted)
    out.push(
      `- …and ${plural(p.selections_omitted, 'older selection')}, not listed here.`,
    );
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
  // Fixture pricing is simulated: the app calls those amounts simulated units, not money.
  const money = (nano: string) =>
    isFixture ? `${exact(nano)} simulated units` : `$${exact(nano)}`;
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
      `- **Review ${short(h.id)}** v${h.version} of ${h.subject_title ? `“${t(h.subject_title)}” (${short(h.subject_id)} v${h.subject_version})` : `${short(h.subject_id)} v${h.subject_version}`}: ${kindWords(h.disposition)}; ethics ${w(h.ethical_status)}. ${t(h.rationale)}`,
    );
    for (const d of h.dissent) out.push(`  - Dissent: ${t(d)}`);
  }
  if (r.humility_omitted)
    out.push(
      `- …and ${plural(r.humility_omitted, 'older review')}, not listed here.`,
    );
  out.push('', '## Human decisions and interventions', '');
  out.push(
    'Where the work stopped for a person, and what people decided. Agent and system actions are not listed here.',
    '',
  );
  if (!r.interventions.length) out.push('No human decision is recorded.');
  for (const i of r.interventions)
    out.push(
      `- ${i.at} — ${t(i.who)}: ${i.detail ? sentences(t(i.what), t(i.detail)) : t(i.what)}`,
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
  if (!r.specs.length) out.push('No specification is recorded.', '');
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
    if (s.checks_unreadable)
      out.push(
        '_The checks of this version could not be read, so they are not listed. That does not mean it has none._',
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
  if (!r.builds.length)
    out.push('No packaged build (package manifest) is recorded.', '');
  const artifacts = r.unpackaged_artifacts;
  if (artifacts)
    out.push(
      `${plural(artifacts, 'artifact is', 'artifacts are')} recorded without a package manifest (for example a build that stopped before packaging), so ${artifacts === 1 ? 'it is' : 'they are'} not listed here. See Projects › Build.`,
      '',
    );
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
      `- Cost recorded in the manifest: ${money(b.settled_nano)} settled${b.unsettled_attempts ? `, ${plural(b.unsettled_attempts, 'attempt')} unsettled` : ''}${b.plan_requests ? `; ${plural(b.plan_requests, 'plan request')}` : ''}; local compute is not metered`,
    );
    for (const q of [...b.qa, ...b.package].filter((x) => !x.passed))
      out.push(`- Failed ${t(q.key)}: ${t(q.reason ?? 'no reason recorded')}`);
    for (const l of b.limitations) out.push(`- Limitation: ${t(l)}`);
    for (const fb of b.feedback)
      out.push(
        `- Feedback (${w(fb.category)}, ${t(fb.status)}): ${t(fb.text)}`,
      );
    if (b.feedback_omitted)
      out.push(
        `- …and ${plural(b.feedback_omitted, 'more feedback item')}, not listed here.`,
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
  const listed = (x: Record<string, number>) =>
    Object.entries(x)
      .map(([k, v]) => `${v} ${w(k)}`)
      .join(', ');
  out.push(
    isFixture
      ? 'From the workspace’s budget records. This is a fixture workspace: amounts are simulated units, not money.'
      : 'From the workspace’s budget records. Amounts are exact US dollars.',
    '',
    `- Paid-request attempts sent: ${attempts}${attempts ? ` (${listed(m.attempts)})` : ''}`,
  );
  if (attempts)
    out.push(
      `- By provider: ${Object.entries(m.providers)
        .map(([k, v]) => `${t(k)} ${v}`)
        .join(', ')}`,
    );
  if (m.denied)
    out.push(
      `- Refused before sending: ${m.denied} (not counted as attempts; nothing was spent)`,
    );
  out.push(`- Settled spend: ${money(m.settled_nano)}`);
  if (m.unknown_attempts || m.in_flight_attempts)
    out.push(
      `- **Not settled:** ${plural(m.unknown_attempts, 'attempt')} with an unknown outcome and ${m.in_flight_attempts} in flight, holding up to ${money(m.unknown_exposure_nano)}. Unknown is not zero.`,
    );
  const pr = m.plan_requests;
  out.push(
    `- Plan-connection requests through this workspace’s connections: ${pr.total}${pr.total ? ` (by purpose: ${listed(pr.by_purpose)}; by state: ${listed(pr.by_state)})` : ''}. These have no dollar cost; they use the plan’s own quota.`,
  );
  if (pr.open)
    out.push(
      `- **${plural(pr.open, 'plan request')} in flight or with an unknown outcome.** ${pr.open === 1 ? 'It' : 'They'} may still use quota.`,
    );
  if (m.envelopes.length) {
    out.push(
      '',
      '| Budget | Kind | Status | Cap | Incurred |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const e of m.envelopes)
      out.push(
        `| ${t(e.name)} | ${t(e.kind)} | ${t(e.status)} | ${money(e.cap_nano)} | ${money(e.incurred_nano)} |`,
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
    'Local compute is not metered, so the money section covers only paid requests and plan-request counts.',
    'Evidence freshness is computed when the report is made and can change later.',
    'Option ranks and scores are read just after the rest of the records, so a change made in that moment can show in one and not the other.',
  );
  const capped =
    r.problems_omitted +
    r.interventions_omitted +
    r.humility_omitted +
    r.problems.reduce(
      (n, p) => n + p.claims_omitted + p.options_omitted + p.selections_omitted,
      0,
    ) +
    r.builds.reduce((n, b) => n + b.feedback_omitted, 0);
  if (capped)
    limits.push(
      `Long lists are cut: ${plural(capped, 'record')} not listed (see the notes above).`,
    );
  if (r.claims_not_listed)
    limits.push(
      `${plural(r.claims_not_listed, 'claim is', 'claims are')} recorded but not listed, because ${r.claims_not_listed === 1 ? 'it is' : 'they are'} not linked to a listed problem or its options (or the list was cut). See Sources › Sources and claims.`,
    );
  if (r.product_records)
    limits.push(
      `${plural(r.product_records, 'product record (catalog)', 'product records (catalog)')} ${r.product_records === 1 ? 'is' : 'are'} not covered by this report.`,
    );
  if (r.specs.some((x) => x.checks_unreadable))
    limits.push(
      'The checks of at least one spec could not be read and are not listed.',
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
