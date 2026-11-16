import { createHash } from 'node:crypto';
import type { SourceBroker } from '@creator/research';
import {
  SOURCE_RECHECK_MAX,
  SourceRecheckRequestSchema,
  parse,
  type ProblemComparison,
  type Retrieval,
  type SourceRecheckOutcome,
  type SourceRecheckResult,
} from '@creator/contracts';
import type { CommandContext } from '@creator/db';

/** F8 (ADR-0126): POST rechecks the sources cited by one problem's claims. */
export const SOURCE_RECHECK_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(problems)\/([^/]+)\/(source-rechecks)$/;

/**
 * A fixed fetch identity per recheck and source, so a retried request replays the recorded
 * retrieval instead of fetching again (UUID version 8, from a SHA-256 of both ids).
 */
export function recheckOperationId(recheckId: string, sourceId: string) {
  const h = createHash('sha256')
    .update(
      `source-recheck:${recheckId.toLowerCase()}:${sourceId.toLowerCase()}`,
    )
    .digest('hex');
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function outcomeOf(r: Retrieval): SourceRecheckOutcome {
  if (r.state === 'fetched') return r.changed ? 'changed' : 'unchanged';
  if (r.state === 'removed' || r.state === 'inaccessible') return 'page_gone';
  return 'not_checked';
}

/**
 * Fetches each source the problem's claims cite (least recently checked first, at most
 * SOURCE_RECHECK_MAX) through the source broker, so the run's fetch permission, its fetch
 * limit and the approved-site rules all apply. No model calls and no spending. Claims and
 * their support are never edited: what changed shows as a flag when the claims are read.
 * Stops at the first fetch that needs approval or is refused, so one press never files a
 * request per source.
 */
export async function recheckSources(o: {
  sources: SourceBroker;
  comparison: () => Promise<ProblemComparison>;
  ctx: CommandContext;
  ws: string;
  problemId: string;
  raw: unknown;
}): Promise<SourceRecheckResult> {
  const req = parse(SourceRecheckRequestSchema, o.raw);
  const cmp = await o.comparison();
  const cited = new Map<
    string,
    { title: string; url: string; checked: string | null }
  >();
  for (const c of cmp.claims)
    for (const r of c.evidence.rows) {
      if (r.freshness === 'retracted') continue;
      const id = r.support.source_id;
      const seen = cited.get(id);
      if (!seen)
        cited.set(id, {
          title: r.source_title,
          url: r.source_url,
          checked: r.last_checked_at,
        });
    }
  // Never checked first, then oldest check first; ties by id so the order is stable.
  const order = [...cited.entries()].sort(([a, x], [b, y]) => {
    const tx = x.checked ? Date.parse(x.checked) : -Infinity;
    const ty = y.checked ? Date.parse(y.checked) : -Infinity;
    return tx === ty ? a.localeCompare(b) : tx - ty;
  });
  const picked = order.slice(0, SOURCE_RECHECK_MAX);
  const out: SourceRecheckResult['sources'] = [];
  let stopped: SourceRecheckResult['stopped'] = null;
  for (const [sourceId, s] of picked) {
    const base = { source_id: sourceId, title: s.title, url: s.url };
    if (stopped) {
      out.push({
        ...base,
        outcome: 'not_tried',
        retrieval_id: null,
        decision_id: null,
        state: null,
        reason_code: null,
        explanation: null,
      });
      continue;
    }
    const r = await o.sources.fetch(o.ctx, o.ws, req.run_id, {
      url: s.url,
      task_id: null,
      logical_operation_id: recheckOperationId(req.recheck_id, sourceId),
      justification: 'Recheck of a source cited on Decide (no model calls).',
    });
    out.push({
      ...base,
      outcome: outcomeOf(r),
      retrieval_id: r.id,
      decision_id: r.decision_id,
      state: r.state,
      reason_code: r.reason_code,
      explanation: r.explanation,
    });
    if (r.state === 'needs_human' || r.state === 'denied')
      stopped = { reason_code: r.reason_code, explanation: r.explanation };
  }
  return {
    recheck_id: req.recheck_id.toLowerCase(),
    run_id: req.run_id.toLowerCase(),
    problem_id: o.problemId.toLowerCase(),
    sources: out,
    not_rechecked: order.length - picked.length,
    stopped,
  };
}
