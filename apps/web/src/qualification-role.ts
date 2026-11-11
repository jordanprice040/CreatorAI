import type { PlanQualification } from '@creator/contracts';

/**
 * ADR-0089: which role a qualification counts for. One task class can serve two roles (scoring:
 * the assessor and the discovery skeptic; research synthesis: the discovery locator and, with
 * P12, Search the web), and the server admits each role only with qualifications bound to that
 * role's prompts. `null` is a task class with one role (specification, the build roles) or a
 * qualification no role admits any more (an older prompt).
 */
export type Admits = 'assessment' | 'discovery' | 'web_discovery' | null;

type Flags = {
  admits_assessment?: PlanQualification['admits_assessment'] | undefined;
  admits_discovery?: PlanQualification['admits_discovery'] | undefined;
  /** Set by the server once P12 (ADR-0086) is in; read here so the merge needs no change. */
  admits_web_discovery?: boolean | undefined;
};

export function roleOf(q: Flags): Admits {
  if (q.admits_assessment === true) return 'assessment';
  if (q.admits_discovery === true) return 'discovery';
  if (q.admits_web_discovery === true) return 'web_discovery';
  return null;
}

/** The qualifications that count for one role; an untagged role never borrows a tagged pass. */
export const forRole = <T extends Flags>(qs: readonly T[], admits: Admits) =>
  qs.filter((q) => roleOf(q) === admits);

const ROLE_NAME: Record<Exclude<Admits, null>, string> = {
  assessment: 'assessments',
  discovery: 'discovery',
  web_discovery: 'Search the web',
};

/** "scoring for discovery", "research synthesis for Search the web", "specification". */
export function roleTask(task_class: string, admits: Admits): string {
  const w = task_class.replaceAll('_', ' ');
  return admits ? `${w} for ${ROLE_NAME[admits]}` : w;
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
  return null;
}
