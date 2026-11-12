import {
  RUBRICS,
  type AssessmentPacket,
  type AssessorOutput,
} from '@creator/contracts';
import { isUsable } from './discovery.js';
import { ASSESSMENT_MARKER } from './assessment.js';

// Deterministic fixture assessor (ADR-0074). It reads only the packet and applies fixed rules:
// a criterion is rated only when a supporting claim with current evidence exists (3, or 2 plus
// the claim's independent origins for evidence criteria, at most 5), and is unknown otherwise.
// It is not a model and proves nothing about model quality.

const EVIDENCE_CRITERIA = ['evidence_quality', 'evidence_support'];
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export function assessmentFixtureAnswer(
  messages: { role: string; text: string }[],
): string | null {
  if (!(messages[0]?.text ?? '').includes(ASSESSMENT_MARKER)) return null;
  const text = messages[1]!.text;
  const packet = JSON.parse(
    text.slice(text.indexOf('\n') + 1),
  ) as AssessmentPacket;
  const usable = packet.claims.filter(
    (c) => c.relation === 'supports' && isUsable(c.status),
  );
  const against = packet.claims.filter((c) => c.relation === 'contradicts');
  const best = usable[0];
  const who = clip(
    packet.problem.affected_group ?? 'People named in the problem',
    300,
  );
  const measure = clip(
    packet.problem.outcome_measure ?? 'Not stated in the packet (fixture).',
    300,
  );
  const out: AssessorOutput = {
    fixture: true,
    summary: best
      ? `Fixture assessor: ${packet.options.length} option${packet.options.length === 1 ? '' : 's'} rated from ${usable.length} supporting claim${usable.length === 1 ? '' : 's'} with current evidence.`
      : 'Fixture assessor: no supporting claim has current evidence, so every rating is unknown.',
    assessments: packet.options.flatMap((o) =>
      o.rubrics.map((rubric) => ({
        option: o.ref,
        rubric,
        ratings: Object.fromEntries(
          RUBRICS[rubric].criteria.map((c) => [
            c.key,
            best
              ? {
                  rating: EVIDENCE_CRITERIA.includes(c.key)
                    ? Math.min(5, 2 + best.independent_origins)
                    : 3,
                  claim_refs: [best.ref],
                  rationale: `Claim ${best.ref} is ${best.status} with ${best.independent_origins} independent origin${best.independent_origins === 1 ? '' : 's'} (fixture rule).`,
                }
              : {
                  rating: null,
                  claim_refs: [],
                  rationale:
                    'No supporting claim with current evidence (fixture rule).',
                },
          ]),
        ),
        confidence: {
          level: 'low' as const,
          rationale: 'Fixture rules, not reasoning; synthetic evidence only.',
        },
        software_influence:
          rubric === 'suitability'
            ? {
                rating: o.kind === 'build' ? 4 : o.kind === 'hybrid' ? 3 : 2,
                note: `Recorded from the option kind "${o.kind}" (fixture rule); not counted.`,
              }
            : null,
        gates: {
          ethics: {
            status: 'clear' as const,
            note: 'Fixture rules found no concern; a person must confirm.',
          },
          access: {
            status: 'clear' as const,
            note: 'Fixture rules found no concern; a person must confirm.',
          },
        },
        checks: {
          target_users: who,
          current_workaround: 'Not stated in the packet (fixture).',
          contrary_evidence: against.length
            ? `Claims ${against.map((c) => c.ref).join(', ')} weigh against the problem.`
            : 'None linked in the packet (fixture).',
          measurable_outcome: measure,
          validation_plan: 'Pilot with the affected group (fixture).',
          maintenance: 'Not assessed by fixture rules.',
        },
        uncertainty: 'Fixture rules over synthetic evidence.',
        // ADR-0097: every checklist item on suitability, passed only when it can cite a ref.
        ...(packet.checklist && rubric === 'suitability'
          ? (() => {
              const yes = (packet.team?.capabilities ?? []).find(
                (c) => c.status === 'yes' && c.key,
              )?.key;
              return {
                checklist: Object.fromEntries(
                  packet.checklist.items.map((i) => {
                    const team_refs = i.gate === 'access' && yes ? [yes] : [];
                    const claim_refs =
                      !team_refs.length && best ? [best.ref] : [];
                    const pass = team_refs.length + claim_refs.length > 0;
                    return [
                      i.ref,
                      {
                        answer: pass ? ('pass' as const) : ('unknown' as const),
                        claim_refs,
                        team_refs,
                        note: pass
                          ? 'Fixture rule: a packet ref exists for this item.'
                          : 'Fixture rule: nothing in the packet bears on this item.',
                      },
                    ];
                  }),
                ),
                access_needs: yes ? [yes] : [],
              };
            })()
          : {}),
      })),
    ),
    not_covered: ['Fixture assessor does not judge evidence quality.'],
  };
  return JSON.stringify(out);
}
