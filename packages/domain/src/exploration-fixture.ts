import type {
  ExplorationCandidate,
  ExplorationPacket,
  ExplorerOutput,
} from '@creator/contracts';
import { isUsable } from './discovery.js';
import { EXPLORATION_MARKER } from './exploration.js';

// Deterministic fixture explorer (ADR-0065). It reads only the packet and applies fixed rules:
// one card per usable claim, newest first, up to the scope's limit, citing that claim and any
// contradicted claim as contrary. It is not a model and proves nothing about model quality.

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export function explorationFixtureAnswer(
  messages: { role: string; text: string }[],
): string | null {
  if (!(messages[0]?.text ?? '').includes(EXPLORATION_MARKER)) return null;
  const text = messages[1]!.text;
  const packet = JSON.parse(
    text.slice(text.indexOf('\n') + 1),
  ) as ExplorationPacket;
  const s = packet.scope;
  const against = packet.claims
    .filter((c) => c.status === 'contradicted')
    .map((c) => c.ref)
    .slice(0, 3);
  const candidates: ExplorationCandidate[] = packet.claims
    .filter((c) => isUsable(c.status))
    .slice(0, s.max_candidates)
    .map((c) => ({
      title: clip(`Fixture problem: ${c.statement}`, 200),
      affected_users: clip(
        s.target_groups[0] ?? 'People named in the fixture claim',
        300,
      ),
      observable_pain: clip(c.statement, 1200),
      why_chosen: `Claim ${c.ref} is ${c.status} in the packet.`,
      current_alternatives: [],
      outcome_measure: 'Time or errors in the described task (fixture).',
      next_question: 'Who else reports this, and how often? (fixture)',
      uncertainty: 'Fixture rules, not reasoning; synthetic evidence only.',
      fields: [
        clip(s.interests[0] ?? 'Workflow design', 300),
        'Measurement and feedback',
      ],
      claim_refs: [c.ref],
      contrary_refs: against.filter((r) => r !== c.ref),
      catalog_ref: null,
    }));
  const out: ExplorerOutput = {
    fixture: true,
    summary: candidates.length
      ? `Fixture explorer: ${candidates.length} problem${candidates.length === 1 ? '' : 's'} from usable claims in the packet.`
      : 'Fixture explorer: no claim in the packet has current evidence, so no problem is proposed.',
    candidates,
    directions: s.interests.slice(0, 2).map((i) => ({
      direction: clip(`Recorded evidence about ${i}`, 300),
      why: 'Named as an interest; the packet has no claim about it yet (fixture).',
      question: clip(
        `What recurring problem do people report about ${i}?`,
        300,
      ),
    })),
    not_covered: ['Fixture explorer does not judge evidence quality.'],
  };
  return JSON.stringify(out);
}
