import type { CommandContext } from '@creator/db';
import type { AutopilotRunner } from './autopilot.js';

/**
 * ADR-0124 (F2) routes: the usage check before an autopilot starts (reads only) and the owner
 * turning off "continue by itself after a usage limit". Returns false when not matched.
 *
 * - POST /api/workspaces/:ws/autopilots/usage-check  { config, run_id? }
 * - POST /api/workspaces/:ws/autopilots/:id/auto-resume  { expected_version? }  (turns it off)
 */
export async function autopilotUsageRoutes(r: {
  autopilot: AutopilotRunner | null;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { autopilot, ctx, ws, collection, item, action, method, send } = r;
  if (collection !== 'autopilots' || !autopilot || method !== 'POST')
    return false;
  if (item === 'usage-check' && !action)
    return send(
      200,
      await autopilot.usageCheck(ctx, ws, await r.body()),
      false,
    );
  if (item && action === 'auto-resume')
    return send(
      200,
      await autopilot.turnOffAutoResume(ctx, ws, item, await r.body()),
      true,
    );
  return false;
}
