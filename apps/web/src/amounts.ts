/**
 * Exact nano-USD from a dollar amount typed by a person ("50", "12.5", "0.000000001"), or
 * null when it is not a plain non-negative decimal. No floating point is involved.
 */
export function usdToNano(text: string): string | null {
  const m = /^(\d{1,15})(?:\.(\d{1,9}))?$/.exec(text.trim().replace(/^\$/, ''));
  if (!m) return null;
  const nano =
    BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? '').padEnd(9, '0'));
  return nano.toString();
}
