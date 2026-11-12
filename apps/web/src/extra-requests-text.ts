// ADR-0094 (P29): the words for extra requests, pure so tests and fix-buttons.tsx load them
// without the component's imports.
import { PLAN_EXTRA_HOURS, PLAN_EXTRA_REQUESTS } from '@creator/contracts';

/** "14:05 on Nov 12" for an expiry time. */
export const atText = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });

/** What the confirmation says the press will do. */
export function extraConfirmText(configured: number, cap: number): string {
  return `Adds ${PLAN_EXTRA_REQUESTS} requests to this connection's cap for the next ${PLAN_EXTRA_HOURS} hours (${cap} → ${cap + PLAN_EXTRA_REQUESTS}). The configured cap of ${configured} a day is not changed and applies again when they expire; change it in the connection's caps if you want more every day. Plan requests use your subscription, not API money, and your provider's own usage limit still applies.`;
}

/** The line that says extra requests are in force, or null when none are. */
export function extraLine(
  extra: number,
  until: string | null | undefined,
  configured: number,
): string | null {
  if (extra <= 0 || !until) return null;
  return `Includes ${extra} extra request${extra === 1 ? '' : 's'} until ${atText(until)}; after that the cap is ${configured} a day again.`;
}
