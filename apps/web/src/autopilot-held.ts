/**
 * Review 1 of #199, L-1: what the held-claims Next text says about “Accept quote-checked web
 * claims”, so it matches what is actually offered below it. No imports, so a test can load it.
 */
export function heldClaimsSetting(
  a: { next?: readonly { kind: string }[] | null | undefined },
  canContinue: boolean,
  /** The owner's “Accept quote-checked web claims” now, when known (re-review N-A). */
  settingOn = false,
): string {
  if (a.next?.some((n) => n.kind === 'allow_and_continue'))
    return 'Or allow “Accept quote-checked web claims” below.';
  if (canContinue)
    return '“Accept quote-checked web claims” is on now, so Continue accepts them.';
  if (settingOn)
    return '“Accept quote-checked web claims” is on now, so later autopilots accept them.';
  return 'To let later autopilots accept them, turn on “Accept quote-checked web claims” under How much is automated.';
}
