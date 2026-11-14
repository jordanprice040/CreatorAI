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

const NANO = 1_000_000_000n;
const CENT = 10_000_000n;

/**
 * Exact decimal display of nano-USD: every non-zero digit is kept, trailing zeros past the
 * cents are dropped. Fixture amounts are simulated units, not money.
 */
export function money(nano: string | null, fixture: boolean): string {
  if (nano === null) return '—';
  const v = BigInt(nano);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = abs / NANO;
  const frac = (abs % NANO)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `${sign}${fixture ? '' : '$'}${whole}.${frac}${fixture ? ' sim' : ''}`;
}

/**
 * P-9 (Jordan, November 14): the Standard view's amount, rounded to cents (half a cent rounds
 * up). An amount that is not zero but smaller than a cent reads "<0.01" with its unit, so a
 * real charge never reads as zero. Display only: storage, comparisons and enforcement stay
 * exact, and `money` gives the exact text.
 */
export function cents(nano: string | null, fixture: boolean): string {
  if (nano === null) return '—';
  const v = BigInt(nano);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const unit = fixture ? '' : '$';
  const tail = fixture ? ' sim' : '';
  if (abs > 0n && abs < CENT) return `${sign}<${unit}0.01${tail}`;
  const c = (abs + CENT / 2n) / CENT;
  return `${sign}${unit}${c / 100n}.${String(c % 100n).padStart(2, '0')}${tail}`;
}

/** Whether the cents text leaves digits out, so the exact amount is worth offering. */
export const roundedAway = (nano: string | null) =>
  nano !== null && BigInt(nano) % CENT !== 0n;

/**
 * A history line's decimal amounts ("Charged 0.05577 of 0.4285375 reserved") as nano-USD
 * strings, so they can be shown like any other amount. Returns null for text that is not
 * a plain non-negative decimal.
 */
export function decimalToNano(text: string): string | null {
  const m = /^(-?)(\d{1,15})\.(\d{1,9})$/.exec(text);
  if (!m) return null;
  const v = BigInt(m[2]!) * NANO + BigInt(m[3]!.padEnd(9, '0'));
  return (m[1] ? -v : v).toString();
}
