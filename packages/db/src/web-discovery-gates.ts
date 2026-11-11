import type { PoolClient } from 'pg';
import {
  ContractError,
  WEB_DISCOVERY_TASK_CLASS,
  type PlanAdmissionRequest,
  type WebLead,
} from '@creator/contracts';

// ADR-0086 (P12): what the owner's start of one web discovery covers, checked in code under
// row locks. Like a build's one approval (ADR-0054), it covers exactly this discovery's search
// request, its reading request and fetches of the pages it chose, nothing else and only once.

export interface WebDiscoveryBinding {
  discovery_id: string;
  stage: 'search' | 'read';
}

const RUN_CLOSED = (run: Record<string, unknown> | undefined) =>
  !run ||
  run.state !== 'active' ||
  run.experiment_condition === 'human_only' ||
  run.autonomy_mode === 'human_only';

/**
 * Refuses a plan request a web discovery does not cover. Lock order: the run (by the caller's
 * `lockRun`), then the discovery, then (back in admission) the connection.
 */
export async function webDiscoveryRequestGate(
  c: PoolClient,
  ws: string,
  actorId: string,
  req: PlanAdmissionRequest,
  b: WebDiscoveryBinding,
  lockRun: (runId: string) => Promise<unknown>,
  requireOwner: () => Promise<unknown>,
): Promise<void> {
  if (
    req.purpose !== 'task' ||
    req.path !== 'responses' ||
    req.task_class !== WEB_DISCOVERY_TASK_CLASS ||
    req.data_class !== 'public' ||
    !req.run_id
  )
    throw new ContractError(
      'INVALID_CONTRACT',
      'A web discovery request is a research synthesis task on public data, in its run.',
    );
  await requireOwner();
  await lockRun(req.run_id);
  const run = (
    await c.query(
      'select * from run_controls where workspace_id = $1 and run_id = $2',
      [ws, req.run_id.toLowerCase()],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  const d = (
    await c.query(
      'select * from web_discoveries where workspace_id = $1 and id = $2 for update',
      [ws, b.discovery_id.toLowerCase()],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (!d) throw new ContractError('NOT_FOUND', 'Web discovery not found.');
  const out: string[] = [];
  if (String(d.run_id) !== req.run_id.toLowerCase())
    out.push('The request names another run than the discovery.');
  if (
    String(d.connection_id) !== req.connection_id.toLowerCase() ||
    d.model_id !== req.model_id
  )
    out.push(
      'The request names another connection or model than the discovery.',
    );
  if (String(d.created_by) !== actorId)
    out.push('Only the person who started this discovery can continue it.');
  const want = b.stage === 'search' ? 'searching' : 'reading';
  if (d.state !== want)
    out.push(`The discovery is ${String(d.state)}, not ${want}.`);
  if ((b.stage === 'search' ? d.search_request_id : d.read_request_id) !== null)
    out.push(
      `This discovery already made its ${b.stage === 'search' ? 'search' : 'reading'} request; it makes each once.`,
    );
  if (RUN_CLOSED(run))
    out.push(
      'The run is cancelled or human-only; no model request is admitted.',
    );
  const study = await c.query(
    'select 1 from study_attempts where workspace_id = $1 and run_id = $2',
    [ws, req.run_id.toLowerCase()],
  );
  if (study.rowCount)
    out.push('Web discovery is not used for frozen study assignments.');
  if (out.length)
    throw new ContractError(
      'ACCESS_DENIED',
      'This web discovery request is not admitted.',
      out,
    );
}

/**
 * Why a fetch for this discovery is not covered (null: it is). The caller already holds the
 * run's lock; the discovery row is locked here.
 */
export async function webDiscoveryFetchRefusal(
  c: PoolClient,
  ws: string,
  runId: string,
  actorId: string,
  discoveryId: string,
  url: string,
): Promise<{ code: string; text: string } | null> {
  const run = (
    await c.query(
      'select * from run_controls where workspace_id = $1 and run_id = $2',
      [ws, runId],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (!run || run.state !== 'active')
    return {
      code: 'run_cancelled',
      text: 'The run was cancelled; cancellation overrides any approval.',
    };
  const d = (
    await c.query(
      'select * from web_discoveries where workspace_id = $1 and id = $2 for update',
      [ws, discoveryId.toLowerCase()],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (!d || String(d.run_id) !== runId)
    return {
      code: 'web_discovery_not_found',
      text: 'No web discovery of this run chose this page.',
    };
  if (String(d.created_by) !== actorId)
    return {
      code: 'web_discovery_other_person',
      text: 'Only the person who started this discovery can fetch for it.',
    };
  if (d.state !== 'fetching')
    return {
      code: 'web_discovery_not_fetching',
      text: `The discovery is ${String(d.state)}; it fetches pages only while fetching.`,
    };
  if (
    !(d.leads as WebLead[]).some(
      (l) => l.disposition === 'selected' && l.url === url,
    )
  )
    return {
      code: 'web_discovery_page_not_chosen',
      text: 'This URL is not one of the pages the discovery chose from its search.',
    };
  return null;
}
