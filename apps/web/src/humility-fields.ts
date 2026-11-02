// Fields of the "Humility review" form (audit item 4, piece 3), used on Decide for an option
// and on Build for a spec version. No imports, so the tests can load it without a browser and
// check its output against HumilityBodySchema. The server validates the body again, and the
// humility gate (packages/domain/src/oversight.ts) decides whether it admits a build.
//
// The disposition, every viability call and the ethics status are the owner's: nothing here
// picks them. Starting from an earlier review copies only what the owner wrote there.

export const OPTION_KEYS = [
  'software',
  'existing_tool',
  'process_change',
  'human_led',
  'hybrid',
  'defer_decline',
] as const;
export type OptionKey = (typeof OPTION_KEYS)[number];
export const OPTION_LABELS: Record<OptionKey, string> = {
  software: 'Custom software',
  existing_tool: 'An existing tool',
  process_change: 'A process change',
  human_led: 'Human-led work',
  hybrid: 'Hybrid (people plus a small tool)',
  defer_decline: 'Defer or decline',
};
export const DISPOSITIONS = [
  'build',
  'use_existing',
  'change_process',
  'human_led',
  'hybrid',
  'investigate',
  'defer',
  'decline',
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export type EthicalStatus =
  'none_identified' | 'resolved' | 'unresolved_serious';

type Ref = { id: string; version: number };
export type HumilityDraft = {
  outcome_that_matters: string;
  whose_perspective: string;
  /** One item per line. */
  supported: string;
  inferred: string;
  disputed: string;
  unknown: string;
  comparisons: Record<
    OptionKey,
    { assessment: string; viable: '' | 'yes' | 'no'; evidence: string[] }
  >;
  software_part: string;
  human_part: string;
  burden_risks: string;
  disconfirming_test: string;
  change_course_trigger: string;
  ethical: { status: '' | EthicalStatus; note: string };
  disposition: '' | Disposition;
  rationale: string;
  /** One dissent per line. */
  dissent: string;
};
export type HumilityBodyShape = {
  subject: Ref;
  outcome_that_matters: string;
  whose_perspective: string;
  evidence: {
    supported: string[];
    inferred: string[];
    disputed: string[];
    unknown: string[];
  };
  comparisons: Record<
    OptionKey,
    { assessment: string; viable: boolean; evidence_refs: Ref[] }
  >;
  software_part: string;
  human_part: string;
  burden_risks: string[];
  disconfirming_test: string;
  change_course_trigger: string;
  ethical: { status: EthicalStatus; note: string };
  disposition: Disposition;
  rationale: string;
  dissent: string[];
};

const SHORT = 500;
const NOTE = 1200;
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
export const refKey = (r: Ref) => `${r.id.toLowerCase()}@${r.version}`;
const parseRef = (k: string): Ref => {
  const at = k.lastIndexOf('@');
  return { id: k.slice(0, at), version: Number(k.slice(at + 1)) };
};

export function emptyHumilityDraft(
  prefill: { whose_perspective?: string; outcome_that_matters?: string } = {},
): HumilityDraft {
  return {
    outcome_that_matters: (prefill.outcome_that_matters ?? '').slice(0, NOTE),
    whose_perspective: (prefill.whose_perspective ?? '').slice(0, NOTE),
    supported: '',
    inferred: '',
    disputed: '',
    unknown: '',
    comparisons: Object.fromEntries(
      OPTION_KEYS.map((k) => [
        k,
        { assessment: '', viable: '' as const, evidence: [] as string[] },
      ]),
    ) as HumilityDraft['comparisons'],
    software_part: '',
    human_part: '',
    burden_risks: '',
    disconfirming_test: '',
    change_course_trigger: '',
    ethical: { status: '', note: '' },
    disposition: '',
    rationale: '',
    dissent: '',
  };
}

/** An earlier review, as the form edits it: everything the owner wrote, subject aside. */
export function draftFromBody(b: HumilityBodyShape): HumilityDraft {
  return {
    outcome_that_matters: b.outcome_that_matters,
    whose_perspective: b.whose_perspective,
    supported: b.evidence.supported.join('\n'),
    inferred: b.evidence.inferred.join('\n'),
    disputed: b.evidence.disputed.join('\n'),
    unknown: b.evidence.unknown.join('\n'),
    comparisons: Object.fromEntries(
      OPTION_KEYS.map((k) => [
        k,
        {
          assessment: b.comparisons[k].assessment,
          viable: b.comparisons[k].viable ? 'yes' : 'no',
          evidence: b.comparisons[k].evidence_refs.map(refKey),
        },
      ]),
    ) as HumilityDraft['comparisons'],
    software_part: b.software_part,
    human_part: b.human_part,
    burden_risks: b.burden_risks.join('\n'),
    disconfirming_test: b.disconfirming_test,
    change_course_trigger: b.change_course_trigger,
    ethical: { ...b.ethical },
    disposition: b.disposition,
    rationale: b.rationale,
    dissent: b.dissent.join('\n'),
  };
}

/** The review body for this subject version, or the fields to fix. */
export function draftToBody(
  d: HumilityDraft,
  subject: Ref,
):
  | { body: HumilityBodyShape; errors: null }
  | { body: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (key: string, v: string, what: string) => {
    const t = v.trim();
    if (!t) errors[key] = `Write ${what}.`;
    else if (t.length > NOTE)
      errors[key] = `Keep it under ${NOTE} characters (now ${t.length}).`;
    return t;
  };
  const list = (key: string, v: string, max: number, each: number) => {
    const l = lines(v);
    if (l.length > max) errors[key] = `List at most ${max}, one per line.`;
    else if (l.some((x) => x.length > each))
      errors[key] = `Keep each line under ${each} characters.`;
    return l;
  };
  const evidence = {
    supported: list('supported', d.supported, 20, SHORT),
    inferred: list('inferred', d.inferred, 20, SHORT),
    disputed: list('disputed', d.disputed, 20, SHORT),
    unknown: list('unknown', d.unknown, 20, SHORT),
  };
  const comparisons = Object.fromEntries(
    OPTION_KEYS.map((k) => {
      const c = d.comparisons[k];
      if (!c.viable)
        errors[`comparisons.${k}.viable`] = 'Say whether it is viable.';
      if (c.evidence.length > 20)
        errors[`comparisons.${k}.evidence`] = 'Tick at most 20 claims.';
      return [
        k,
        {
          assessment: text(
            `comparisons.${k}.assessment`,
            c.assessment,
            'an assessment',
          ),
          viable: c.viable === 'yes',
          evidence_refs: c.evidence.map(parseRef),
        },
      ];
    }),
  ) as HumilityBodyShape['comparisons'];
  if (!d.ethical.status) errors['ethical.status'] = 'Pick a status.';
  if (!d.disposition) errors.disposition = 'Pick what you recommend.';
  const body: HumilityBodyShape = {
    subject: { id: subject.id, version: subject.version },
    outcome_that_matters: text(
      'outcome_that_matters',
      d.outcome_that_matters,
      'the outcome',
    ),
    whose_perspective: text(
      'whose_perspective',
      d.whose_perspective,
      'whose view this takes',
    ),
    evidence,
    comparisons,
    software_part: text(
      'software_part',
      d.software_part,
      'what software would do',
    ),
    human_part: text('human_part', d.human_part, 'what people would still do'),
    burden_risks: list('burden_risks', d.burden_risks, 20, SHORT),
    disconfirming_test: text(
      'disconfirming_test',
      d.disconfirming_test,
      'a test that could prove it wrong',
    ),
    change_course_trigger: text(
      'change_course_trigger',
      d.change_course_trigger,
      'what would change course',
    ),
    ethical: {
      status: (d.ethical.status || 'none_identified') as EthicalStatus,
      note: text('ethical.note', d.ethical.note, 'a note'),
    },
    disposition: (d.disposition || 'investigate') as Disposition,
    rationale: text(
      'rationale',
      d.rationale,
      'the reason for your recommendation',
    ),
    dissent: list('dissent', d.dissent, 10, NOTE),
  };
  if (Object.keys(errors).length) return { body: null, errors };
  return { body, errors: null };
}

/**
 * What the humility gate will say about this body for a build, in words. Mirrors
 * humilityGate in packages/domain/src/oversight.ts; the server's verdict is the authority.
 */
export function gatePreview(b: HumilityBodyShape): string[] {
  const out: string[] = [];
  if (b.disposition !== 'build')
    out.push(
      `It recommends ${b.disposition.replaceAll('_', ' ')}, so it does not admit a build.`,
    );
  if (!b.comparisons.software.viable)
    out.push(
      'It finds custom software not viable, so it does not admit a build.',
    );
  const cited =
    b.evidence.supported.length +
    OPTION_KEYS.reduce((n, k) => n + b.comparisons[k].evidence_refs.length, 0);
  if (cited === 0)
    out.push(
      'It records no supporting evidence: list a supported point or tick a claim.',
    );
  if (b.ethical.status === 'unresolved_serious')
    out.push(
      'A serious unresolved ethical problem means a person must judge before any build.',
    );
  return out;
}
