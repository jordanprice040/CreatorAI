import {
  ContractError,
  parse,
  HumilityBodySchema,
  OVERSIGHT_POLICY_VERSION,
  type ActionType,
  type AutonomyMode,
  type Binding,
  type DecisionKind,
  type Grant,
  type HumanReason,
  type ResponseChoice,
} from '@creator/contracts';
import { canonicalHash } from './rules.js';

/**
 * Effects of each action type. Callers name an action; they cannot declare it model-free,
 * reversible or internal. Adding an action type is a code change, not a runtime setting.
 */
export interface ActionSpec {
  uses_model: boolean;
  external_effect: boolean;
  reversible: boolean;
  /** Owner-only actions are never admitted for a run, whatever grant exists. */
  owner_only: boolean;
  requires_target: boolean;
  requires_humility: boolean;
}
const spec = (s: Partial<ActionSpec>): ActionSpec => ({
  uses_model: false,
  external_effect: false,
  reversible: true,
  owner_only: false,
  requires_target: false,
  requires_humility: false,
  ...s,
});
export const ACTION_REGISTRY: Record<ActionType, ActionSpec> = {
  'record.revise': spec({ requires_target: true }),
  'assumption.log': spec({}),
  'model.generate': spec({ uses_model: true }),
  'model.summarize': spec({ uses_model: true }),
  'model.embed': spec({ uses_model: true }),
  'tool.search_public': spec({}),
  // Read-only GET through the source broker under its network policy; no model, no spend.
  'source.fetch': spec({}),
  // T08: recording a selection for a problem; a later selection replaces it.
  'candidate.select': spec({ requires_target: true }),
  'spec.freeze': spec({ reversible: false, requires_target: true }),
  'product.commit_build': spec({
    requires_target: true,
    requires_humility: true,
  }),
  'release.publish': spec({
    external_effect: true,
    reversible: false,
    requires_target: true,
  }),
  'message.send': spec({ external_effect: true, reversible: false }),
  'payment.charge': spec({ external_effect: true, reversible: false }),
  'grant.create': spec({ owner_only: true }),
  'policy.change': spec({ owner_only: true }),
  'budget.increase': spec({ owner_only: true }),
  // X04. A created repository is never deleted by the studio, so creation is irreversible.
  'github.repo_create': spec({ external_effect: true, reversible: false }),
  // Branches, pushes (no force), issues and pull requests on a managed private repository.
  'github.write': spec({ external_effect: true }),
  // Changes under .github/workflows or .github/actions: separately granted, never via github.write.
  'github.workflow_change': spec({ external_effect: true, reversible: false }),
  'github.merge': spec({ external_effect: true, reversible: false }),
};
/** Stage gates each mode asks at unless the run registers its own list. */
export const DEFAULT_STAGE_GATES: Record<AutonomyMode, readonly ActionType[]> =
  {
    supervised: [
      'candidate.select',
      'spec.freeze',
      'product.commit_build',
      'release.publish',
    ],
    human_in_loop: ['release.publish'],
    autonomous_within_scope: [],
    human_only: [],
  };
const AUTHORIZATION_REASONS: readonly HumanReason[] = [
  'outside_grant',
  'stage_gate',
];
export const reasonKind = (r: HumanReason): DecisionKind =>
  AUTHORIZATION_REASONS.includes(r)
    ? 'authorization'
    : r === 'material_assumption'
      ? 'clarification'
      : r === 'output_feedback'
        ? 'feedback'
        : 'judgment';
/** Mode and research condition must agree; an autonomy label is not cosmetic. */
export function conditionFor(mode: AutonomyMode) {
  return mode === 'human_only'
    ? 'human_only'
    : mode === 'autonomous_within_scope'
      ? 'autonomous'
      : 'human_in_loop';
}
export const bindingHash = (b: Binding) => canonicalHash(b);

export interface GrantContext {
  now: number;
  mode: AutonomyMode;
  /** Grants the autonomous run was started with, at their versions. */
  initialGrants: readonly { id: string; version: number }[];
}
/** True when the grant deterministically covers this exact binding now. */
export function grantCovers(g: Grant, b: Binding, ctx: GrantContext): boolean {
  const s = ACTION_REGISTRY[b.action_type];
  if (g.status !== 'active' || Date.parse(g.expires_at) <= ctx.now)
    return false;
  if (g.run_id !== null && g.run_id !== b.run_id) return false;
  if (
    ctx.mode === 'autonomous_within_scope' &&
    !ctx.initialGrants.some((i) => i.id === g.id && i.version === g.version)
  )
    return false;
  if (!g.action_types.includes(b.action_type)) return false;
  if (!g.data_classes.includes(b.data_class)) return false;
  if (s.external_effect && !g.allow_external_effects) return false;
  if (!s.reversible && !g.allow_irreversible) return false;
  if (b.amount_nano_usd !== null) {
    // An amount with no configured cap is not covered; unknown is not zero.
    if (g.max_amount_nano_usd === null) return false;
    if (BigInt(b.amount_nano_usd) > BigInt(g.max_amount_nano_usd)) return false;
  }
  if (g.target_kind !== null && b.target?.kind !== g.target_kind) return false;
  if (g.scope === 'once') {
    const t = g.target;
    if (
      (t === null) !== (b.target === null) ||
      (t &&
        b.target &&
        (t.id !== b.target.id ||
          t.version !== b.target.version ||
          t.content_hash !== b.target.content_hash)) ||
      g.spec_hash !== b.spec_hash ||
      g.max_amount_nano_usd !== b.amount_nano_usd
    )
      return false;
  }
  return true;
}

export interface HumilityInput {
  id: string;
  version: number;
  status: string;
  body: unknown;
}
export interface HumilityVerdict {
  review_id: string;
  review_version: number;
  disposition: string;
  build_admissible: boolean;
  needs_judgment: boolean;
  reasons: string[];
}
/**
 * What the reviewed subject is (ADR-0077, pilot F9): a hybrid option, or a spec written from
 * one, is judged on the hybrid comparison; anything else on the software-only comparison.
 */
export type HumilitySubjectKind = 'software' | 'hybrid';
/** Pre-build humility gate. A serious unresolved ethical problem is its own gate, not a score. */
export function humilityGate(
  review: HumilityInput,
  subject: { id: string; version: number } | null,
  subjectKind: HumilitySubjectKind = 'software',
): HumilityVerdict {
  const body = parse(HumilityBodySchema, review.body);
  const blockers: string[] = [];
  if (review.status !== 'active')
    blockers.push(`The review is ${review.status}.`);
  if (
    subject &&
    (body.subject.id !== subject.id || body.subject.version !== subject.version)
  )
    blockers.push('The review assesses a different subject or version.');
  // A hybrid's build is its software part: "build" or "hybrid" both recommend building it,
  // and the hybrid comparison (not software-only) says whether it is viable.
  const hybrid = subjectKind === 'hybrid';
  if (
    body.disposition !== 'build' &&
    !(hybrid && body.disposition === 'hybrid')
  )
    blockers.push(
      `The review recommends ${body.disposition.replaceAll('_', ' ')}, not building${hybrid ? ' the hybrid' : ''}.`,
    );
  if (hybrid && !body.comparisons.hybrid.viable)
    blockers.push('The review found the hybrid not viable.');
  if (!hybrid && !body.comparisons.software.viable)
    blockers.push('The review found custom software not viable.');
  const cited =
    body.evidence.supported.length +
    Object.values(body.comparisons).reduce(
      (n, c) => n + c.evidence_refs.length,
      0,
    );
  if (cited === 0) blockers.push('No supporting evidence is recorded.');
  const ethical = body.ethical.status === 'unresolved_serious';
  return {
    review_id: review.id,
    review_version: review.version,
    disposition: body.disposition,
    build_admissible: blockers.length === 0 && !ethical,
    needs_judgment: blockers.length === 0 && ethical,
    reasons: ethical
      ? [...blockers, 'A serious ethical problem is unresolved.']
      : blockers,
  };
}

export interface AssumptionInput {
  id: string;
  status: string;
  body: {
    status: 'unresolved' | 'supported' | 'refuted';
    materiality: 'routine' | 'material';
  };
}
export interface AdmissionInput {
  mode: AutonomyMode;
  runState: 'active' | 'cancelled';
  stageGates: readonly ActionType[];
  binding: Binding;
  grants: readonly Grant[];
  initialGrants: readonly { id: string; version: number }[];
  assumptions: readonly AssumptionInput[];
  humility: HumilityVerdict | null;
  flags: readonly HumanReason[];
  /** Non-authorization reasons a person already answered "proceed" to for this binding. */
  resolvedReasons: readonly HumanReason[];
  now: number;
}
export interface AdmissionVerdict {
  verdict: 'allow' | 'request_human' | 'deny' | 'defer';
  outcome: 'admitted' | 'needs_human' | 'denied' | 'waiting_human';
  reason_code: string;
  reasons: HumanReason[];
  explanation: string;
  covered_by: Grant | null;
  provisional_assumptions: string[];
  decision_kind: DecisionKind | null;
  policy_version: typeof OVERSIGHT_POLICY_VERSION;
}
const deny = (reason_code: string, explanation: string): AdmissionVerdict => ({
  verdict: 'deny',
  outcome: 'denied',
  reason_code,
  reasons: [],
  explanation,
  covered_by: null,
  provisional_assumptions: [],
  decision_kind: null,
  policy_version: OVERSIGHT_POLICY_VERSION,
});

/**
 * Admission order from HUMAN_OVERSIGHT.md: non-delegable constraints first, then grant
 * coverage, stage gates and assumption/ethical flags, then a verdict bound to one policy version.
 */
export function evaluateAction(input: AdmissionInput): AdmissionVerdict {
  const b = input.binding;
  const s = ACTION_REGISTRY[b.action_type];
  if (input.runState === 'cancelled')
    return deny(
      'run_cancelled',
      'The run was cancelled; cancellation overrides any approval.',
    );
  if (input.mode === 'human_only' && s.uses_model)
    return deny(
      'human_only_model_denied',
      'Human-only runs cannot call models, including summaries.',
    );
  if (s.owner_only)
    return deny(
      'owner_only_action',
      'Runs cannot grant authority, change policy or raise budgets.',
    );
  if (s.requires_target && b.target === null)
    return deny('missing_target', 'This action must name its exact target.');
  const reasons: HumanReason[] = [];
  if (s.requires_humility) {
    if (!input.humility)
      return deny(
        'humility_review_required',
        'Committing to a build requires a humility review of this exact subject.',
      );
    if (input.humility.needs_judgment) reasons.push('ethical_judgment');
    else if (!input.humility.build_admissible)
      return deny(
        'humility_gate_failed',
        input.humility.reasons.join(' ') || 'The humility gate did not pass.',
      );
  }
  const ctx = {
    now: input.now,
    mode: input.mode,
    initialGrants: input.initialGrants,
  };
  const gated = input.stageGates.includes(b.action_type);
  // In supervised and human-in-the-loop runs a stage gate needs an approval of this exact
  // action; an autonomous run's initial packet is its only approval.
  const covering =
    input.grants.find(
      (g) =>
        grantCovers(g, b, ctx) &&
        (!gated ||
          g.scope === 'once' ||
          input.mode === 'autonomous_within_scope'),
    ) ?? null;
  if (!covering) reasons.push(gated ? 'stage_gate' : 'outside_grant');
  const provisional: string[] = [];
  for (const a of input.assumptions) {
    if (a.status !== 'active' || a.body.status === 'supported') continue;
    if (a.body.status === 'unresolved' && a.body.materiality === 'routine')
      provisional.push(a.id);
    else reasons.push('material_assumption');
  }
  for (const f of input.flags)
    if (!AUTHORIZATION_REASONS.includes(f)) reasons.push(f);
  const open = [...new Set(reasons)].filter(
    (r) =>
      AUTHORIZATION_REASONS.includes(r) || !input.resolvedReasons.includes(r),
  );
  if (open.length === 0)
    return {
      verdict: 'allow',
      outcome: 'admitted',
      reason_code: provisional.length
        ? 'covered_with_provisional_assumptions'
        : 'covered',
      reasons: [],
      explanation: provisional.length
        ? 'Covered by an existing grant; routine reversible assumptions are logged as provisional.'
        : 'Covered by an existing grant; no human input needed.',
      covered_by: covering,
      provisional_assumptions: provisional,
      decision_kind: null,
      policy_version: OVERSIGHT_POLICY_VERSION,
    };
  // Ask the value question before the permission question.
  const first =
    open.find((r) => !AUTHORIZATION_REASONS.includes(r)) ?? open[0]!;
  if (input.mode === 'autonomous_within_scope')
    return {
      verdict: 'defer',
      outcome: 'needs_human',
      reason_code: 'needs_human',
      reasons: open,
      explanation:
        'Autonomous runs cannot obtain task-specific human input; this work is deferred.',
      covered_by: null,
      provisional_assumptions: provisional,
      decision_kind: null,
      policy_version: OVERSIGHT_POLICY_VERSION,
    };
  return {
    verdict: 'request_human',
    outcome: 'waiting_human',
    reason_code: first,
    reasons: open,
    explanation: `Needs a person: ${open.map((r) => r.replaceAll('_', ' ')).join(', ')}.`,
    covered_by: null,
    provisional_assumptions: provisional,
    decision_kind: reasonKind(first),
    policy_version: OVERSIGHT_POLICY_VERSION,
  };
}

/** The run-scoped standing grant an approve-standing answer would create. */
export function standingDraft(b: Binding) {
  const s = ACTION_REGISTRY[b.action_type];
  return {
    run_id: b.run_id,
    action_types: [b.action_type],
    target_kind: b.target?.kind ?? null,
    max_amount_nano_usd: b.amount_nano_usd,
    allow_irreversible: !s.reversible,
    allow_external_effects: s.external_effect,
    data_classes: [b.data_class],
  };
}
/** Standing approval is offered only for reversible, internal actions that no stage gate holds. */
export function standingAllowed(
  b: Binding,
  stageGates: readonly ActionType[],
): boolean {
  const s = ACTION_REGISTRY[b.action_type];
  return (
    s.reversible && !s.external_effect && !stageGates.includes(b.action_type)
  );
}
export function coverageHash(v: {
  decision_id: string;
  decision_version: number;
  once: Binding | null;
  standing: ReturnType<typeof standingDraft> | null;
  current: boolean;
}) {
  return canonicalHash(v);
}

const MAX_STANDING_MS = 90 * 86_400_000;
export interface AnswerCheck {
  kind: DecisionKind;
  status: string;
  expiresAt: string;
  runState: 'active' | 'cancelled';
  options: readonly { id: string }[];
  coverageHash: string;
  coverageCurrent: boolean;
  standingOffered: boolean;
  responderKind: 'human' | 'agent' | 'system';
  responderRole: 'owner' | 'editor' | 'viewer';
  now: number;
  answer: {
    choice: ResponseChoice;
    option_id: string | null;
    coverage_hash: string;
    standing_expires_at: string | null;
  };
}
function rule(
  ok: boolean,
  code: ConstructorParameters<typeof ContractError>[0],
  m: string,
): asserts ok {
  if (!ok) throw new ContractError(code, m);
}
/**
 * Validates a person's answer against the request's current state. Throws with the reason;
 * EXPIRED and a stale coverage tell the caller to close the request.
 */
export function checkAnswer(c: AnswerCheck): void {
  rule(
    c.responderKind === 'human',
    'ACCESS_DENIED',
    'Only a person can answer a decision; agents cannot approve themselves.',
  );
  rule(
    c.responderRole === 'owner',
    'ACCESS_DENIED',
    'Only a workspace owner can answer decisions.',
  );
  rule(
    c.runState === 'active',
    'INVALID_TRANSITION',
    'The run was cancelled; cancellation overrides pending approval.',
  );
  rule(
    c.status === 'pending',
    'INVALID_TRANSITION',
    `This decision is ${c.status}.`,
  );
  rule(c.now < Date.parse(c.expiresAt), 'EXPIRED', 'This decision expired.');
  rule(
    c.coverageCurrent,
    'VERSION_CONFLICT',
    'The target changed after this request was made; a new request is needed.',
  );
  rule(
    c.answer.coverage_hash === c.coverageHash,
    'VERSION_CONFLICT',
    'What this decision covers changed since it was shown; review it again.',
  );
  const a = c.answer;
  const approve =
    a.choice === 'approve_once' || a.choice === 'approve_standing';
  rule(
    !approve || c.kind === 'authorization',
    'INVALID_CONTRACT',
    'Only authorization requests can be approved; answer value questions with an option.',
  );
  rule(
    a.choice !== 'choose_option' || c.kind !== 'authorization',
    'INVALID_CONTRACT',
    'Authorization requests are approved, rejected or deferred, not answered with an option.',
  );
  rule(
    (a.choice === 'choose_option') === (a.option_id !== null) &&
      (a.option_id === null || c.options.some((o) => o.id === a.option_id)),
    'INVALID_CONTRACT',
    'Choosing an option requires one of the listed option ids, and only then.',
  );
  if (a.choice === 'approve_standing') {
    rule(
      c.standingOffered,
      'INVALID_CONTRACT',
      'This action can only be approved once: it is irreversible, external or stage-gated.',
    );
    const until = a.standing_expires_at ? Date.parse(a.standing_expires_at) : 0;
    rule(
      until > c.now && until - c.now <= MAX_STANDING_MS,
      'INVALID_CONTRACT',
      'A standing approval needs an expiry within 90 days.',
    );
  } else
    rule(
      a.standing_expires_at === null,
      'INVALID_CONTRACT',
      'Only standing approvals take an expiry.',
    );
}
