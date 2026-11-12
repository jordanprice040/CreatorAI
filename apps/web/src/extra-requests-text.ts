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

/**
 * The line that says extra requests are in force, each with its own expiry (review L-2), or
 * null when none are. `extras` are soonest first, as the server sends them.
 */
export function extraLine(
  extras: readonly { requests: number; expires_at: string }[],
  configured: number,
): string | null {
  if (!extras.length) return null;
  const total = extras.reduce((n, x) => n + x.requests, 0);
  const each = extras.map((x) => `${x.requests} until ${atText(x.expires_at)}`);
  const head = `Includes ${total} extra request${total === 1 ? '' : 's'}`;
  const back = `the cap is ${configured} a day again.`;
  return extras.length === 1
    ? `${head} until ${atText(extras[0]!.expires_at)}; after that ${back}`
    : `${head}: ${each.slice(0, -1).join(', ')} and ${each.at(-1)}; after the last expires ${back}`;
}

/**
 * The connection's daily cap in force, with any extra requests named (ADR-0094, re-review 3
 * N-2): "60 requests now, 20 of them extra" while an extra is in force, else "40 requests".
 */
export function capWords(d: {
  connection: {
    settings: { caps: { shared: { max_model_requests_per_day: number } } };
  };
  usage: { extra_requests: number };
}): string {
  const configured =
    d.connection.settings.caps.shared.max_model_requests_per_day;
  const extra = d.usage.extra_requests;
  return extra > 0
    ? `${configured + extra} requests now, ${extra} of them extra`
    : `${configured} requests`;
}
