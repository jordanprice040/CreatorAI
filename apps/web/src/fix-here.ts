// ADR-0087 (P27, walk items 8 and 16): the fix a refusal offers in place, chosen by the
// refusal's code or by what the page already knows, never by matching its wording. Pure rules,
// so tests load them directly; fix-buttons.tsx draws the buttons. Every fix is the owner's own
// Models and connections route with the same confirmation, and only the owner sees one.
import type { PlanRefusal } from '@creator/contracts';
import { DATA_CLASS_CHOICES } from './caps-fields.js';
import type { FixAction, QualifyRole } from './discover-defaults.js';

export {
  missingTaskFixes,
  type FixAction,
  type QualifyRole,
} from './discover-defaults.js';

/** A data class in words, lower case, as the allow button names it. */
const dataWords = (key: string) => {
  const label = DATA_CLASS_CHOICES.find((x) => x.key === key)?.label ?? key;
  return label.charAt(0).toLowerCase() + label.slice(1);
};

/** The button's label for a fix. */
export function fixLabel(a: FixAction): string {
  switch (a.kind) {
    case 'accept_caps':
      return 'Review and accept caps';
    case 'allow_data':
      return `Allow ${dataWords(a.data_class)} on this connection`;
    case 'allow_tasks': {
      const one = a.tasks.length === 1;
      return a.qualify.length
        ? one
          ? 'Allow and qualify'
          : 'Allow and qualify these tasks'
        : one
          ? 'Allow this task'
          : 'Allow these tasks';
    }
    case 'qualify':
      return 'Qualify now';
  }
}

/** A stable key for a fix, so the same fix is offered once on a page. */
export const fixKey = (a: FixAction) =>
  a.kind === 'allow_tasks'
    ? `${a.kind}:${a.connection_id}:${a.model_id ?? ''}:${a.tasks.join(',')}:${a.qualify.join(',')}`
    : a.kind === 'allow_data'
      ? `${a.kind}:${a.connection_id}:${a.data_class}`
      : a.kind === 'qualify'
        ? `${a.kind}:${a.connection_id}:${a.model_id}:${a.task_class}`
        : `${a.kind}:${a.connection_id}`;

/**
 * The fixes for refusals the server sent with their codes (ADR-0087): caps not accepted, a
 * data class or task not allowed, a model not qualified. Refusals without an owner fix, or
 * without the connection they name, give none. A task that is both not allowed and not
 * qualified gets one "allow and qualify", not two buttons.
 */
export function refusalFixes(
  refusals: readonly PlanRefusal[],
  role: QualifyRole,
  canQualify: (task: string) => boolean,
): FixAction[] {
  const out: FixAction[] = [];
  const keys = new Set<string>();
  const add = (a: FixAction) => {
    const k = fixKey(a);
    if (!keys.has(k)) {
      keys.add(k);
      out.push(a);
    }
  };
  const notAllowed = new Map<
    string,
    { connection_id: string; model_id: string | null; tasks: string[] }
  >();
  for (const r of refusals) {
    const c = r.connection_id;
    if (!c) continue;
    if (r.code === 'caps_not_accepted')
      add({ kind: 'accept_caps', connection_id: c });
    else if (r.code === 'data_class_not_allowed' && r.data_class)
      add({ kind: 'allow_data', connection_id: c, data_class: r.data_class });
    else if (r.code === 'task_class_not_allowed' && r.task_class) {
      const k = `${c}:${r.model_id ?? ''}`;
      const g = notAllowed.get(k) ?? {
        connection_id: c,
        model_id: r.model_id ?? null,
        tasks: [],
      };
      if (!g.tasks.includes(r.task_class)) g.tasks.push(r.task_class);
      notAllowed.set(k, g);
    }
  }
  for (const g of notAllowed.values())
    add({
      kind: 'allow_tasks',
      ...g,
      qualify: g.model_id ? g.tasks.filter(canQualify) : [],
      role,
    });
  for (const r of refusals) {
    const c = r.connection_id;
    if (r.code !== 'not_qualified' || !c || !r.model_id || !r.task_class)
      continue;
    const covered = [...notAllowed.values()].some(
      (g) => g.connection_id === c && g.tasks.includes(r.task_class!),
    );
    if (!covered && canQualify(r.task_class))
      add({
        kind: 'qualify',
        connection_id: c,
        model_id: r.model_id,
        task_class: r.task_class,
        role,
      });
  }
  return out;
}
