import {
  RunBenchmarkRequestSchema,
  parse,
  type Promotion,
} from '@creator/contracts';
import { benchmarkOperationId } from '@creator/domain';
import type { CommandContext, RoutingStore } from '@creator/db';
import type { ModelBroker } from './broker.js';

/**
 * X01 held-out benchmark run: every frozen case for the candidate and the reference baseline,
 * each as an ordinary metered broker call (grants, envelope and pricing all apply) under a
 * derived operation id, so a rerun never dispatches twice. The store then scores the cases
 * from the broker's own records and applies the gate.
 */
export async function runPromotionBenchmark(
  store: RoutingStore,
  broker: ModelBroker,
  ctx: CommandContext,
  ws: string,
  promotionId: string,
  raw: unknown,
): Promise<Promotion> {
  const req = parse(RunBenchmarkRequestSchema, raw);
  const plan = await store.benchmarkPlan(ctx, ws, promotionId);
  for (const arm of plan.arms)
    for (const k of plan.manifest.cases)
      await broker.callModel(ctx, ws, req.run_id, arm.model, {
        envelope_id: req.envelope_id,
        action_type: 'model.generate',
        task_id: null,
        logical_operation_id: benchmarkOperationId(
          plan.promotion.id,
          arm.model,
          k.case_id,
        ),
        pricing_snapshot_id: arm.pricing_snapshot_id,
        data_class: plan.manifest.data_class,
        input: k.input,
        max_output_tokens: k.max_output_tokens,
        output_format: k.output_format,
        tool: null,
        max_attempts: 1,
        timeout_ms: req.timeout_ms,
        justification: `Held-out benchmark ${plan.manifest.name}, case ${k.case_id}, for a route promotion.`,
      });
  return store.recordBenchmark(ctx, ws, promotionId);
}
