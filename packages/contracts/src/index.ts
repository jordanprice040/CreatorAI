export * from './primitives.js';
export * from './records.js';
export * from './execution.js';
import { TaskSchema, TaskResultSchema, RunConfigSchema } from './execution.js';
import {
  SourceSchema,
  ClaimSchema,
  AlternativeSchema,
  AssumptionSchema,
  DecisionRequestSchema,
  CostSchema,
  EntityLinkSchema,
  ExperimentAssignmentSchema,
} from './records.js';
export const contractSchemas = {
  task: TaskSchema,
  result: TaskResultSchema,
  run_config: RunConfigSchema,
  source: SourceSchema,
  claim: ClaimSchema,
  alternative: AlternativeSchema,
  assumption: AssumptionSchema,
  decision: DecisionRequestSchema,
  cost: CostSchema,
  link: EntityLinkSchema,
  assignment: ExperimentAssignmentSchema,
} as const;
