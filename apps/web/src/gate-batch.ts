import {
  advanceOutlook,
  type ConfirmGatesRequest,
  type GateKind,
  type RankedCandidate,
} from '@creator/contracts';

// UX pass P-4 (as Jordan revised it): which options can advance, and one step to confirm ethics
// and access for the options the owner ticks. One shared reason per gate kind; any option can
// have its own reason for a gate instead, and the server records which applied to each option
// and gate. Pure functions, so the rules are tested without a browser.

export type GateDetail = NonNullable<
  RankedCandidate['gates']['gate_details']
>[number];

/** Whether the owner can confirm this gate here (the server checks it again). */
export function gateConfirmable(d: GateDetail): boolean {
  return (
    d.assessed !== false &&
    (d.state === 'not_assessed' ||
      d.state === 'auto_cleared' ||
      (d.state === 'unresolved' && !d.concerns.some((x) => x.by === 'person')))
  );
}

/**
 * Whether the owner can clear every gate that still stands in the way here. When not (nothing
 * has assessed it yet, or a person raised the concern), the option's own gate lines say what to do.
 */
export function gatesConfirmableNow(c: RankedCandidate): boolean {
  return (c.gates.gate_details ?? []).every(
    (d) =>
      d.state === 'clear' ||
      d.state === 'confirmed' ||
      d.state === 'auto_cleared' ||
      gateConfirmable(d),
  );
}

/**
 * The gates the one-step form offers for one option: those it can confirm that still stand in
 * the way. A gate the owner's rule already cleared is left to the option's own line.
 */
export function batchGates(c: RankedCandidate): GateDetail[] {
  return (c.gates.gate_details ?? []).filter(
    (d) => gateConfirmable(d) && d.state !== 'auto_cleared',
  );
}

export type BatchOption = {
  cand: RankedCandidate;
  outlook: ReturnType<typeof advanceOutlook>;
  gates: GateDetail[];
};

/** The options the form lists: every option with a gate to confirm, the ones it helps first. */
export function batchOptions(cands: readonly RankedCandidate[]): BatchOption[] {
  const rank = { after_gates: 0, now: 1, never: 2 } as const;
  return cands
    .map((cand) => ({
      cand,
      outlook: advanceOutlook(cand),
      gates: batchGates(cand),
    }))
    .filter((o) => o.gates.length > 0)
    .sort((a, b) => rank[a.outlook.state] - rank[b.outlook.state]);
}

/**
 * Ticked by default: options whose gate is the only thing between them and advancing. One that
 * something else blocks stays unticked (confirming it would change nothing yet).
 */
export const tickedByDefault = (o: BatchOption) =>
  o.outlook.state === 'after_gates';

export type OwnReasons = Partial<Record<GateKind, string>>;

/** The gate kinds among the ticked options that need a shared reason (no own reason given). */
export function sharedNeeded(
  options: readonly BatchOption[],
  ticked: ReadonlySet<string>,
  own: Readonly<Record<string, OwnReasons | undefined>>,
): GateKind[] {
  const kinds = new Set<GateKind>();
  for (const o of options) {
    if (!ticked.has(o.cand.alternative.id)) continue;
    for (const g of o.gates)
      if (!own[o.cand.alternative.id]?.[g.gate]?.trim()) kinds.add(g.gate);
  }
  return (['ethics', 'access'] as const).filter((k) => kinds.has(k));
}

const okReason = (s: string | undefined) => (s?.trim().length ?? 0) >= 3;

/** The request, or what is still missing in words. */
export function batchRequest(
  options: readonly BatchOption[],
  ticked: ReadonlySet<string>,
  shared: Readonly<Partial<Record<GateKind, string>>>,
  own: Readonly<Record<string, OwnReasons | undefined>>,
): { request: ConfirmGatesRequest } | { missing: string } {
  const items: ConfirmGatesRequest['items'] = [];
  for (const o of options) {
    const id = o.cand.alternative.id;
    if (!ticked.has(id)) continue;
    for (const g of o.gates) {
      const mine = own[id]?.[g.gate]?.trim() ?? '';
      if (mine && !okReason(mine))
        return {
          missing: `The own ${g.gate} reason for “${o.cand.alternative.title}” needs at least 3 characters.`,
        };
      items.push({
        alternative: { id, version: o.cand.alternative.version },
        gate: g.gate,
        concerns_seen: g.concerns.map((x) => x.scorecard),
        reason: mine || null,
      });
    }
  }
  if (!items.length) return { missing: 'Tick at least one option.' };
  for (const k of sharedNeeded(options, ticked, own))
    if (!okReason(shared[k]))
      return {
        missing: `Write the shared ${k} reason (at least 3 characters), or give each ticked option its own.`,
      };
  const kept = (k: GateKind) =>
    items.some((x) => x.gate === k && x.reason === null)
      ? shared[k]!.trim()
      : null;
  return {
    request: {
      shared: { ethics: kept('ethics'), access: kept('access') },
      items,
    },
  };
}

/** What pressing the button records, in one line. */
export function batchSummary(req: ConfirmGatesRequest): string {
  const options = new Set(req.items.map((x) => x.alternative.id)).size;
  const own = req.items.filter((x) => x.reason !== null).length;
  const n = req.items.length;
  return (
    `${n} gate confirmation${n === 1 ? '' : 's'} for ${options} option${options === 1 ? '' : 's'}, ` +
    (own === 0
      ? 'all with the shared reasons'
      : own === n
        ? 'each with its own reason'
        : `${n - own} with a shared reason and ${own} with the option’s own`) +
    '. Each is recorded as your decision on that option and gate.'
  );
}
