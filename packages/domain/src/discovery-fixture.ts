import type {
  DiscoveryTaskKind,
  EvidencePacket,
  EvidenceRole,
  LocatorOutput,
  PacketClaim,
  ProposalOutput,
  ResponseType,
  SkepticOutput,
} from '@creator/contracts';
import { isUsable } from './discovery.js';

// Deterministic fixture roles for discovery runs. They read only the packet and the inputs
// the runtime supplied and apply fixed rules, so a fixture run shows what the pipeline does
// with a given body of evidence. They are not a model and prove nothing about model quality.

const KINDS: DiscoveryTaskKind[] = ['locate', 'propose', 'revise', 'skeptic'];
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const payload = (text: string): unknown => {
  const at = text.indexOf('\n');
  return JSON.parse(text.slice(at + 1)) as unknown;
};

class Evidence {
  constructor(readonly packet: EvidencePacket) {}
  /** Claims bearing on a role whose evidence is current (supported or contested). */
  usable(role: EvidenceRole): PacketClaim[] {
    return this.packet.claims.filter(
      (c) => c.bears_on.includes(role) && isUsable(c.status),
    );
  }
  supported(role: EvidenceRole): PacketClaim[] {
    return this.usable(role).filter((c) => c.status === 'supported');
  }
  any(role: EvidenceRole): PacketClaim[] {
    return this.packet.claims.filter((c) => c.bears_on.includes(role));
  }
}
const refs = (cs: PacketClaim[]) => [...new Set(cs.map((c) => c.ref))];
const first = (cs: PacketClaim[]) => cs[0]?.statement;

function locate(e: Evidence): LocatorOutput {
  const b = e.packet.brief.body;
  const problem = e.usable('problem');
  const urgency = e.usable('urgency');
  const mechanism = e.packet.claims.filter(
    (c) => c.bears_on.includes('mechanism') && c.status !== 'contradicted',
  );
  const data = e.usable('data');
  const insufficient = e.packet.sufficiency.verdict === 'insufficient';
  return {
    fixture: true,
    problem_statement: clip(
      `${b.measurable_problem}${problem.length ? ` Evidence: ${problem.map((c) => `${c.statement} (${c.ref}, ${c.status})`).join(' ')}` : ' The packet has no current passage supporting this problem.'}`,
      1200,
    ),
    affected_users: clip(b.target_users, 300),
    observable_problem: clip(first(problem) ?? b.outcome_measure, 300),
    urgency: {
      frequency: clip(first(urgency) ?? 'Not evidenced in the packet.', 300),
      severity: urgency.some((c) => c.status === 'supported')
        ? 'high'
        : urgency.length
          ? 'medium'
          : 'unknown',
      claim_refs: refs(urgency),
    },
    workarounds: e.usable('workaround').map((c) => ({
      description: clip(c.statement, 300),
      claim_refs: [c.ref],
    })),
    alternatives: e.usable('existing_tool').map((c) => ({
      description: clip(c.statement, 300),
      claim_refs: [c.ref],
    })),
    software_hypothesis: data.length
      ? {
          hypothesis: clip(
            `Software could help if it uses the available data (${data.map((c) => c.ref).join(', ')}) to act on ${b.outcome_measure}.`,
            1200,
          ),
          measurable_outcome: clip(b.outcome_measure, 300),
          claim_refs: refs(data),
        }
      : null,
    cross_field: mechanism.length
      ? {
          from_field: b.fields[0],
          to_field: b.fields[1],
          transferred_mechanism: clip(mechanism[0]!.statement, 800),
          why_it_transfers: clip(
            `The same structure appears in ${b.fields[1]}: ${first(problem) ?? b.measurable_problem}`,
            800,
          ),
          claim_refs: refs([mechanism[0]!, ...problem.slice(0, 1)]),
        }
      : null,
    cross_field_absent_reason: mechanism.length
      ? null
      : 'No claim in the packet describes a mechanism that transfers between the two fields.',
    evidence_strength: insufficient
      ? 'insufficient'
      : problem.every((c) => c.status === 'supported')
        ? 'well_supported'
        : 'exploratory',
    gaps: e.packet.sufficiency.reasons.slice(0, 8).map((r) => clip(r, 300)),
  };
}

function propose(
  e: Evidence,
  perspective: ResponseType,
  revising: {
    prior: ProposalOutput;
    review: SkepticOutput['reviews'][number];
  } | null,
): ProposalOutput {
  const b = e.packet.brief.body;
  const problem = e.usable('problem');
  const tools = e.supported('existing_tool');
  const gap = e.supported('tool_gap');
  const data = e.supported('data');
  const workaround = e.usable('workaround');
  const mechanism = e.usable('mechanism');
  const urgency = e.usable('urgency');
  const base = {
    fixture: true,
    perspective,
    intended_users: clip(b.target_users, 300),
    measurable_outcome: clip(b.outcome_measure, 300),
    novelty: null,
    response_to_findings: null,
  };
  let p: ProposalOutput;
  switch (perspective) {
    case 'software': {
      const covered = tools.length > 0 && gap.length === 0;
      const recommendation = covered
        ? 'not_recommended'
        : data.length && gap.length
          ? 'recommend'
          : data.length
            ? 'consider'
            : 'not_recommended';
      p = {
        ...base,
        title: clip(
          `Software: ${first(mechanism) ?? first(data) ?? b.theme}`,
          200,
        ),
        mechanism: clip(
          `${first(mechanism) ?? 'A small tool'} applied to ${b.outcome_measure}.`,
          1200,
        ),
        smallest_version: clip(
          `A single screen that reads ${first(data) ?? 'the data the users already keep'} and flags where action would change ${b.outcome_measure}.`,
          1200,
        ),
        feasibility: clip(
          data.length
            ? `Data: ${data.map((c) => c.statement).join(' ')}`
            : 'No evidence in the packet that the needed data is available.',
          1200,
        ),
        maintenance:
          'Needs an owner to keep data imports current and to retire it if unused.',
        software_warranted: {
          verdict:
            recommendation === 'recommend' ? 'yes' : covered ? 'no' : 'unclear',
          reason: clip(
            covered
              ? `An existing tool already covers the need (${refs(tools).join(', ')}): ${first(tools)}`
              : recommendation === 'recommend'
                ? `Existing tools fall short (${refs(gap).join(', ')}) and the data exists (${refs(data).join(', ')}).`
                : 'The packet does not show that existing tools fall short, or that the data exists.',
            1200,
          ),
        },
        recommendation,
        claim_refs: refs([
          ...problem,
          ...urgency,
          ...data,
          ...gap,
          ...mechanism,
          ...tools,
        ]),
        assumptions: [
          {
            statement: 'Staff will act on what the tool flags.',
            would_change: 'A hand-run pilot where flagged items are ignored.',
          },
        ],
      };
      break;
    }
    case 'existing_tool':
      p = {
        ...base,
        title: clip(
          tools.length
            ? `Use the existing tool: ${first(tools)}`
            : 'Use an existing tool (none evidenced)',
          200,
        ),
        mechanism: clip(
          tools.length
            ? `Adopt what already exists: ${first(tools)}`
            : 'No existing tool is evidenced in the packet.',
          1200,
        ),
        smallest_version:
          'Configure the existing tool for one site for a month.',
        feasibility: clip(
          tools.length
            ? `Evidence: ${tools.map((c) => c.ref).join(', ')}.`
            : 'Unknown.',
          1200,
        ),
        maintenance: 'Vendor-maintained; local configuration only.',
        software_warranted: {
          verdict: 'no',
          reason: clip(
            tools.length
              ? gap.length
                ? `An existing tool exists (${refs(tools).join(', ')}), but a gap is reported (${refs(gap).join(', ')}).`
                : `An existing tool covers the need (${refs(tools).join(', ')}); building software would duplicate it.`
              : 'No existing tool is evidenced; nothing to adopt.',
            1200,
          ),
        },
        recommendation: tools.length
          ? gap.length
            ? 'consider'
            : 'recommend'
          : 'not_recommended',
        claim_refs: refs([...problem, ...tools, ...gap]),
        assumptions: [],
      };
      break;
    case 'process_change':
      p = {
        ...base,
        title: clip(
          first(workaround) ?? `Change the process behind ${b.outcome_measure}`,
          200,
        ),
        mechanism: clip(
          workaround.length
            ? `Make the current workaround routine: ${workaround.map((c) => c.statement).join(' ')}`
            : `Change how the work is organised to improve ${b.outcome_measure}.`,
          1200,
        ),
        smallest_version:
          'A written procedure tried at one site for four weeks.',
        feasibility: 'Needs staff time, no new data.',
        maintenance: 'Periodic review of the procedure.',
        software_warranted: {
          verdict: 'no',
          reason: 'A process change can be tried without new software.',
        },
        recommendation: workaround.length ? 'consider' : 'not_recommended',
        claim_refs: refs([...problem, ...workaround]),
        assumptions: [],
      };
      break;
    case 'human_led':
      p = {
        ...base,
        title: clip(
          `Human-led: a named coordinator owns ${b.outcome_measure}`,
          200,
        ),
        mechanism: clip(
          `A person reviews ${first(problem) ?? 'the problem'} each week and follows up by hand.`,
          1200,
        ),
        smallest_version: 'One coordinator, part-time, for six weeks.',
        feasibility: 'Needs a funded role.',
        maintenance: 'Ongoing staff cost.',
        software_warranted: {
          verdict: 'no',
          reason:
            'Judgment and follow-up are the scarce part; a person can do both.',
        },
        recommendation: problem.length ? 'consider' : 'not_recommended',
        claim_refs: refs(problem),
        assumptions: [
          {
            statement: 'A coordinator role can be funded.',
            would_change: 'No budget for staff time.',
          },
        ],
      };
      break;
    case 'hybrid':
      p = {
        ...base,
        title: clip(
          `Hybrid: ${first(workaround) ? 'routine workaround' : 'staff review'} supported by a simple list from existing data`,
          200,
        ),
        mechanism: clip(
          `Staff keep doing the work by hand${data.length ? `, guided by a list drawn from ${first(data)}` : ''}.`,
          1200,
        ),
        smallest_version: 'A weekly exported list and a checklist.',
        feasibility: clip(
          data.length
            ? `Data: ${refs(data).join(', ')}.`
            : 'No data evidenced.',
          1200,
        ),
        maintenance: 'Low; a saved export.',
        software_warranted: {
          verdict: 'unclear',
          reason: 'Only a saved export is needed, not a new product.',
        },
        recommendation:
          data.length && workaround.length ? 'consider' : 'not_recommended',
        claim_refs: refs([...problem, ...data, ...workaround]),
        assumptions: [],
      };
      break;
  }
  if (!revising) return p;
  const counter = revising.review.findings.filter(
    (f) => f.type === 'counterevidence',
  );
  return {
    ...revising.prior,
    recommendation:
      counter.length && revising.prior.recommendation === 'recommend'
        ? 'consider'
        : revising.prior.recommendation,
    assumptions: [
      ...revising.prior.assumptions,
      ...(revising.review.cheaper_test
        ? [
            {
              statement: clip(
                `Passes the cheaper test first: ${revising.review.cheaper_test}`,
                300,
              ),
              would_change: 'The cheaper test fails.',
            },
          ]
        : []),
    ].slice(0, 6),
    response_to_findings: clip(
      `Addressed ${revising.review.findings.length} finding(s): ${revising.review.findings.map((f) => f.type).join(', ')}. Contested evidence now lowers the recommendation and the cheaper test comes first.`,
      1200,
    ),
  };
}

function skeptic(
  e: Evidence,
  proposals: { label: string; output: ProposalOutput }[],
  matches: { proposal: string; catalog: string; similarity: number }[],
): SkepticOutput {
  const byRef = new Map(e.packet.claims.map((c) => [c.ref, c]));
  const reviews = proposals.map(({ label, output }) => {
    const findings: SkepticOutput['reviews'][number]['findings'] = [];
    for (const r of output.claim_refs) {
      const c = byRef.get(r);
      if (!c) continue;
      if (c.status === 'contested' || c.status === 'contradicted')
        findings.push({
          type: 'counterevidence',
          detail: clip(`${r} is ${c.status}: ${c.statement}`, 1200),
          claim_refs: [r],
          catalog_ref: null,
        });
      else if (!isUsable(c.status))
        findings.push({
          type: 'weak_evidence',
          detail: clip(`${r} is ${c.status.replace('_', ' ')}.`, 1200),
          claim_refs: [r],
          catalog_ref: null,
        });
    }
    const dup = matches.filter((m) => m.proposal === label);
    for (const m of dup)
      findings.push({
        type: 'duplicate',
        detail: `Resembles catalog entry ${m.catalog} (similarity ${m.similarity}).`,
        claim_refs: [],
        catalog_ref: m.catalog,
      });
    const building =
      output.perspective === 'software' &&
      output.recommendation !== 'not_recommended';
    const cheaper = building
      ? 'Run the flagging by hand from an export for two weeks before building anything.'
      : null;
    const counter = findings.some((f) => f.type === 'counterevidence');
    return {
      proposal: label,
      verdict: dup.some((m) => m.similarity >= 0.6)
        ? ('reject' as const)
        : counter && output.response_to_findings === null
          ? ('revise' as const)
          : ('stands' as const),
      findings: findings.slice(0, 8),
      cheaper_test: cheaper,
    };
  });
  return {
    fixture: true,
    summary: clip(
      `Reviewed ${reviews.length} proposal(s): ${reviews.map((r) => `${r.proposal} ${r.verdict}`).join(', ')}.`,
      1200,
    ),
    reviews,
  };
}

/**
 * Answers a discovery task from its rendered input, or returns null for any other call. The
 * fixture model adapter uses it so fixture runs exercise the real pipeline end to end.
 */
export function discoveryFixtureAnswer(
  messages: { role: string; text: string }[],
): string | null {
  const system = messages[0]?.text ?? '';
  const kind = KINDS.find((k) => system.includes(`[discovery-task:${k}]`));
  if (!kind) return null;
  const e = new Evidence(payload(messages[1]!.text) as EvidencePacket);
  const task = payload(messages[2]!.text) as {
    perspective: ResponseType | null;
    proposal: string | null;
    catalog_matches: {
      proposal: string;
      catalog: string;
      similarity: number;
    }[];
  };
  const inputs = messages.slice(3).map((m) => ({
    label: m.text.slice('Input '.length, m.text.indexOf(' (untrusted')),
    output: payload(m.text),
  }));
  let answer: unknown;
  if (kind === 'locate') answer = locate(e);
  else if (kind === 'propose') answer = propose(e, task.perspective!, null);
  else if (kind === 'revise') {
    const prior = inputs.find((i) => i.label.startsWith('P'))
      ?.output as ProposalOutput;
    const review = (
      inputs.find((i) => i.label.startsWith('skeptic'))?.output as SkepticOutput
    ).reviews.find((r) => r.proposal === task.proposal)!;
    answer = propose(e, task.perspective!, { prior, review });
  } else
    answer = skeptic(
      e,
      inputs
        .filter((i) => i.label.startsWith('P'))
        .map((i) => ({
          label: i.label.split(' ')[0]!,
          output: i.output as ProposalOutput,
        })),
      task.catalog_matches,
    );
  return JSON.stringify(answer);
}
