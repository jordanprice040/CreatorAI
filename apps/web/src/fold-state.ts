// P18: which collapsible items are open. No imports, so the rules load directly in tests.

/**
 * An item is open when the person opened it, closed when they closed it, and otherwise
 * open only when it is the item that needs their attention.
 */
export function foldIsOpen(
  chosen: Readonly<Record<string, boolean>>,
  id: string,
  attention: readonly string[],
): boolean {
  return chosen[id] ?? attention.includes(id);
}

/** `chosen` with every listed item set open or closed (Expand all / Collapse all). */
export function chooseAll(
  chosen: Readonly<Record<string, boolean>>,
  ids: readonly string[],
  open: boolean,
): Record<string, boolean> {
  const out = { ...chosen };
  for (const id of ids) out[id] = open;
  return out;
}

/**
 * The one item to open by default: the first, in page order, that needs the person.
 * None when nothing does, so a page with nothing to act on shows only summaries.
 */
export function firstNeeding<T extends string>(
  ids: readonly T[],
  needs: (id: T) => boolean,
): T[] {
  const id = ids.find(needs);
  return id === undefined ? [] : [id];
}

/** "A, B and 2 more" for naming the items a blocked action waits on. */
export function nameList(names: readonly string[], max = 3): string {
  if (names.length <= max) {
    return names.length <= 1
      ? (names[0] ?? '')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/**
 * P18 re-review R3-2: blocked choices grouped by their first reason, so one shared reason
 * (e.g. ethics not assessed) is written once with the choices it blocks.
 */
export function groupByReason(
  blocked: readonly (readonly [choice: string, reasons: readonly string[]])[],
): { reason: string; choices: string[] }[] {
  const out: { reason: string; choices: string[] }[] = [];
  for (const [choice, reasons] of blocked) {
    const reason = reasons[0];
    if (!reason) continue;
    const group = out.find((g) => g.reason === reason);
    if (group) group.choices.push(choice);
    else out.push({ reason, choices: [choice] });
  }
  return out;
}
