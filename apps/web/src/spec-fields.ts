// Fields of the Build page "Write a spec" form (audit item 4, piece 2). No imports, so the
// tests can load it without a browser and check its output against SpecContentSchema. The
// server is the authority: it checks the selection still chose this option version for build,
// validates the content again and reports task-graph problems (validateSpec) on the result.
//
// The form writes nothing the owner did not: only the problem's affected group and statement
// and the option's title are filled in to start from.

export type Method =
  '' | 'automated_test' | 'browser_check' | 'manual_review' | 'metric';
export type Role = '' | 'builder' | 'reviewer' | 'qa' | 'designer' | 'owner';
export type DataClass = '' | 'synthetic' | 'public' | 'private_approved';

export type CaseDraft = {
  /** One argument per line, exactly as typed (an empty middle line is an empty argument). */
  args: string;
  /**
   * The stored arguments when revising: kept exactly while `args` is not edited, so a list the
   * one-per-line box can't show (an argument with a line break, or a final empty argument) is
   * never rewritten by a revision that doesn't touch it (review of PR #112, M-2).
   */
  stored?: string[];
  stdin: string;
  /** Expected output without its final newline; `newline` adds it back. */
  stdout: string;
  newline: boolean;
  exit_code: string;
  held_out: boolean;
};
export type SpecDraft = {
  title: string;
  audience: string;
  problem_statement: string;
  flows: { key: string; name: string; steps: string }[];
  scope: string;
  non_goals: string;
  data_contracts: {
    name: string;
    description: string;
    data_class: DataClass;
  }[];
  checks: {
    key: string;
    flow: string;
    statement: string;
    measure: string;
    method: Method;
    cases: CaseDraft[];
  }[];
  risks: { risk: string; mitigation: string }[];
  maintenance: { owner: string; obligations: string; review_interval: string };
  tasks: {
    key: string;
    title: string;
    role: Role;
    file_scope: string;
    depends_on: string[];
    acceptance: string[];
    deliverable: string;
  }[];
};

type Case = {
  args: string[];
  stdin: string;
  stdout: string;
  exit_code: number;
  held_out: boolean;
};
export type SpecContentShape = {
  audience: string;
  problem_statement: string;
  user_flows: { key: string; name: string; steps: string[] }[];
  scope: string[];
  non_goals: string[];
  data_contracts: {
    name: string;
    description: string;
    data_class: 'synthetic' | 'public' | 'private_approved';
  }[];
  acceptance_checks: {
    key: string;
    flow: string | null;
    statement: string;
    measure: string;
    method: 'automated_test' | 'browser_check' | 'manual_review' | 'metric';
    cases?: Case[];
  }[];
  risks: { risk: string; mitigation: string }[];
  maintenance: {
    owner: string;
    obligations: string[];
    review_interval: string;
  };
  tasks: {
    key: string;
    title: string;
    role: 'builder' | 'reviewer' | 'qa' | 'designer' | 'owner';
    file_scope: string[];
    depends_on: string[];
    acceptance: string[];
    deliverable: string;
  }[];
};

const SHORT = 300;
const NOTE = 1200;
const lines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * The next key with this prefix (F, A or T), after the highest one in use or stored in the
 * version being revised: keys stay fixed once given and a removed key is never reused, so a
 * revision's task changes read as "removed T2, added T3" (review of PR #112, L-1).
 */
export function nextKey(
  prefix: 'F' | 'A' | 'T',
  used: readonly string[],
  stored: readonly string[] = [],
): string | null {
  let max = 0;
  for (const k of [...used, ...stored]) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(k);
    if (m) max = Math.max(max, Number(m[1]));
  }
  // Keys stop at 99 (the schema's limit); null means no new key is left (re-review N-B).
  return max >= 99 ? null : `${prefix}${max + 1}`;
}

/** True when the one-per-line box shows these arguments exactly. */
export const argsShowable = (args: readonly string[]) =>
  !args.some((a) => a.includes('\n')) && args.at(-1) !== '';

/** Every key a stored spec version gave out, for nextKey in a revision. */
export function storedKeys(s: SpecContentShape) {
  return [
    ...s.user_flows.map((f) => f.key),
    ...s.acceptance_checks.map((a) => a.key),
    ...s.tasks.map((t) => t.key),
  ];
}

type Ref = { id: string; version: number };
/**
 * Options a current selection chose for build that have no active spec written from that
 * selection. A spec belongs to the selection it was written from: once the owner records the
 * selection again, the old spec can no longer be frozen, so the option is offered again
 * (review of PR #112, M-1).
 */
export function unwrittenOptions<
  T extends { selection_id: string; alternative: Ref },
>(
  selections: readonly T[],
  specs: readonly { status: string; body: Record<string, unknown> | null }[],
): T[] {
  return selections.filter(
    (u) =>
      !specs.some((e) => {
        const a = e.body?.alternative as Ref | undefined;
        const sel = e.body?.selection_id as string | undefined;
        return (
          e.status === 'active' &&
          sel?.toLowerCase() === u.selection_id.toLowerCase() &&
          a?.id.toLowerCase() === u.alternative.id.toLowerCase() &&
          a.version === u.alternative.version
        );
      }),
  );
}

export const emptyCase = (): CaseDraft => ({
  args: '',
  stdin: '',
  stdout: '',
  newline: true,
  exit_code: '0',
  held_out: false,
});

export function emptySpecDraft(
  prefill: {
    title?: string;
    audience?: string;
    problem_statement?: string;
  } = {},
): SpecDraft {
  return {
    title: (prefill.title ?? '').slice(0, SHORT),
    audience: (prefill.audience ?? '').slice(0, SHORT),
    problem_statement: (prefill.problem_statement ?? '').slice(0, NOTE),
    flows: [{ key: 'F1', name: '', steps: '' }],
    scope: '',
    non_goals: '',
    data_contracts: [],
    checks: [
      {
        key: 'A1',
        flow: '',
        statement: '',
        measure: '',
        method: '',
        cases: [],
      },
    ],
    risks: [],
    maintenance: { owner: '', obligations: '', review_interval: '' },
    tasks: [
      {
        key: 'T1',
        title: '',
        role: '',
        file_scope: '',
        depends_on: [],
        acceptance: [],
        deliverable: '',
      },
    ],
  };
}

/** A stored spec version, as the form edits it when revising. */
export function draftFromContent(
  title: string,
  s: SpecContentShape,
): SpecDraft {
  return {
    title,
    audience: s.audience,
    problem_statement: s.problem_statement,
    flows: s.user_flows.map((f) => ({
      key: f.key,
      name: f.name,
      steps: f.steps.join('\n'),
    })),
    scope: s.scope.join('\n'),
    non_goals: s.non_goals.join('\n'),
    data_contracts: s.data_contracts.map((d) => ({ ...d })),
    checks: s.acceptance_checks.map((a) => ({
      key: a.key,
      flow: a.flow ?? '',
      statement: a.statement,
      measure: a.measure,
      method: a.method,
      cases: (a.cases ?? []).map((c) => ({
        args: c.args.join('\n'),
        stored: [...c.args],
        stdin: c.stdin,
        stdout: c.stdout.endsWith('\n') ? c.stdout.slice(0, -1) : c.stdout,
        newline: c.stdout.endsWith('\n'),
        exit_code: String(c.exit_code),
        held_out: c.held_out,
      })),
    })),
    risks: s.risks.map((r) => ({ ...r })),
    maintenance: {
      owner: s.maintenance.owner,
      obligations: s.maintenance.obligations.join('\n'),
      review_interval: s.maintenance.review_interval,
    },
    tasks: s.tasks.map((t) => ({
      key: t.key,
      title: t.title,
      role: t.role,
      file_scope: t.file_scope.join('\n'),
      depends_on: [...t.depends_on],
      acceptance: [...t.acceptance],
      deliverable: t.deliverable,
    })),
  };
}

const SCOPE_PATH = /^[a-z0-9_-][a-z0-9_./-]*$/;
const scopeOk = (p: string) =>
  p.length <= 240 &&
  SCOPE_PATH.test(p) &&
  !p.includes('..') &&
  !p.endsWith('/') &&
  !p.split('/').some((s) => !s || s.startsWith('.'));

/** The spec content and title, or the fields to fix (keyed like `checks.0.statement`). */
export function draftToContent(
  d: SpecDraft,
):
  | { title: string; content: SpecContentShape; errors: null }
  | { title: null; content: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const text = (key: string, v: string, max: number, what: string) => {
    const t = v.trim();
    if (!t) errors[key] = `Write ${what}.`;
    else if (t.length > max)
      errors[key] = `Keep it under ${max} characters (now ${t.length}).`;
    return t;
  };
  const list = (
    key: string,
    v: string,
    min: number,
    max: number,
    what: string,
  ) => {
    const l = lines(v);
    if (l.length < min)
      errors[key] = `List at least ${min} ${what}, one per line.`;
    else if (l.length > max) errors[key] = `List at most ${max} ${what}.`;
    else if (l.some((x) => x.length > SHORT))
      errors[key] = `Keep each line under ${SHORT} characters.`;
    return l;
  };
  const count = (
    key: string,
    n: number,
    min: number,
    max: number,
    what: string,
  ) => {
    if (n < min) errors[key] = `Add at least ${min} ${what}.`;
    if (n > max) errors[key] = `At most ${max} ${what}.`;
  };

  const title = text('title', d.title, SHORT, 'a title');
  const audience = text('audience', d.audience, SHORT, 'who it is for');
  const problem_statement = text(
    'problem_statement',
    d.problem_statement,
    NOTE,
    'the problem',
  );
  count('flows', d.flows.length, 1, 10, 'user flow(s)');
  const flowKeys = d.flows.map((f) => f.key);
  const user_flows = d.flows.map((f, i) => ({
    key: f.key,
    name: text(`flows.${i}.name`, f.name, SHORT, 'a name'),
    steps: list(`flows.${i}.steps`, f.steps, 1, 12, 'steps'),
  }));
  const scope = list('scope', d.scope, 1, 20, 'things in scope');
  const non_goals = list('non_goals', d.non_goals, 1, 20, 'non-goals');
  count('data_contracts', d.data_contracts.length, 0, 20, 'data contracts');
  const data_contracts = d.data_contracts.map((c, i) => {
    if (!c.data_class)
      errors[`data_contracts.${i}.data_class`] = 'Pick a data class.';
    return {
      name: text(`data_contracts.${i}.name`, c.name, SHORT, 'a name'),
      description: text(
        `data_contracts.${i}.description`,
        c.description,
        SHORT,
        'a description',
      ),
      data_class: (c.data_class || 'synthetic') as
        'synthetic' | 'public' | 'private_approved',
    };
  });
  count('checks', d.checks.length, 1, 30, 'acceptance check(s)');
  const checkKeys = d.checks.map((c) => c.key);
  const acceptance_checks = d.checks.map((c, i) => {
    if (!c.method) errors[`checks.${i}.method`] = 'Pick how it is checked.';
    if (c.flow && !flowKeys.includes(c.flow))
      errors[`checks.${i}.flow`] = 'That flow was removed; pick another.';
    const check: SpecContentShape['acceptance_checks'][number] = {
      key: c.key,
      flow: c.flow || null,
      statement: text(
        `checks.${i}.statement`,
        c.statement,
        SHORT,
        'what must hold',
      ),
      measure: text(
        `checks.${i}.measure`,
        c.measure,
        SHORT,
        'what is measured',
      ),
      method: (c.method ||
        'manual_review') as SpecContentShape['acceptance_checks'][number]['method'],
    };
    // Cases are optional in a spec (the builder needs them; buildNotes says so). Any method
    // may carry them, so a revision keeps what the stored version had.
    if (c.cases.length) {
      count(`checks.${i}.cases`, c.cases.length, 0, 10, 'test case(s)');
      check.cases = c.cases.map((x, j) => {
        const k = `checks.${i}.cases.${j}`;
        // One argument per line; an empty line in the middle is an empty argument.
        const args =
          x.stored && x.args === x.stored.join('\n')
            ? [...x.stored]
            : x.args === ''
              ? []
              : x.args.replace(/\n$/, '').split('\n');
        if (args.length > 12) errors[`${k}.args`] = 'At most 12 arguments.';
        if (args.some((a) => a.length > 500))
          errors[`${k}.args`] = 'Keep each argument under 500 characters.';
        if (x.stdin.length > 4000)
          errors[`${k}.stdin`] = 'Keep input under 4,000 characters.';
        const stdout = x.stdout + (x.newline ? '\n' : '');
        if (stdout.length > 12000)
          errors[`${k}.stdout`] = 'Keep output under 12,000 characters.';
        const code = Number(x.exit_code);
        if (!/^\d+$/.test(x.exit_code.trim()) || code > 125)
          errors[`${k}.exit_code`] =
            'Exit code is a whole number from 0 to 125.';
        return {
          args,
          stdin: x.stdin,
          stdout,
          exit_code: code,
          held_out: x.held_out,
        };
      });
    }
    return check;
  });
  count('risks', d.risks.length, 0, 20, 'risks');
  const risks = d.risks.map((r, i) => ({
    risk: text(`risks.${i}.risk`, r.risk, SHORT, 'the risk'),
    mitigation: text(
      `risks.${i}.mitigation`,
      r.mitigation,
      SHORT,
      'the mitigation',
    ),
  }));
  const maintenance = {
    owner: text(
      'maintenance.owner',
      d.maintenance.owner,
      SHORT,
      'who maintains it',
    ),
    obligations: list(
      'maintenance.obligations',
      d.maintenance.obligations,
      1,
      10,
      'obligations',
    ),
    review_interval: text(
      'maintenance.review_interval',
      d.maintenance.review_interval,
      SHORT,
      'how often it is reviewed',
    ),
  };
  count('tasks', d.tasks.length, 1, 40, 'task(s)');
  const taskKeys = d.tasks.map((t) => t.key);
  const tasks = d.tasks.map((t, i) => {
    if (!t.role) errors[`tasks.${i}.role`] = 'Pick a role.';
    const file_scope = lines(t.file_scope);
    if (file_scope.length > 20)
      errors[`tasks.${i}.file_scope`] = 'At most 20 paths.';
    const bad = file_scope.find((p) => !scopeOk(p));
    if (bad)
      errors[`tasks.${i}.file_scope`] =
        `"${bad.slice(0, 40)}" is not a plain lowercase relative path (like src or src/main.py).`;
    if (t.acceptance.length === 0)
      errors[`tasks.${i}.acceptance`] = 'Tick the checks this task delivers.';
    if (t.depends_on.length > 20)
      errors[`tasks.${i}.depends_on`] =
        'A task can wait for at most 20 others.';
    return {
      key: t.key,
      title: text(`tasks.${i}.title`, t.title, SHORT, 'a title'),
      role: (t.role || 'builder') as SpecContentShape['tasks'][number]['role'],
      file_scope,
      // Never send a reference to a removed task or check.
      depends_on: t.depends_on.filter(
        (k) => taskKeys.includes(k) && k !== t.key,
      ),
      acceptance: t.acceptance.filter((k) => checkKeys.includes(k)),
      deliverable: text(
        `tasks.${i}.deliverable`,
        t.deliverable,
        SHORT,
        'the deliverable',
      ),
    };
  });
  for (const a of acceptance_checks)
    if (!tasks.some((t) => t.acceptance.includes(a.key)))
      errors[`checks.${checkKeys.indexOf(a.key)}.covered`] =
        `No task delivers ${a.key}: tick it on a task.`;
  if (Object.keys(errors).length) return { title: null, content: null, errors };
  return {
    errors: null,
    title,
    content: {
      audience,
      problem_statement,
      user_flows,
      scope,
      non_goals,
      data_contracts,
      acceptance_checks,
      risks,
      maintenance,
      tasks,
    },
  };
}

/**
 * Why the studio's reviewed Python builder could not build a task of this spec, in words
 * (packages/executor/src/build.ts). Advice only: a spec can be valid and still need another
 * recipe; the build itself checks again.
 */
export function buildNotes(s: SpecContentShape): string[] {
  const notes: string[] = [];
  const builders = s.tasks.filter((t) => t.role === 'builder');
  if (!builders.length)
    notes.push(
      'No builder task: the studio builds only tasks with the builder role.',
    );
  for (const t of builders) {
    if (t.depends_on.length)
      notes.push(
        `${t.key} depends on other tasks; the builder takes only independent tasks.`,
      );
    const checks = s.acceptance_checks.filter((a) =>
      t.acceptance.includes(a.key),
    );
    if (checks.some((a) => a.method !== 'automated_test' || !a.cases?.length))
      notes.push(
        `${t.key} delivers a check that is not an automated test with cases; the builder needs every check it delivers to be one.`,
      );
    if (!checks.some((a) => a.cases?.some((c) => c.held_out)))
      notes.push(
        `${t.key} has no held-out case; a build needs at least one case that neither builder nor reviewer sees.`,
      );
  }
  return notes;
}

/**
 * The reason a spec revision from preview feedback starts with. The studio appends
 * " (feedback <id>)" and keeps 300 characters, so the feedback's own words are cut at 240.
 */
export function feedbackReason(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  const words = t.length > 222 ? `${t.slice(0, 221).trimEnd()}…` : t;
  return `Preview feedback: ${words}`;
}

/**
 * Why accepted preview feedback cannot open the spec form now, in words, or null when it
 * can. The feedback names the spec version it was given on; the studio refuses a revision
 * once that spec has moved on, so the form is not offered for it (audit L-8).
 */
export function feedbackRevisionBlocker(
  f: { status: string; spec: { version: number } },
  spec: { status: string; version: number; format: unknown },
  owner: boolean,
): string | null {
  if (f.status !== 'accepted') return 'Accept the feedback first.';
  if (!owner) return 'Only the workspace owner can revise the spec.';
  if (spec.status !== 'active')
    return `The spec is ${spec.status}, so it cannot be revised.`;
  if (spec.version !== f.spec.version)
    return `The spec is now v${spec.version}; this feedback was given on v${f.spec.version}, so it can no longer revise it. Revise the current version on Build.`;
  if (spec.format !== 'spec/1')
    return 'This spec is not in the format the form edits (spec/1).';
  return null;
}

/**
 * The longest reason a feedback revision takes: the studio appends " (feedback <uuid>)"
 * (48 characters) and keeps 300, so a longer reason would cut the feedback id off (PR #121
 * review N-1).
 */
export const FEEDBACK_REASON_MAX = 252;

/**
 * A package's accepted feedback can start one spec revision: the first one moves the spec on
 * and the others are given on a superseded version. Says so for an accepted item once another
 * item of the same package has revised the spec, so it is known without a click (PR #121
 * review L-1).
 */
export function feedbackSuperseded(
  f: { id: string; status: string; spec: { version: number } },
  all: readonly {
    id: string;
    revision: { version: number } | null;
  }[],
): string | null {
  if (f.status !== 'accepted') return null;
  const later = all
    .filter((x) => x.id !== f.id && x.revision)
    .map((x) => x.revision!.version)
    .filter((v) => v > f.spec.version);
  if (!later.length) return null;
  return `Other feedback revised the spec to v${Math.max(...later)}, so this item, given on v${f.spec.version}, can no longer start a revision. Make the change in the current version on Build.`;
}

/** Shown when the spec or the feedback moved on while the revision form was open (L-2). */
export const FEEDBACK_REVISION_STALE =
  'The spec changed after this form opened (another revision was saved), so this feedback can no longer revise it. Your edits here were not saved. Make the change in the current version on Build.';
