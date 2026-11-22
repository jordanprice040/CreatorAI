import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { z } from '@creator/contracts';
import { api } from './oversight.js';
import { routeHash } from './pages.js';
import { GUTTER, TIP_CLOSED, nextTip, tipShift } from './terms.js';
import {
  hasClaimTag,
  previewText,
  splitClaimRefs,
  type RefClaim,
} from './claim-refs.js';
import './claim-ref.css';

// Claim tags ("C1", "C2" …) in discovery, exploration and assessment text link to the claim
// under Sources, and show the claim on hover or keyboard focus. The preview is the tag's
// accessible description, so a screen reader reads the claim with the tag. Both views.

/** The packet a workflow read, by the address its workflow page already uses. */
export type PacketKind = 'packet' | 'exploration-packet' | 'assessment-packet';

const PacketClaims = z.object({
  packet: z.object({
    claims: z.array(
      z.object({
        ref: z.string(),
        claim_id: z.string(),
        statement: z.string(),
        status: z.string(),
      }),
    ),
  }),
});

// A workflow's packet is bound by hash when it starts and never changes, so one read serves
// every tag on every page for as long as the window is open. A failed read is forgotten, so
// the next page that needs it tries again.
const packets = new Map<string, Promise<Map<string, RefClaim>>>();

function readPacket(ws: string, workflow: string, kind: PacketKind) {
  const key = `${ws}/${workflow}/${kind}`;
  let p = packets.get(key);
  if (!p) {
    p = api(
      PacketClaims,
      `workspaces/${ws}/workflows/${workflow}/${kind}`,
    ).then(
      (r) =>
        new Map(
          r.packet.claims.map((c) => [
            c.ref,
            { claim_id: c.claim_id, statement: c.statement, status: c.status },
          ]),
        ),
    );
    p.catch(() => packets.delete(key));
    packets.set(key, p);
  }
  return p;
}

/**
 * The claims a workflow's packet numbered, by tag; null until read (or when the read failed,
 * so the tags stay plain text). Read only when `texts` has something shaped like a tag.
 */
export function usePacketClaims(
  ws: string,
  workflow: string | null | undefined,
  kind: PacketKind,
  texts: readonly (string | null | undefined)[],
): Map<string, RefClaim> | null {
  const wanted = !!ws && !!workflow && texts.some((t) => !!t && hasClaimTag(t));
  const [refs, setRefs] = useState<{
    key: string;
    map: Map<string, RefClaim>;
  } | null>(null);
  const key = `${ws}/${workflow ?? ''}/${kind}`;
  useEffect(() => {
    if (!wanted || !workflow) return;
    let live = true;
    // A failed read leaves the tags as plain text.
    readPacket(ws, workflow, kind).then(
      (map) => live && setRefs({ key, map }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [key, wanted]);
  return refs?.key === key ? refs.map : null;
}

/** The address of a claim under Sources. */
export function claimHref(ws: string, claimId: string) {
  return routeHash({ view: 'evidence', ws, id: `claim:${claimId}`, q: '' });
}

/** One claim tag: a link to the claim with its statement on hover or focus. */
export function ClaimRef({
  ws,
  tag,
  claim,
  children,
}: {
  ws: string;
  tag: string;
  claim: RefClaim;
  /** The words as they read on the page; the tag itself when left out. */
  children?: ReactNode;
}) {
  const id = useId();
  const [tip, setTip] = useState(TIP_CLOSED);
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const on = (e: Parameters<typeof nextTip>[1]) => setTip((s) => nextTip(s, e));
  // Escape dismisses a preview opened by hover too, without moving the pointer (WCAG 1.4.13).
  useEffect(() => {
    if (!tip.open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(TIP_CLOSED);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [tip.open]);
  // Keep the preview inside the window: a tag near the right edge moves its box left.
  useLayoutEffect(() => {
    if (!tip.open || !box.current || !wrap.current) return;
    const width = box.current.offsetWidth;
    const left = wrap.current.getClientRects()[0]?.left ?? 0;
    const room = document.documentElement.clientWidth - GUTTER;
    setShift(tipShift(left, width, room));
  }, [tip.open]);
  return (
    <span
      ref={wrap}
      className="claim-ref-wrap"
      onMouseEnter={() => on('enter')}
      onMouseLeave={() => on('leave')}
    >
      <a
        className="claim-ref"
        href={claimHref(ws, claim.claim_id)}
        aria-describedby={`${id}-claim`}
        onFocus={() => on('focus')}
        onBlur={() => on('blur')}
        onKeyDown={(e) => {
          // Close this preview only; a dialog around it stays open.
          if (e.key === 'Escape' && tip.open) {
            e.stopPropagation();
            on('escape');
          }
        }}
      >
        {children ?? tag}
      </a>
      <span
        ref={box}
        role="tooltip"
        className="claim-ref-tip"
        hidden={!tip.open}
        style={shift ? { left: `${shift}px` } : undefined}
      >
        <strong aria-hidden="true">
          Claim {tag} · {claim.status.replaceAll('_', ' ')}
        </strong>
        <span id={`${id}-claim`}>{previewText(claim.statement)}</span>
        <span className="claim-ref-hint" aria-hidden="true">
          Select to open it under Sources.
        </span>
      </span>
    </span>
  );
}

/** Text with each claim tag the packet holds linked to its claim; the rest stays as written. */
export function ClaimText({
  ws,
  text,
  refs,
}: {
  ws: string;
  text: string;
  refs: ReadonlyMap<string, RefClaim> | null;
}) {
  const parts = splitClaimRefs(text, refs);
  if (parts.length === 1 && typeof parts[0] === 'string') return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string' ? (
          p
        ) : (
          <ClaimRef key={i} ws={ws} tag={p.ref} claim={p.claim} />
        ),
      )}
    </>
  );
}
