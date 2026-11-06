import { z } from './primitives.js';

/**
 * ADR-0078 (P15 slice 1): frozen browser checks for the static-web/1 recipe. A browser check
 * opens one page of the generated site in the reviewed headless browser and runs these steps in
 * order; every expectation waits up to a few seconds for the page to settle. The steps are data
 * read by the reviewed checker, never code: no step runs a script the spec author wrote.
 */
const selector = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((s) => !/[\n\r]/.test(s), 'A selector is one line');
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
  const text = line.trim();
  const command = Object.keys(COMMANDS)
    .sort((a, b) => b.length - a.length)
    .find((c) => text === c || text.startsWith(c + ' '));
  if (!command)
    return {
      error: `Start the line with a step such as click, fill or expect text (got “${text.slice(0, 40)}”).`,
    };
  const action = COMMANDS[command]!;
  const rest = text.slice(command.length).trim();
  // A trailing " =" (trimmed from "fill #name = ") means an empty value.
  const body = rest.endsWith(' =') || rest === '=' ? rest + ' ' : rest;
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
      raw = { action, selector: target, key: after };
      break;
    case 'goto':
      raw = { action, path: rest };
      break;
    case 'expect_text':
    case 'expect_contains':
      raw = { action, selector: target, text: after };
      break;
    case 'expect_count':
      raw = {
        action,
        selector: target,
        count: after !== null && /^[0-9]+$/.test(after) ? Number(after) : after,
      };
      break;
    case 'expect_title':
      raw = { action, text: after };
      break;
    default:
      raw = { action, selector: rest };
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
