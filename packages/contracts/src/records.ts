import {
  z,
  RecordFields,
  EntityRefSchema,
  EvidenceSchema,
  text,
  timestamp,
  id,
  hash,
  MoneySchema,
  ConditionSchema,
  DiscoverySchema,
  OutcomeSchema,
} from './primitives.js';

export const SourceSchema = z
  .strictObject({
    ...RecordFields,
    url: z.url(),
    title: text,
    source_version: text,
    content_hash: hash.nullable(),
    retrieved_at: timestamp,
    published_at: timestamp.nullable(),
    retrieval_status: z.enum(['available', 'inaccessible', 'removed']),
    independent_origin: text,
    observation: text,
    uncertainty: text,
  })
  .superRefine((s, ctx) => {
    if (s.retrieval_status === 'available' && !s.content_hash)
      ctx.addIssue({
        code: 'custom',
        message: 'Available sources require a content hash.',
      });
  });
export const ClaimSchema = z
  .strictObject({
    ...RecordFields,
    statement: text,
    basis: z.enum(['observation', 'inference']),
    support: z.array(EvidenceSchema).min(1).max(100),
    contrary_evidence: z.array(EvidenceSchema).max(100),
    uncertainty: text,
  })
  .superRefine((c, ctx) => {
    for (const e of [...c.support, ...c.contrary_evidence])
      if (
        e.source.kind !== 'source' ||
        e.source.workspace_id !== c.workspace_id
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Claim evidence must reference a source in the same workspace.',
        });
  });
export const AlternativeSchema = z.strictObject({
  ...RecordFields,
  kind: OutcomeSchema,
  title: text,
  rationale: text,
  evidence_refs: z.array(EntityRefSchema).max(100),
  tradeoffs: z.array(text).min(1).max(20),
  uncertainty: text,
});
export const AssumptionSchema = z.strictObject({
  ...RecordFields,
  statement: text,
  consequence_if_wrong: text,
  would_change_decision: text,
  status: z.enum(['unresolved', 'supported', 'refuted']),
  evidence_refs: z.array(EntityRefSchema).max(100),
});
export const DecisionRequestSchema = z
  .strictObject({
    ...RecordFields,
    run_id: id,
    task_id: id,
    kind: z.enum(['clarification', 'judgment', 'authorization', 'feedback']),
    reason_code: text,
    question: text,
    assumption: text,
    consequence_if_wrong: text,
    evidence_refs: z.array(EntityRefSchema).max(100),
    options: z
      .array(z.strictObject({ id: text, label: text, tradeoff: text }))
      .min(2)
      .max(5),
    recommendation: text.nullable(),
    blocked_task_ids: z.array(id).max(100),
    unblocked_work: z.array(text).max(20),
    binding: z.strictObject({
      action_type: text,
      target: EntityRefSchema,
      content_hash: hash,
      spec_hash: hash,
      amount_cap: MoneySchema.nullable(),
      expires_at: timestamp,
    }),
    status: z.enum(['pending', 'answered', 'expired', 'revoked']),
    response: z
      .strictObject({
        actor_id: id,
        option_id: text,
        responded_at: timestamp,
        rationale: text,
      })
      .nullable(),
  })
  .superRefine((d, ctx) => {
    const options = d.options.map((o) => o.id);
    if (
      new Set(options).size !== options.length ||
      (d.recommendation !== null && !options.includes(d.recommendation))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Options must be unique; recommendation must name an option.',
      });
    if ((d.status === 'answered') !== (d.response !== null))
      ctx.addIssue({
        code: 'custom',
        message: 'Only answered decisions contain a response.',
      });
    if (
      d.response &&
      (!options.includes(d.response.option_id) ||
        Date.parse(d.response.responded_at) >=
          Date.parse(d.binding.expires_at) ||
        Date.parse(d.response.responded_at) < Date.parse(d.created_at))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Response must select an option within the decision lifetime.',
      });
    if (
      d.binding.target.workspace_id !== d.workspace_id ||
      Date.parse(d.binding.expires_at) <= Date.parse(d.created_at)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid decision binding or expiry.',
      });
  });
export const CostSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('known'),
    amount: MoneySchema,
    basis: z.enum(['fixture', 'authoritative_usage', 'estimate']),
    pricing_ref: EntityRefSchema.nullable(),
  }),
  z.strictObject({
    status: z.literal('unknown'),
    reserved_maximum: MoneySchema.nullable(),
    reason: text,
  }),
]);
export const LinkRelationSchema = z.enum([
  'supports',
  'contradicts',
  'derived_from',
  'uses',
  'implements',
  'verifies',
  'supersedes',
  'forks',
  'reuses',
  'released_as',
  'assesses',
  'part_of',
  'authorizes',
]);
export type LinkRelation = z.infer<typeof LinkRelationSchema>;
// Additive to schema 1.0 (T02): idea/assessment kinds and their relations; no T01-valid link becomes invalid.
export const linkPairs: Record<LinkRelation, readonly string[]> = {
  supports: [
    'source:claim',
    'claim:problem',
    'claim:alternative',
    'claim:idea',
  ],
  contradicts: ['source:claim', 'claim:claim'],
  derived_from: [
    'problem:claim',
    'alternative:problem',
    'product:alternative',
    'specification:alternative',
    'idea:problem',
    'idea:idea',
    'alternative:idea',
    'problem:search_brief',
    'product:idea',
    'specification:product',
    'artifact:task',
  ],
  uses: ['task:source', 'task:specification', 'run:config', 'run:prompt'],
  implements: ['task:specification', 'artifact:specification'],
  verifies: ['test:artifact', 'review:artifact'],
  supersedes: [],
  forks: ['product:product'],
  reuses: ['product:artifact'],
  released_as: ['product:artifact'],
  assesses: [
    'assessment:alternative',
    'assessment:idea',
    'assessment:problem',
    'humility_review:product',
    'humility_review:alternative',
    'humility_review:problem',
    'scorecard:alternative',
  ],
  part_of: ['task:run', 'run:product', 'assumption:run'],
  authorizes: [
    'grant:run',
    'grant:task',
    'decision:alternative',
    'decision:specification',
  ],
};
/**
 * Which endpoint is the origin in provenance terms. "A supports B" makes A the origin;
 * "A derived_from B" makes B the origin. Lineage walks use this, not raw link direction.
 */
export const provenanceOrigin: Record<LinkRelation, 'from' | 'to'> = {
  supports: 'from',
  contradicts: 'from',
  verifies: 'from',
  assesses: 'from',
  authorizes: 'from',
  released_as: 'from',
  derived_from: 'to',
  uses: 'to',
  implements: 'to',
  part_of: 'to',
  reuses: 'to',
  forks: 'to',
  supersedes: 'to',
};
/** Endpoint-type rule shared by contract validation and the persistent link repository. */
export function isAllowedLink(
  relation: LinkRelation,
  from: { kind: string; id: string; version: number },
  to: { kind: string; id: string; version: number },
): boolean {
  if (from.id === to.id && from.version === to.version) return false;
  if (relation === 'supersedes')
    return from.kind === to.kind && from.version > to.version;
  return linkPairs[relation].includes(`${from.kind}:${to.kind}`);
}
export const EntityLinkSchema = z
  .strictObject({
    ...RecordFields,
    relation: LinkRelationSchema,
    from: EntityRefSchema,
    to: EntityRefSchema,
    asserted_by: id,
    rationale: text,
  })
  .superRefine((l, ctx) => {
    if (
      l.from.workspace_id !== l.workspace_id ||
      l.to.workspace_id !== l.workspace_id
    )
      ctx.addIssue({ code: 'custom', message: 'Cross-workspace link denied.' });
    if (!isAllowedLink(l.relation, l.from, l.to))
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid relation endpoint types or self-link.',
      });
  });
export const ExperimentAssignmentSchema = z
  .strictObject({
    ...RecordFields,
    study_id: id,
    participant_code: text,
    protocol: EntityRefSchema,
    task_packet: EntityRefSchema,
    condition: ConditionSchema,
    discovery_method: DiscoverySchema,
    phase: z.enum(['pilot', 'held_out']),
    allowed_tools: z.array(text).max(100),
    generative_tools_allowed: z.boolean(),
    prompt_hash: hash.nullable(),
    rubric_hash: hash,
    assignment_seed: text,
    previous_assignment_id: id.nullable(),
  })
  .superRefine((a, ctx) => {
    if (
      a.condition === 'human_only' &&
      (a.generative_tools_allowed ||
        a.prompt_hash !== null ||
        a.discovery_method !== 'human_defined')
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Human-only assignments cannot include generative assistance or AI discovery.',
      });
    if (
      a.condition !== 'human_only' &&
      (!a.generative_tools_allowed ||
        a.prompt_hash === null ||
        a.discovery_method === 'human_defined')
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'AI assignments require a bound prompt and AI discovery method.',
      });
    if (
      a.protocol.kind !== 'protocol' ||
      a.task_packet.kind !== 'packet' ||
      a.protocol.workspace_id !== a.workspace_id ||
      a.task_packet.workspace_id !== a.workspace_id
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Assignment must bind a protocol and packet in its workspace.',
      });
  });
