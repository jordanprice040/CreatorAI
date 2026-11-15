import { StartStudyEffortStepSchema, parse } from '@creator/contracts';
import type { CommandContext, StudyStore } from '@creator/db';

/** ADR-0122 (F13): start timing an intervention step, or list an attempt's timed steps. */
export const STUDY_EFFORT_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(study-attempts)\/([^/]+)\/(effort-steps)$/;

/**
 * The study effort timer's routes. The intervention itself (with its measured totals) is still
 * saved through `study-attempts/:id/interventions`. Returns false when not matched.
 */
export async function studyEffortRoutes(r: {
  store: Pick<StudyStore, 'startEffortStep' | 'effortSteps'>;
  ctx: CommandContext;
  ws: string;
  attemptId: string;
  method: string;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  if (r.method === 'POST') {
    parse(StartStudyEffortStepSchema, await r.body());
    return r.send(
      201,
      await r.store.startEffortStep(r.ctx, r.ws, r.attemptId),
      true,
    );
  }
  if (r.method === 'GET')
    return r.send(
      200,
      await r.store.effortSteps(r.ctx, r.ws, r.attemptId),
      false,
    );
  return false;
}
