import {
  ADVANCING_DISPOSITIONS,
  CORE_PROPOSAL_SECTIONS,
  PROPOSAL_SECTIONS,
  PROPOSAL_SECTION_LABELS,
  PROPOSAL_MAX_CITED_CLAIMS,
  PROPOSAL_SECTION_MAX,
  SUITABILITY_RUBRIC,
  type HumilityBody,
  type ProposalBody,
  type ProposalCheck,
  type ProposalChecks,
  type ProposalReference,
  type ProposalSection,
  type ProposalSectionBody,
  type RankedCandidate,
  type ResponseExplanation,
  type ScorecardBody,
  type Selection,
  type SelectionReport,
  type SoftwareAvenue,
} from '@creator/contracts';
import type { HumilityVerdict } from './oversight.js';

// ADR-0077 (P09). Everything here is deterministic over recorded data: the explanation of why a
// response was chosen, a proposal draft filled only from records (the rest marked unknown),
// the checks of a proposal version, and its Markdown export. No model is involved and nothing
// here claims that a plan was carried out or works.

const SOFTWARE = ['build', 'hybrid'];
export const RESPONSE_WORDS: Record<string, string> = {
  build: 'custom software',
  hybrid: 'a hybrid (software with people or process)',
  use_existing: 'an existing tool',
  change_process: 'a process change',
  human_led: 'a human-led response',
  investigate: 'further investigation',
  defer: 'deferring',
  decline: 'declining',
  failed: 'a failed outcome',
};
const words = (kind: string) =>
  RESPONSE_WORDS[kind] ?? kind.replaceAll('_', ' ');
const clip = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

// ---- Response explanation ---------------------------------------------------------------

export interface ExplainInput {
  report: SelectionReport;
  /** The problem's current selection, if any. */
  selection: Selection | null;
  /** Each option's recorded rationale, by id (lower case). */
  rationales: ReadonlyMap<string, string>;
  /** Scorecard bodies by id (lower case); only the report's counted cards are read. */
  cards: ReadonlyMap<string, ScorecardBody>;
  /** The newest active humility review of each software or hybrid option, by option id. */
  reviews: ReadonlyMap<
    string,
    {
      id: string;
      version: number;
      body: HumilityBody;
      verdict: HumilityVerdict;
    }
  >;
}

/** Mean rating per criterion over the candidate's counted cards; null when nobody rated it. */
function criterionMeans(
  c: RankedCandidate | undefined,
  cards: ReadonlyMap<string, ScorecardBody>,
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const counted = (c?.scorecards ?? [])
    .filter((s) => !s.stale && !s.superseded_by)
    .map((s) => cards.get(s.id.toLowerCase()))
    .filter((b): b is ScorecardBody => !!b && b.rubric === 'suitability');
  for (const k of SUITABILITY_RUBRIC.criteria) {
    const rs = counted
      .map((b) => b.ratings[k.key]?.rating ?? null)
      .filter((r): r is number => r !== null);
    out[k.key] = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
  }
  return out;
}
const shown = (r: number | null) => (r === null ? null : r.toFixed(1));

export function explainResponse(input: ExplainInput): ResponseExplanation {
  const { report, selection } = input;
  const opp = new Map(
    report.opportunity.candidates.map((c) => [
      c.alternative.id.toLowerCase(),
      c,
    ]),
  );
  const decided = new Map(
    (selection?.dispositions ?? []).map((d) => [
      d.alternative.id.toLowerCase(),
      d,
    ]),
  );
  const option = (c: RankedCandidate) => {
    const key = c.alternative.id.toLowerCase();
    const d = decided.get(key);
    return {
      alternative: c.alternative,
      software: SOFTWARE.includes(c.alternative.kind),
      status: c.status,
      rank: c.rank,
      score: c.score?.display ?? null,
      disposition: d?.disposition ?? null,
      reasons: d?.reasons ?? [],
      reverse_if: d?.reverse_if ?? null,
      rationale: input.rationales.get(key) ?? null,
    };
  };
  const all = report.suitability.candidates;
  const basis: ResponseExplanation['basis'] = selection
    ? 'selection'
    : all.some((c) => c.rank === 1)
      ? 'ranking'
      : 'none';
  const chosenCands =
    basis === 'selection'
      ? all.filter((c) => {
          const d = decided.get(c.alternative.id.toLowerCase());
          return !!d && ADVANCING_DISPOSITIONS.includes(d.disposition);
        })
      : basis === 'ranking'
        ? all.filter((c) => c.rank === 1)
        : [];
  // Best ranked first; the first is the one others are compared against.
  chosenCands.sort(
    (a, b) =>
      (a.rank ?? 1e9) - (b.rank ?? 1e9) ||
      (a.alternative.id < b.alternative.id ? -1 : 1),
  );
  const chosenIds = new Set(
    chosenCands.map((c) => c.alternative.id.toLowerCase()),
  );
  const chosen = chosenCands.map(option);
  const leader = chosenCands[0];
  const leaderMeans = criterionMeans(leader, input.cards);
  const kinds = [...new Set(chosenCands.map((c) => c.alternative.kind))];
  const response = kinds.length ? kinds.map(words).join(' and ') : 'none yet';
  const non_code =
    kinds.length > 0 && kinds.every((k) => !SOFTWARE.includes(k));

  const softwareCands = all.filter(
    (c) =>
      SOFTWARE.includes(c.alternative.kind) &&
      !chosenIds.has(c.alternative.id.toLowerCase()),
  );
  const software_avenues: SoftwareAvenue[] = softwareCands.map((c) => {
    const key = c.alternative.id.toLowerCase();
    const means = criterionMeans(c, input.cards);
    const behind_on: SoftwareAvenue['behind_on'] = [];
    const unknown: SoftwareAvenue['unknown'] = [];
    const scored = c.status !== 'unscored';
    for (const k of SUITABILITY_RUBRIC.criteria) {
      const gap = {
        criterion: k.key,
        label: k.label,
        rating: shown(means[k.key] ?? null),
        leader_rating: shown(leaderMeans[k.key] ?? null),
        top_anchor: k.anchors[5],
      };
      if (means[k.key] === null) {
        if (scored) unknown.push(gap);
      } else if (
        leader &&
        leaderMeans[k.key] !== null &&
        means[k.key]! < leaderMeans[k.key]!
      )
        behind_on.push(gap);
    }
    const gated = opp.get(key) ?? c;
    const blockers = [
      ...new Set(gated.gates.blocked.select_for_build ?? []),
    ].slice(0, 12);
    const r = input.reviews.get(key);
    const would: string[] = [];
    if (!scored)
      would.push(
        'A suitability score of its current version: it has none, so it cannot be compared yet.',
      );
    for (const g of behind_on)
      would.push(
        `Evidence that raises ${g.label} from ${g.rating} to above ${g.leader_rating} (a 5 means: ${g.top_anchor}).`,
      );
    for (const g of unknown)
      would.push(
        `A rating for ${g.label}, which is unknown now (unknown is not a neutral score).`,
      );
    for (const b of blockers) would.push(`Clear this: ${b}`);
    if (r) {
      would.push(
        `The humility review's change-course trigger happens: ${r.body.change_course_trigger}`,
      );
      would.push(
        `Its disconfirming test is tried and does not disconfirm: ${r.body.disconfirming_test}`,
      );
    }
    return {
      option: option(c),
      behind_on,
      unknown,
      blockers,
      humility: r
        ? {
            review: { id: r.id, version: r.version },
            state: r.verdict.build_admissible
              ? 'passing'
              : r.verdict.needs_judgment
                ? 'needs_judgment'
                : 'failing',
            software_part: r.body.software_part,
            human_part: r.body.human_part,
            change_course_trigger: r.body.change_course_trigger,
            disconfirming_test: r.body.disconfirming_test,
            reasons: r.verdict.reasons.slice(0, 12),
          }
        : null,
      would_prefer_if: would.slice(0, 30).map((w) => clip(w, 600)),
    };
  });
  const others = all
    .filter(
      (c) =>
        !SOFTWARE.includes(c.alternative.kind) &&
        !chosenIds.has(c.alternative.id.toLowerCase()),
    )
    .map(option);
  const criteria = SUITABILITY_RUBRIC.criteria.map((k) => ({
    criterion: k.key,
    label: k.label,
    ratings: Object.fromEntries(
      [...chosenCands, ...softwareCands].map((c) => [
        c.alternative.id,
        shown(criterionMeans(c, input.cards)[k.key] ?? null),
      ]),
    ),
  }));

  // One paragraph, in words, from the same facts.
  const parts: string[] = [];
  const place = (c: RankedCandidate) =>
    c.rank !== null
      ? `suitability rank ${c.rank}${c.score ? `, ${c.score.display}` : ''}`
      : c.status === 'unscored'
        ? 'not scored'
        : 'incomplete scores, not ranked';
  if (basis === 'none')
    parts.push(
      'No option is ranked or selected yet, so there is nothing to explain.',
    );
  else if (!leader)
    parts.push(
      'The current selection advanced no option (it chose research, defer or reject).',
    );
  else {
    parts.push(
      `${basis === 'selection' ? 'The recorded selection advances' : 'No selection is recorded yet; the top-ranked option is'} ${response}: ${chosenCands
        .map((c) => `“${c.alternative.title}” (${place(c)})`)
        .join(', ')}.`,
    );
    if (chosenCands.length > 1 && basis === 'ranking')
      parts.push('They tie; the tie is not broken automatically.');
  }
  if (leader && softwareCands.length === 0 && non_code)
    parts.push(
      'No software or hybrid option was proposed for this problem, so there is no software route to compare; add one if a software-assisted route seems plausible.',
    );
  for (const a of software_avenues) {
    const c = softwareCands.find(
      (x) => x.alternative.id === a.option.alternative.id,
    )!;
    const bits = [
      `${words(c.alternative.kind)} “${c.alternative.title}” is at ${place(c)}`,
    ];
    if (a.behind_on.length)
      bits.push(
        `behind on ${a.behind_on.map((g) => g.label.toLowerCase()).join(', ')}`,
      );
    if (a.unknown.length)
      bits.push(
        `unknown on ${a.unknown.map((g) => g.label.toLowerCase()).join(', ')}`,
      );
    if (a.blockers.length)
      bits.push(
        `${a.blockers.length} gate${a.blockers.length > 1 ? 's' : ''} open`,
      );
    const line = bits.join('; ');
    parts.push(`${line[0]!.toUpperCase()}${line.slice(1)}.`);
  }
  const notes = [
    'Built by application code from the recorded scores, gates, humility reviews and selection; it is not a model’s judgment.',
    'Unknown ratings stay unknown: they count neither for nor against an option.',
    'Software influence belongs to the opportunity rubric only; it does not count toward suitability, so it cannot tilt this comparison toward code.',
  ];
  if (selection && selection.report_hash !== report.report_hash)
    notes.push(
      'Scores or gates changed since the selection was recorded; the comparison above uses today’s report.',
    );
  return {
    explanation_version: 'response-explanation/1',
    problem: report.problem,
    basis,
    selection: selection
      ? {
          id: selection.id,
          created_at: selection.created_at,
          rationale: selection.rationale,
          report_changed: selection.report_hash !== report.report_hash,
        }
      : null,
    chosen,
    response: clip(response, 60),
    non_code,
    summary: clip(parts.join(' '), 1500),
    criteria,
    software_avenues,
    others,
    notes,
  };
}

// ---- Proposal draft ---------------------------------------------------------------------

export interface DraftInput {
  problem: {
    id: string;
    version: number;
    title: string;
    body: Record<string, unknown> | null;
  };
  option: {
    id: string;
    version: number;
    title: string;
    body: Record<string, unknown> | null;
  };
  response: ProposalBody['response'];
  selection: Selection;
  /** Claims linked to the problem now, with their relation. */
  claims: readonly {
    id: string;
    version: number;
    statement: string;
    relation: 'supports' | 'contradicts';
  }[];
  explanation: ResponseExplanation | null;
}
const unknown = (text: string): ProposalSectionBody => ({
  state: 'unknown',
  text,
  claims: [],
});
const written = (
  text: string,
  claims: { id: string; version: number }[] = [],
) =>
  ({
    state: 'written',
    text: clip(text, PROPOSAL_SECTION_MAX),
    claims,
  }) satisfies ProposalSectionBody;
/** One line of text from a record: no line breaks or control characters (review L-4). */
const oneLine = (s: string) => s.replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').trim();
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** A title ending a sentence: no doubled full stop. */
const end = (t: string) => t.replace(/[.\s]+$/, '');

/** A first version filled only from the records; everything else is marked unknown. */
export function draftProposal(input: DraftInput): {
  title: string;
  body: ProposalBody;
} {
  const p = input.problem.body ?? {};
  const o = input.option.body ?? {};
  const choice = input.selection.dispositions.find(
    (d) => d.alternative.id.toLowerCase() === input.option.id.toLowerCase(),
  );
  const supports = input.claims
    .filter((c) => c.relation === 'supports')
    .slice(0, 20);
  const contrary = input.claims
    .filter((c) => c.relation === 'contradicts')
    .slice(0, 20);
  // Review L-1: the draft cites claims; it never copies their statements into the text, so a
  // later redaction of a claim reaches every saved version through the References.
  const cites = (n: number, what: string) =>
    `${n} ${what} claim${n === 1 ? ' is' : 's are'} cited here; their statements, sources and current evidence status are listed under References.`;
  const tradeoffs = Array.isArray(o.tradeoffs)
    ? (o.tradeoffs as unknown[]).map(str).filter(Boolean)
    : [];
  const avenues = input.explanation?.software_avenues ?? [];
  const assumptions = [
    ...(choice?.reverse_if
      ? [`- The selection would be reversed if: ${choice.reverse_if}`]
      : []),
    ...avenues.flatMap((a) =>
      a.would_prefer_if
        .slice(0, 3)
        .map(
          (w) =>
            `- “${a.option.alternative.title}” would become preferable if: ${w}`,
        ),
    ),
  ];
  const limits = [str(p.uncertainty), str(o.uncertainty)].filter(Boolean);
  const sections: Record<ProposalSection, ProposalSectionBody> = {
    problem_users: written(
      [
        str(p.statement) || input.problem.title,
        str(p.affected_group) && `Affected group: ${str(p.affected_group)}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
    background: written(
      [
        `Selected response: ${words(input.response)} — ${end(input.option.title)}.`,
        str(o.rationale),
        choice?.reasons.length
          ? `Why it was selected:\n${choice.reasons.map((r) => `- ${r}`).join('\n')}`
          : '',
        input.selection.rationale
          ? `Selection rationale: ${input.selection.rationale}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
    objectives: unknown(
      'State the outcome this should change, for whom, and how it will be measured.',
    ),
    evidence: supports.length
      ? written(
          cites(supports.length, 'supporting'),
          supports.map((c) => ({ id: c.id, version: c.version })),
        )
      : unknown(
          'No supporting claim is linked to this problem yet; link evidence in Sources and claims.',
        ),
    contrary_evidence: contrary.length
      ? written(
          cites(contrary.length, 'contrary'),
          contrary.map((c) => ({ id: c.id, version: c.version })),
        )
      : unknown(
          'No contrary claim is linked to this problem; that does not show there is none.',
        ),
    methods: unknown(
      'Describe the step-by-step procedure: who does what, in what order, with which tools.',
    ),
    materials: unknown(
      'List the materials, tools, data and other resources needed.',
    ),
    roles: unknown(
      'Name the roles (not people’s private details) and what each is responsible for.',
    ),
    timeline: unknown('Give the stages and their expected durations.'),
    costs: unknown(
      'Estimate the costs; a cost nobody knows stays unknown, not zero.',
    ),
    evaluation: unknown(
      [
        'Say how success will be tested and what result would count as failure.',
        choice?.reverse_if
          ? `The selection said it would reverse if: ${choice.reverse_if}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
    ethics_risks: unknown(
      [
        'Confirm the ethics, access and risk points.',
        tradeoffs.length
          ? `Trade-offs recorded with the option:\n${tradeoffs.map((t) => `- ${t}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    ),
    limitations: limits.length
      ? written(limits.join('\n\n'))
      : unknown('State what this proposal does not cover.'),
    assumptions: assumptions.length
      ? written(assumptions.join('\n'))
      : unknown(
          'List the assumptions that, if wrong, would change the decision.',
        ),
    next_tasks: unknown('List the next concrete tasks.'),
  };
  return {
    title: clip(`Proposal: ${oneLine(input.option.title)}`, 300),
    body: {
      format: 'proposal/1',
      problem: { id: input.problem.id, version: input.problem.version },
      alternative: { id: input.option.id, version: input.option.version },
      response: input.response,
      selection_id: input.selection.id,
      summary: clip(
        `${words(input.response)[0]!.toUpperCase()}${words(input.response).slice(1)} for “${input.problem.title}”: ${end(input.option.title)}.`,
        1200,
      ),
      sections,
    },
  };
}

// ---- Checks ------------------------------------------------------------------------------

export interface ChecksContext {
  /** The problem's current version, or null when it is no longer active. */
  problem_version: number | null;
  option: { version: number; status: string } | null;
  selection_current: boolean;
  /** Every cited claim, as it is now (missing: not found in the workspace). */
  claims: ReadonlyMap<
    string,
    {
      version: number;
      status: string;
      statement: string;
      evidence_status: string;
      relation: 'supports' | 'contradicts' | 'not_linked';
      sources: ProposalReference['sources'];
    }
  >;
  /** Claims that contradict the problem now (ids, lower case). */
  contrary_linked: readonly string[];
}

export function proposalChecks(
  body: ProposalBody,
  ctx: ChecksContext,
): ProposalChecks {
  const checks: ProposalCheck[] = [];
  const add = (
    level: ProposalCheck['level'],
    code: ProposalCheck['code'],
    section: ProposalSection | null,
    message: string,
  ) => checks.push({ level, code, section, message: clip(message, 500) });
  let written = 0;
  let unknownN = 0;
  let na = 0;
  for (const k of PROPOSAL_SECTIONS) {
    const s = body.sections[k];
    if (s.state === 'written') written++;
    else if (s.state === 'unknown') unknownN++;
    else na++;
    if (s.state === 'unknown')
      add(
        CORE_PROPOSAL_SECTIONS.includes(k) ? 'blocker' : 'warning',
        CORE_PROPOSAL_SECTIONS.includes(k) ? 'core_unknown' : 'section_unknown',
        k,
        `${PROPOSAL_SECTION_LABELS[k]} is marked unknown.`,
      );
  }
  const complete = CORE_PROPOSAL_SECTIONS.every(
    (k) => body.sections[k].state === 'written',
  );
  if (
    body.sections.evidence.state === 'written' &&
    body.sections.evidence.claims.length === 0
  )
    add(
      'blocker',
      'evidence_uncited',
      'evidence',
      'The evidence section cites no claim.',
    );
  // Citation fidelity: each cited claim exists, is active, is the version cited and bears on
  // the problem. Labels follow first citation order, so the export reads R1, R2, ...
  const order: string[] = [];
  const citedVersion = new Map<string, number>();
  for (const k of PROPOSAL_SECTIONS)
    for (const c of body.sections[k].claims) {
      const id = c.id.toLowerCase();
      if (!order.includes(id)) {
        order.push(id);
        citedVersion.set(id, c.version);
      }
      const now = ctx.claims.get(id);
      const label = PROPOSAL_SECTION_LABELS[k];
      if (!now)
        add(
          'blocker',
          'claim_missing',
          k,
          `${label} cites a claim that is not in this workspace (${id.slice(0, 8)}).`,
        );
      else if (now.status !== 'active')
        add(
          'blocker',
          'claim_inactive',
          k,
          `${label} cites a claim that is ${now.status} (${id.slice(0, 8)}).`,
        );
      else {
        if (now.version !== c.version)
          add(
            'warning',
            'claim_changed',
            k,
            `${label} cites v${c.version} of a claim now at v${now.version}: “${clip(now.statement, 120)}”.`,
          );
        if (now.relation === 'not_linked')
          add(
            'warning',
            'claim_unlinked',
            k,
            `${label} cites a claim that is not linked to this problem: “${clip(now.statement, 120)}”.`,
          );
        if (k === 'contrary_evidence' && now.relation === 'supports')
          add(
            'warning',
            'contrary_supports',
            k,
            `Contrary evidence cites a claim linked as support: “${clip(now.statement, 120)}”.`,
          );
      }
    }
  const uncited = ctx.contrary_linked.filter(
    (id) => !order.includes(id.toLowerCase()),
  );
  if (uncited.length)
    add(
      'warning',
      'contrary_uncited',
      'contrary_evidence',
      `${uncited.length} claim${uncited.length > 1 ? 's' : ''} contradicting the problem ${uncited.length > 1 ? 'are' : 'is'} not cited anywhere.`,
    );
  if (ctx.problem_version === null)
    add('warning', 'problem_changed', null, 'The problem is no longer active.');
  else if (ctx.problem_version !== body.problem.version)
    add(
      'warning',
      'problem_changed',
      null,
      `The problem changed since this was written (v${body.problem.version} → v${ctx.problem_version}).`,
    );
  if (!ctx.option || ctx.option.status !== 'active')
    add('warning', 'option_inactive', null, 'The option is no longer active.');
  else if (ctx.option.version !== body.alternative.version)
    add(
      'warning',
      'option_changed',
      null,
      `The option changed since this was written (v${body.alternative.version} → v${ctx.option.version}).`,
    );
  if (!ctx.selection_current)
    add(
      'warning',
      'selection_replaced',
      null,
      'A later selection for this problem replaced the one this proposal follows.',
    );
  const references: ProposalReference[] = order
    .slice(0, PROPOSAL_MAX_CITED_CLAIMS)
    .map((id, i) => {
      const now = ctx.claims.get(id);
      return {
        label: `R${i + 1}`,
        claim: { id, version: citedVersion.get(id)! },
        statement: clip(
          now?.statement ?? '(not found in this workspace)',
          2000,
        ),
        relation: now?.relation ?? 'not_linked',
        status: now
          ? now.status === 'active'
            ? now.evidence_status
            : now.status
          : 'missing',
        sources: now?.sources.slice(0, 10) ?? [],
      };
    });
  return {
    complete,
    ready_for_review: complete && !checks.some((c) => c.level === 'blocker'),
    written,
    unknown: unknownN,
    not_applicable: na,
    checks: checks.slice(0, 200),
    references,
  };
}

// ---- Markdown export --------------------------------------------------------------------

export interface MarkdownInput {
  id: string;
  version: number;
  title: string;
  content_hash: string;
  body: ProposalBody;
  checks: ProposalChecks;
  problem_title: string;
  option_title: string;
  /** When the exported version was saved: the export is the same bytes for the same version. */
  saved_at: string;
}

/**
 * Text from a record or a typed one-line field, flattened to one line with the Markdown
 * characters that could start a heading, quote, code span or fence, link, HTML, emphasis or
 * table escaped, so it renders as the literal text wherever it sits (re-review L-A).
 */
export function inlineText(text: string): string {
  return oneLine(text).replace(/[\\`*_[\]<>#|~!]/g, '\\$&');
}

/**
 * The person's section text, kept exactly as typed inside a fenced block whose fence is longer
 * than any backtick run in the text. Nothing typed can close the block, open another one, or
 * become a heading, so no section can hide or forge the References, Open checks or provenance
 * (review L-4, re-review L-A). Markdown in the text shows as written, not rendered.
 */
export function sectionMarkdown(text: string): string {
  const body = text.replace(/\r\n?/g, '\n').trimEnd();
  if (!body) return '';
  const longest = Math.max(
    0,
    ...[...body.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}text\n${body}\n${fence}`;
}

/**
 * The canonical export. Section text is fenced and record text escaped (see above). The
 * bytes depend only on the version and the records it cites, not on the export time or on
 * reviews, so saving the same version to Files twice keeps one copy (review L-2).
 */
export function proposalMarkdown(m: MarkdownInput): string {
  const labelOf = new Map(
    m.checks.references.map((r) => [r.claim.id.toLowerCase(), r.label]),
  );
  const out: string[] = [
    `# ${inlineText(m.title)}`,
    '',
    `> ${inlineText(m.body.summary)}`,
    '',
    `- Problem: ${inlineText(m.problem_title)} (v${m.body.problem.version})`,
    `- Response: ${words(m.body.response)} — ${inlineText(m.option_title)} (v${m.body.alternative.version})`,
    `- Proposal ${m.id}, version ${m.version}, content hash ${m.content_hash}`,
    `- Version saved ${m.saved_at}`,
    `- Document checks: ${m.checks.complete ? 'all core sections written' : 'core sections still unknown'}; ${m.checks.checks.filter((c) => c.level === 'blocker').length} blocker(s), ${m.checks.checks.filter((c) => c.level === 'warning').length} warning(s)`,
    '- Reviews are kept in the studio with the version they judged; they are not part of this file.',
    '- Section text is shown exactly as written, in a text block.',
    '',
    '_This is a plan. It has not been carried out, and nothing here shows that it works in practice._',
    '',
  ];
  for (const k of PROPOSAL_SECTIONS) {
    const s = m.body.sections[k];
    out.push(`## ${PROPOSAL_SECTION_LABELS[k]}`, '');
    if (s.state === 'unknown') out.push('**Unknown.**');
    else if (s.state === 'not_applicable') out.push('**Not applicable.**');
    const text = sectionMarkdown(s.text);
    if (text) out.push(...(s.state === 'written' ? [] : ['']), text);
    if (s.claims.length)
      out.push(
        '',
        `Cited: ${s.claims.map((c) => `[${labelOf.get(c.id.toLowerCase()) ?? '?'}]`).join(' ')}`,
      );
    out.push('');
  }
  out.push('## References', '');
  if (!m.checks.references.length) out.push('No claims are cited.');
  for (const r of m.checks.references) {
    out.push(
      `- [${r.label}] ${inlineText(r.statement)} — claim ${r.claim.id.slice(0, 8)} v${r.claim.version}; ${r.relation.replace('_', ' ')}; evidence ${r.status}`,
    );
    for (const s of r.sources)
      out.push(
        `  - ${inlineText(s.title || s.url)}: ${inlineText(s.url)} (${s.stance}, ${s.freshness})${s.quote ? ` — “${inlineText(s.quote)}”` : ''}`,
      );
  }
  if (m.checks.checks.length) {
    out.push('', '## Open checks', '');
    for (const c of m.checks.checks)
      out.push(
        `- ${c.level === 'blocker' ? 'Blocker' : 'Warning'}: ${inlineText(c.message)}`,
      );
  }
  return `${out.join('\n')}\n`;
}

/** A safe file name for the export: letters, digits, dashes; the version is in it. */
export function proposalFileName(title: string, version: number): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/\p{M}+/gu, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .toLowerCase() || 'proposal';
  return `${base}-v${version}.md`;
}
