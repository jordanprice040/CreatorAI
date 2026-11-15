import type { PoolClient } from 'pg';
import {
  BenchmarkCheckSchema,
  ContractError,
  SPEC_DRAFT_INSTRUCTIONS,
  SPEC_DRAFT_INSTRUCTIONS_VERSION,
  SpecCaseProblemSchema,
  SpecDraftResultSchema,
  draftComparable,
  heldOutOf,
  specDraftInput,
  type PlanAdmissionRequest,
  type SpecContent,
  type SpecDraft,
  type SpecDraftedMark,
  type SpecDraftResult,
} from '@creator/contracts';
import { canonicalHash } from '@creator/domain';
import { iso, type Row } from './store.js';

// ADR-0107 (B2): what an owner's press of Draft the spec, Add an edge case or Explain this case
// covers, checked in code under row locks, and how a saved spec says drafts went into it.

/** The plan task class that drafts specs. */
export const SPEC_DRAFT_TASK_CLASS = 'specification' as const;

export interface SpecDraftBinding {
  draft_id: string;
}

/** One spec draft as the page reads it; its words are gone once its option is redacted. */
export const toSpecDraft = (r: Row): SpecDraft => {
  const result = r.redacted_at
    ? null
    : SpecDraftResultSchema.safeParse(r.result).data ?? null;
  const problems = r.redacted_at
    ? []
    : ((r.problems as unknown[] | null) ?? []).flatMap((p) => {
        const ok = SpecCaseProblemSchema.safeParse(p);
        return ok.success ? [ok.data] : [];
      });
  return {
    id: String(r.id),
    kind: String(r.kind) as SpecDraft['kind'],
    selection_id: String(r.selection_id),
    alternative: {
      id: String(r.alternative_id),
      version: Number(r.alternative_version),
    },
    product: String(r.product) as SpecDraft['product'],
    state: String(r.state) as SpecDraft['state'],
    connection_kind: String(r.connection_kind),
    fixture: Boolean(r.fixture),
    model_id: String(r.model_id),
    result,
    problems,
    reason:
      r.reason === null || r.reason === undefined ? null : String(r.reason),
    sent:
      r.state === 'refused' || r.redacted_at
        ? null
        : {
            instructions_version: String(r.instructions_version),
            instructions_hash: String(r.instructions_hash),
            input: String(r.input),
          },
    requested_by: String(r.requested_by),
    created_at: iso(r.created_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
  };
};

/**
 * ADR-0107: a specification qualification admits spec drafts only when every case is a spec
 * cases check on the current instructions version, whose system message is exactly the draft
 * instructions and whose user message is exactly the draft input for its request. The older
 * acceptance-check labelling benchmark (specification-synthetic-v1) never admits drafts.
 */
export function currentForSpecDraftRole(r: Row): boolean {
  if (String(r.task_class) !== SPEC_DRAFT_TASK_CLASS) return false;
  const manifest = r.manifest as {
    cases?: { input?: { role: string; text: string }[]; check?: unknown }[];
  };
  if (!manifest?.cases?.length || canonicalHash(manifest) !== r.manifest_hash)
    return false;
  return manifest.cases.every((item) => {
    const parsed = BenchmarkCheckSchema.safeParse(item.check);
    if (
      !parsed.success ||
      parsed.data.kind !== 'spec_cases_contract' ||
      parsed.data.role_version !== SPEC_DRAFT_INSTRUCTIONS_VERSION
    )
      return false;
    const of = (role: string) =>
      (item.input ?? [])
        .filter((m) => m.role === role)
        .map((m) => m.text)
        .join('\n\n');
    return (
      of('system') === SPEC_DRAFT_INSTRUCTIONS &&
      of('user') ===
        specDraftInput({
          kind: 'spec',
          product: 'cli',
          ...parsed.data.request,
          check: null,
          case_index: null,
          maxChars: Number.MAX_SAFE_INTEGER,
        })
    );
  });
}

/**
 * Refuses a plan request the spec draft does not cover: the request must be the draft's own
 * (same operation, connection, model and data class), by the person who pressed, while the
 * draft is still waiting for it, and it is sent once.
 */
export async function specDraftRequestGate(
  c: PoolClient,
  ws: string,
  actorId: string,
  req: PlanAdmissionRequest,
  b: SpecDraftBinding,
): Promise<void> {
  if (
    req.purpose !== 'task' ||
    req.path !== 'responses' ||
    req.task_class !== SPEC_DRAFT_TASK_CLASS ||
    req.run_id !== null ||
    req.build_id !== null
  )
    throw new ContractError(
      'INVALID_CONTRACT',
      'A spec draft request is one specification task outside any run or build.',
    );
  const d = (
    await c.query(
      'select * from spec_drafts where workspace_id = $1 and id = $2 for update',
      [ws, b.draft_id.toLowerCase()],
    )
  ).rows[0] as Row | undefined;
  if (!d) throw new ContractError('NOT_FOUND', 'Spec draft not found.');
  const out: string[] = [];
  if (String(d.logical_operation_id) !== req.logical_operation_id.toLowerCase())
    out.push('The request is not this draft’s own request.');
  if (
    String(d.connection_id) !== req.connection_id.toLowerCase() ||
    d.model_id !== req.model_id ||
    d.data_class !== req.data_class
  )
    out.push(
      'The request names another connection, model or data class than the draft.',
    );
  if (String(d.requested_by) !== actorId)
    out.push('Only the person who asked for this draft can send it.');
  if (d.state !== 'pending' || d.plan_request_id !== null)
    out.push('This draft already made its request; it makes one.');
  if (out.length)
    throw new ContractError(
      'ACCESS_DENIED',
      'This plan request is not covered by the spec draft.',
      out,
    );
}

/**
 * The drafted mark of a spec version saved with these draft ids (ADR-0107), or the prior
 * version's mark when no new draft is named. Each draft must be a completed spec or edge case
 * draft of this option, in this workspace, with its words still kept; anything else refuses
 * the save, so a mark never names a draft that is not what it says.
 */
export async function draftedMark(
  c: PoolClient,
  ws: string,
  alternativeId: string,
  content: SpecContent,
  draftIds: readonly string[] | undefined,
  prior: SpecDraftedMark | undefined,
): Promise<SpecDraftedMark | undefined> {
  const ids = [...new Set((draftIds ?? []).map((x) => x.toLowerCase()))];
  const known = new Set(prior?.drafts.map((d) => d.id) ?? []);
  const fresh = ids.filter((x) => !known.has(x));
  if (!fresh.length && !prior) return undefined;
  const { rows } = fresh.length
    ? await c.query(
        'select * from spec_drafts where workspace_id = $1 and id = any($2::uuid[])',
        [ws, fresh],
      )
    : { rows: [] as Row[] };
  const found = new Map((rows as Row[]).map((r) => [String(r.id), r]));
  const bad: string[] = [];
  const added: { row: Row; result: SpecDraftResult }[] = [];
  for (const x of fresh) {
    const r = found.get(x);
    const result = r ? SpecDraftResultSchema.safeParse(r.result).data : null;
    if (
      !r ||
      r.state !== 'completed' ||
      r.redacted_at ||
      String(r.alternative_id) !== alternativeId ||
      !result ||
      (result.kind !== 'spec' && result.kind !== 'edge_case')
    )
      bad.push(x.slice(0, 8));
    else added.push({ row: r, result });
  }
  if (bad.length)
    throw new ContractError(
      'INVALID_CONTRACT',
      `The spec names model drafts that cannot be recorded with it (${bad.join(', ')}): each must be a completed spec or edge-case draft for this option.`,
    );
  const drafts = [
    ...(prior?.drafts ?? []),
    ...added.map(({ row, result }) => ({
      id: String(row.id),
      kind: result.kind as 'spec' | 'edge_case',
      model_id: String(row.model_id),
    })),
  ].slice(-40);
  if (!drafts.length) return undefined;
  // `edited` and `held_out` follow the newest whole-spec draft named in this save; without
  // one they are carried over (and an edge case counts as edited when it is not there as drafted).
  const spec = [...added].reverse().find((a) => a.result.kind === 'spec');
  let edited = prior?.edited ?? false;
  let held_out: SpecDraftedMark['held_out'] = prior?.held_out ?? 'none';
  if (spec && spec.result.kind === 'spec') {
    edited =
      canonicalHash(draftComparable(content)) !==
      canonicalHash(draftComparable(spec.result.content));
    const pick = (p: { check: string; list: string; index: number }) =>
      `${p.check}/${p.list}/${p.index}`;
    held_out =
      JSON.stringify(spec.result.picks.map(pick).sort()) ===
      JSON.stringify(heldOutOf(content).map(pick).sort())
        ? 'studio_pick'
        : 'changed';
  }
  for (const { result } of added)
    if (result.kind === 'edge_case') {
      const check = content.acceptance_checks.find(
        (a) => a.key === result.check,
      );
      const same = (a: unknown, b: unknown) =>
        canonicalHash({ ...(a as object), held_out: false }) ===
        canonicalHash({ ...(b as object), held_out: false });
      const there = result.case
        ? check?.cases?.some((x) => same(x, result.case))
        : check?.browser_cases?.some((x) => same(x, result.browser_case));
      if (!there) edited = true;
    }
  return { drafts, edited, held_out };
}
