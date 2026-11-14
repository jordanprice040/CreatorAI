import type { Decision } from '@creator/contracts';

// UX pass P-3: the rules for showing the owner's approval where they acted. Pure, so they are
// tested without a browser; inline-approval.tsx renders them.

/** Whether this pending decision can be approved here, or why not (then use Approvals). */
export function inlineApprovable(
  d: Pick<Decision, 'status' | 'kind' | 'coverage'>,
  owner: boolean,
): { ok: true } | { ok: false; why: string } {
  if (!owner)
    return { ok: false, why: 'Only the workspace owner approves this.' };
  if (d.status !== 'pending')
    return {
      ok: false,
      why: `This request is ${d.status.replaceAll('_', ' ')}.`,
    };
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
