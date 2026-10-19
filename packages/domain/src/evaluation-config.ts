import {
  z,
  parse,
  text,
  nanoUsd,
  GovernanceItemSchema,
  type StudyInput,
} from '@creator/contracts';
import { verifyFreeze, type FrozenProtocol } from './evaluation.js';

/**
 * config/evaluation.json. It records the owner's model preference and T15 cap and keeps every
 * unresolved study decision explicit. It cannot decide anything: the record gate below accepts
 * only answers that appear in the adopted protocol freeze.
 */
export const EvaluationConfigSchema = z.strictObject({
  schema_version: z.literal('evaluation-config/1'),
  recorded_on: z.iso.date(),
  note: text,
  model: z.strictObject({
    owner_preference: text,
    preference_source: text,
    verified_model_id: text.nullable(),
    live_dispatch_enabled: z.boolean(),
    decision: text,
  }),
  budget: z.strictObject({
    t15_total_cap_usd: z.string().regex(/^[0-9]+\.[0-9]{2}$/),
    t15_total_cap_nano_usd: nanoUsd,
    source: text,
    spend_authorized: z.boolean(),
  }),
  governance: z.strictObject({
    participants: GovernanceItemSchema,
    reviewers: GovernanceItemSchema,
    human_subjects: GovernanceItemSchema,
    task_selection: GovernanceItemSchema,
  }),
});
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>;

export function evaluationConfig(raw: unknown): EvaluationConfig {
  const c = parse(EvaluationConfigSchema, raw, 'INVALID_CONFIG');
  const [dollars, cents] = c.budget.t15_total_cap_usd.split('.');
  if (
    BigInt(dollars!) * 1_000_000_000n + BigInt(cents!) * 10_000_000n !==
    BigInt(c.budget.t15_total_cap_nano_usd)
  )
    throw new Error('The T15 cap in dollars and nano-dollars disagree.');
  return c;
}

export const GOVERNANCE_ITEMS = [
  'participants',
  'reviewers',
  'human_subjects',
  'task_selection',
] as const;

/** What config alone still leaves open for final work; each line names its decision. */
export function evaluationReadiness(config: EvaluationConfig): string[] {
  const out: string[] = [];
  for (const k of GOVERNANCE_ITEMS) {
    const item = config.governance[k];
    if (item.status === 'unresolved')
      out.push(`${k.replace('_', ' ')} unresolved (${item.decision}).`);
  }
  if (!config.model.verified_model_id)
    out.push(
      `No verified model id; owner preference ${config.model.owner_preference} is unverified (${config.model.decision}).`,
    );
  if (!config.model.live_dispatch_enabled)
    out.push('Live dispatch is disabled; no final AI call can be made.');
  if (!config.budget.spend_authorized)
    out.push(
      `No spend is authorized against the $${config.budget.t15_total_cap_usd} T15 cap.`,
    );
  return out;
}

/**
 * Deterministic gate for a non-synthetic (final) study record. Returns every unmet condition;
 * an empty list is the only way to create one. Synthetic records never pass through here.
 */
export function finalRecordBlockers(
  input: StudyInput,
  state: { workspace_fixture: boolean; freeze: FrozenProtocol | null },
  config: EvaluationConfig,
): string[] {
  const out: string[] = [];
  if (state.workspace_fixture)
    out.push('A final record needs a real (non-fixture) workspace.');
  if (!state.freeze || state.freeze.origin !== 'adopted')
    out.push(
      'No adopted protocol freeze in this workspace (RD1-RD10 unanswered).',
    );
  else {
    try {
      verifyFreeze(state.freeze);
    } catch (e) {
      out.push(`The adopted freeze does not verify: ${(e as Error).message}`);
    }
    if (input.evaluation?.freeze_hash !== state.freeze.freeze_hash)
      out.push('The study must bind the hash of the adopted freeze.');
  }
  const answers = new Map(
    (state.freeze?.manifest.decisions ?? []).map((d) => [d.id, d.choice]),
  );
  const g = input.governance;
  if (!g)
    out.push(
      'Governance (participants, reviewers, human subjects, tasks, model, cap) is missing.',
    );
  else {
    for (const k of GOVERNANCE_ITEMS) {
      const item = g[k];
      const expected = config.governance[k].decision;
      if (item.decision !== expected)
        out.push(`${k} must cite ${expected}, not ${item.decision}.`);
      else if (item.status !== 'decided')
        out.push(`${k} is unresolved (${expected}).`);
      else if (answers.get(expected) !== item.choice)
        out.push(
          `${k} choice does not match the owner's answer to ${expected} in the freeze.`,
        );
    }
    if (g.model.owner_preference !== config.model.owner_preference)
      out.push(
        `The model preference ${config.model.owner_preference} must be preserved; a substitution needs a recorded owner decision.`,
      );
    if (!config.model.verified_model_id || !g.model.verified_model_id)
      out.push(
        `No verified API model id for ${config.model.owner_preference} (${config.model.decision}).`,
      );
    else if (
      g.model.verified_model_id !== config.model.verified_model_id ||
      input.config.model_version !== config.model.verified_model_id
    )
      out.push(
        'The study model must equal the verified model id in config/evaluation.json.',
      );
    if (g.model.verified_model_id && !answers.has(config.model.decision))
      out.push(`${config.model.decision} is not answered in the freeze.`);
    if (g.budget.ledger_cap_nano_usd !== config.budget.t15_total_cap_nano_usd)
      out.push(
        `The study must use the owner's $${config.budget.t15_total_cap_usd} T15 cap.`,
      );
  }
  return out;
}
