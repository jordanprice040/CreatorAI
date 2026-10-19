import { createHash } from 'node:crypto';
import {
  AUDIT_PLAN_VERSION,
  AuditPlanSchema,
  StoredKindSchema,
  type AuditCompileResult,
  type AuditPlan,
  type AuditWindow,
  type SubjectRef,
} from '@creator/contracts';

// X03: natural-language audit questions. The rules compiler maps a question onto one plan
// from a closed list with typed parameters; record names and ids in the question become
// bound parameters, never query text. A model compiler (metered, in the broker) may propose
// a plan instead, and acceptModelPlan holds it to the same strict schema.

const KINDS = new Set<string>(StoredKindSchema.options);
const ID_RE = /\b([0-9a-f]{8}(?:-[0-9a-f]{4}){0,3}(?:-[0-9a-f]{1,12})?)\b/gi;
// Titles in double quotes (straight or curly); apostrophes are ordinary text.
const QUOTED_RE = /(?:\b([a-z_]+)\s+)?["“]([^"”\n]{1,200})["”]/gi;
const KIND_ALIASES: Record<string, string> = {
  spec: 'specification',
  specs: 'specification',
  products: 'product',
  sources: 'source',
  ideas: 'idea',
  problems: 'problem',
  claims: 'claim',
  runs: 'run',
  tasks: 'task',
  artifacts: 'artifact',
};
const kindOf = (w: string | undefined) => {
  const k = w ? (KIND_ALIASES[w.toLowerCase()] ?? w.toLowerCase()) : '';
  return KINDS.has(k) ? (k as SubjectKind) : null;
};
type SubjectKind = Extract<SubjectRef, { title: string }>['kind'];

/** Today's calendar date in a time zone, as YYYY-MM-DD. */
export function localToday(tz: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;

/** Reads a time window from the question; dates are calendar days in `tz`. */
export function questionWindow(
  question: string,
  tz: string,
  now = new Date(),
): AuditWindow {
  const q = question.toLowerCase();
  const today = localToday(tz, now);
  let m: RegExpExecArray | null;
  if (
    (m = new RegExp(
      `(?:between|from)\\s+${DATE}\\s+(?:and|to|until)\\s+${DATE}`,
    ).exec(q))
  )
    return { from: m[1]!, to: m[2]!, tz };
  if ((m = new RegExp(`\\b(?:since|after|from)\\s+${DATE}`).exec(q)))
    return { from: m[1]!, to: null, tz };
  if ((m = new RegExp(`\\b(?:before|until)\\s+${DATE}`).exec(q)))
    return { from: null, to: addDays(m[1]!, -1), tz };
  if ((m = new RegExp(`\\bon\\s+${DATE}`).exec(q)))
    return { from: m[1]!, to: m[1]!, tz };
  if ((m = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(q)))
    return { from: addDays(today, -(Number(m[1]) - 1)), to: today, tz };
  if (/\byesterday\b/.test(q))
    return { from: addDays(today, -1), to: addDays(today, -1), tz };
  if (/\btoday\b/.test(q)) return { from: today, to: today, tz };
  return { from: null, to: null, tz };
}

/** Ids, id prefixes and quoted titles named in a question, in order of appearance. */
export function questionSubjects(question: string): {
  ref: SubjectRef;
  kind: SubjectKind;
  at: number;
}[] {
  const out: { ref: SubjectRef; kind: SubjectKind; at: number }[] = [];
  const quoted: [number, number][] = [];
  for (const m of question.matchAll(QUOTED_RE)) {
    const title = m[2]!.trim();
    if (!title) continue;
    const kind = kindOf(m[1]);
    out.push({ ref: { title, kind }, kind, at: m.index });
    quoted.push([m.index, m.index + m[0].length]);
  }
  for (const m of question.matchAll(ID_RE)) {
    if (quoted.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const raw = m[1]!.toLowerCase().replace(/-+$/, '');
    if (!/[0-9]/.test(raw)) continue; // an all-letter word such as "deadbeef" is not an id
    const before = question
      .slice(0, m.index)
      .trim()
      .split(/\s+/)
      .at(-1)
      ?.replace(/[^a-z_]/gi, '');
    const kind = kindOf(before);
    out.push({ ref: { id: raw.slice(0, 36) }, kind, at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

const has = (q: string, re: RegExp) => re.test(q);
const SUGGESTIONS = [
  'Which sources does product "Name" come from?',
  'Which products use source 1a2b3c4d?',
  'How much did run 1a2b3c4d cost?',
  'What did products "A" and "B" cost together?',
  'Show the upstream lineage of idea 1a2b3c4d',
  'Which decisions are pending for run 1a2b3c4d?',
  'Who changed product 1a2b3c4d in the last 7 days?',
  'What was redacted since 2026-10-01?',
  'Model usage for fixture-model-v1 last 30 days',
];

/**
 * Compiles a question into one plan from the closed list, or says it is unsupported. Pure and
 * deterministic: the same question, zone and day always give the same plan.
 */
export function compileAuditQuestion(
  question: string,
  options: { tz: string; limit: number; now?: Date },
): AuditCompileResult {
  const q = question.toLowerCase();
  const window = questionWindow(question, options.tz, options.now);
  const subjects = questionSubjects(question);
  const base = { version: AUDIT_PLAN_VERSION, limit: options.limit } as const;
  const first = subjects[0]?.ref ?? null;
  const unsupported = (reason: string): AuditCompileResult => ({
    status: 'unsupported',
    reason,
    suggestions: SUGGESTIONS,
  });
  const plan = (p: AuditPlan): AuditCompileResult => ({
    status: 'compiled',
    plan: AuditPlanSchema.parse(p),
  });
  if (
    has(
      q,
      /\b(cost|costs|costed|spend|spent|spending|expense|expenses|paid|charged?|money)\b|how much/,
    )
  ) {
    if (!subjects.length)
      return unsupported(
        'A cost question needs a run, product, idea or problem: give its id or its title in quotes.',
      );
    const isRun =
      subjects.length === 1 &&
      (subjects[0]!.kind === 'run' ||
        (subjects[0]!.kind === null && has(q, /\brun\b/)));
    if (isRun) return plan({ ...base, intent: 'run_cost', run: first! });
    return plan({
      ...base,
      intent: 'subject_cost',
      subjects: subjects.slice(0, 10).map((s) => s.ref),
    });
  }
  if (has(q, /\bmodels?\b/) && has(q, /\b(usage|used|use|calls?|spend)\b/)) {
    // A model id looks like fixture-model-v1 or gpt-6-astra: hyphenated, with a digit.
    const modelId =
      question
        .match(/\b[a-z0-9]+(?:[-.:][a-z0-9]+)+\b/gi)
        ?.find(
          (t) => /\d/.test(t) && /-/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t),
        )
        ?.slice(0, 100) ?? null;
    return plan({ ...base, intent: 'model_usage', model_id: modelId, window });
  }
  if (has(q, /\b(redact\w*|deleted|tombstones?|removed)\b/))
    return plan({ ...base, intent: 'redactions', window });
  if (has(q, /\b(decisions?|approvals?|approved|pending)\b/)) {
    const status =
      (/\b(pending|answered|expired|cancelled|superseded)\b/.exec(q)?.[1] as
        | 'pending'
        | 'answered'
        | 'expired'
        | 'cancelled'
        | 'superseded'
        | undefined) ?? null;
    const run = subjects.find((s) => s.kind === 'run' || s.kind === null);
    return plan({
      ...base,
      intent: 'decisions',
      run: run?.ref ?? null,
      status,
      window,
    });
  }
  if (
    has(
      q,
      /\b(sources?|evidence|came from|come from|comes from|based on|origins?)\b/,
    )
  ) {
    if (!first)
      return unsupported(
        'Name the product or source: give its id or its title in quotes.',
      );
    const forward =
      subjects[0]!.kind === 'source' ||
      has(q, /\b(which|what) products?\b|\bproducts? (use|used|uses|built)\b/);
    return plan({
      ...base,
      intent: 'source_to_product',
      subject: first,
      direction: forward ? 'to_products' : 'to_sources',
      depth: 8,
    });
  }
  if (
    has(
      q,
      /\b(lineage|upstream|downstream|derived|descend\w*|ancestors?|provenance)\b/,
    )
  ) {
    if (!first) return unsupported('Name the record whose lineage you want.');
    const down = has(
      q,
      /\b(downstream|descend\w*|derived from (it|this)|what was derived)\b/,
    );
    return plan({
      ...base,
      intent: 'lineage',
      subject: first,
      direction: down ? 'downstream' : 'upstream',
      depth: 8,
    });
  }
  if (has(q, /\b(who|changed|changes|activity|history|happened|edited|did)\b/))
    return plan({
      ...base,
      intent: 'activity',
      subject: first,
      action_prefix: null,
      window,
    });
  return unsupported(
    'The question does not match a supported audit question. Supported: sources behind a product, products using a source, lineage, run or product cost, decisions, activity, redactions and model usage.',
  );
}

/** Marker the model compiler's instruction starts with (the fixture model recognises it). */
export const AUDIT_COMPILER_MARKER = 'audit-plan-compiler/1:';
export function auditCompilerInput(
  question: string,
  tz: string,
  limit: number,
): { role: 'system' | 'user'; text: string }[] {
  return [
    {
      role: 'system',
      text: `${AUDIT_COMPILER_MARKER} Translate the user's audit question into one JSON object that matches the ${AUDIT_PLAN_VERSION} schema (intent is one of source_to_product, lineage, run_cost, subject_cost, decisions, activity, redactions, model_usage). Refer to records only by id or exact title. Output JSON only. Never write SQL; any other key is rejected.\nTZ: ${tz}\nLIMIT: ${limit}`,
    },
    { role: 'user', text: question },
  ];
}
/** The fixture model's answer: the rules compiler's plan, labelled as such. */
export function auditPlanFixtureAnswer(
  input: { role: string; text: string }[],
): string | null {
  const sys = input.find((m) => m.text.startsWith(AUDIT_COMPILER_MARKER));
  if (!sys) return null;
  const tz = /\nTZ: (.+)/.exec(sys.text)?.[1]?.trim() ?? 'UTC';
  const limit = Number(/\nLIMIT: (\d+)/.exec(sys.text)?.[1] ?? 50);
  const question = input.find((m) => m.role === 'user')?.text ?? '';
  const r = compileAuditQuestion(question, { tz, limit });
  return JSON.stringify(
    r.status === 'compiled' ? r.plan : { unsupported: r.reason },
  );
}
/**
 * Holds a model-proposed plan to the strict schema. Extra keys (such as `sql`), unknown
 * intents and out-of-range limits are refused; the plan never becomes query text.
 */
export function acceptModelPlan(
  text: string,
):
  | { status: 'compiled'; plan: AuditPlan }
  | { status: 'unsupported'; reason: string }
  | { status: 'refused'; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { status: 'refused', reason: 'The model did not return JSON.' };
  }
  if (
    json !== null &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    Object.keys(json).length === 1 &&
    typeof (json as { unsupported?: unknown }).unsupported === 'string'
  )
    return {
      status: 'unsupported',
      reason: String((json as { unsupported: string }).unsupported).slice(
        0,
        500,
      ),
    };
  const parsed = AuditPlanSchema.safeParse(json);
  if (!parsed.success)
    return {
      status: 'refused',
      reason:
        `The proposed plan does not match ${AUDIT_PLAN_VERSION}: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')}`.slice(0, 500),
    };
  return { status: 'compiled', plan: parsed.data };
}

/**
 * Fixture embedding (labelled fixture, not a real model): hashed character trigrams of the
 * lower-cased words, L2-normalised. Similar spellings land close together, which is enough to
 * exercise metering, ranking and access checks; it has no semantic understanding.
 */
export const FIXTURE_EMBED_DIMENSIONS = 64;
export function fixtureEmbedding(
  text: string,
  dims = FIXTURE_EMBED_DIMENSIONS,
): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const w = ` ${word} `;
    for (let i = 0; i + 3 <= w.length; i++) {
      const h = createHash('sha256')
        .update(w.slice(i, i + 3))
        .digest();
      v[h.readUInt16BE(0) % dims]! += h[2]! & 1 ? 1 : -1;
    }
  }
  const norm = Math.hypot(...v);
  return norm ? v.map((x) => Math.round((x / norm) * 1e6) / 1e6) : v;
}
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** An instant as wall-clock time in a zone with its offset, e.g. 2026-10-19T03:31:06-04:00. */
export function localTimestamp(iso: string, tz: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'longOffset',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const offset =
    String(parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}
