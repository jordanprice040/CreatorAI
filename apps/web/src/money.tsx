import { useState } from 'react';
import { cents, money, roundedAway } from './amounts.js';
import { useViewMode } from './view-mode.js';

/**
 * An amount as people read it (P-9, Jordan, November 14). Standard shows cents, with "<0.01"
 * for a charge smaller than a cent; when that leaves digits out, the amount is a small button
 * that shows the exact value on click, tap or keyboard (and on hover, as its title). Advanced
 * always shows the exact value, and so does `exact`, which pages use wherever the owner
 * authorizes spending. Display only: nothing stored, compared or enforced is rounded.
 */
export function Money({
  nano,
  fixture,
  exact = false,
  bare = false,
  inButton = false,
}: {
  nano: string | null;
  fixture: boolean;
  exact?: boolean;
  /** No "$" or "sim": for history lines, which don't record the budget's mode. */
  bare?: boolean;
  /**
   * Inside another button (a tile that opens a page), where a nested button would be invalid:
   * cents as plain text, with the exact amount as its title and on the page the tile opens.
   */
  inButton?: boolean;
}) {
  const { standard } = useViewMode();
  const [open, setOpen] = useState(false);
  const unit = (text: string) =>
    bare ? text.replace(/^(-?<?)\$/, '$1').replace(/ sim$/, '') : text;
  const full = unit(money(nano, fixture));
  if (exact || !standard || !roundedAway(nano)) return <>{full}</>;
  const short = unit(cents(nano, fixture));
  if (inButton) return <span title={`Exact amount: ${full}`}>{short}</span>;
  return (
    <button
      type="button"
      className="money"
      title={`Exact amount: ${full}`}
      aria-label={
        open
          ? `${full}, the exact amount. Show it in cents`
          : `${short}, rounded to cents. Show the exact amount`
      }
      onClick={() => setOpen((o) => !o)}
    >
      {open ? full : short}
    </button>
  );
}
