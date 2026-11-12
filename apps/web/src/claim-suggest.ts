// ADR-0091: which recorded claims look like evidence about an option or a problem, so the
// person can link them in one click. No imports, so the rules load in tests without a browser.
// A suggestion is only a pointer: nothing is linked until the person presses Link.

export type SuggestableClaim = {
  id: string;
  title: string;
  /** The claim's statement, when it has one. */
  text: string;
};

const STOP = new Set(
  'a an and are as at be by can for from has have how in into is it its of on or that the their them then there these this to use used using via was with without your you our we not no new more most less any all each per than one two'.split(
    ' ',
  ),
);

/** Lower-case words of three or more letters or digits, without common filler words. */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'+.-]*/gu) ?? [])
    .map((w) => w.replace(/[.'-]+$/, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/**
 * Claims ranked by how much of the target's title they mention. A word every candidate claim
 * mentions (such as the problem's own subject) counts for nothing; a rarer word counts more.
 * Already-linked claims, claims mentioning no title word, and claims scoring under a third of
 * the best match are left out.
 */
export function suggestClaims(
  target: { title: string },
  claims: readonly SuggestableClaim[],
  linked: ReadonlySet<string> = new Set(),
  max = 5,
): SuggestableClaim[] {
  const wanted = [...new Set(terms(target.title))];
  if (!wanted.length) return [];
  const pool = claims.filter((c) => !linked.has(c.id.toLowerCase()));
  const words = pool.map((c) => new Set(terms(`${c.title} ${c.text}`)));
  const n = pool.length;
  const weight = new Map(
    wanted.map((w) => {
      const df = words.filter((s) => s.has(w)).length;
      return [w, df === 0 || df === n ? 0 : Math.log((n + 1) / df)];
    }),
  );
  return (
    pool
      .map((c, i) => ({
        c,
        score: wanted.reduce(
          (sum, w) => sum + (words[i]!.has(w) ? weight.get(w)! : 0),
          0,
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : 1))
      // A claim sharing one passing word with a long title is not offered (it stays findable).
      .filter((x, _, all) => x.score >= all[0]!.score / 3)
      .slice(0, max)
      .map((x) => x.c)
  );
}

/** Whether a claim's title or statement contains every word typed in the filter box. */
export function matchesFilter(c: SuggestableClaim, filter: string): boolean {
  const want = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${c.title} ${c.text}`.toLowerCase();
  return want.every((w) => hay.includes(w));
}

/**
 * What sets each end of an option's score range (ADR-0091): the counted cards whose low or
 * high estimate equals the range end, with how many unknown ratings each counts at 1 or 5.
 */
export function rangeEnds(
  cards: readonly {
    id: string;
    lower: number;
    upper: number;
    unknown: number;
    counted: boolean;
  }[],
): {
  low: { id: string; unknown: number }[];
  high: { id: string; unknown: number }[];
} {
  const live = cards.filter((c) => c.counted);
  if (!live.length) return { low: [], high: [] };
  const lo = Math.min(...live.map((c) => c.lower));
  const hi = Math.max(...live.map((c) => c.upper));
  const pick = (f: (c: (typeof live)[number]) => boolean) =>
    live.filter(f).map((c) => ({ id: c.id, unknown: c.unknown }));
  return {
    low: pick((c) => c.lower === lo),
    high: pick((c) => c.upper === hi),
  };
}
