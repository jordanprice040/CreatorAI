import { createHash } from 'node:crypto';
import {
  z,
  parse,
  ModelRegistryBodySchema,
  RegistryModelSchema,
  PricingSnapshotBodySchema,
} from '@creator/contracts';
import { checkDiscoveryOutput } from './discovery.js';
import { canonicalHash } from './rules.js';
import type {
  ArmSummary,
  BenchmarkCheck,
  CostSummary,
  ModelRef,
  ModelRegistryBody,
  ObjectiveSignal,
  PricingSnapshotBody,
  Promotion,
  PromotionCriteria,
  PromotionEvaluation,
  Rate,
  RegistryModel,
  RouteCandidate,
  RoutePolicyBody,
  RouteReason,
  RouteRequest,
} from '@creator/contracts';

// X01 pure routing rules. The store supplies registry, policy, promotions and evidence; these
// functions decide deterministically. Rates are exact fractions and money is BigInt.
export const modelKey = (m: ModelRef) => `${m.provider}/${m.model_id}`;
export const sameModel = (a: ModelRef, b: ModelRef) =>
  a.provider === b.provider && a.model_id === b.model_id;
const big = (v: string | number) => BigInt(v);

/** a ≥ b for exact fractions. */
export const rateAtLeast = (a: Rate, b: Rate) =>
  big(a.numerator) * big(b.denominator) >=
  big(b.numerator) * big(a.denominator);
export const rateOf = (accepted: number, cases: number): Rate | null =>
  cases === 0 ? null : { numerator: accepted, denominator: cases };

export function sumCosts(costs: CostSummary[]): CostSummary {
  return costs.reduce<CostSummary>(
    (s, c) => ({
      incurred_nano: String(big(s.incurred_nano) + big(c.incurred_nano)),
      unknown_nano: String(big(s.unknown_nano) + big(c.unknown_nano)),
      operations: s.operations + c.operations,
    }),
    { incurred_nano: '0', unknown_nano: '0', operations: 0 },
  );
}

/**
 * Cost per accepted result counts everything spent on the arm: failed and rejected attempts,
 * reviews, repairs and tools, divided by accepted results only (rounded up). No accepted
 * result means no finite cost. Unknown exposure is reported, never treated as zero.
 */
export function summarizeArm(
  model: ModelRef,
  rows: { accepted: boolean; cost: CostSummary }[],
): ArmSummary {
  const accepted = rows.filter((r) => r.accepted).length;
  const cost = sumCosts(rows.map((r) => r.cost));
  const incurred = big(cost.incurred_nano);
  return {
    provider: model.provider,
    model_id: model.model_id,
    cases: rows.length,
    accepted,
    accepted_rate: rateOf(accepted, rows.length),
    cost,
    cost_per_accepted_nano:
      accepted === 0
        ? null
        : String((incurred + big(accepted) - 1n) / big(accepted)),
  };
}

/** Savings are claimed only from measured, fully known costs in a real workspace. */
export function savingsClaim(
  fixture: boolean,
  candidate: ArmSummary,
  baseline: ArmSummary | null,
): PromotionEvaluation['savings_claim'] {
  if (fixture) return 'not_claimed_fixture';
  if (
    !baseline ||
    candidate.cost_per_accepted_nano === null ||
    baseline.cost_per_accepted_nano === null
  )
    return 'not_claimed_no_accepted';
  if (candidate.cost.unknown_nano !== '0' || baseline.cost.unknown_nano !== '0')
    return 'not_claimed_unknown_cost';
  return big(candidate.cost_per_accepted_nano) <
    big(baseline.cost_per_accepted_nano)
    ? 'measured'
    : 'not_claimed_not_cheaper';
}

type Row = {
  accepted: boolean;
  cost: CostSummary;
  split?: 'development' | 'held_out';
};
/**
 * The held-out gate: enough held-out cases, at or above the quality floor, and no larger
 * drop below the baseline than allowed. Development-split rows never count.
 */
export function evaluateBenchmark(
  criteria: PromotionCriteria,
  candidate: ModelRef,
  baseline: ModelRef,
  candidateRows: Row[],
  baselineRows: Row[],
  fixture: boolean,
): PromotionEvaluation {
  const heldOut = (rows: Row[]) => rows.filter((r) => r.split === 'held_out');
  const cand = summarizeArm(candidate, heldOut(candidateRows));
  const base = summarizeArm(baseline, heldOut(baselineRows));
  const reasons: string[] = [];
  if (cand.cases < criteria.min_held_out_cases)
    reasons.push('held_out_cases_below_minimum');
  if (base.cases !== cand.cases) reasons.push('baseline_not_run_on_same_cases');
  if (
    !cand.accepted_rate ||
    !rateAtLeast(cand.accepted_rate, criteria.quality_floor)
  )
    reasons.push('below_quality_floor');
  if (cand.accepted_rate && base.accepted_rate) {
    // candidate + max_regression ≥ baseline, in exact arithmetic.
    const c = cand.accepted_rate;
    const r = criteria.max_regression;
    const b = base.accepted_rate;
    const d = big(c.denominator) * big(r.denominator) * big(b.denominator);
    const lhs =
      big(c.numerator) * big(r.denominator) * big(b.denominator) +
      big(r.numerator) * big(c.denominator) * big(b.denominator);
    const rhs = big(b.numerator) * big(c.denominator) * big(r.denominator);
    if (d > 0n && lhs < rhs)
      reasons.push('regression_vs_baseline_exceeds_limit');
  }
  return {
    stage: 'benchmark',
    passed: reasons.length === 0,
    reasons: reasons.length ? reasons : ['held_out_gate_passed'],
    candidate: cand,
    baseline: base,
    savings_claim: savingsClaim(fixture, cand, base),
  };
}

/** Shadow, canary and post-promotion gates use the same objective accepted-rate test. */
export function evaluateStage(
  stage: 'shadow' | 'canary' | 'post_promotion',
  criteria: PromotionCriteria,
  candidate: ModelRef,
  rows: Row[],
  fixture: boolean,
): PromotionEvaluation {
  const window =
    stage === 'post_promotion' ? rows.slice(-criteria.rollback_window) : rows;
  const min =
    stage === 'shadow'
      ? criteria.shadow_min_outcomes
      : stage === 'canary'
        ? criteria.canary_min_outcomes
        : criteria.rollback_window;
  const summary = summarizeArm(candidate, window);
  const reasons: string[] = [];
  if (summary.cases < min) reasons.push('outcomes_below_minimum');
  else if (
    !summary.accepted_rate ||
    !rateAtLeast(summary.accepted_rate, criteria.quality_floor)
  )
    reasons.push('below_quality_floor');
  return {
    stage,
    passed: reasons.length === 0,
    reasons: reasons.length ? reasons : [`${stage}_gate_passed`],
    candidate: summary,
    baseline: null,
    savings_claim: fixture ? 'not_claimed_fixture' : 'not_claimed_no_accepted',
  };
}

/** Deterministic canary slice: the same operation always lands in the same bucket. */
export function inCanarySlice(
  promotionId: string,
  logicalOperationId: string,
  fraction: Rate,
): boolean {
  const h = createHash('sha256')
    .update(`${promotionId.toLowerCase()}:${logicalOperationId.toLowerCase()}`)
    .digest();
  return h.readUIntBE(0, 6) % fraction.denominator < fraction.numerator;
}

/** Objective acceptance check of a benchmark output; never a model's own judgement. */
export function checkOutput(
  check: BenchmarkCheck,
  output: { text: string; json: unknown } | null,
  status: { succeeded: boolean; reason_code: string },
): ObjectiveSignal {
  if (!status.succeeded || !output)
    return status.reason_code === 'incomplete_output'
      ? 'incomplete_output'
      : status.reason_code === 'malformed_output'
        ? 'schema_invalid'
        : 'provider_error';
  switch (check.kind) {
    case 'discovery_contract': {
      if (canonicalHash(check.packet) !== check.context.packet_hash)
        return 'acceptance_check_failed';
      const validated = checkDiscoveryOutput(
        check.task_kind,
        output.json,
        check.packet,
        check.context,
      );
      if (!validated.ok)
        return validated.problem === 'does not match the output schema'
          ? 'schema_invalid'
          : 'acceptance_check_failed';
      if ((output.json as { fixture?: boolean }).fixture === true)
        return 'acceptance_check_failed';
      const valuesAt = (value: unknown, path: string[]): unknown[] => {
        if (!path.length) return [value];
        const [key, ...rest] = path;
        if (key === '*')
          return Array.isArray(value)
            ? value.flatMap((v) => valuesAt(v, rest))
            : [];
        if (!value || typeof value !== 'object' || !Object.hasOwn(value, key!))
          return [];
        return valuesAt((value as Record<string, unknown>)[key!], rest);
      };
      const same = (a: unknown, b: unknown) =>
        JSON.stringify(a) === JSON.stringify(b);
      return check.assertions.every((a) => {
        let target: unknown = output.json;
        if (a.select) {
          if (check.task_kind !== 'skeptic') return false;
          const reviews = (
            output.json as {
              reviews: {
                proposal: string;
                findings: {
                  type: string;
                  catalog_ref: string | null;
                  claim_refs: string[];
                }[];
              }[];
            }
          ).reviews;
          const selected = reviews.filter(
            (r) => r.proposal === a.select!.proposal,
          );
          if (selected.length !== 1) return false;
          target = selected[0];
          const f = a.select.finding;
          if (f) {
            const findings = selected[0]!.findings.filter(
              (r) =>
                r.type === f.type &&
                (f.catalog_ref === undefined ||
                  r.catalog_ref === f.catalog_ref) &&
                (f.claim_ref === undefined ||
                  r.claim_refs.includes(f.claim_ref)),
            );
            // Ambiguity must not silently choose the first matching finding.
            if (findings.length !== 1) return false;
            target = findings[0];
          }
        }
        const found = valuesAt(target, a.path);
        if (!found.length) return false;
        if (a.op === 'nonempty')
          return found.every((v) =>
            typeof v === 'string'
              ? !!v.trim()
              : Array.isArray(v) && v.length > 0,
          );
        if (a.op === 'equals') return found.every((v) => same(v, a.value));
        if (a.op === 'one_of')
          return found.every((v) => a.values!.some((x) => same(x, v)));
        return found.some((v) =>
          Array.isArray(v) ? v.some((x) => same(x, a.value)) : same(v, a.value),
        );
      })
        ? 'accepted'
        : 'acceptance_check_failed';
    }
    case 'json_keys': {
      const j = output.json;
      if (j === null || typeof j !== 'object' || Array.isArray(j))
        return 'schema_invalid';
      return check.keys.every((k) => Object.hasOwn(j, k))
        ? 'accepted'
        : 'acceptance_check_failed';
    }
    case 'contains_all': {
      const t = output.text.toLowerCase();
      return check.phrases.every((p) => t.includes(p.toLowerCase()))
        ? 'accepted'
        : 'acceptance_check_failed';
    }
    case 'exact_label':
      return output.text.trim() === check.label
        ? 'accepted'
        : 'acceptance_check_failed';
    case 'review_verdict': {
      const r = output.json as {
        candidate?: unknown;
        spec_hash?: unknown;
        task_hash?: unknown;
        verdict?: unknown;
        findings?: unknown;
      } | null;
      if (
        !r ||
        typeof r !== 'object' ||
        !Array.isArray(r.findings) ||
        !r.findings.every((f) => typeof f === 'string' && f.length > 0)
      )
        return 'schema_invalid';
      if (
        r.candidate !== check.candidate ||
        r.spec_hash !== check.spec_hash ||
        r.task_hash !== check.task_hash
      )
        return 'acceptance_check_failed';
      // T12 accepts only an approve with no findings, so the benchmark scores the same way.
      if (check.verdict === 'approve')
        return r.verdict === 'approve' && r.findings.length === 0
          ? 'accepted'
          : 'review_rejected';
      return r.verdict === 'changes_requested' && r.findings.length > 0
        ? 'accepted'
        : 'acceptance_check_failed';
    }
    case 'patch_cases':
      // Grading runs code in the isolated worker; only the studio's patch scorer may do it.
      throw new Error(
        'patch_cases checks are graded by the studio patch scorer',
      );
  }
}

export interface RoutingInputs {
  fixture: boolean;
  registry: ModelRegistryBody;
  pricing: Map<string, PricingSnapshotBody>;
  policy: RoutePolicyBody;
  request: RouteRequest;
  /** Non-terminal and promoted promotions for this task class. */
  promotions: Promotion[];
}
type Evidence = {
  rate: Rate | null;
  cpa: string | null;
  promotion: string | null;
};

/** Latest held-out evidence per model for this task class, from benchmark evaluations. */
function evidenceFor(promotions: Promotion[]): Map<string, Evidence> {
  const out = new Map<string, Evidence>();
  const ordered = [...promotions].sort((a, b) =>
    a.updated_at.localeCompare(b.updated_at),
  );
  for (const p of ordered) {
    const bench = [...p.evaluations]
      .reverse()
      .find((e) => e.stage === 'benchmark');
    if (!bench) continue;
    out.set(modelKey(p.candidate), {
      rate: bench.candidate.accepted_rate,
      cpa: bench.candidate.cost_per_accepted_nano,
      promotion: p.id,
    });
    if (bench.baseline)
      out.set(modelKey(p.baseline), {
        rate: bench.baseline.accepted_rate,
        cpa: bench.baseline.cost_per_accepted_nano,
        promotion: null,
      });
  }
  return out;
}

/** Hard constraints every route must meet, whatever the policy or evidence. */
export function hardReasons(
  m: RegistryModel,
  pricing: PricingSnapshotBody | undefined,
  req: RouteRequest,
  fixture: boolean,
): RouteReason[] {
  const r: RouteReason[] = [];
  if (m.availability.state === 'withdrawn') r.push('model_withdrawn');
  else if (!fixture && m.availability.state !== 'verified')
    r.push('model_unverified');
  if (!pricing || !pricing.supported_actions.includes(req.action_type))
    r.push('action_unsupported');
  if (!m.task_classes.includes(req.task_class))
    r.push('task_class_unsupported');
  if (
    req.tools.some(
      (t) => !m.tools.includes(t) || pricing?.tool_call_rates[t] === undefined,
    )
  )
    r.push('tool_unsupported');
  if (!m.data_classes.includes(req.data_class)) r.push('privacy_incompatible');
  if (
    pricing &&
    (req.max_output_tokens > pricing.max_output_tokens ||
      req.estimated_input_tokens + req.max_output_tokens >
        pricing.context_window_tokens)
  )
    r.push('context_exceeded');
  if (req.max_latency_ms !== null) {
    if (m.latency.p95_ms === null || m.latency.basis === 'unknown')
      r.push('latency_unknown');
    else if (m.latency.p95_ms > req.max_latency_ms) r.push('latency_exceeded');
  }
  return r;
}

export type RouteChoice =
  | {
      status: 'routed';
      model: ModelRef;
      role:
        | 'reference_baseline'
        | 'fixed'
        | 'auto'
        | 'economy'
        | 'canary'
        | 'escalation';
      promotion: Promotion | null;
      shadow: Promotion | null;
      candidates: RouteCandidate[];
      explanation: string;
    }
  | {
      status: 'refused';
      reason_code: string;
      candidates: RouteCandidate[];
      explanation: string;
    };

/**
 * Qualifies every registry model, then applies the policy. Only the reference baseline and
 * promoted models are quality-qualified; a canary candidate serves only its capped,
 * deterministic slice, and a shadow candidate is evaluated alongside, never served.
 */
export function chooseRoute(
  inp: RoutingInputs,
  canaryAvailable: (p: Promotion) => boolean,
  escalation: { failed: ModelRef } | null = null,
): RouteChoice {
  const { registry, policy, request, fixture } = inp;
  const ref = registry.reference_model;
  const evidence = evidenceFor(inp.promotions);
  const promoted = new Map(
    inp.promotions
      .filter((p) => p.state === 'promoted')
      .map((p) => [modelKey(p.candidate), p]),
  );
  const canaries = inp.promotions.filter((p) => p.state === 'canary');
  const shadows = inp.promotions.filter((p) => p.state === 'shadow');
  const allowed = (m: ModelRef) =>
    !policy.allowed_models ||
    policy.allowed_models.some((a) => sameModel(a, m));
  const hard = new Map<string, RouteReason[]>();
  const candidates: RouteCandidate[] = registry.models.map((m) => {
    const key = modelKey(m);
    const reasons = hardReasons(m, inp.pricing.get(key), request, fixture);
    if (!allowed(m)) reasons.push('not_allowed_by_policy');
    hard.set(key, [...reasons]);
    const ev = evidence.get(key);
    let promotion: string | null = null;
    if (!reasons.length) {
      if (sameModel(m, ref)) reasons.push('eligible_reference_baseline');
      else if (promoted.has(key)) {
        reasons.push('eligible_promoted');
        promotion = promoted.get(key)!.id;
      } else reasons.push('not_promoted');
    }
    return {
      provider: m.provider,
      model_id: m.model_id,
      eligible: reasons[0]?.startsWith('eligible_') ?? false,
      reasons,
      held_out_accepted: ev?.rate ?? null,
      cost_per_accepted_nano: ev?.cpa ?? null,
      promotion_id: promotion ?? ev?.promotion ?? null,
    };
  });
  const byKey = new Map(candidates.map((c) => [modelKey(c), c]));
  const refuse = (reason_code: string, explanation: string): RouteChoice => ({
    status: 'refused',
    reason_code,
    candidates,
    explanation,
  });
  const shadow =
    shadows.find(
      (p) => (hard.get(modelKey(p.candidate)) ?? ['x']).length === 0,
    ) ?? null;
  const routed = (
    model: ModelRef,
    role: Extract<RouteChoice, { status: 'routed' }>['role'],
    explanation: string,
    promotion: Promotion | null = null,
  ): RouteChoice => ({
    status: 'routed',
    model: { provider: model.provider, model_id: model.model_id },
    role,
    promotion,
    shadow: role === 'escalation' ? null : shadow,
    candidates,
    explanation,
  });
  const refCandidate = byKey.get(modelKey(ref));
  if (escalation) {
    if (sameModel(escalation.failed, ref))
      return refuse(
        'escalation_exhausted',
        'The reference baseline already failed the objective check; a person must decide.',
      );
    if (!refCandidate?.eligible)
      return refuse(
        'escalation_unavailable',
        `The reference baseline cannot take this request (${(refCandidate?.reasons ?? []).join(', ')}).`,
      );
    return routed(
      ref,
      'escalation',
      `Escalated from ${modelKey(escalation.failed)} to the reference baseline after an objective failure.`,
    );
  }
  if (policy.mode === 'fixed') {
    const want = policy.fixed_model!;
    const c = byKey.get(modelKey(want));
    if (!c)
      return refuse(
        'route_unknown',
        `${modelKey(want)} is not in the registry.`,
      );
    if (!c.eligible)
      return refuse(
        hard.get(modelKey(want))!.length
          ? 'route_unsupported'
          : 'route_unqualified',
        `Fixed route ${modelKey(want)} is not qualified: ${c.reasons.join(', ')}. No substitute is used.`,
      );
    return routed(want, 'fixed', `Fixed policy route ${modelKey(want)}.`);
  }
  // A canary serves only its capped slice, and only where the candidate meets every hard
  // constraint and the policy allows it.
  for (const p of canaries) {
    const key = modelKey(p.candidate);
    if ((hard.get(key) ?? ['x']).length) continue;
    const c = byKey.get(key)!;
    if (
      canaryAvailable(p) &&
      inCanarySlice(
        p.id,
        request.logical_operation_id,
        p.criteria.canary_fraction,
      )
    ) {
      c.eligible = true;
      c.reasons = ['eligible_canary'];
      c.promotion_id = p.id;
      return routed(
        p.candidate,
        'canary',
        `Capped canary for promotion ${p.id}; outcomes decide promotion or rollback.`,
        p,
      );
    }
    c.reasons = ['canary_not_selected'];
  }
  const eligible = candidates.filter((c) => c.eligible);
  if (!eligible.length)
    return refuse(
      'no_qualified_route',
      'No registry model meets the hard constraints and quality qualification for this request.',
    );
  const promotionOf = (c: RouteCandidate) => promoted.get(modelKey(c)) ?? null;
  if (policy.mode === 'auto') {
    const best = [...eligible].sort((a, b) => {
      const ra = a.held_out_accepted;
      const rb = b.held_out_accepted;
      if (ra && rb && !(rateAtLeast(ra, rb) && rateAtLeast(rb, ra)))
        return rateAtLeast(ra, rb) ? -1 : 1;
      if (ra && !rb) return -1;
      if (rb && !ra) return 1;
      const ca = a.cost_per_accepted_nano;
      const cb = b.cost_per_accepted_nano;
      if (ca && cb && ca !== cb) return big(ca) < big(cb) ? -1 : 1;
      return sameModel(a, ref) ? -1 : sameModel(b, ref) ? 1 : 0;
    })[0]!;
    return routed(
      best,
      sameModel(best, ref) ? 'reference_baseline' : 'auto',
      `Auto: best held-out accepted rate among ${eligible.length} qualified route(s).`,
      promotionOf(best),
    );
  }
  const floor = policy.quality_floor!;
  const affordable = eligible.filter((c) => {
    if (!c.held_out_accepted || !rateAtLeast(c.held_out_accepted, floor)) {
      if (!sameModel(c, ref)) c.reasons = [...c.reasons, 'below_quality_floor'];
      return false;
    }
    return c.cost_per_accepted_nano !== null;
  });
  const cheapest = affordable.sort((a, b) =>
    big(a.cost_per_accepted_nano!) < big(b.cost_per_accepted_nano!)
      ? -1
      : big(a.cost_per_accepted_nano!) > big(b.cost_per_accepted_nano!)
        ? 1
        : sameModel(a, ref)
          ? -1
          : 1,
  )[0];
  if (cheapest)
    return routed(
      cheapest,
      sameModel(cheapest, ref) ? 'reference_baseline' : 'economy',
      `Economy: lowest held-out cost per accepted result at or above the quality floor.`,
      promotionOf(cheapest),
    );
  if (refCandidate?.eligible)
    return routed(
      ref,
      'reference_baseline',
      'Economy: no measured route meets the quality floor; using the reference baseline.',
    );
  return refuse(
    'no_qualified_route',
    'No route meets the quality floor and the reference baseline cannot take this request.',
  );
}

/** A stable UUID-shaped id derived from its parts (benchmark and shadow operations). */
export function derivedId(...parts: string[]): string {
  const h = createHash('sha256')
    .update(parts.map((p) => p.toLowerCase()).join('\u0000'))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const benchmarkOperationId = (
  promotionId: string,
  model: ModelRef,
  caseId: string,
) => derivedId('route-benchmark', promotionId, modelKey(model), caseId);

/**
 * config/routing/model-registry*.json: a registry whose entries name their pricing file
 * instead of its hash. The hash is computed from the file, so the registry cannot drift from
 * the price it was written against.
 */
export const RegistryConfigSchema = z.strictObject({
  format: z.literal('model-registry-config/1'),
  registry_version: z.string(),
  recorded_on: z.string(),
  fixture: z.boolean(),
  reference_model: z.unknown(),
  models: z.array(
    RegistryModelSchema.omit({ pricing_hash: true }).extend({
      pricing_file: z.string().regex(/^config\/pricing\/[a-z0-9.-]+\.json$/),
    }),
  ),
});
export function registryRequestFromConfig(
  raw: unknown,
  readPricing: (path: string) => unknown,
) {
  const cfg = parse(RegistryConfigSchema, raw, 'INVALID_CONFIG');
  const pricing = cfg.models.map((m) =>
    parse(
      PricingSnapshotBodySchema,
      readPricing(m.pricing_file),
      'INVALID_CONFIG',
    ),
  );
  const registry = parse(
    ModelRegistryBodySchema,
    {
      format: 'model-registry/1',
      registry_version: cfg.registry_version,
      recorded_on: cfg.recorded_on,
      fixture: cfg.fixture,
      reference_model: cfg.reference_model,
      models: cfg.models.map(({ pricing_file: _file, ...m }, i) => ({
        ...m,
        pricing_hash: canonicalHash(pricing[i]),
      })),
    },
    'INVALID_CONFIG',
  );
  return { registry, pricing };
}
