// ADR-0100: the server's copy of the "Link claims" suggestion rule (ADR-0091,
// apps/web/src/claim-suggest.ts), so an autopilot whose owner turned on "Gather evidence when it
// is thin" links the same claims a person would see pre-ticked. A test keeps the two in step.

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
export function suggestClaims<C extends SuggestableClaim>(
  target: { title: string },
  claims: readonly C[],
  linked: ReadonlySet<string> = new Set(),
  max = 5,
): C[] {
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
