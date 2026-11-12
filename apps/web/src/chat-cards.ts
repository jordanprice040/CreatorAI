// ADR-0083 (P20): the rules behind Chat's action cards. Pure: given a card's answers, the
// records loaded for it and the person's view, they say which question to ask next, what is
// still needed, exactly which requests a send makes (the form's own routes and bodies) and
// what will happen. Nothing here sends anything; chat-card.tsx sends the plan after the
// person presses Send, and every route checks it again exactly as for the form.

import {
  CHAT_ACTION_SUBJECTS_MAX,
  WORKFLOW_WALL_MAX_SECONDS,
  type PlanConnectionDetail,
} from '@creator/contracts';
import { studioDefaults } from './discover-defaults.js';
import { overridesFor, type CarryReport } from './carry-decisions.js';
import {
  CHECK_DEFAULT,
  CHECK_LABELS,
  OPEN_CHECKS,
  draftToBody,
  emptyDraft,
  refKey,
  type GateChoice,
  type RatingChoice,
  type ScorecardDraft,
} from './scorecard-fields.js';

export type CardKind =
  | 'fund_budget'
  | 'fetch_source'
  | 'cite_claim'
  | 'start_discovery'
  | 'answer_decision'
  | 'score_option'
  | 'record_choice'
  | 'save_proposal';

export type Value = string | string[];
export type Input = Record<string, unknown>;

export type CardCtx = {
  ws: string;
  fixture: boolean;
  /** Advanced asks routine questions too; Standard uses their shown defaults. */
  advanced: boolean;
  /** The reviewer label a scorecard records (the person's display name). */
  reviewer: string;
  /** Plan time, rounded to the minute so the shown requests match what is sent. */
  now: number;
};

export type Choice = {
  value: string;
  label: string;
  detail?: string | undefined;
  /** Why it cannot be picked; shown beside it. */
  blocked?: string;
};

export type Question = {
  key: string;
  /** The question, as the form would ask it. */
  prompt: string;
  /** The field's short name, for the review list and "still needed". */
  label: string;
  help?: string | undefined;
  type: 'text' | 'long' | 'choice' | 'multi';
  choices?: Choice[];
  /** Routine: Standard uses `fallback` without asking; Advanced asks with it filled in. */
  routine?: boolean;
  /** May be left empty (Skip). */
  optional?: boolean;
  /** The value used when nothing was answered (routine), or the starting text (others). */
  fallback?: Value;
  /** Where a routine value came from, for the summary. */
  source?: string | undefined;
};

export type Step = {
  label: string;
  /** The form's route, relative to /api/. `{name}` is filled from an earlier response. */
  path: string;
  body: unknown;
  idempotencyKey?: string;
  timeoutMs?: number;
  /** Values to keep from the response: name → field. */
  capture?: Record<string, string>;
  /** The record the response is, for the card's outcome. */
  record?: { kind: string; label: string; from: string };
  /**
   * A route that answers a refusal with 200 and a record of it: a retrieval that was not
   * fetched, or a selection the admission held or denied. The card reads it as the form does.
   */
  answer?: 'retrieval' | 'admission';
};

export type Subject = {
  kind: 'entity' | 'decision';
  id: string;
  version: number;
  label: string;
};

export type Line = {
  label: string;
  value: string;
  source?: string | undefined;
};

export type CardView = {
  questions: Question[];
  values: Record<string, Value>;
  /** The question to ask now, or null when every needed answer is in. */
  current: Question | null;
  /** Names of answers still needed, in order. */
  missing: string[];
  steps: Step[];
  /** Why it cannot be sent even when every answer is in (no budget, nothing to score…). */
  blockers: string[];
  happen: Line[];
  subjects: Subject[];
  /** One line naming what the card does, with its main subject. */
  title: string;
};

// ---- Data each kind is shown with (loaded in chat-card-load.ts) -------------------------

export type FundData = {
  budgets: number;
  fixturePricing: boolean;
  pricingBody: unknown;
};
export type FetchData = {
  /** Active runs whose live grant allows fetching, newest first. */
  runs: { id: string; label: string }[];
  pages: string[];
};
export type PassageOption = {
  id: string;
  label: string;
  excerpt: string;
};
export type CiteData = { passages: PassageOption[] };
export type ClaimOption = { id: string; version: number; title: string };
export type DiscoverRoute =
  | { kind: 'api'; envelope: string; pricing: string; label: string }
  | {
      kind: 'subscription';
      connection: string;
      model: string;
      settings_hash: string;
      max_output_chars: number;
      timeout_ms: number;
      max_requests: number;
      label: string;
    };
export type DiscoverData = {
  claims: ClaimOption[];
  route: DiscoverRoute | null;
  /** Why no route can run a discovery now, in the Discover form's words. */
  routeBlockers: string[];
  /**
   * ADR-0087 (P27): what the owner's fixes for those blockers need (the connection as read,
   * the model and the discovery tasks it lacks). The card draws the buttons from these facts,
   * never from the model's reply.
   */
  routeFix?: {
    plan: Pick<PlanConnectionDetail, 'connection' | 'refusals'>;
    model: string;
    missing: string[];
  };
};
export type DecisionOption = {
  id: string;
  version: number;
  question: string;
  reason: string;
  covers: string;
  current: boolean;
  coverage_hash: string;
  recommendation: string | null;
};
export type DecisionData = { decisions: DecisionOption[] };
export type ScoreOptionData = {
  id: string;
  version: number;
  title: string;
  kind: string;
  problem: string;
  target_users: string;
  outcome: string;
  claims: ClaimOption[];
  /** Why it is not offered here (already scored by you, an automatic assessment to edit). */
  skip?: string;
};
export type ScoreData = {
  options: ScoreOptionData[];
  rubricVersion: string;
  criteria: {
    key: string;
    label: string;
    anchors: Record<1 | 3 | 5, string>;
  }[];
};
export type ChoiceProblem = {
  id: string;
  version: number;
  title: string;
  report_hash: string;
  report: CarryReport;
  runs: { id: string; label: string }[];
  defaultRun: string;
  alternatives: {
    id: string;
    version: number;
    title: string;
    kind: string;
    rank: number | null;
    blocked: Record<string, string[]>;
  }[];
  /** Why a card cannot record it (an earlier selection exists, nothing scored…). */
  skip?: string;
};
export type ChoiceData = { problems: ChoiceProblem[] };
export type ProposalOption = {
  option: { id: string; version: number; title: string; kind: string };
  problem: string;
};
export type ProposalData = {
  eligible: ProposalOption[];
  /** The draft for the picked option, built by the server from records. */
  draft: {
    title: string;
    body: {
      summary: string;
      sections: Record<
        string,
        {
          state: string;
          text: string;
          claims: { id: string; version: number }[];
        }
      >;
      [k: string]: unknown;
    };
  } | null;
  sections: { key: string; label: string; core: boolean }[];
};

export type CardData =
  | FundData
  | FetchData
  | CiteData
  | DiscoverData
  | DecisionData
  | ScoreData
  | ChoiceData
  | ProposalData;

// ---- Shared helpers ---------------------------------------------------------------------

const str = (v: Value | undefined) =>
  typeof v === 'string' ? v.trim() : (v ?? []).join(', ');
const list = (v: Value | undefined): string[] =>
  Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const DAY = 86_400_000;

/** The answer a question has now: what was answered, else its routine default. */
function valueOf(q: Question, input: Input): Value {
  if (Object.hasOwn(input, q.key)) {
    const v = input[q.key];
    if (Array.isArray(v)) return v.map(String);
    return typeof v === 'string' ? v : '';
  }
  return q.routine ? (q.fallback ?? '') : '';
}
const empty = (v: Value) => (Array.isArray(v) ? v.length === 0 : !v.trim());

/** A question still to ask: never answered (unless routine in Standard), or required and empty. */
export function pending(q: Question, input: Input, advanced: boolean) {
  const answered = Object.hasOwn(input, q.key);
  if (!answered) return !(q.routine && !advanced);
  return !q.optional && empty(valueOf(q, input));
}

/** The card as the page shows it: next question, what is missing, the requests and summary. */
export function cardView(
  kind: CardKind,
  input: Input,
  data: CardData | null,
  ctx: CardCtx,
): CardView {
  const spec = SPECS[kind] as Spec<CardData>;
  if (!data)
    return {
      questions: [],
      values: {},
      current: null,
      missing: [],
      steps: [],
      blockers: ['Reading the records this card needs…'],
      happen: [],
      subjects: [],
      title: LABEL[kind],
    };
  const questions = spec.questions(input, data, ctx);
  const values: Record<string, Value> = {};
  for (const q of questions) values[q.key] = valueOf(q, input);
  const open = questions.filter((q) => pending(q, input, ctx.advanced));
  const missing = open.filter((q) => !q.optional).map((q) => q.label);
  const planned =
    missing.length === 0
      ? spec.plan(values, input, data, ctx)
      : { steps: [], blockers: [] };
  const subjects = spec.subjects(values, data, input);
  // Review N-5: a card keeps at most this many records to re-check before sending.
  const tooMany =
    subjects.length > CHAT_ACTION_SUBJECTS_MAX
      ? [
          `This card can check at most ${CHAT_ACTION_SUBJECTS_MAX} records before sending, and it names ${subjects.length}. Choose fewer, or use the form.`,
        ]
      : [];
  return {
    questions,
    values,
    current: open[0] ?? null,
    missing,
    steps: planned.steps,
    blockers: [
      ...new Set([
        ...spec.blockers(values, data, ctx),
        ...planned.blockers,
        ...tooMany,
      ]),
    ],
    happen: spec.happen(values, data, ctx, questions),
    subjects: tooMany.length ? [] : subjects,
    title: spec.title(values, data),
  };
}

export const LABEL: Record<CardKind, string> = {
  fund_budget: 'Set up a budget',
  fetch_source: 'Fetch a page',
  cite_claim: 'Record a claim',
  start_discovery: 'Start a discovery',
  answer_decision: 'Answer a waiting decision',
  score_option: 'Score an option',
  record_choice: 'Record your choice',
  save_proposal: 'Save a proposal',
};

/** The form each card stands in for, so "Use the form instead" opens it. */
export const FORM_VIEW: Record<CardKind, string> = {
  fund_budget: 'budgets',
  fetch_source: 'evidence',
  cite_claim: 'evidence',
  start_discovery: 'submit',
  answer_decision: 'decisions',
  score_option: 'compare',
  record_choice: 'compare',
  save_proposal: 'proposals',
};

type Spec<D> = {
  questions(input: Input, d: D, ctx: CardCtx): Question[];
  plan(
    v: Record<string, Value>,
    input: Input,
    d: D,
    ctx: CardCtx,
  ): { steps: Step[]; blockers: string[] };
  blockers(v: Record<string, Value>, d: D, ctx: CardCtx): string[];
  happen(v: Record<string, Value>, d: D, ctx: CardCtx, qs: Question[]): Line[];
  subjects(v: Record<string, Value>, d: D, input?: Input): Subject[];
  title(v: Record<string, Value>, d: D): string;
};

/** A routine question's value and where it came from, for "What will happen". */
const routineLine = (q: Question | undefined, v: Value): string => {
  if (!q) return str(v);
  const shown =
    list(v)
      .map((x) => q.choices?.find((c) => c.value === x)?.label ?? x)
      .join(', ') || '—';
  const source =
    str(v) === str(q.fallback ?? '')
      ? (q.source ?? 'studio default')
      : 'changed here';
  return `${shown} · ${source}`;
};

/** A fresh id for a card's own idempotent requests, kept in its answers. */
export const opKey = (input: Input, name: string): string =>
  typeof input[`_${name}`] === 'string' ? String(input[`_${name}`]) : '';

// ---- fund_budget ------------------------------------------------------------------------

const CAP_RE = /^(\d{1,12})(?:\.(\d{1,6}))?$/;
export const capNano = (cap: string): string | null => {
  const m = CAP_RE.exec(cap.trim());
  return m
    ? (
        BigInt(m[1]!) * 1_000_000_000n +
        BigInt((m[2] ?? '').padEnd(9, '0'))
      ).toString()
    : null;
};

const fund: Spec<FundData> = {
  questions: (_i, _d, ctx) => [
    {
      key: 'name',
      label: 'Budget name',
      prompt: 'What should the budget be called?',
      type: 'text',
      routine: true,
      fallback: 'Studio budget',
    },
    {
      key: 'cap',
      label: 'Cap',
      prompt: ctx.fixture
        ? 'How many simulated units may it hold?'
        : 'How many dollars may it hold? A discovery on a connected plan costs nothing.',
      help: 'A number with up to six decimals.',
      type: 'text',
      routine: true,
      fallback: ctx.fixture ? '100' : '0',
    },
  ],
  blockers: (v) =>
    capNano(str(v.cap)) === null
      ? ['Enter the cap as a number with up to six decimals.']
      : [],
  plan: (v, _i, d, ctx) => {
    const nano = capNano(str(v.cap));
    if (nano === null) return { steps: [], blockers: [] };
    const steps: Step[] = [
      {
        label: 'Fund the budget (Budgets)',
        path: `workspaces/${ctx.ws}/budgets`,
        body: {
          parent_id: null,
          kind: 'global',
          run_id: null,
          name: str(v.name),
          cap_nano_usd: nano,
          starts_at: null,
          ends_at: null,
          max_in_flight: 4,
        },
        record: { kind: 'budget', label: str(v.name), from: 'id' },
      },
    ];
    if (ctx.fixture && !d.fixturePricing)
      steps.push({
        label: 'Add the bundled fixture pricing (Budgets)',
        path: `workspaces/${ctx.ws}/pricing`,
        body: d.pricingBody,
      });
    return { steps, blockers: [] };
  },
  happen: (v, d, ctx, qs) => [
    {
      label: 'Budget',
      value: `A new top-level budget “${str(v.name)}”`,
      source: routineLine(
        qs.find((q) => q.key === 'name'),
        v.name ?? '',
      ).split(' · ')[1],
    },
    {
      label: 'Cap',
      value: ctx.fixture
        ? `${str(v.cap)} simulated units (no money)`
        : `$${str(v.cap)}`,
      source: routineLine(
        qs.find((q) => q.key === 'cap'),
        v.cap ?? '',
      ).split(' · ')[1],
    },
    ...(ctx.fixture
      ? [
          {
            label: 'Pricing',
            value: d.fixturePricing
              ? 'Fixture pricing is already there'
              : 'Adds the bundled fixture pricing, so a discovery can reserve its calls',
          },
        ]
      : []),
  ],
  subjects: () => [],
  title: (v) => `Set up the budget “${str(v.name) || 'Studio budget'}”`,
};

/**
 * The answers a card sent again starts from: the person's own answers, without the page's
 * working keys. Re-review N-8: a fetch card that registered a new run does not register
 * another; the run question is answered again from the runs that can fetch now.
 */
export function againInput(
  kind: CardKind,
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([k, v]) =>
        !k.startsWith('_') &&
        !(kind === 'fetch_source' && k === 'run' && v === 'new'),
    ),
  );
}

// ---- fetch_source -----------------------------------------------------------------------

const fetchSource: Spec<FetchData> = {
  questions: (input, d) => [
    {
      key: 'url',
      label: 'Address',
      prompt: 'Which page should the studio fetch?',
      help: d.pages.length
        ? `Synthetic pages you can use here: ${d.pages.join(', ')}`
        : 'Only websites approved under Settings › Evidence websites can be fetched.',
      type: 'text',
      fallback:
        typeof input.hint_url === 'string'
          ? input.hint_url
          : (d.pages[0] ?? ''),
    },
    // Review M-1: a default never adds a grant. With a run that can already fetch, the
    // newest one is the routine choice; a new run and its fetch grant are always asked.
    {
      key: 'run',
      label: 'Run',
      prompt: d.runs.length
        ? 'Which run fetches it?'
        : 'Fetching needs a run with a 24-hour fetch grant. Register a new evidence-gathering run?',
      help: d.runs.length
        ? undefined
        : 'Like “Register a run for fetching” under Sources: the run may fetch public pages for 24 hours, nothing else. Pick it to go on, or put the card away to cancel.',
      type: 'choice',
      ...(d.runs.length
        ? {
            routine: true,
            source: 'newest run allowed to fetch',
            fallback: d.runs[0]!.id,
          }
        : {}),
      choices: [
        ...d.runs.map((r) => ({ value: r.id, label: r.label })),
        {
          value: 'new',
          label: 'A new evidence-gathering run',
          detail: 'Allowed to fetch public pages for 24 hours, nothing else',
        },
      ],
    },
  ],
  blockers: (v) =>
    /^https?:\/\/\S+$/i.test(str(v.url))
      ? []
      : ['Give a full web address starting with http:// or https://.'],
  plan: (v, input, _d, ctx) => {
    const base = `workspaces/${ctx.ws}`;
    const steps: Step[] = [];
    let run = str(v.run);
    if (run === 'new') {
      run = '{run}';
      steps.push(
        {
          label: 'Register a run record (Sources)',
          path: `${base}/entities`,
          body: {
            kind: 'run',
            title: 'Evidence gathering',
            body: {
              state: 'queued',
              experiment_condition: 'human_in_loop',
              discovery_method: 'structured',
              config_hash: null,
            },
          },
          capture: { run_record: 'id' },
        },
        {
          label: 'Put the run under oversight (Sources)',
          path: `${base}/runs`,
          body: {
            run: { id: '{run_record}', version: 1 },
            autonomy_mode: 'human_in_loop',
            stage_gates: null,
            initial_grants: [],
          },
          capture: { run: 'run_id' },
          record: { kind: 'run', label: 'Evidence gathering', from: 'run_id' },
        },
        {
          label: 'Allow it to fetch public pages for 24 hours (Sources)',
          path: `${base}/grants`,
          body: {
            run_id: '{run}',
            action_types: ['source.fetch'],
            target_kind: null,
            max_amount_nano_usd: null,
            allow_irreversible: false,
            allow_external_effects: false,
            data_classes: ['public'],
            expires_at: new Date(ctx.now + DAY).toISOString(),
            rationale: 'Fetch public pages from the Evidence view.',
          },
        },
      );
    }
    steps.push({
      label: 'Fetch the page through the source broker (Sources)',
      path: `${base}/runs/${run}/source-fetches`,
      body: {
        url: str(v.url),
        task_id: null,
        logical_operation_id: opKey(input, 'op'),
        justification: 'Requested from a Chat card.',
      },
      timeoutMs: 30_000,
      record: { kind: 'source', label: str(v.url), from: 'source_id' },
      answer: 'retrieval',
    });
    return {
      steps,
      blockers: opKey(input, 'op') ? [] : ['This card has no request id.'],
    };
  },
  happen: (v, d) => [
    { label: 'Fetch', value: str(v.url) },
    {
      label: 'Run',
      value:
        str(v.run) === 'new'
          ? 'A new evidence-gathering run, allowed to fetch public pages for 24 hours'
          : (d.runs.find((r) => r.id === str(v.run))?.label ?? str(v.run)),
    },
    {
      label: 'Then',
      value:
        'The server fetches it only from an approved website, under the run’s grant. Its passages become sources you can cite; a page is not a claim until you record one.',
    },
  ],
  subjects: () => [],
  title: (v) => `Fetch ${str(v.url) || 'a page'}`,
};

// ---- cite_claim -------------------------------------------------------------------------

/** The first real sentence of a passage (a heading line is skipped), as a starting quote. */
const firstSentence = (s: string) => {
  for (const m of s.trim().matchAll(/[^.!?\n]{8,400}[.!?]/g)) {
    const sentence = m[0].trim();
    if (sentence.split(/\s+/).length >= 6) return sentence;
  }
  return s.trim().slice(0, 400).trim();
};
/** Whitespace-normalized, as the server checks a quote against its passage. */
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Case- and whitespace-normalized, as the brief compares its two fields. */
const sameField = (s: string) => squash(s).toLowerCase();

const cite: Spec<CiteData> = {
  questions: (input, d) => {
    const passage = d.passages.find(
      (p) => p.id === str(input.passage as Value),
    );
    return [
      {
        key: 'passage',
        label: 'Passage',
        prompt: 'Which fetched passage is the evidence?',
        type: 'choice',
        choices: d.passages.map((p) => ({
          value: p.id,
          label: p.label,
          detail: clip(p.excerpt, 240),
        })),
      },
      {
        key: 'statement',
        label: 'Claim',
        prompt: 'What does it show? Write the claim in one or two sentences.',
        type: 'long',
        fallback: typeof input.hint_text === 'string' ? input.hint_text : '',
      },
      {
        key: 'basis',
        label: 'Basis',
        prompt:
          'Is the claim observed in the source, or your inference from it?',
        type: 'choice',
        choices: [
          { value: 'observation', label: 'Observed in the source' },
          { value: 'inference', label: 'Our inference from it' },
        ],
      },
      {
        key: 'uncertainty',
        label: 'Uncertainty',
        prompt: 'What is still uncertain about it?',
        type: 'long',
      },
      {
        key: 'stance',
        label: 'Stance',
        prompt: 'Does the passage support the claim or contradict it?',
        type: 'choice',
        choices: [
          { value: 'supports', label: 'Supports it' },
          { value: 'contradicts', label: 'Contradicts it' },
          {
            value: 'does_not_support',
            label: 'Does not support it (no quote needed)',
          },
        ],
      },
      {
        key: 'quote',
        label: 'Quote',
        prompt:
          'Quote the words of the passage it rests on (exactly as written).',
        help: passage ? `Passage: ${clip(passage.excerpt, 600)}` : undefined,
        type: 'long',
        optional: str(input.stance as Value) === 'does_not_support',
        fallback: passage ? firstSentence(passage.excerpt) : '',
      },
      {
        key: 'rationale',
        label: 'Why it bears on the claim',
        prompt: 'Why does this passage bear on the claim?',
        type: 'long',
      },
      {
        key: 'type',
        label: 'Kind of evidence',
        prompt: 'What kind of evidence is it?',
        type: 'choice',
        routine: true,
        fallback: 'source_assertion',
        choices: [
          { value: 'source_assertion', label: 'The source asserts it' },
          { value: 'quotation', label: 'An exact quotation' },
          { value: 'observation', label: 'Observed in the source' },
          { value: 'inference', label: 'Our inference' },
        ],
      },
    ];
  },
  blockers: (v, d) => {
    const out: string[] = [];
    if (d.passages.length === 0)
      out.push('No fetched passage yet. Fetch a page first (“Fetch a page”).');
    const p = d.passages.find((x) => x.id === str(v.passage));
    const q = squash(str(v.quote));
    if (p && q && !squash(p.excerpt).includes(q))
      out.push(
        'The quote must appear exactly in the passage. Copy it from the passage text.',
      );
    if (q && q.length < 8) out.push('Quote at least 8 characters.');
    if (str(v.stance) !== 'does_not_support' && !q)
      out.push('Supporting or contradicting evidence must quote the passage.');
    return out;
  },
  plan: (v, input, _d, ctx) => {
    const base = `workspaces/${ctx.ws}`;
    const statement = str(v.statement);
    return {
      steps: [
        {
          label: 'Save the claim (Sources)',
          path: `${base}/entities`,
          idempotencyKey: opKey(input, 'op'),
          body: {
            kind: 'claim',
            title: statement.slice(0, 120),
            body: {
              statement,
              basis: str(v.basis),
              uncertainty: str(v.uncertainty),
            },
          },
          capture: { claim: 'id', claim_version: 'version' },
          record: { kind: 'claim', label: clip(statement, 120), from: 'id' },
        },
        {
          label: 'Attach the passage as its evidence (Sources)',
          path: `${base}/claims/{claim}/support`,
          body: {
            evidence: 'passage',
            claim_version: '{claim_version}',
            passage_id: str(v.passage),
            stance: str(v.stance),
            support_type: str(v.type),
            quote: str(v.quote) ? str(v.quote) : null,
            rationale: str(v.rationale),
          },
        },
      ],
      blockers: opKey(input, 'op') ? [] : ['This card has no request id.'],
    };
  },
  happen: (v, d, _c, qs) => [
    { label: 'Claim', value: clip(str(v.statement), 200) },
    {
      label: 'Evidence',
      value: `${d.passages.find((p) => p.id === str(v.passage))?.label ?? '—'}, ${str(v.stance).replaceAll('_', ' ')}`,
    },
    {
      label: 'Kind of evidence',
      value: routineLine(
        qs.find((q) => q.key === 'type'),
        v.type ?? '',
      ),
    },
    {
      label: 'Then',
      value:
        'Discovery can work from the claim. It counts as supported only by the passages it actually quotes.',
    },
  ],
  subjects: () => [],
  title: (v) => `Record the claim “${clip(str(v.statement) || '…', 60)}”`,
};

// ---- start_discovery --------------------------------------------------------------------

/** The Discover form's limits (submit.tsx); a plan route waits as long as its timeout allows. */
export const DISCOVERY_LIMITS = {
  max_children: 5,
  max_concurrency: 2,
  max_depth: 1,
  max_attempts: 1,
  max_repairs: 1,
  max_calls: 24,
  max_output_tokens: 4000,
  call_timeout_ms: 10_000,
  max_wall_seconds: 900,
};
export function discoveryLimits(route: DiscoverRoute | null) {
  if (route?.kind !== 'subscription') return DISCOVERY_LIMITS;
  const calls = Math.min(DISCOVERY_LIMITS.max_calls, route.max_requests);
  return {
    ...DISCOVERY_LIMITS,
    max_concurrency: 1,
    max_attempts: 1,
    max_calls: calls,
    call_timeout_ms: route.timeout_ms,
    max_wall_seconds: Math.min(
      WORKFLOW_WALL_MAX_SECONDS,
      Math.max(
        DISCOVERY_LIMITS.max_wall_seconds,
        Math.ceil((calls * route.timeout_ms) / 1000) + 60,
      ),
    ),
  };
}
const ROLES: Choice[] = [
  { value: 'problem', label: 'the problem' },
  { value: 'affected_users', label: 'who is affected' },
  { value: 'urgency', label: 'urgency' },
  { value: 'workaround', label: 'the current workaround' },
  { value: 'existing_tool', label: 'an existing tool' },
  { value: 'tool_gap', label: 'a tool gap' },
  { value: 'data', label: 'available data' },
  { value: 'mechanism', label: 'a cross-field mechanism' },
];
const PERSPECTIVES = [
  'software',
  'existing_tool',
  'process_change',
  'human_led',
  'hybrid',
];
const lines = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Key order does not matter when comparing a brief with the pick's. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : x,
  );

/** ADR-0096 (P31): the Explore for me pick a discovery card was filled from, if any. */
export type ExploredBrief = {
  id: string;
  version: number;
  body: {
    theme: string;
    fields: [string, string];
    target_users: string;
    context: string | null;
    measurable_problem: string;
    outcome_measure: string;
    data_and_tools: string[];
    time_limit: string;
    budget_limit: string;
    nae_seed: string | null;
    constraints: string[];
  };
};
export function exploredPick(input: Input): ExploredBrief | null {
  const e = input._explored as ExploredBrief | undefined;
  return e &&
    typeof e === 'object' &&
    typeof e.id === 'string' &&
    typeof e.version === 'number' &&
    e.body &&
    typeof e.body.theme === 'string'
    ? e
    : null;
}

/**
 * The answers a discovery card takes from an Explore for me pick (the person's "Use this"):
 * the brief's fields, and the cited claims recorded here that support it, as bearing on the
 * problem. Claims cited against it are left for the person to add, as on Discover.
 */
export function answersFromPick(
  brief: ExploredBrief,
  claims: { claim_id: string; contrary: boolean }[],
  known: ReadonlySet<string>,
): Input {
  const b = brief.body;
  const supporting = [
    ...new Set(
      claims
        .filter((c) => !c.contrary && known.has(c.claim_id))
        .map((c) => c.claim_id),
    ),
  ];
  return {
    theme: b.theme,
    field_a: b.fields[0],
    field_b: b.fields[1],
    target_users: b.target_users,
    context: b.context ?? '',
    measurable_problem: b.measurable_problem,
    outcome_measure: b.outcome_measure,
    time_limit: b.time_limit,
    budget_limit: b.budget_limit,
    constraints: b.constraints.join('\n'),
    // Review L-5: a pick with no supporting claim here clears claims chosen for an earlier
    // theme, so the card asks for them again.
    claims: supporting,
    roles: supporting.length ? ['problem'] : [],
    _explored: brief,
  };
}

/** The search brief a discovery card saves, from its answers (and a pick's data and seed). */
function briefOf(
  v: Record<string, Value>,
  picked: ExploredBrief | null,
  dataAndTools: string[],
) {
  return {
    theme: str(v.theme),
    fields: [str(v.field_a), str(v.field_b)],
    target_users: str(v.target_users),
    context: str(v.context) || null,
    measurable_problem: str(v.measurable_problem),
    outcome_measure: str(v.outcome_measure),
    // ADR-0096: a brief from Explore for me keeps its own data and seed.
    data_and_tools: picked ? picked.body.data_and_tools : dataAndTools,
    time_limit: str(v.time_limit),
    budget_limit: str(v.budget_limit),
    nae_seed: picked ? picked.body.nae_seed : null,
    constraints: lines(str(v.constraints)),
  };
}
/** The Explore pick the card starts on unchanged, or null once any brief field was edited. */
function reusedPick(
  v: Record<string, Value>,
  input: Input,
): ExploredBrief | null {
  const picked = exploredPick(input);
  return picked && stable(picked.body) === stable(briefOf(v, picked, []))
    ? picked
    : null;
}

const discover: Spec<DiscoverData> = {
  questions: (input, d, ctx) => {
    const dflt = studioDefaults(ctx.fixture);
    return [
      {
        key: 'theme',
        label: 'Theme',
        prompt: 'What should the discovery look into? Name a setting or group.',
        type: 'text',
        fallback: typeof input.hint_text === 'string' ? input.hint_text : '',
      },
      {
        key: 'target_users',
        label: 'Who is affected',
        prompt: 'Who is affected?',
        type: 'text',
      },
      {
        key: 'measurable_problem',
        label: 'Measurable problem',
        prompt: 'What is the problem, in terms you could measure?',
        type: 'long',
      },
      {
        key: 'outcome_measure',
        label: 'What would be measured',
        prompt: 'What would you measure to tell whether it improved?',
        type: 'text',
      },
      {
        key: 'field_a',
        label: 'First field',
        prompt:
          'Which two fields should the search look across? Name the first.',
        help: 'Discovery looks where two fields meet for a mechanism that could transfer.',
        type: 'text',
      },
      {
        key: 'field_b',
        label: 'Second field',
        prompt: 'And the second field?',
        type: 'text',
      },
      {
        key: 'claims',
        label: 'Claims it rests on',
        prompt: 'Which recorded claims should it work from? Tick at least one.',
        type: 'multi',
        choices: d.claims.map((c) => ({
          value: c.id,
          label: c.title,
          detail: `version ${c.version}`,
        })),
      },
      {
        key: 'roles',
        label: 'What they bear on',
        prompt: 'What do the ticked claims bear on?',
        type: 'multi',
        choices: ROLES,
      },
      {
        key: 'context',
        label: 'Setting',
        prompt: 'Is there a geography or setting that matters?',
        type: 'text',
        optional: true,
      },
      {
        key: 'time_limit',
        label: 'Time limit',
        prompt: 'What time limit should a solution respect?',
        type: 'text',
        routine: true,
        fallback: dflt.timeLimit,
      },
      {
        key: 'budget_limit',
        label: 'Budget constraint',
        prompt: 'What budget constraint should a solution respect?',
        type: 'text',
        routine: true,
        fallback: dflt.budgetLimit,
      },
      {
        key: 'constraints',
        label: 'Constraints',
        prompt: 'Any constraints, one per line?',
        type: 'long',
        routine: true,
        fallback: dflt.constraints,
      },
      {
        key: 'revisions',
        label: 'Revision rounds',
        prompt: 'How many revision rounds may each proposal get?',
        type: 'choice',
        routine: true,
        fallback: String(dflt.revisions),
        choices: ['0', '1', '2'].map((n) => ({ value: n, label: n })),
      },
      {
        key: 'oversight',
        label: 'Oversight',
        prompt: 'How should the run ask you?',
        type: 'choice',
        routine: true,
        fallback: dflt.oversight,
        choices: [
          {
            value: 'human_in_loop',
            label: 'Human in the loop: it asks at stage gates',
          },
          {
            value: 'supervised',
            label: 'Supervised: it asks before each consequential step',
          },
        ],
      },
    ];
  },
  blockers: (v, d) => {
    const out = [...d.routeBlockers];
    if (d.claims.length === 0)
      out.push(
        'No claim is recorded yet. Record one first (“Record a claim”).',
      );
    if (
      str(v.field_a) &&
      sameField(str(v.field_a)) === sameField(str(v.field_b))
    )
      out.push('Name two different fields.');
    return out;
  },
  plan: (v, input, d, ctx) => {
    const base = `workspaces/${ctx.ws}`;
    const route = d.route;
    if (!route) return { steps: [], blockers: [] };
    const dflt = studioDefaults(ctx.fixture);
    const theme = str(v.theme);
    const picked = exploredPick(input);
    const brief = briefOf(v, picked, lines(dflt.dataAndTools));
    // An unedited Explore for me pick keeps its own brief (and its audited link to the
    // exploration), as on Discover; any edit saves a new brief.
    const reuse = reusedPick(v, input) !== null;
    const roles = list(v.roles);
    const limits = discoveryLimits(route);
    const steps: Step[] = [
      ...(reuse
        ? []
        : [
            {
              label: 'Save the search brief (Discover)',
              path: `${base}/entities`,
              body: { kind: 'search_brief', title: theme, body: brief },
              capture: { brief: 'id', brief_version: 'version' },
            },
          ]),
      {
        label: 'Register the run record (Discover)',
        path: `${base}/entities`,
        body: {
          kind: 'run',
          title: `Discovery: ${theme}`.slice(0, 300),
          body: {
            state: 'queued',
            experiment_condition: 'human_in_loop',
            discovery_method: 'structured',
            config_hash: null,
          },
        },
        capture: { run_record: 'id' },
      },
      {
        label: 'Put the run under oversight (Discover)',
        path: `${base}/runs`,
        body: {
          run: { id: '{run_record}', version: 1 },
          autonomy_mode: str(v.oversight),
          stage_gates: null,
          initial_grants: [],
          routine_policy: null,
        },
        capture: { run: 'run_id' },
        record: { kind: 'run', label: `Discovery: ${theme}`, from: 'run_id' },
      },
      {
        label: 'Allow model calls for 24 hours (Discover)',
        path: `${base}/grants`,
        body: {
          run_id: '{run}',
          action_types: ['model.generate', 'model.summarize'],
          target_kind: null,
          max_amount_nano_usd:
            route.kind === 'subscription' ? null : '2000000000',
          allow_irreversible: false,
          allow_external_effects: false,
          data_classes: [dflt.dataClass],
          expires_at: new Date(ctx.now + DAY).toISOString(),
          rationale:
            `Model calls for the discovery run on “${theme}”, granted from a Chat card.`.slice(
              0,
              300,
            ),
        },
      },
      {
        label: 'Start the discovery (Discover)',
        path: `${base}/runs/{run}/discoveries`,
        timeoutMs: 15_000,
        body: {
          brief:
            reuse && picked
              ? { id: picked.id, version: picked.version }
              : { id: '{brief}', version: '{brief_version}' },
          evidence: list(v.claims).map((claim_id) => ({
            claim_id,
            bears_on: roles,
          })),
          perspectives: PERSPECTIVES,
          excluded: [],
          max_revisions: Number(str(v.revisions)),
          max_age_days: 180,
          ...(route.kind === 'subscription'
            ? {
                resource_setup: {
                  kind: 'subscription',
                  connection_id: route.connection,
                  model_id: route.model,
                  settings_hash: route.settings_hash,
                  max_output_chars: route.max_output_chars,
                },
              }
            : {
                envelope_id: route.envelope,
                pricing_snapshot_id: route.pricing,
              }),
          data_class: dflt.dataClass,
          limits,
        },
        record: {
          kind: 'workflow',
          label: `Discovery: ${theme}`,
          from: 'workflow.id',
        },
      },
    ];
    return { steps, blockers: [] };
  },
  happen: (v, d, ctx, qs) => {
    const limits = discoveryLimits(d.route);
    const q = (k: string) => qs.find((x) => x.key === k);
    return [
      {
        label: 'Brief',
        value: `“${str(v.theme)}” for ${str(v.target_users) || '…'}, from ${plural(list(v.claims).length, 'claim')}`,
      },
      {
        label: 'Run',
        value:
          str(v.oversight) === 'supervised'
            ? 'A new supervised run: it asks before each consequential step'
            : 'A new run, human in the loop: it asks at stage gates',
        source: routineLine(q('oversight'), v.oversight ?? '').split(' · ')[1],
      },
      {
        label: 'Model access',
        value: d.route?.label ?? 'none ready',
      },
      {
        label: 'Model calls',
        value: `Allowed for 24 hours on ${studioDefaults(ctx.fixture).dataClass} data, revocable under Monitor › Approvals`,
      },
      {
        label: 'Limits',
        value:
          d.route?.kind === 'subscription'
            ? `At most ${limits.max_calls} plan requests, ${limits.max_wall_seconds} s in all; no API spending`
            : `At most ${limits.max_calls} calls, up to 2 ${ctx.fixture ? 'simulated units' : 'dollars'} each from the budget, ${limits.max_wall_seconds} s in all`,
      },
      {
        label: 'Routine settings',
        value: `${str(v.time_limit)} · ${str(v.budget_limit)} · ${str(v.revisions)} revision round${str(v.revisions) === '1' ? '' : 's'}`,
        source: [
          'time_limit',
          'budget_limit',
          'constraints',
          'revisions',
          'oversight',
        ].every((k) => str(v[k] ?? '') === str(q(k)?.fallback ?? ''))
          ? 'studio defaults'
          : 'changed here',
      },
      {
        label: 'Output',
        value:
          'Proposals for all 5 response types, each critiqued; you compare them under Decide',
      },
    ];
  },
  subjects: (v, d, input) => {
    const claims = list(v.claims)
      .map((id) => d.claims.find((c) => c.id === id))
      .filter((c): c is ClaimOption => !!c)
      .map((c) => ({
        kind: 'entity' as const,
        id: c.id,
        version: c.version,
        label: clip(c.title, 200),
      }));
    // A picked brief the card starts on that changed since is refused as stale before
    // anything is sent; once edited, the card no longer uses it (review L-5).
    const picked = input ? reusedPick(v, input) : null;
    return picked
      ? [
          ...claims,
          {
            kind: 'entity' as const,
            id: picked.id,
            version: picked.version,
            label: `Search brief “${clip(picked.body.theme, 150)}”`,
          },
        ]
      : claims;
  },
  title: (v) => `Start a discovery about “${clip(str(v.theme) || '…', 60)}”`,
};

// ---- answer_decision --------------------------------------------------------------------

const answer: Spec<DecisionData> = {
  questions: (input, d) => {
    const pick = d.decisions.find((x) => x.id === str(input.decision as Value));
    return [
      {
        key: 'decision',
        label: 'Decision',
        prompt: 'Which waiting decision do you want to answer?',
        type: 'choice',
        choices: d.decisions.map((x) => ({
          value: x.id,
          label: x.question,
          detail: `${x.reason} · ${x.covers}`,
          ...(x.current
            ? {}
            : { blocked: 'The target changed; a new request is needed.' }),
        })),
      },
      {
        key: 'choice',
        label: 'Answer',
        prompt: pick
          ? `${pick.question} What is your answer?`
          : 'What is your answer?',
        help: pick
          ? `Approving permits exactly this, once: ${pick.covers}${pick.recommendation ? ` · The studio recommends: ${pick.recommendation}` : ''}`
          : undefined,
        type: 'choice',
        choices: [
          { value: 'approve_once', label: 'Approve once' },
          { value: 'reject', label: 'Reject' },
          { value: 'defer', label: 'Defer' },
        ],
      },
      {
        key: 'rationale',
        label: 'Why',
        prompt: 'Why? A short reason is kept with your answer.',
        type: 'long',
      },
    ];
  },
  blockers: (v, d) => {
    if (d.decisions.length === 0) return ['Nothing is waiting for you.'];
    const pick = d.decisions.find((x) => x.id === str(v.decision));
    return pick && !pick.current
      ? [
          'The target changed after this request. It cannot be approved; a new request is needed.',
        ]
      : [];
  },
  plan: (v, _input, d, ctx) => {
    const pick = d.decisions.find((x) => x.id === str(v.decision));
    if (!pick) return { steps: [], blockers: [] };
    return {
      steps: [
        {
          label: 'Answer the decision (Approvals)',
          path: `workspaces/${ctx.ws}/decisions/${pick.id}/answer`,
          body: {
            choice: str(v.choice),
            option_id: null,
            rationale: str(v.rationale),
            coverage_hash: pick.coverage_hash,
            standing_expires_at: null,
            // Review L-2: measured by the page when Send is pressed, from when this card
            // was shown on it, to the millisecond, as the Approvals form measures it.
            time_spent_ms: '{time_spent_ms}',
            interruption: null,
          },
        },
      ],
      blockers: [],
    };
  },
  happen: (v, d) => {
    const pick = d.decisions.find((x) => x.id === str(v.decision));
    return [
      { label: 'Decision', value: pick?.question ?? '—' },
      {
        label: 'Answer',
        value:
          str(v.choice) === 'approve_once'
            ? `Approve once: ${pick?.covers ?? ''}`
            : str(v.choice) === 'reject'
              ? 'Reject: the step does not happen'
              : 'Defer: it keeps waiting',
      },
    ];
  },
  subjects: (v, d) => {
    const pick = d.decisions.find((x) => x.id === str(v.decision));
    return pick
      ? [
          {
            kind: 'decision' as const,
            id: pick.id,
            version: pick.version,
            label: clip(pick.question, 200),
          },
        ]
      : [];
  },
  title: (v, d) =>
    `Answer “${clip(d.decisions.find((x) => x.id === str(v.decision))?.question ?? 'a waiting decision', 60)}”`,
};

// ---- score_option -----------------------------------------------------------------------

const RATING_CHOICES: Choice[] = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: 'unknown', label: 'Unknown: the evidence does not tell' },
];
const GATE_CHOICES: Choice[] = [
  { value: 'clear', label: 'Clear: no concern found' },
  { value: 'resolved', label: 'Resolved: a concern was found and dealt with' },
  { value: 'unresolved', label: 'Unresolved: blocks building' },
];
const ROUTINE_CHECKS = (
  Object.keys(CHECK_LABELS) as (keyof ScorecardDraft['checks'])[]
).filter((k) => !OPEN_CHECKS.includes(k));

function scoreDraft(
  v: Record<string, Value>,
  d: ScoreData,
  o: ScoreOptionData,
): ScorecardDraft {
  const draft = emptyDraft(
    d.criteria.map((c) => c.key),
    { target_users: o.target_users, measurable_outcome: o.outcome },
  );
  for (const c of d.criteria)
    draft.ratings[c.key] = {
      rating: str(v[`r_${c.key}`]) as RatingChoice,
      evidence:
        str(v[`r_${c.key}`]) === 'unknown'
          ? []
          : list(v[`e_${c.key}`])
              .map((id) => o.claims.find((x) => x.id === id))
              .filter((x): x is ClaimOption => !!x)
              .map((x) => refKey(x)),
      rationale: str(v[`w_${c.key}`]),
    };
  draft.confidence = {
    level: str(v.confidence) as ScorecardDraft['confidence']['level'],
    rationale: str(v.confidence_why),
  };
  draft.influence = {
    rating: str(v.influence) as RatingChoice,
    note: str(v.influence_note),
  };
  draft.ethics = {
    status: str(v.ethics) as GateChoice,
    note: str(v.ethics_note),
  };
  draft.access = {
    status: str(v.access) as GateChoice,
    note: str(v.access_note),
  };
  for (const k of Object.keys(
    CHECK_LABELS,
  ) as (keyof ScorecardDraft['checks'])[])
    draft.checks[k] = str(v[`c_${k}`]);
  return draft;
}

const score: Spec<ScoreData> = {
  questions: (input, d) => {
    const o = d.options.find((x) => x.id === str(input.option as Value));
    const qs: Question[] = [
      {
        key: 'option',
        label: 'Option',
        prompt: 'Which option do you want to score?',
        type: 'choice',
        choices: d.options.map((x) => ({
          value: x.id,
          label: x.title,
          detail: x.problem,
          ...(x.skip ? { blocked: x.skip } : {}),
        })),
      },
    ];
    if (!o) return qs;
    const evidence = o.claims.map((c) => ({
      value: c.id,
      label: c.title,
      detail: `version ${c.version}`,
    }));
    for (const c of d.criteria) {
      qs.push({
        key: `r_${c.key}`,
        label: c.label,
        prompt: `${c.label}: how does “${clip(o.title, 80)}” rate, 1 to 5?`,
        help: `1: ${c.anchors[1]} · 3: ${c.anchors[3]} · 5: ${c.anchors[5]}`,
        type: 'choice',
        choices: RATING_CHOICES,
      });
      if (str(input[`r_${c.key}`] as Value) !== 'unknown')
        qs.push({
          key: `e_${c.key}`,
          label: `${c.label}: evidence`,
          prompt: `Which claims back that ${c.label.toLowerCase()} rating?`,
          type: 'multi',
          choices: evidence,
        });
      qs.push({
        key: `w_${c.key}`,
        label: `${c.label}: reason`,
        prompt: `Why that ${c.label.toLowerCase()} rating?`,
        type: 'long',
      });
    }
    qs.push(
      {
        key: 'influence',
        label: 'Software influence',
        prompt:
          'How much did it being software (or not) sway your ratings? 1 is not at all, 5 a lot.',
        type: 'choice',
        choices: RATING_CHOICES,
      },
      {
        key: 'influence_note',
        label: 'Software influence: note',
        prompt: 'A note on that?',
        type: 'long',
      },
      {
        key: 'ethics',
        label: 'Ethics gate',
        prompt: 'Is there an ethical concern?',
        type: 'choice',
        choices: GATE_CHOICES,
      },
      {
        key: 'ethics_note',
        label: 'Ethics: note',
        prompt: 'What did you look at for ethics?',
        type: 'long',
      },
      {
        key: 'access',
        label: 'Access gate',
        prompt: 'Is there an access or permission concern?',
        type: 'choice',
        choices: GATE_CHOICES,
      },
      {
        key: 'access_note',
        label: 'Access: note',
        prompt: 'What did you look at for access?',
        type: 'long',
      },
      ...OPEN_CHECKS.map((k) => ({
        key: `c_${k}`,
        label: CHECK_LABELS[k],
        prompt: `${CHECK_LABELS[k]}? Write “unknown” if you cannot tell.`,
        type: 'text' as const,
      })),
      ...ROUTINE_CHECKS.map((k) => {
        const fallback =
          k === 'target_users'
            ? o.target_users || CHECK_DEFAULT
            : k === 'measurable_outcome'
              ? o.outcome || CHECK_DEFAULT
              : CHECK_DEFAULT;
        return {
          key: `c_${k}`,
          label: CHECK_LABELS[k],
          prompt: `${CHECK_LABELS[k]}?`,
          type: 'text' as const,
          routine: true,
          fallback,
          source:
            fallback === CHECK_DEFAULT
              ? 'unknown until answered'
              : 'from the record',
        };
      }),
      {
        key: 'confidence',
        label: 'Confidence',
        prompt: 'How confident are you in these scores?',
        type: 'choice',
        choices: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
      },
      {
        key: 'confidence_why',
        label: 'Confidence: why',
        prompt: 'Why that confidence?',
        type: 'long',
      },
    );
    return qs;
  },
  blockers: (v, d) => {
    if (d.options.every((o) => o.skip))
      return [
        d.options.length
          ? 'Every option here is already scored by you or has an automatic assessment to edit; change those under Decide.'
          : 'No option to score yet. Start a discovery first.',
      ];
    const o = d.options.find((x) => x.id === str(v.option));
    if (!o) return [];
    if (o.skip) return [o.skip];
    const out = draftToBody(scoreDraft(v, d, o), {
      rubric: 'suitability',
      rubricVersion: d.rubricVersion,
      criteria: d.criteria.map((c) => c.key),
      subject: { id: o.id, version: o.version },
      reviewer: 'x',
    });
    return out.errors
      ? Object.entries(out.errors)
          .filter(([k]) => k.endsWith('.evidence') || k.startsWith('checks.'))
          .map(([, m]) => m)
      : [];
  },
  plan: (v, _i, d, ctx) => {
    const o = d.options.find((x) => x.id === str(v.option));
    if (!o) return { steps: [], blockers: [] };
    const out = draftToBody(scoreDraft(v, d, o), {
      rubric: 'suitability',
      rubricVersion: d.rubricVersion,
      criteria: d.criteria.map((c) => c.key),
      subject: { id: o.id, version: o.version },
      reviewer: ctx.reviewer,
    });
    if (!out.body)
      return { steps: [], blockers: Object.values(out.errors).slice(0, 3) };
    return {
      steps: [
        {
          label: 'Save the scorecard (Decide)',
          path: `workspaces/${ctx.ws}/scorecards`,
          body: {
            title: clip(`Solution suitability: ${o.title}`, 300),
            body: out.body,
          },
          record: { kind: 'scorecard', label: o.title, from: 'id' },
        },
      ],
      blockers: [],
    };
  },
  happen: (v, d, ctx, qs) => {
    const o = d.options.find((x) => x.id === str(v.option));
    const answered = ROUTINE_CHECKS.filter(
      (k) =>
        str(v[`c_${k}`]) && str(v[`c_${k}`]).toLowerCase() !== CHECK_DEFAULT,
    ).length;
    return [
      {
        label: 'Scorecard',
        value: `Saves your solution suitability scorecard of “${o?.title ?? '…'}” v${o?.version ?? '?'}, as ${ctx.reviewer}`,
      },
      {
        label: 'Ranking',
        value:
          'It counts in the ranking under Decide; an unresolved gate still holds the option back',
      },
      {
        label: 'Checks',
        value: `Other checks: ${answered} of ${ROUTINE_CHECKS.length} answered, the rest “unknown”`,
        source: qs.some((q) => q.routine) ? undefined : 'answered here',
      },
    ];
  },
  subjects: (v, d) => {
    const o = d.options.find((x) => x.id === str(v.option));
    return o
      ? [
          {
            kind: 'entity' as const,
            id: o.id,
            version: o.version,
            label: clip(o.title, 200),
          },
        ]
      : [];
  },
  title: (v, d) =>
    `Score “${clip(d.options.find((x) => x.id === str(v.option))?.title ?? 'an option', 60)}”`,
};

// ---- record_choice ----------------------------------------------------------------------

const DISPOSITIONS: Choice[] = [
  { value: 'select_for_build', label: 'Select for a bounded build' },
  { value: 'proceed_to_validation', label: 'Validate before building' },
  { value: 'recommend_alternative', label: 'Recommend (no new software)' },
  { value: 'research_further', label: 'Research further' },
  { value: 'defer', label: 'Defer' },
  { value: 'reject', label: 'Reject' },
];

const choose: Spec<ChoiceData> = {
  questions: (input, d) => {
    const p = d.problems.find((x) => x.id === str(input.problem as Value));
    const qs: Question[] = [
      {
        key: 'problem',
        label: 'Problem',
        prompt: 'Which problem do you want to decide on?',
        type: 'choice',
        choices: d.problems.map((x) => ({
          value: x.id,
          label: x.title,
          detail: plural(x.alternatives.length, 'option'),
          ...(x.skip ? { blocked: x.skip } : {}),
        })),
      },
    ];
    if (!p || p.skip) return qs;
    for (const a of p.alternatives) {
      qs.push(
        {
          key: `d_${a.id}`,
          label: `${clip(a.title, 50)}: decision`,
          prompt: `What should happen with “${clip(a.title, 90)}”${a.rank === null ? ' (not ranked)' : ` (ranked ${a.rank})`}?`,
          type: 'choice',
          choices: DISPOSITIONS.map((c) =>
            a.blocked[c.value]?.length
              ? { ...c, blocked: a.blocked[c.value]![0]! }
              : c,
          ),
        },
        {
          key: `why_${a.id}`,
          label: `${clip(a.title, 50)}: reasons`,
          prompt: `Why that for “${clip(a.title, 90)}”?`,
          type: 'long',
        },
        {
          key: `rev_${a.id}`,
          label: `${clip(a.title, 50)}: would reverse if`,
          prompt: 'What would make you reverse it?',
          type: 'long',
        },
      );
    }
    const dispositions = Object.fromEntries(
      p.alternatives.map((a) => [a.id, str(input[`d_${a.id}`] as Value)]),
    );
    if (overridesFor(p.report, dispositions).length)
      qs.push({
        key: 'override',
        label: 'Why against the ranking',
        prompt:
          'You chose an option over higher-ranked ones. Why go against the ranking?',
        type: 'long',
      });
    qs.push(
      {
        key: 'rationale',
        label: 'Overall reason',
        prompt: 'In a sentence or two, why this decision overall?',
        type: 'long',
      },
      {
        key: 'run',
        label: 'Run',
        prompt: 'Which run records it?',
        type: 'choice',
        routine: true,
        fallback: p.defaultRun,
        source: 'the run that found these options',
        choices: p.runs.map((r) => ({ value: r.id, label: r.label })),
      },
    );
    return qs;
  },
  blockers: (v, d) => {
    if (d.problems.length === 0)
      return ['No problem to decide on yet. Start a discovery first.'];
    if (d.problems.every((p) => p.skip)) return [d.problems[0]!.skip!];
    const p = d.problems.find((x) => x.id === str(v.problem));
    if (!p) return [];
    if (p.skip) return [p.skip];
    const out: string[] = [];
    if (!p.runs.length)
      out.push(
        'No active run can record it. Start a run under Discover first.',
      );
    for (const a of p.alternatives) {
      const dd = str(v[`d_${a.id}`]);
      const why = a.blocked[dd];
      if (dd && why?.length)
        out.push(
          `“${a.title}” cannot be ${dd.replaceAll('_', ' ')}: ${why[0]}`,
        );
    }
    return out;
  },
  plan: (v, _i, d, ctx) => {
    const p = d.problems.find((x) => x.id === str(v.problem));
    if (!p) return { steps: [], blockers: [] };
    const dispositions = Object.fromEntries(
      p.alternatives.map((a) => [a.id, str(v[`d_${a.id}`])]),
    );
    const needsOverride = overridesFor(p.report, dispositions).length > 0;
    return {
      steps: [
        {
          label: 'Record the selection (Decide)',
          path: `workspaces/${ctx.ws}/runs/${str(v.run)}/selections`,
          body: {
            problem: { id: p.id, version: p.version },
            report_hash: p.report_hash,
            dispositions: p.alternatives.map((a) => ({
              alternative: { id: a.id, version: a.version },
              disposition: str(v[`d_${a.id}`]),
              reasons: [str(v[`why_${a.id}`])],
              reverse_if: str(v[`rev_${a.id}`]),
            })),
            override_reason: needsOverride ? str(v.override) || null : null,
            rationale: str(v.rationale),
            shortlist_size: 3,
            data_class: ctx.fixture ? 'synthetic' : 'public',
          },
          record: { kind: 'selection', label: p.title, from: 'selection.id' },
          answer: 'admission',
        },
      ],
      blockers: [],
    };
  },
  happen: (v, d) => {
    const p = d.problems.find((x) => x.id === str(v.problem));
    if (!p) return [];
    return [
      { label: 'Problem', value: `${p.title} v${p.version}` },
      ...p.alternatives.map((a) => ({
        label: clip(a.title, 60),
        value:
          DISPOSITIONS.find((c) => c.value === str(v[`d_${a.id}`]))?.label ??
          '—',
      })),
      {
        label: 'Then',
        value:
          'The run may ask you to approve the selection under its oversight setting; a card for that appears here. A non-code choice is ready for a proposal; software goes to a spec and a build.',
      },
    ];
  },
  subjects: (v, d) => {
    const p = d.problems.find((x) => x.id === str(v.problem));
    return p
      ? [
          {
            kind: 'entity' as const,
            id: p.id,
            version: p.version,
            label: clip(p.title, 200),
          },
          ...p.alternatives.map((a) => ({
            kind: 'entity' as const,
            id: a.id,
            version: a.version,
            label: clip(a.title, 200),
          })),
        ]
      : [];
  },
  title: (v, d) =>
    `Record your choice on “${clip(d.problems.find((x) => x.id === str(v.problem))?.title ?? 'a problem', 60)}”`,
};

// ---- save_proposal ----------------------------------------------------------------------

const propose: Spec<ProposalData> = {
  questions: (input, d) => {
    const qs: Question[] = [
      {
        key: 'option',
        label: 'Option',
        prompt: 'Which chosen option do you want to write up as a proposal?',
        type: 'choice',
        choices: d.eligible.map((e) => ({
          value: e.option.id,
          label: e.option.title,
          detail: e.problem,
        })),
      },
    ];
    if (!d.draft || !str(input.option as Value)) return qs;
    qs.push({
      key: 'summary',
      label: 'Summary',
      prompt: 'Is this summary right? Change it if not.',
      type: 'long',
      fallback: d.draft.body.summary,
    });
    for (const s of d.sections) {
      const cur = d.draft.body.sections[s.key];
      if (!s.core || !cur || cur.state !== 'unknown') continue;
      qs.push({
        key: `s_${s.key}`,
        label: s.label,
        prompt: `${s.label}: what should it say? Skip to leave it marked unknown for now.`,
        help: cur.text || undefined,
        type: 'long',
        optional: true,
      });
    }
    return qs;
  },
  blockers: (_v, d) =>
    d.eligible.length === 0
      ? [
          'No chosen option is waiting for a proposal. Record a choice that recommends or validates a non-code option first.',
        ]
      : [],
  plan: (v, input, d, ctx) => {
    if (!d.draft) return { steps: [], blockers: ['Reading the draft…'] };
    const sections = { ...d.draft.body.sections };
    for (const s of d.sections) {
      const text = str(v[`s_${s.key}`]);
      if (text && sections[s.key])
        sections[s.key] = { ...sections[s.key]!, state: 'written', text };
    }
    return {
      steps: [
        {
          label: 'Save the proposal (Proposals)',
          path: `workspaces/${ctx.ws}/proposals`,
          idempotencyKey: opKey(input, 'op'),
          body: {
            title: d.draft.title,
            body: { ...d.draft.body, summary: str(v.summary), sections },
          },
          record: {
            kind: 'proposal',
            label: d.draft.title,
            from: 'proposal.id',
          },
        },
      ],
      blockers: opKey(input, 'op') ? [] : ['This card has no request id.'],
    };
  },
  happen: (v, d) => {
    if (!d.draft) return [];
    const unknown = d.sections.filter(
      (s) =>
        d.draft!.body.sections[s.key]?.state === 'unknown' &&
        !str(v[`s_${s.key}`]),
    );
    return [
      { label: 'Proposal', value: `Saves “${d.draft.title}” as version 1` },
      {
        label: 'Sections',
        value: unknown.length
          ? `${plural(unknown.length, 'section')} still marked unknown (${unknown.map((s) => s.label).join(', ')}); finish them under Proposals`
          : 'Every section has text or was already filled from records',
      },
      {
        label: 'Then',
        value:
          'Its checks say what is still missing before it is ready for review. They check the document, not whether the plan works.',
      },
    ];
  },
  subjects: (v, d) => {
    const e = d.eligible.find((x) => x.option.id === str(v.option));
    return e
      ? [
          {
            kind: 'entity' as const,
            id: e.option.id,
            version: e.option.version,
            label: clip(e.option.title, 200),
          },
        ]
      : [];
  },
  title: (v, d) =>
    `Save a proposal for “${clip(d.eligible.find((x) => x.option.id === str(v.option))?.option.title ?? 'a chosen option', 60)}”`,
};

const SPECS: Record<CardKind, Spec<never>> = {
  fund_budget: fund as Spec<never>,
  fetch_source: fetchSource as Spec<never>,
  cite_claim: cite as Spec<never>,
  start_discovery: discover as Spec<never>,
  answer_decision: answer as Spec<never>,
  score_option: score as Spec<never>,
  record_choice: choose as Spec<never>,
  save_proposal: propose as Spec<never>,
};

// ---- Sending ----------------------------------------------------------------------------

const PLACEHOLDER = /^\{([a-z_]+)\}$/;
/**
 * Fills a whole-string `{name}` in a request body with the raw value from an earlier response.
 * Review N-1: braces inside text the person typed (a quote, a reason) are left as written.
 */
export function fill(v: unknown, got: Record<string, unknown>): unknown {
  if (typeof v === 'string') {
    const whole = PLACEHOLDER.exec(v);
    return whole && Object.hasOwn(got, whole[1]!) ? got[whole[1]!] : v;
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, got));
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, fill(x, got)]),
    );
  return v;
}

/** Fills `{name}` segments of a route path (ids from earlier responses). */
export const fillPath = (path: string, got: Record<string, unknown>) =>
  path
    .split('/')
    .map((seg) => {
      const whole = PLACEHOLDER.exec(seg);
      return whole && Object.hasOwn(got, whole[1]!)
        ? encodeURIComponent(String(got[whole[1]!]))
        : seg;
    })
    .join('/');

/** A dotted field of a response. */
export function pick(v: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (o, k) =>
        o && typeof o === 'object'
          ? (o as Record<string, unknown>)[k]
          : undefined,
      v,
    );
}

/**
 * The card for the main path's next step (the Path tab's own rules pick the tab; this picks
 * the card that stands in for its form there), or null when that step has no card yet.
 */
export function cardForStep(
  view: string | null,
  f: { sources: number; scorecards: number },
): CardKind | null {
  switch (view) {
    case 'decisions':
      return 'answer_decision';
    case 'evidence':
      return f.sources === 0 ? 'fetch_source' : 'cite_claim';
    case 'budgets':
      return 'fund_budget';
    case 'submit':
      return 'start_discovery';
    case 'compare':
      return f.scorecards === 0 ? 'score_option' : 'record_choice';
    default:
      return null;
  }
}
