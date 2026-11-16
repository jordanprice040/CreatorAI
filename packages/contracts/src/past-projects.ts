import { z, id, version, counter, timestamp } from './primitives.js';
import { ResponseTypeSchema, SearchBriefBodySchema } from './discovery.js';
import { AutonomyModeSchema, DataClassSchema } from './oversight.js';
import { WorkflowStateSchema } from './orchestration.js';
import { EvidenceSiteHostSchema } from './research.js';

// F9 "Start a similar project" (ADR-0125). A read model of past discovery runs, each with the
// setup a new project may start from: the brief as that run used it, its Discover settings,
// the websites its exploration was limited to, and the connection it ran on. It holds no
// claims, no evidence roles, no decisions, no approvals, no grants and no budgets: those
// belong to the past run and are chosen again for the new one. Nothing is written.

export const PAST_PROJECTS_MAX = 20;

export const PastProjectConnectionSchema = z.discriminatedUnion('kind', [
  /** A metered run: the new project picks its own budget and price list. */
  z.strictObject({ kind: z.literal('api') }),
  z.strictObject({
    kind: z.literal('subscription'),
    connection_id: id,
    model_id: z.string().max(300),
  }),
  z.strictObject({ kind: z.literal('local'), model_id: z.string().max(300) }),
]);
export type PastProjectConnection = z.infer<typeof PastProjectConnectionSchema>;

export const PastProjectSchema = z.strictObject({
  /** The past discovery workflow and its run, for the label and a link; never reused. */
  workflow_id: id,
  run_id: id,
  state: WorkflowStateSchema,
  started_at: timestamp,
  /** The brief at the version that run used. */
  brief: z.strictObject({
    id,
    version,
    title: z.string().max(500),
    body: SearchBriefBodySchema,
  }),
  settings: z.strictObject({
    perspectives: z.array(ResponseTypeSchema).max(5),
    excluded: z
      .array(
        z.strictObject({
          perspective: ResponseTypeSchema,
          reason: z.string().max(300),
        }),
      )
      .max(5),
    max_revisions: counter,
    max_age_days: counter,
    data_class: DataClassSchema,
    /** The run's oversight mode; null when the run record is missing. */
    oversight: AutonomyModeSchema.nullable(),
  }),
  /**
   * The websites of the exploration this brief was picked from (ADR-0065 scope), when it came
   * from one; both lists empty otherwise. The workspace's evidence-website list is shared by
   * every project already and is not copied.
   */
  sites: z.strictObject({
    exploration_id: id.nullable(),
    only_hosts: z.array(EvidenceSiteHostSchema).max(20),
    excluded_hosts: z.array(EvidenceSiteHostSchema).max(20),
  }),
  /** The route the run used; null for an older run that recorded no route. */
  connection: PastProjectConnectionSchema.nullable(),
});
export type PastProject = z.infer<typeof PastProjectSchema>;

export const PastProjectsSchema = z
  .array(PastProjectSchema)
  .max(PAST_PROJECTS_MAX);
