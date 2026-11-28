import { MAX_SEARCH_CALLS } from '@creator/contracts';

const CHOICES = Array.from({ length: MAX_SEARCH_CALLS }, (_, i) => i + 1);

/** ADR-0140: the "Searches per web search" field, shared by Search the web and the autopilot. */
export function SearchLimitField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <>
      <label htmlFor={id}>Searches per web search</label>
      <select
        id={id}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {CHOICES.map((n) => (
          <option key={n} value={n}>
            Up to {n}
          </option>
        ))}
      </select>
      <p className="small" id={`${id}-hint`}>
        How many searches the model may run in its one request. More can find
        more pages; the model is told the limit, and a request that starts more
        searches than that ends with nothing kept.
      </p>
    </>
  );
}
