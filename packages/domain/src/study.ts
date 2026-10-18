import {
  CreateStudySchema,
  parse,
  ContractError,
  type StudyInput,
  type StudyAssignment,
} from '@creator/contracts';
import { DISCOVERY_PROMPT_HASH, DISCOVERY_ROLE_VERSION } from './discovery.js';
import { canonicalHash } from './rules.js';

// Baseline deliberately does not import the structured discovery prompt or rubric.
export const STUDY_PROMPTS = {
  structured: {
    version: 'study-structured/1',
    text: 'Research the supplied problem; compare independent alternatives, challenge them with a skeptic, and assess against the supplied rubric. Preserve evidence, uncertainty and dissent.',
  },
  open_ended: {
    version: 'study-open-ended/1',
    text: 'Suggest ideas addressing the supplied problem. Use only the supplied resources. Preserve uncertainty and cite only supplied evidence. Return plain text.',
  },
  human_defined: {
    version: 'study-human/1',
    text: 'Complete the supplied task using ordinary non-generative tools. Record your own work and effort. No AI summaries, rewriting or completion.',
  },
} as const;

export function studyManifest(raw: unknown) {
  const input = parse(CreateStudySchema, raw);
  const artifacts = {
    protocol: input.protocol,
    packet: input.packet,
    config: input.config,
    rubric: input.rubric,
    intervention_policy: input.intervention_policy,
    analysis_plan: input.analysis_plan,
    missing_data_policy: input.missing_data_policy,
    stop_retry_rules: input.stop_retry_rules,
    prompts: {
      ...STUDY_PROMPTS,
      structured_runtime: {
        version: DISCOVERY_ROLE_VERSION,
        hash: DISCOVERY_PROMPT_HASH,
      },
    },
    tool_access: input.config.tool_access,
    model_version: input.config.model_version,
    pricing_version: input.config.pricing_version,
  };
  const hashes = Object.fromEntries(
    Object.entries(artifacts).map(([k, v]) => [k, canonicalHash(v)]),
  );
  const manifest = {
    ...input,
    status: 'draft_not_frozen' as const,
    review_and_consent_status: 'unresolved_before_recruitment' as const,
    hashes,
  };
  return { manifest, manifest_hash: canonicalHash(manifest) };
}

/** Allowlist construction: never accept caller-supplied context, other outputs or grader data. */
export function studyContext(
  input: StudyInput,
  assignment: Pick<StudyAssignment, 'condition' | 'discovery_method'>,
) {
  const { structured_brief: _structuredBrief, ...neutralPacket } = input.packet;
  const human = assignment.condition === 'human_only';
  if (human !== (assignment.discovery_method === 'human_defined'))
    throw new ContractError(
      'INVALID_CONTRACT',
      'Human-only work must use human_defined discovery.',
    );
  return {
    schema_version: 'study-context/1',
    synthetic: true,
    packet: {
      ...neutralPacket,
      background: {
        theme: _structuredBrief.theme,
        fields: _structuredBrief.fields,
        target_users: _structuredBrief.target_users,
        context: _structuredBrief.context,
        data_and_tools: _structuredBrief.data_and_tools,
        constraints: _structuredBrief.constraints,
      },
    },
    prompt: STUDY_PROMPTS[assignment.discovery_method],
    resources: human
      ? {
          tools: ['ordinary editor', 'conventional tests'],
          time_cap_seconds: input.packet.time_cap_seconds,
        }
      : input.config,
    ...(assignment.discovery_method === 'structured'
      ? { rubric: input.rubric }
      : {}),
  };
}

/** Deterministic order is recorded; randomization cannot undo a person's prior familiarity. */
export function studyOrder(seed: string) {
  return (['autonomous', 'human_in_loop', 'human_only'] as const)
    .map((condition) => ({
      condition,
      key: canonicalHash({ seed, condition }),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((x) => x.condition);
}

export const STUDY_FIXTURE_PRICING = {
  provider: 'fixture',
  model_id: 'fixture-model-v1',
  basis: 'fixture',
  source_url: null,
  retrieved_at: '2026-10-18T05:45:00.000Z',
  unit: 'nano_usd_per_token',
  rates: {
    input: '10000',
    cached_input: '1000',
    cache_write: '12500',
    output: '50000',
  },
  long_context: null,
  tool_call_rates: { search_public: '5000000' },
  context_window_tokens: 200000,
  max_output_tokens: 8000,
  supported_actions: [
    'model.generate',
    'model.summarize',
    'model.embed',
    'tool.search_public',
  ],
  notes:
    'Simulated units for the deterministic fixture adapter. Not money and not a real provider price.',
};

export const SYNTHETIC_STUDY: StudyInput = {
  schema_version: 'study/1',
  synthetic: true,
  title: 'Synthetic shared-checklist study',
  protocol: {
    version: 'draft/1',
    text: 'Synthetic plumbing only. All assigned attempts remain in accounting; no empirical inference.',
  },
  packet: {
    version: 'checklist/1',
    stratum: 'decision',
    problem: 'A fictional team misses handoffs.',
    initial_resources: [
      {
        locator: 'fixture://team',
        snapshot: 'Synthetic team already has a shared document.',
      },
    ],
    outcome: 'Recommend a response and a validation plan.',
    structured_brief: {
      theme: 'Fictional team handoffs',
      fields: ['coordination', 'information design'],
      target_users: 'Fictional volunteers',
      context: null,
      measurable_problem: 'A fictional team misses handoffs.',
      outcome_measure: 'Recommend a response and a validation plan.',
      data_and_tools: ['Shared document'],
      time_limit: 'One hour',
      budget_limit: 'Synthetic fixture budget only',
      nae_seed: null,
      constraints: ['Synthetic task; no empirical conclusions.'],
    },
    time_cap_seconds: 3600,
  },
  config: {
    model_version: 'fixture-model-v1',
    pricing_version: canonicalHash(STUDY_FIXTURE_PRICING),
    tool_access: [],
    candidate_count: 3,
    max_calls: 7,
    max_output_tokens: 2000,
    max_cost_nano_usd: '1000000000',
    max_retries: 0,
  },
  rubric: {
    version: 'draft/1',
    text: 'Evidence, usefulness, feasibility and appropriateness.',
  },
  intervention_policy: {
    version: 'draft/1',
    text: 'A stops when human judgment is needed; B records assistance; C uses no AI.',
  },
  analysis_plan: {
    version: 'draft/1',
    text: 'Count every assigned run. No synthetic performance claims.',
  },
  missing_data_policy: {
    version: 'draft/1',
    text: 'Keep incomplete and missing runs visible.',
  },
  stop_retry_rules: {
    version: 'draft/1',
    text: 'No retries; stop at deadline or need for human judgment.',
  },
  primary_outcomes: ['Decision quality (not rated in fixtures)'],
  assignment_seed: 'synthetic-seed-1',
};
