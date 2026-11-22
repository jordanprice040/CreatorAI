// Claim tags in model and rule text: discovery, exploration and assessment packets number their
// claims "C1", "C2" … and the answers cite them that way. These rules find the tags that name
// a claim in the packet the text was written against, so the page can link each one to the
// claim itself. No imports, so the tests load it directly.

/** One packet claim, as much as a tag's preview needs. */
export type RefClaim = { claim_id: string; statement: string; status: string };

/** Plain text, or a tag that names a claim in the packet. */
export type TextPart = string | { ref: string; claim: RefClaim };

// "C" and one or two digits (packets hold at most 30 claims, refs C1–C99), not inside a longer
// word or code such as "ABC12" or "C1x". "draft-C3" (any case, any dash) is a discovery run's
// tag, not this packet's: the assessment rules rename those so they never resolve here (review
// of #254, L-1). A hyphen alone does not stop a tag, so both ends of "C1-C3" link (L-2).
// Each use makes its own pattern: a shared global one carries `lastIndex` from one text to the
// next, and `matchAll` starts from it.
const tag = (flags = '') =>
  new RegExp(
    /(?<![A-Za-z0-9_])(?<![Dd][Rr][Aa][Ff][Tt][-–—])C[1-9][0-9]?(?![A-Za-z0-9_])/
      .source,
    flags,
  );

/** True when the text has anything shaped like a claim tag (so the packet is worth reading). */
export function hasClaimTag(text: string): boolean {
  return tag().test(text);
}

/**
 * The text split around the tags that name a claim in `refs`. A tag the packet does not hold
 * stays plain text: the page never links a tag to a claim it cannot show.
 */
export function splitClaimRefs(
  text: string,
  refs: ReadonlyMap<string, RefClaim> | null,
): TextPart[] {
  if (!refs || !refs.size) return [text];
  const out: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(tag('g'))) {
    const claim = refs.get(m[0]);
    if (!claim) continue;
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push({ ref: m[0], claim });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out.length ? out : [text];
}

/** A preview's statement: whole words, at most `max` characters. */
export function previewText(statement: string, max = 280): string {
  const s = statement.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}
