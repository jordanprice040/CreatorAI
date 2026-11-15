import type { PlanQualification } from '@creator/contracts';

/**
 * ADR-0089: which role a qualification counts for. One task class can serve two roles (scoring:
 * the assessor and the discovery skeptic; research synthesis: the discovery locator and, with
 * P12, Search the web; specification: the old acceptance-check labelling and, with ADR-0107,
 * drafting specs), and the server admits each role only with qualifications bound to that
 * role's prompts. `null` is a task class with one role (specification, the build roles) or a
 * qualification no role admits any more (an older prompt).
 */
export type Admits =
  'assessment' | 'discovery' | 'web_discovery' | 'spec_drafts' | null;

type Flags = {
  admits_assessment?: PlanQualification['admits_assessment'] | undefined;
  admits_discovery?: PlanQualification['admits_discovery'] | undefined;
  admits_web_discovery?: PlanQualification['admits_web_discovery'] | undefined;
  admits_spec_drafts?: PlanQualification['admits_spec_drafts'] | undefined;
};

export function roleOf(q: Flags): Admits {
  if (q.admits_assessment === true) return 'assessment';
  if (q.admits_discovery === true) return 'discovery';
  if (q.admits_web_discovery === true) return 'web_discovery';
  if (q.admits_spec_drafts === true) return 'spec_drafts';
  return null;
}

/** The qualifications that count for one role; an untagged role never borrows a tagged pass. */
export const forRole = <T extends Flags>(qs: readonly T[], admits: Admits) =>
  qs.filter((q) => roleOf(q) === admits);

const ROLE_NAME: Record<Exclude<Admits, null>, string> = {
  assessment: 'assessments',
  discovery: 'discovery',
  web_discovery: 'Search the web',
  spec_drafts: 'drafting specs',
};

/** "scoring for discovery", "research synthesis for Search the web", "specification". */
export function roleTask(task_class: string, admits: Admits): string {
  const w = task_class.replaceAll('_', ' ');
  return admits ? `${w} for ${ROLE_NAME[admits]}` : w;
}

/**
 * A qualification's task in words, with its role, or "(older prompt)" when no role admits it
 * because its prompt is out of date (PR #175 re-review N-C).
 */
export function qualificationTask(
  q: Flags & {
    task_class: string;
    prompt_current?: boolean | undefined;
  },
): string {
  const role = roleOf(q);
  return `${roleTask(q.task_class, role)}${!role && q.prompt_current === false ? ' (older prompt)' : ''}`;
}

/**
 * The newest decided qualification that decides whether `q` still counts: the newest of the
 * same model, task class and role (PR #175 review M-1). The Qualified tasks list uses it, so a
 * failed run of one role never withdraws a pass of another.
 */
export function rowLatest<
  T extends Flags & {
    model_id: string;
    task_class: string;
    state: string;
    decided_at: string | null;
    created_at: string;
    prompt_current?: boolean | undefined;
  },
>(qs: readonly T[], q: T): T | null {
  let out: T | null = null;
  for (const x of forRole(qs, roleOf(q))) {
    if (x.prompt_current === false) continue;
    if (x.model_id !== q.model_id || x.task_class !== q.task_class) continue;
    if (x.state !== 'qualified' && x.state !== 'failed') continue;
    const t = Date.parse(x.decided_at ?? x.created_at);
    const best = out ? Date.parse(out.decided_at ?? out.created_at) : -Infinity;
    if (t > best || (t === best && x.created_at > out!.created_at)) out = x;
  }
  return out;
}

/**
 * Where a start of one role stands against the running qualifications (one per model and task
 * class runs at a time on the server, whatever its role): free, started in this role (run it),
 * or started in another role (run or finish that one first; never run it in this role's name).
 * For P27's "Qualify now" and Qualify a model alike (PR #175 re-review L-A).
 */
export function runningFor<
  T extends Flags & { state: string; model_id: string; task_class: string },
>(
  qs: readonly T[],
  model: string,
  task: string,
  admits: Admits,
): { kind: 'free' } | { kind: 'started' | 'other_running'; qualification: T } {
  const q = qs.find(
    (x) =>
      x.state === 'running' && x.model_id === model && x.task_class === task,
  );
  if (!q) return { kind: 'free' };
  return roleOf(q) === admits
    ? { kind: 'started', qualification: q }
    : { kind: 'other_running', qualification: q };
}

/**
 * The role a benchmark manifest qualifies for, from its checks: assessment checks, discovery
 * checks, or the web scout and reader checks. Anything else has no role tag.
 */
export function manifestRole(m: {
  cases: readonly { check?: unknown }[];
}): Admits {
  const kinds = new Set(
    m.cases.map((c) => (c.check as { kind?: string } | undefined)?.kind),
  );
  if (kinds.size === 1 && kinds.has('assessment_contract')) return 'assessment';
  if (kinds.size === 1 && kinds.has('discovery_contract')) return 'discovery';
  if (
    kinds.size > 0 &&
    Array.from(kinds).every(
      (k) => k === 'web_scout_contract' || k === 'web_reader_contract',
    )
  )
    return 'web_discovery';
  // ADR-0107: the spec cases benchmark qualifies drafting specs on Build › Write a spec.
  if (kinds.size === 1 && kinds.has('spec_cases_contract'))
    return 'spec_drafts';
  return null;
}
