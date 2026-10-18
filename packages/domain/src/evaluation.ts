import {
  ContractError,
  StudyPacketSchema,
  parse,
  type StudyInput,
} from '@creator/contracts';
import { canonicalHash } from './rules.js';
import {
  BLOCKING_DECISIONS,
  PROPOSED_PROTOCOL,
  REVEALING,
  classifyAttempt,
  type OwnerDecision,
  type PilotAttempt,
} from './pilot.js';

/**
 * T15 final evaluation. The schedule is derived only from a frozen protocol and the owner's
 * final tasks; admission is decided here, not by the runner; every slot ends in the flow
 * table with a truthful state; reviewer packets are blinded and scanned before they exist.
 */
export const EVALUATION_VERSION = 'final-evaluation/1';

type StudyPacket = StudyInput['packet'];
export type EvaluationArm = 'A' | 'B' | 'C' | 'D-structured' | 'D-open';
const ARMS = {
  A: { condition: 'autonomous', discovery_method: 'structured' },
  B: { condition: 'human_in_loop', discovery_method: 'structured' },
  C: { condition: 'human_only', discovery_method: 'human_defined' },
  'D-structured': { condition: 'autonomous', discovery_method: 'structured' },
  'D-open': { condition: 'autonomous', discovery_method: 'open_ended' },
} as const;

export interface EvaluationTask {
  key: string;
  /** autonomy tasks get arms A, B and C; discovery themes get the repeated structured/open pair. */
  role: 'autonomy' | 'discovery';
  packet: StudyPacket;
}
export interface FreezeManifest {
  schema_version: 'protocol-freeze/1';
  proposal_hash: string;
  proposal: unknown;
  decisions: OwnerDecision[];
}
export interface FrozenProtocol {
  /** adopted: read from the owner's audit log. rehearsal: plumbing only, never final. */
  origin: 'adopted' | 'rehearsal';
  freeze_hash: string;
  manifest: FreezeManifest;
}

interface Counts {
  decision_tasks: number;
  implementation_tasks: number;
  discovery_themes: number;
  discovery_repeats: number;
}

/** Rebuilds the manifest the server froze and refuses one that no longer binds current code. */
export function verifyFreeze(f: FrozenProtocol) {
  if (canonicalHash(f.manifest) !== f.freeze_hash)
    throw new ContractError(
      'EVIDENCE_MISMATCH',
      'The freeze manifest does not match its recorded hash.',
    );
  if (canonicalHash(f.manifest.proposal) !== f.manifest.proposal_hash)
    throw new ContractError(
      'EVIDENCE_MISMATCH',
      'The frozen proposal does not match its recorded hash.',
    );
  if (
    f.origin === 'adopted' &&
    f.manifest.proposal_hash !== canonicalHash(PROPOSED_PROTOCOL)
  )
    throw new ContractError(
      'VERSION_CONFLICT',
      'The protocol in code changed after the freeze; re-freeze before running the evaluation.',
    );
  const counts = (f.manifest.proposal as { counts?: Counts }).counts;
  if (!counts)
    throw new ContractError('INVALID_CONTRACT', 'The freeze has no counts.');
  return counts;
}

/** Rehearsal freeze: the real freeze function with labelled stand-in answers, never adopted. */
export function rehearsalFreeze(): FrozenProtocol {
  const manifest: FreezeManifest = {
    schema_version: 'protocol-freeze/1',
    proposal_hash: canonicalHash(PROPOSED_PROTOCOL),
    proposal: PROPOSED_PROTOCOL,
    decisions: BLOCKING_DECISIONS.map((d) => ({
      id: d.id,
      choice: `REHEARSAL STAND-IN (not an owner decision): ${d.recommendation}`,
      rationale: 'Plumbing rehearsal only.',
    })),
  };
  return {
    origin: 'rehearsal',
    freeze_hash: canonicalHash(manifest),
    manifest,
  };
}

export interface ScheduleSlot {
  slot_id: string;
  /** Position in the single-run-at-a-time execution order. */
  sequence: number;
  task_key: string;
  task_hash: string;
  stratum: 'decision' | 'implementation';
  comparison: 'autonomy' | 'discovery';
  arm: EvaluationArm;
  condition: 'autonomous' | 'human_in_loop' | 'human_only';
  discovery_method: 'structured' | 'open_ended' | 'human_defined';
  repeat: number;
}

const PILOT_PACKETS = new Set<string>(
  PROPOSED_PROTOCOL.task_strata.pilot_tasks_excluded,
);

export function buildSchedule(
  freeze: FrozenProtocol,
  tasks: EvaluationTask[],
  seed: string,
) {
  const counts = verifyFreeze(freeze);
  const problems: string[] = [];
  const parsed = tasks.map((t) => ({
    ...t,
    packet: parse(StudyPacketSchema, t.packet),
  }));
  const keys = new Set(parsed.map((t) => t.key));
  if (keys.size !== parsed.length) problems.push('Task keys must be unique.');
  const hashes = new Set(parsed.map((t) => canonicalHash(t.packet)));
  if (hashes.size !== parsed.length)
    problems.push('Two tasks share an identical packet.');
  for (const t of parsed)
    if (PILOT_PACKETS.has(t.packet.version))
      problems.push(`${t.key} reuses pilot packet ${t.packet.version}.`);
  const count = (role: string, stratum?: string) =>
    parsed.filter(
      (t) => t.role === role && (!stratum || t.packet.stratum === stratum),
    ).length;
  const expect: [string, number, number][] = [
    [
      'autonomy decision tasks',
      count('autonomy', 'decision'),
      counts.decision_tasks,
    ],
    [
      'autonomy implementation tasks',
      count('autonomy', 'implementation'),
      counts.implementation_tasks,
    ],
    ['discovery themes', count('discovery'), counts.discovery_themes],
  ];
  for (const [what, got, want] of expect)
    if (got !== want)
      problems.push(`The freeze requires ${want} ${what}; ${got} supplied.`);
  if (
    parsed.some(
      (t) => t.role === 'discovery' && t.packet.stratum !== 'decision',
    )
  )
    problems.push('Discovery themes use the decision stratum.');
  if (problems.length)
    throw new ContractError(
      'INVALID_CONTRACT',
      'Final tasks do not match the frozen protocol.',
      problems,
    );

  const slots: Omit<ScheduleSlot, 'sequence'>[] = [];
  const add = (
    t: (typeof parsed)[number],
    arm: EvaluationArm,
    repeat: number,
  ) => {
    const task_hash = canonicalHash(t.packet);
    slots.push({
      slot_id: canonicalHash({
        freeze: freeze.freeze_hash,
        task_hash,
        arm,
        repeat,
      }),
      task_key: t.key,
      task_hash,
      stratum: t.packet.stratum,
      comparison: t.role,
      arm,
      ...ARMS[arm],
      repeat,
    });
  };
  for (const t of parsed) {
    if (t.role === 'autonomy')
      for (const arm of ['A', 'B', 'C'] as const) add(t, arm, 1);
    else
      for (let r = 1; r <= counts.discovery_repeats; r++)
        for (const arm of ['D-structured', 'D-open'] as const) add(t, arm, r);
  }
  const ordered = slots
    .map((s) => ({ s, key: canonicalHash({ seed, slot: s.slot_id }) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map((x, i) => ({ ...x.s, sequence: i + 1 }));
  const body = {
    schema_version: 'evaluation-schedule/1',
    evaluation_version: EVALUATION_VERSION,
    freeze_origin: freeze.origin,
    freeze_hash: freeze.freeze_hash,
    seed_hash: canonicalHash({ seed }),
    tasks: parsed.map((t) => ({
      key: t.key,
      role: t.role,
      stratum: t.packet.stratum,
      packet_hash: canonicalHash(t.packet),
    })),
    slots: ordered,
  };
  return { ...body, schedule_hash: canonicalHash(body) };
}
export type EvaluationSchedule = ReturnType<typeof buildSchedule>;

/** What this process may actually do. Nothing here can be granted by a model or a task. */
export interface EvaluationAuthority {
  mode: 'final' | 'rehearsal';
  /** Live AI needs live dispatch enabled and a verified model id (RD6). */
  live_ai: { enabled: boolean; verified_model_id: string | null };
  /** Final runs need the non-synthetic study record path (gated in the study store). */
  final_study_records: boolean;
  /** AI implementation slots need studies bound to a frozen build task and the builder link. */
  ai_implementation: boolean;
  /** Unmet final conditions from config/evaluation.json; each blocks every final slot. */
  governance?: string[];
}
export type Admission =
  | {
      admitted: true;
      ai: 'fixture' | 'live' | null;
      human: 'participant' | 'scripted_rehearsal' | null;
    }
  | { admitted: false; state: 'blocked'; reasons: string[] };

export function admitSlot(
  slot: ScheduleSlot,
  authority: EvaluationAuthority,
): Admission {
  const usesAi = slot.condition !== 'human_only';
  const usesHuman = slot.condition !== 'autonomous';
  const reasons: string[] = [];
  if (
    usesAi &&
    slot.stratum === 'implementation' &&
    !authority.ai_implementation
  )
    reasons.push(
      'AI implementation runs need a study bound to a frozen build task (spec, freeze, held-out cases) for the isolated builder; these tasks have none.',
    );
  if (
    usesAi &&
    authority.mode === 'final' &&
    !(authority.live_ai.enabled && authority.live_ai.verified_model_id)
  )
    reasons.push(
      'No live AI authority: live dispatch is disabled or no model id is verified (RD6). Fixture output never substitutes in a final run.',
    );
  if (authority.mode === 'final' && !authority.final_study_records)
    reasons.push(
      'No final study record path: study records are synthetic-only, so no run can be recorded as real participant or final AI work. Simulated work tests plumbing only.',
    );
  if (authority.mode === 'final')
    for (const g of authority.governance ?? []) reasons.push(g);
  if (reasons.length) return { admitted: false, state: 'blocked', reasons };
  return {
    admitted: true,
    ai: usesAi ? (authority.mode === 'final' ? 'live' : 'fixture') : null,
    human: usesHuman
      ? authority.mode === 'final'
        ? 'participant'
        : 'scripted_rehearsal'
      : null,
  };
}

export interface AttemptRecord {
  attempt_id: string;
  state: string;
  finish: Record<string, unknown> | null;
  measurements: Record<string, unknown>;
  /** Any task output (artifact, model output) was recorded before the end. */
  produced_output: boolean;
  human_source: 'none' | 'participant' | 'scripted_rehearsal';
}

/**
 * RD10: one retry, only for an infrastructure failure before any task output. Both attempts
 * stay in the flow table; the retry never replaces the failed record.
 */
export function retryPermitted(attempts: AttemptRecord[]) {
  if (attempts.length !== 1) return false;
  const [a] = attempts as [AttemptRecord];
  return (
    !a.produced_output &&
    a.finish !== null &&
    classifyAttempt(
      a as Pick<PilotAttempt, 'finish' | 'state' | 'measurements'>,
    ).class === 'instrumentation'
  );
}

export type SlotState =
  | 'blocked'
  | 'deferred'
  | 'missing'
  | 'assigned'
  | 'submitted'
  | 'failed'
  | 'cancelled'
  | 'needs_human'
  | 'budget_exhausted';

/** Every scheduled slot appears exactly once, whether or not anything ran. */
export function flowTable(
  schedule: EvaluationSchedule,
  admissions: Map<string, Admission>,
  attempts: Map<string, AttemptRecord[]>,
  deferred: Map<string, string>,
) {
  return schedule.slots.map((slot) => {
    const admission = admissions.get(slot.slot_id);
    const runs = attempts.get(slot.slot_id) ?? [];
    const last = runs.at(-1);
    let state: SlotState;
    let reasons: string[] = [];
    if (!admission)
      throw new ContractError(
        'INVALID_CONTRACT',
        'Every slot needs an admission.',
      );
    if (!admission.admitted) {
      state = 'blocked';
      reasons = admission.reasons;
      if (runs.length)
        throw new ContractError(
          'INVALID_TRANSITION',
          'A blocked slot has a recorded attempt.',
        );
    } else if (deferred.has(slot.slot_id) && !runs.length) {
      state = 'deferred';
      reasons = [deferred.get(slot.slot_id)!];
    } else if (!last) {
      state = 'missing';
      reasons = ['Admitted but no attempt was recorded.'];
    } else state = last.state as SlotState;
    return {
      slot_id: slot.slot_id,
      sequence: slot.sequence,
      task_key: slot.task_key,
      arm: slot.arm,
      condition: slot.condition,
      discovery_method: slot.discovery_method,
      repeat: slot.repeat,
      state,
      reasons,
      outcome: last
        ? (last.finish?.outcome ?? last.finish?.status ?? null)
        : null,
      attempts: runs.map((r, i) => ({
        attempt_id: r.attempt_id,
        state: r.state,
        retry_of: i ? runs[i - 1]!.attempt_id : null,
        human_source: r.human_source,
        classification: classifyAttempt(r),
        measurements: r.measurements,
      })),
    };
  });
}

export const REVIEWER_RUBRIC = {
  version: 'reviewer-rubric/1',
  dimensions: [
    'usefulness',
    'feasibility',
    'evidence_support',
    'differentiation',
    'appropriateness',
  ],
  text: 'Rate each item 1-5 on each dimension using the anchors in SCORING_RUBRIC.md. Rate the text as written. Record a note when an item is unrateable; do not guess how it was produced.',
} as const;

export interface ReviewItem {
  slot_id: string;
  attempt_id: string;
  task_key: string;
  problem: string;
  outcome: string;
  text: string | null;
}

function normalize(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
}
const SUBMISSION = '## Submission\n\n';
const SUBMISSION_FLAGS = new RegExp(
  `${REVEALING.source}|fixture|as an ai|language model`,
  'i',
);

/**
 * One identically formatted packet per reviewer, in a per-reviewer random order. Codes come
 * from a secret kept only in the private key, so they cannot be recomputed from slot ids.
 */
export function blindedPackets(input: {
  items: ReviewItem[];
  reviewers: string[];
  secret: string;
}) {
  const coded = input.items.map((i) => ({
    ...i,
    code: canonicalHash({ secret: input.secret, slot: i.slot_id }).slice(0, 10),
  }));
  const files: Record<string, string> = {};
  const orders: Record<string, string[]> = {};
  for (const reviewer of input.reviewers) {
    const order = coded
      .map((i) => ({
        i,
        k: canonicalHash({ secret: input.secret, reviewer, code: i.code }),
      }))
      .sort((a, b) => (a.k < b.k ? -1 : 1))
      .map((x) => x.i);
    orders[reviewer] = order.map((i) => i.code);
    const dir = `reviewers/${reviewer}`;
    files[`${dir}/README.md`] =
      `# Review packet\n\nRubric ${REVIEWER_RUBRIC.version}. ${REVIEWER_RUBRIC.text}\n\n` +
      `Dimensions: ${REVIEWER_RUBRIC.dimensions.join(', ')}.\n\n` +
      `There are ${order.length} items. Enter ratings in ratings.csv using each item's code. ` +
      'Do not discuss items with other reviewers before submitting.\n';
    order.forEach((i, n) => {
      const num = String(n + 1).padStart(2, '0');
      files[`${dir}/items/item-${num}.md`] =
        `# Item ${num}\n\nCode: ${i.code}\n\n## Task\n\n${normalize(i.problem)}\n\n` +
        `## Asked for\n\n${normalize(i.outcome)}\n\n${SUBMISSION}` +
        `${i.text === null || !normalize(i.text) ? 'No submitted output.' : normalize(i.text)}\n`;
    });
    files[`${dir}/ratings.csv`] =
      ['item', 'code', ...REVIEWER_RUBRIC.dimensions, 'notes'].join(',') +
      '\n' +
      order
        .map(
          (i, n) =>
            `${String(n + 1).padStart(2, '0')},${i.code}${','.repeat(REVIEWER_RUBRIC.dimensions.length + 1)}`,
        )
        .join('\n') +
      '\n';
  }
  return {
    files,
    key: {
      private: true,
      secret: input.secret,
      codes: Object.fromEntries(
        coded.map((i) => [
          i.code,
          { slot_id: i.slot_id, attempt_id: i.attempt_id },
        ]),
      ),
      reviewer_orders: orders,
    },
  };
}

/**
 * Template and filename leaks fail. Inside a submission, ids fail (they can only come from
 * the system) while condition-like words are flagged for owner review, because the packet must
 * not rewrite what a participant or model actually submitted.
 */
export function scanBlinding(
  files: Record<string, string>,
  forbidden: string[],
  /** Task text shown identically to every arm; it cannot reveal a condition. */
  taskText: string[] = [],
) {
  const failures: string[] = [];
  const flags: string[] = [];
  const tokens = forbidden
    .filter((t) => t.length >= 6)
    .map((t) => t.toLowerCase());
  const template = new RegExp(
    `${REVEALING.source}|\\barm\\b|fixture|rehearsal|pilot|participant|autonom`,
    'i',
  );
  for (const [path, body] of Object.entries(files)) {
    if (
      template.test(path) ||
      tokens.some((t) => path.toLowerCase().includes(t))
    )
      failures.push(`${path}: filename reveals hidden metadata.`);
    const cut = body.indexOf(SUBMISSION);
    const head = taskText
      .map(normalize)
      .reduce(
        (h, t) => (t ? h.split(t).join('') : h),
        cut === -1 ? body : body.slice(0, cut),
      );
    const submission = cut === -1 ? '' : body.slice(cut + SUBMISSION.length);
    const m = head.match(template);
    if (m) failures.push(`${path}: template contains "${m[0]}".`);
    const lower = body.toLowerCase();
    const id = tokens.find((t) => lower.includes(t));
    if (id) failures.push(`${path}: contains a hidden identifier.`);
    const s = submission.match(SUBMISSION_FLAGS);
    if (s)
      flags.push(
        `${path}: submission text contains "${s[0]}"; owner review before sending.`,
      );
  }
  return { failures, flags };
}
