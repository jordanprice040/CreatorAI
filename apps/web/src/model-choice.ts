// ADR-0081 (P21): how a form starts from the person's current model. No imports, so the
// rules load directly in tests. A form keeps the choice even when the model is not qualified
// for its task: it says so and offers a qualified alternative, and never switches quietly.

/** Fired on window after the choice changes here; `detail` is the new choice. */
export const MODEL_CHOICE_CHANGED = 'creator:model-choice';

/** The plan-role build needs both roles qualified on its model (ADR-0048). */
export const BUILD_ROLE_CLASSES = [
  'patch_build',
  'independent_review',
] as const;

export type Choice = { connection_id: string; model_id: string };

/** One connection as a form sees it: its verified models and what each is qualified for. */
export type RoutePlan = {
  id: string;
  /** Can this connection run work now (no blockers, allows the data class)? */
  ready: boolean;
  models: readonly { id: string; qualified: readonly string[] }[];
};

export type Route = {
  connection: string;
  model: string;
  /** The route is the person's current choice. */
  fromChoice: boolean;
  /** A choice was set but its model is not verified on any listed connection here. */
  choiceUnavailable: boolean;
  /** Task classes the route's model is not qualified for (only checked for the choice). */
  unqualified: readonly string[];
  /** A ready connection and model qualified for every task class, when the choice is not. */
  alternative: { connection: string; model: string } | null;
};

const qualifiedFor = (
  m: { qualified: readonly string[] },
  taskClasses: readonly string[],
) => taskClasses.every((tc) => m.qualified.includes(tc));

/**
 * The route a form starts from. With a usable choice, that choice, with any task classes it is
 * not qualified for and a qualified alternative (same connection first). Otherwise the
 * form's own `fallback`, which is never presented as the choice.
 */
export function preferredRoute(
  plans: readonly RoutePlan[],
  choice: Choice | null,
  taskClasses: readonly string[],
  fallback: { connection: string; model: string },
): Route {
  const chosen = choice
    ? plans.find((p) => p.id === choice.connection_id)
    : undefined;
  const model = chosen?.models.find((m) => m.id === choice?.model_id);
  if (!choice || !chosen || !model)
    return {
      ...fallback,
      fromChoice: false,
      choiceUnavailable: Boolean(choice),
      unqualified: [],
      alternative: null,
    };
  const unqualified = taskClasses.filter((tc) => !model.qualified.includes(tc));
  let alternative: Route['alternative'] = null;
  if (unqualified.length) {
    const order = [chosen, ...plans.filter((p) => p !== chosen)];
    for (const p of order) {
      if (!p.ready) continue;
      const m = p.models.find((x) => qualifiedFor(x, taskClasses));
      if (m) {
        alternative = { connection: p.id, model: m.id };
        break;
      }
    }
  }
  return {
    connection: chosen.id,
    model: model.id,
    fromChoice: true,
    choiceUnavailable: false,
    unqualified,
    alternative,
  };
}

/** Plain words for a task class in the "not qualified for" line. */
export function taskWords(taskClass: string): string {
  return taskClass.replace(/_/g, ' ');
}

/**
 * Build's default builder: the plan-role builder on the current model when there is one (even
 * if it is not qualified, so Build can say so), else the first plan-role builder qualified for
 * both roles, else the first plan-role builder (review L-3).
 */
export function planBuilderDefault<
  B extends {
    kind: string;
    connection_id: string;
    model_id: string;
    unqualified?: readonly string[];
  },
>(
  builders: readonly B[],
  choice: Choice | null,
): { builder: B | undefined; fromChoice: boolean } {
  const chosen = choice
    ? builders.find(
        (b) =>
          b.kind === 'roles' &&
          b.connection_id === choice.connection_id &&
          b.model_id === choice.model_id,
      )
    : undefined;
  return chosen
    ? { builder: chosen, fromChoice: true }
    : {
        builder:
          builders.find(
            (b) => b.kind === 'roles' && (b.unqualified?.length ?? 0) === 0,
          ) ?? builders.find((b) => b.kind === 'roles'),
        fromChoice: false,
      };
}
