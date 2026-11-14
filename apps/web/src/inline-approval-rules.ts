import type { Decision } from '@creator/contracts';

// UX pass P-3: the rules for showing the owner's approval where they acted. Pure, so they are
// tested without a browser; inline-approval.tsx renders them.

type Seen = Pick<
  Decision,
  'status' | 'kind' | 'coverage' | 'requested_by' | 'response'
>;

const ANSWER: Record<string, string> = {
  approve_once: 'approved once',
  approve_standing: 'approved as a standing policy',
  reject: 'rejected',
  defer: 'deferred',
  request_evidence: 'answered with a request for more evidence',
  choose_option: 'answered with an option',
};

/** How a closed request ended, in words. */
export function decisionOutcome(d: Seen): string {
  if (d.status === 'answered' && d.response)
    return ANSWER[d.response.choice] ?? 'answered';
  return d.status.replaceAll('_', ' ');
}

/** Whether the request was approved (once or as a standing policy), so the action can go again. */
export const decisionApproved = (d: Seen) =>
  d.status === 'answered' &&
  (d.response?.choice === 'approve_once' ||
    d.response?.choice === 'approve_standing');

/**
 * Whether this decision can be approved here, or why not (then use Approvals). Only the owner's
 * own request is approved in place (review M-1): anyone else's goes to Approvals.
 */
export function inlineApprovable(
  d: Seen,
  viewer: { owner: boolean; actorId: string },
): { ok: true } | { ok: false; why: string } {
  if (!viewer.owner)
    return { ok: false, why: 'Only the workspace owner approves this.' };
  if (d.requested_by.toLowerCase() !== viewer.actorId.toLowerCase())
    return {
      ok: false,
      why: 'Someone else asked for this, so it is answered in Approvals.',
    };
  if (d.status !== 'pending')
    return { ok: false, why: `This request was ${decisionOutcome(d)}.` };
  if (d.kind !== 'authorization')
    return {
      ok: false,
      why: 'This question has options; answer it in Approvals.',
    };
  if (!d.coverage.current)
    return {
      ok: false,
      why: 'The target changed after this request, so it cannot be approved; act again for a new request.',
    };
  return { ok: true };
}

/** A decision id named in a build's stop reason ("…; decision <id>"), if there is one. */
export function decisionInReason(reason: string | null | undefined) {
  return (
    /decision ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
      reason ?? '',
    )?.[1] ?? null
  );
}
