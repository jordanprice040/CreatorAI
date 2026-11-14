import { Money } from './money.js';
import { plainEvent } from './plain-words.js';
import { eventText } from './ui.js';
import { useViewMode } from './view-mode.js';

/**
 * One history line. Standard reads it in the pages' words, without versions or internal codes,
 * and shows its amounts in cents (P-8, P-9); Advanced shows the stored line.
 */
export function EventLine({
  summary,
  fixture,
  inButton = false,
}: {
  summary: string;
  /**
   * The workspace's mode, so amounts carry "$" or "sim" like the rest of the page (review 1
   * of #197, N-8). Left out, amounts are bare numbers.
   */
  fixture?: boolean;
  /** The line sits inside a button, so its amounts are plain text (see `Money`). */
  inButton?: boolean;
}) {
  const { standard } = useViewMode();
  if (!standard) return <>{eventText(summary)}</>;
  return (
    <>
      {plainEvent(summary).map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <Money
            key={i}
            nano={p.nano}
            fixture={p.fixture ?? fixture ?? false}
            bare={p.fixture === undefined && fixture === undefined}
            inButton={inButton}
          />
        ),
      )}
    </>
  );
}
