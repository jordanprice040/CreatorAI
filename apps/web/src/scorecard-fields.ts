// Fields of the Decide page "Score this option" form (audit item 4, piece 1). No imports, so
// the tests can load it without a browser and check its output against ScorecardBodySchema.
// The server is the authority: it validates the body again, checks the option is at the
// scored version and that every evidence reference is a claim or source version here.
//
// Scores are the owner's judgment: nothing here picks a rating, a gate status or a
// confidence level. Only text the discovery record already states is filled in.

export type RubricKey = 'opportunity' | 'suitability';
export type RatingChoice = '' | '1' | '2' | '3' | '4' | '5' | 'unknown';
export type GateChoice = '' | 'clear' | 'resolved' | 'unresolved';

export type CriterionDraft = {
  rating: RatingChoice;
  /** Claim versions as "id@version". */
  evidence: string[];
  rationale: string;
};
export type ScorecardDraft = {
  ratings: Record<string, CriterionDraft>;
  confidence: { level: '' | 'low' | 'medium' | 'high'; rationale: string };
  /** Suitability only. */
  influence: { rating: RatingChoice; note: string };
  ethics: { status: GateChoice; note: string };
  access: { status: GateChoice; note: string };
  checks: {
    target_users: string;
    current_workaround: string;
    contrary_evidence: string;
    measurable_outcome: string;
    validation_plan: string;
    maintenance: string;
  };
  alternatives_checked: { name: string; checked_on: string }[];
};

type Ref = { id: string; version: number };
type CriterionBody = {
  rating: number | null;
  evidence_refs: Ref[];
  rationale: string;
};
export type ScorecardBodyShape = {
  format: 'scorecard/1';
  rubric: RubricKey;
  rubric_version: string;
  subject: Ref;
  reviewer: { kind: 'human' | 'model' | 'fixture'; label: string };
  ratings: Record<string, CriterionBody>;
  confidence: { level: 'low' | 'medium' | 'high'; rationale: string };
  software_influence: { rating: number | null; note: string } | null;
  gates: {
    ethics: { status: 'clear' | 'resolved' | 'unresolved'; note: string };
    access: { status: 'clear' | 'resolved' | 'unresolved'; note: string };
  };
  checks: ScorecardDraft['checks'] & {
    alternatives_checked: { name: string; checked_on: string }[];
  };
};

/** Option kinds with a software part: only these are rated on the opportunity rubric. */
export const SOFTWARE_KINDS = ['build', 'hybrid'];
export const rubricsFor = (kind: string): RubricKey[] =>
  SOFTWARE_KINDS.includes(kind)
    ? ['suitability', 'opportunity']
    : ['suitability'];

const SHORT = 300;
const NOTE = 1200;
export const CHECK_LABELS: Record<keyof ScorecardDraft['checks'], string> = {
  target_users: 'Who it is for',
  current_workaround: 'What they do today',
  contrary_evidence: 'Evidence against it',
  measurable_outcome: 'Outcome you would measure',
  validation_plan: 'How you would check it works',
  maintenance: 'Who keeps it running, and how',
};

export const refKey = (r: Ref) => `${r.id.toLowerCase()}@${r.version}`;
const parseRef = (k: string): Ref => {
  const at = k.lastIndexOf('@');
  return { id: k.slice(0, at), version: Number(k.slice(at + 1)) };
};

export function emptyDraft(
  criteria: readonly string[],
  prefill: { target_users?: string; measurable_outcome?: string } = {},
): ScorecardDraft {
  return {
    ratings: Object.fromEntries(
      criteria.map((k) => [k, { rating: '', evidence: [], rationale: '' }]),
    ),
    confidence: { level: '', rationale: '' },
    influence: { rating: '', note: '' },
    ethics: { status: '', note: '' },
    access: { status: '', note: '' },
    checks: {
      target_users: (prefill.target_users ?? '').slice(0, SHORT),
      current_workaround: '',
      contrary_evidence: '',
      measurable_outcome: (prefill.measurable_outcome ?? '').slice(0, SHORT),
      validation_plan: '',
      maintenance: '',
    },
    alternatives_checked: [],
  };
}

const choice = (r: number | null): RatingChoice =>
  r === null ? 'unknown' : (String(r) as RatingChoice);

/** A stored scorecard, as the form edits it when revising. */
export function draftFromBody(
  body: ScorecardBodyShape,
  criteria: readonly string[],
): ScorecardDraft {
  const d = emptyDraft(criteria);
  for (const k of criteria) {
    const r = body.ratings[k];
    if (r)
      d.ratings[k] = {
        rating: choice(r.rating),
        evidence: r.evidence_refs.map(refKey),
        rationale: r.rationale,
      };
  }
  d.confidence = { ...body.confidence };
  if (body.software_influence)
    d.influence = {
      rating: choice(body.software_influence.rating),
      note: body.software_influence.note,
    };
  d.ethics = { ...body.gates.ethics };
  d.access = { ...body.gates.access };
  const { alternatives_checked, ...checks } = body.checks;
  d.checks = { ...checks };
  d.alternatives_checked = alternatives_checked.map((a) => ({ ...a }));
  return d;
}

/**
 * The scorecard body, or the fields to fix (keyed like `ratings.urgency.rationale`).
 * `evidence` lists the claim versions the form offers; anything else in a draft (an old
 * pick from a revised card) is dropped only if the owner unticks it, never silently.
 */
export function draftToBody(
  draft: ScorecardDraft,
  o: {
    rubric: RubricKey;
    rubricVersion: string;
    criteria: readonly string[];
    subject: Ref;
    reviewer: string;
  },
):
  | { body: ScorecardBodyShape; errors: null }
  | { body: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (key: string, v: string, max: number, what: string) => {
    const t = v.trim();
    if (!t) errors[key] = `Write ${what}.`;
    else if (t.length > max)
      errors[key] = `Keep it under ${max} characters (now ${t.length}).`;
    return t;
  };
  const rating = (key: string, r: RatingChoice) => {
    if (!r) errors[key] = 'Pick a rating, or Unknown if you cannot tell.';
    return r === 'unknown' || !r ? null : Number(r);
  };
  const gate = (key: string, s: GateChoice) => {
    if (!s) errors[key] = 'Pick a status.';
    return (s || 'unresolved') as 'clear' | 'resolved' | 'unresolved';
  };
  const ratings: Record<string, CriterionBody> = {};
  for (const k of o.criteria) {
    const c = draft.ratings[k] ?? { rating: '', evidence: [], rationale: '' };
    const value = rating(`ratings.${k}.rating`, c.rating);
    if (value !== null && c.evidence.length === 0)
      errors[`ratings.${k}.evidence`] =
        'A rating needs evidence: tick at least one claim, or choose Unknown.';
    if (c.evidence.length > 20)
      errors[`ratings.${k}.evidence`] = 'Tick at most 20 claims.';
    ratings[k] = {
      rating: value,
      evidence_refs: c.evidence.map(parseRef),
      rationale: text(`ratings.${k}.rationale`, c.rationale, NOTE, 'a reason'),
    };
  }
  const level = draft.confidence.level;
  if (!level) errors['confidence.level'] = 'Pick how confident you are.';
  const confidence = {
    level: (level || 'low') as 'low' | 'medium' | 'high',
    rationale: text(
      'confidence.rationale',
      draft.confidence.rationale,
      NOTE,
      'why',
    ),
  };
  const software_influence =
    o.rubric === 'suitability'
      ? {
          rating: rating('influence.rating', draft.influence.rating),
          note: text('influence.note', draft.influence.note, NOTE, 'a note'),
        }
      : null;
  const gates = {
    ethics: {
      status: gate('ethics.status', draft.ethics.status),
      note: text('ethics.note', draft.ethics.note, NOTE, 'a note'),
    },
    access: {
      status: gate('access.status', draft.access.status),
      note: text('access.note', draft.access.note, NOTE, 'a note'),
    },
  };
  const checks = Object.fromEntries(
    (Object.keys(CHECK_LABELS) as (keyof ScorecardDraft['checks'])[]).map(
      (k) => [
        k,
        text(`checks.${k}`, draft.checks[k], SHORT, 'an answer (or "unknown")'),
      ],
    ),
  ) as ScorecardDraft['checks'];
  if (draft.alternatives_checked.length > 20)
    errors['checks.alternatives_checked'] = 'List at most 20.';
  const alternatives_checked = draft.alternatives_checked.map((a, i) => {
    const name = text(
      `checks.alternatives_checked.${i}.name`,
      a.name,
      SHORT,
      'its name',
    );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.checked_on))
      errors[`checks.alternatives_checked.${i}.checked_on`] =
        'Pick the date you checked it.';
    return { name, checked_on: a.checked_on };
  });
  if (Object.keys(errors).length) return { body: null, errors };
  return {
    errors: null,
    body: {
      format: 'scorecard/1',
      rubric: o.rubric,
      rubric_version: o.rubricVersion,
      subject: { id: o.subject.id, version: o.subject.version },
      reviewer: { kind: 'human', label: o.reviewer.trim().slice(0, SHORT) },
      ratings,
      confidence,
      software_influence,
      gates,
      checks: { ...checks, alternatives_checked },
    },
  };
}
