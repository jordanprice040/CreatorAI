import { z } from './primitives.js';

/**
 * ADR-0078 (P15 slice 1): frozen browser checks for the static-web/1 recipe. A browser check
 * opens one page of the generated site in the reviewed headless browser and runs these steps in
 * order; every expectation waits up to a few seconds for the page to settle. The steps are data
 * read by the reviewed checker, never code: no step runs a script the spec author wrote.
 */
/** Balanced quotes, brackets and parentheses, and no dangling combinator: the CSS mistakes a
 * typed selector usually has. The browser still has the final word at QA time. */
function selectorShapeOk(s: string): boolean {
  const close: Record<string, string> = { '[': ']', '(': ')' };
  const open: string[] = [];
  let quote = '';
  let escapedEnd = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\') {
      // Review N-c: escapes pair left to right, so two backslashes then a comma end in a real comma.
      escapedEnd = i + 1 === s.length - 1;
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '(') open.push(close[c]!);
    else if (c === ']' || c === ')') {
      if (open.pop() !== c) return false;
    }
  }
  // An escaped trailing character (`.a\\,`) is part of a name, not a combinator.
  return (
    !quote &&
    !open.length &&
    !/^[>+~,]/.test(s) &&
    (escapedEnd || !/[>+~,]$/.test(s))
  );
}
const selector = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\n\r]/.test(s), 'A selector is one line')
  // Typed steps split at the first " = ", so a selector cannot contain one.
  .refine(
    (s) => !s.includes(' = '),
    'A selector cannot contain “ = ”; write [name="x"] without spaces around =',
  )
  .refine(
    selectorShapeOk,
    'The selector has unbalanced quotes, brackets or parentheses, or ends in a combinator',
  );
const value = z
  .string()
  .max(500)
  .refine((s) => !/[\n\r]/.test(s), 'A value is one line');
export const BROWSER_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
] as const;
export const BrowserStepSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('click'), selector }),
  z.strictObject({ action: z.literal('check'), selector }),
  z.strictObject({ action: z.literal('fill'), selector, value }),
  z.strictObject({ action: z.literal('select'), selector, value }),
  z.strictObject({
    action: z.literal('press'),
    selector,
    key: z.enum(BROWSER_KEYS),
  }),
  /** Changes the page's hash route, for example #/about. */
  z.strictObject({
    action: z.literal('goto'),
    path: z.string().regex(/^#[A-Za-z0-9/_.~-]{0,100}$/),
  }),
  z.strictObject({ action: z.literal('expect_text'), selector, text: value }),
  z.strictObject({
    action: z.literal('expect_contains'),
    selector,
    text: value.pipe(z.string().min(1)),
  }),
  z.strictObject({ action: z.literal('expect_visible'), selector }),
  z.strictObject({ action: z.literal('expect_hidden'), selector }),
  z.strictObject({
    action: z.literal('expect_count'),
    selector,
    count: z.number().int().min(0).max(500),
  }),
  z.strictObject({ action: z.literal('expect_title'), text: value }),
]);
export type BrowserStep = z.infer<typeof BrowserStepSchema>;
/** The page a case opens: a path under site/, optionally with a hash route. */
export const BrowserPageSchema = z
  .string()
  .regex(
    /^\/([a-z0-9][a-z0-9_-]*\/)*([a-z0-9][a-z0-9_-]*\.html)?(#[A-Za-z0-9/_.~-]{0,100})?$/,
    'A page is a path such as / or /about.html, optionally with a #route',
  );
export const BrowserCaseSchema = z.strictObject({
  page: BrowserPageSchema,
  steps: z
    .array(BrowserStepSchema)
    .min(1)
    .max(25)
    .refine(
      (steps) => steps.some((s) => s.action.startsWith('expect_')),
      'A browser case needs at least one expect step',
    ),
  held_out: z.boolean(),
});
export type BrowserCase = z.infer<typeof BrowserCaseSchema>;

/** The two reviewed build recipes. A task's frozen acceptance checks choose one (ADR-0078). */
export const BuildRecipeSchema = z.enum(['python-build/1', 'static-web/1']);
export type BuildRecipe = z.infer<typeof BuildRecipeSchema>;

/**
 * The one-step-per-line form people type in the spec form, for example
 *   fill #name = Ada
 *   click #greet
 *   expect text #greeting = Hello, Ada!
 * Each line is `<command> <selector> [= <value>]`; see BROWSER_STEP_HELP.
 */
export const BROWSER_STEP_HELP = [
  'click <selector>',
  'check <selector>',
  'fill <selector> = <text>',
  'select <selector> = <option value>',
  'press <selector> = Enter|Tab|Escape|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Backspace',
  'goto #/route',
  'expect text <selector> = <exact text>',
  'expect contains <selector> = <text>',
  'expect visible <selector>',
  'expect hidden <selector>',
  'expect count <selector> = <number>',
  'expect title = <exact title>',
] as const;

const COMMANDS: Record<string, BrowserStep['action']> = {
  click: 'click',
  check: 'check',
  fill: 'fill',
  select: 'select',
  press: 'press',
  goto: 'goto',
  'expect text': 'expect_text',
  'expect contains': 'expect_contains',
  'expect visible': 'expect_visible',
  'expect hidden': 'expect_hidden',
  'expect count': 'expect_count',
  'expect title': 'expect_title',
};

/** Parses one typed line into a step, or says what is wrong with it. */
export function parseBrowserStep(
  line: string,
): { step: BrowserStep } | { error: string } {
  // Only the line's start and a pasted carriage return are trimmed, so a value keeps its
  // trailing spaces and the typed form round-trips.
  const text = line.replace(/\r$/, '').replace(/^\s+/, '');
  const command = Object.keys(COMMANDS)
    .sort((a, b) => b.length - a.length)
    .find((c) => text === c || text.startsWith(c + ' '));
  if (!command)
    return {
      error: `Start the line with a step such as click, fill or expect text (got “${text.trim().slice(0, 40)}”).`,
    };
  const action = COMMANDS[command]!;
  const rest = text.slice(command.length).replace(/^ +/, '');
  // A trailing " =" (an editor may drop the space of "fill #name = ") means an empty value.
  const body = /(^| )=$/.test(rest) ? rest + ' ' : rest;
  const eq = body.startsWith('= ') ? 0 : body.indexOf(' = ');
  const target = eq === -1 ? body : body.slice(0, eq).trim();
  const after = eq === -1 ? null : body.slice(eq + (eq === 0 ? 2 : 3));
  let raw: Record<string, unknown>;
  switch (action) {
    case 'fill':
    case 'select':
      raw = { action, selector: target, value: after };
      break;
    case 'press':
      raw = { action, selector: target, key: after?.trim() ?? null };
      break;
    case 'goto':
      raw = { action, path: rest.trim() };
      break;
    case 'expect_text':
    case 'expect_contains':
      raw = { action, selector: target, text: after };
      break;
    case 'expect_count':
      raw = {
        action,
        selector: target,
        count:
          after !== null && /^[0-9]+$/.test(after.trim())
            ? Number(after.trim())
            : after,
      };
      break;
    case 'expect_title':
      raw = { action, text: after };
      break;
    default:
      raw = { action, selector: rest.trim() };
  }
  if (
    [
      'fill',
      'select',
      'press',
      'expect_text',
      'expect_contains',
      'expect_count',
      'expect_title',
    ].includes(action) &&
    after === null
  )
    return { error: `“${command}” needs “<selector> = <value>”.` };
  const parsed = BrowserStepSchema.safeParse(raw);
  if (!parsed.success)
    return {
      error: `“${text.slice(0, 60)}”: ${parsed.error.issues[0]?.message ?? 'not a valid step'}.`,
    };
  return { step: parsed.data };
}

/** Parses typed steps, one per line; blank lines are skipped. */
export function parseBrowserSteps(
  text: string,
): { steps: BrowserStep[] } | { error: string } {
  const steps: BrowserStep[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    const r = parseBrowserStep(line);
    if ('error' in r) return { error: `Line ${i + 1}: ${r.error}` };
    steps.push(r.step);
  }
  return { steps };
}

/** The typed form of a step; parseBrowserStep(formatBrowserStep(s)) gives s back. */
export function formatBrowserStep(s: BrowserStep): string {
  const name = Object.entries(COMMANDS).find(([, a]) => a === s.action)![0];
  switch (s.action) {
    case 'fill':
    case 'select':
      return `${name} ${s.selector} = ${s.value}`;
    case 'press':
      return `${name} ${s.selector} = ${s.key}`;
    case 'goto':
      return `${name} ${s.path}`;
    case 'expect_text':
    case 'expect_contains':
      return `${name} ${s.selector} = ${s.text}`;
    case 'expect_count':
      return `${name} ${s.selector} = ${s.count}`;
    case 'expect_title':
      return `${name} = ${s.text}`;
    default:
      return `${name} ${s.selector}`;
  }
}

/**
 * ADR-0078 review N-4: the pinned QA browser (bridge.py BROWSER_VERSION, checked equal by a test)
 * and the day it was pinned. ADR-0078 commits to re-checking it against Chrome for Testing security
 * releases at least monthly; the build page shows when that is due or overdue.
 */
export const PINNED_BROWSER = {
  name: 'Chrome for Testing headless shell',
  version: '156.0.8078.47',
  pinned_on: '2026-11-06',
  recheck_days: 30,
} as const;
/** The day the pinned browser's monthly security re-check is due (YYYY-MM-DD). */
export function browserRecheckDue(): string {
  const d = new Date(PINNED_BROWSER.pinned_on + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + PINNED_BROWSER.recheck_days);
  return d.toISOString().slice(0, 10);
}

/**
 * ADR-0078 (review M-2, L-9): who built a candidate, for deciding whether its roles are qualified
 * for its recipe. Role qualifications are per connection, model and role prompt, so recipe
 * qualification is too: there is no global switch.
 */
export type BuildRoles = {
  connection_id: string;
  model_id: string;
  /** SHA-256 of the exact builder and reviewer role prompts. */
  builder_prompt_sha256: string;
  reviewer_prompt_sha256: string;
};
/**
 * Review L-10: the benchmark versions that currently qualify each recipe. A version is replaced
 * whenever its cases or checker change, so a pass on an older version never qualifies a build.
 * ADR-0105: p15-small-signup-v5 is the in-app copy of v4 (same spec, cases, reference and
 * checker; only who checks the pass bars differs), so a pass on either counts.
 * scripts/p15-web-benchmark.mjs verify checks v4 is one it publishes; the recipe benchmark test
 * checks v5 against v4. ADR-0112: for Python only the larger benchmark is listed, and it applies
 * only to larger Python builds (see pythonBuildScale); small Python builds need no recipe pass.
 * ADR-0115: p14-larger-ledgercheck-v6 is v5's task with leading invented tool-call lines
 * allowed before a role answer's one json fence, as plan-route builds now allow by default.
 */
export const RECIPE_BENCHMARKS: Readonly<
  Partial<Record<BuildRecipe, readonly string[]>>
> = {
  'static-web/1': ['p15-small-signup-v4', 'p15-small-signup-v5'],
  'python-build/1': ['p14-larger-ledgercheck-v5', 'p14-larger-ledgercheck-v6'],
};
/** A recorded live pass of a recipe's frozen benchmark by one set of roles. */
export type RecipeQualification = BuildRoles & {
  recipe: BuildRecipe;
  benchmark_id: string;
};

/**
 * ADR-0112: the largest Python build the small benchmark (p14-small-wordtally-v5) stands for. Its
 * reference is one Python file and its spec freezes 10 cases; the larger benchmark has 5 files
 * and also 10 cases, so files are what tell the two apart, and more cases than the small one
 * froze is also beyond what it showed. A test checks both numbers against the frozen files.
 */
export const SMALL_PYTHON_BUILD = { python_files: 1, cases: 10 } as const;
export type BuildScale = 'small' | 'larger';
/**
 * ADR-0112: a Python build's scale, judged on the exact package it exported and the cases frozen
 * for its task. Larger when either goes beyond SMALL_PYTHON_BUILD. Every non-empty `.py` file
 * counts, tests included; an empty one (a package marker such as `__init__.py`) does not.
 */
export function pythonBuildScale(
  packageFiles: readonly { path: string; size: number }[],
  cases: number,
): BuildScale {
  const pythonFiles = packageFiles.filter(
    (f) => f.path.endsWith('.py') && f.size > 0,
  ).length;
  return pythonFiles > SMALL_PYTHON_BUILD.python_files ||
    cases > SMALL_PYTHON_BUILD.cases
    ? 'larger'
    : 'small';
}
/**
 * Whether a build is an unqualified trial. A small Python build is admitted only on qualified
 * roles (ADR-0048/0049), so it never is. A larger Python build (ADR-0112) and any other recipe
 * are trials unless a recorded benchmark pass matches this build's own connection, model and both
 * role prompts it used, on the recipe's current benchmark versions; a pass on another
 * connection, model, prompt or benchmark version never lifts the label.
 */
export function unqualifiedTrial(
  recipe: BuildRecipe,
  roles: BuildRoles | null,
  qualifications: readonly RecipeQualification[],
  scale: BuildScale = 'small',
): boolean {
  if (recipe === 'python-build/1' && scale === 'small') return false;
  return !(
    roles &&
    qualifications.some(
      (q) =>
        q.recipe === recipe &&
        (RECIPE_BENCHMARKS[recipe] ?? []).includes(q.benchmark_id) &&
        q.connection_id === roles.connection_id &&
        q.model_id === roles.model_id &&
        q.builder_prompt_sha256 === roles.builder_prompt_sha256 &&
        q.reviewer_prompt_sha256 === roles.reviewer_prompt_sha256,
    )
  );
}
export const UNQUALIFIED_TRIAL_NOTE =
  'Unqualified trial: the builder and reviewer were qualified on Python tasks only, not on static web pages, so this evidence is weaker than a qualified build until the frozen web benchmark passes live on the same connection, model and role prompts.';
/** ADR-0112: the same label on a larger Python build whose plan roles may be qualified. */
export const UNQUALIFIED_LARGER_PYTHON_NOTE =
  'Unqualified trial: this is a larger Python build (more than one Python file or more than 10 cases), and the builder and reviewer have not passed the frozen larger Python benchmark live on the same connection, model and role prompts, so this evidence is weaker than a qualified build.';
/**
 * ADR-0112 review L-1: a larger Python build with no plan roles (the dollar broker route or the
 * ChatGPT-plan Codex builder). Build qualification records exist only for plan roles, so nothing
 * can lift this label on these routes.
 */
export const UNQUALIFIED_LARGER_PYTHON_NO_ROLES_NOTE =
  'Unqualified trial: this is a larger Python build (more than one Python file or more than 10 cases) on a route without build qualification (the pay-per-use broker or the Codex builder), so it is always labelled a trial; builds on a plan connection whose builder and reviewer passed the frozen larger Python benchmark are not.';
