import { ContractError, type RecipePassBar } from '@creator/contracts';

/**
 * ADR-0105: how the studio checks the pass bars of its in-app recipe benchmarks (the v5 copies
 * under config/recipe-benchmarks). Each FREEZE.json there names this file's SHA-256
 * (`scorer:recipe-scoring.ts`), and a test holds them equal: changing a rule here needs new
 * benchmark versions, never an edited freeze.
 */
export const RECIPE_SCORER_VERSION = 'recipe-scorer/4';

/**
 * Review 1 L-2 and re-review L-2: role answers that end a request without the contract, caused
 * by the role itself (too long, out of turns, a model other than the one asked for, a refusal to
 * serve the model asked for). They are the model's work, so they fail the attempt instead of
 * earning a free replacement. One rule on every route: the ChatGPT plan's refusal of the model
 * (`subscription_sharing_unsupported_capability` on the `model` parameter) reaches here as
 * `model_refused`, the same as Claude Code's `claude_model_refused`.
 */
export const ROLE_CAUSED_STOPS: readonly string[] = [
  'incomplete',
  'output_cap_exceeded',
  'studio_output_cap',
  'claude_max_turns',
  'model_substituted',
  'model_refused',
  'claude_model_refused',
];

/**
 * Re-review L-1: admission refusal codes the roles' own work causes. `cap_reached` is the
 * per-request input cap when the roles' own output made the input too big (a builder that wrote
 * too much makes the reviewer's or the repair's input too large); `attempt_request_limit` is the
 * attempt's own request limit (the call cap). Third review L-1: an input-cap refusal of an
 * attempt's first request (`input_cap_before_roles`: the roles wrote nothing yet) or after the
 * cap was lowered since Start (`input_cap_changed`) is not the roles' work. Every other refusal
 * (an earlier request with an unknown outcome or one still running, the daily cap, a lost
 * sign-in, a connection setting changed during the run) judges nothing about the roles' work.
 */
export const ROLE_CAUSED_REFUSALS: readonly string[] = [
  'cap_reached',
  'attempt_request_limit',
];

const REFUSED = /^Error: Plan request refused \(([^)]*)\)/;

/**
 * A role request the studio refused, as one build reason that keeps its refusal codes:
 * `Plan request refused (<code>, …): <the refusal texts>`. Null when `e` is not a refusal.
 * Plan admission carries its codes (ADR-0087); a build qualification's own check names the
 * attempt's request limit as `attempt_request_limit` and any other mismatch as `not_covered`.
 */
export function refusalError(
  e: unknown,
  /** The code an input-cap refusal (`cap_reached`) is recorded under, when the caller knows. */
  inputCap?: 'input_cap_before_roles' | 'input_cap_changed',
): Error | null {
  if (!(e instanceof ContractError) || e.code !== 'ACCESS_DENIED') return null;
  const coded = e.reasons;
  const codes = coded.length
    ? coded.map((r) =>
        r.code === 'cap_reached' && inputCap ? inputCap : r.code,
      )
    : e.details.map((d) =>
        /has used its \d+ requests/.test(d)
          ? 'attempt_request_limit'
          : 'not_covered',
      );
  if (!codes.length) codes.push('other');
  const texts = coded.length ? coded.map((r) => r.text ?? '') : [...e.details];
  return new Error(
    `Plan request refused (${[...new Set(codes)].join(', ')}): ${e.message} ${texts.join(' ')}`.trim(),
  );
}

/**
 * Re-review L-3: whether the only reason for a refusal is another plan request still running
 * on the connection (one at a time). A qualification's role request waits for it, within a
 * bound, instead of losing its attempt to a chat answer or an autopilot step.
 */
export function onlyBusyRefusal(e: unknown): boolean {
  if (!(e instanceof ContractError) || e.code !== 'ACCESS_DENIED') return false;
  return (
    e.reasons.length > 0 &&
    e.reasons.every(
      (r) =>
        r.code === 'request_open' &&
        (r.text ?? '').startsWith('Another plan request is already running'),
    )
  );
}

/**
 * A build stop that judged nothing about the roles' work, which the frozen rules call an
 * infrastructure fault: the attempt is invalid and may be replaced once.
 * - A role request that got no answer (`Role stopped: <status> <code>`) for any reason not in
 *   `ROLE_CAUSED_STOPS`: network, provider, stream, rate or usage limit, sign-in, token, timeout.
 * - A request the studio refused (`Plan request refused (<codes>)`) when none of its codes is in
 *   `ROLE_CAUSED_REFUSALS`.
 * - A worker that did not finish a case, or roles not ready before anything was sent.
 * Every other stop (repair limit, reviewer blocked, an answer that is not the contract, the call
 * cap, the input cap, the deadline, or a `ROLE_CAUSED_STOPS` code) is a failed attempt.
 */
export function infrastructureStop(reason: string): boolean {
  const role = /^Error: Role stopped: \S+ (\S+)/.exec(reason);
  if (role) return !ROLE_CAUSED_STOPS.includes(role[1]!);
  const refused = REFUSED.exec(reason);
  if (refused)
    return !refused[1]!
      .split(', ')
      .some((code) => ROLE_CAUSED_REFUSALS.includes(code));
  return (
    /^Error: The worker did not finish check /.test(reason) ||
    /^Error: Plan roles are not ready: /.test(reason)
  );
}

/**
 * Python source as logical lines with every string's contents and every comment blanked out,
 * so text inside a docstring, a string or a comment is never read as code (review 1 L-1).
 * Lines joined by brackets or a trailing backslash become one logical line, which keeps its
 * first line's indentation. A tokenizer, not a parser: it runs nothing.
 */
export function pythonLogicalLines(source: string): string[] {
  return pythonRead(source).lines;
}

/**
 * Re-review N-1: why a module can't be read as Python, as v4's grader (which parsed it) would
 * have refused it: a string left open, a bracket closed that was never opened or left open, or
 * a backslash continuing past the end. Null when none of these is found. Not a full parser:
 * other syntax errors are left to the frozen cases, which run the package.
 */
export function pythonReadProblem(source: string): string | null {
  return pythonRead(source).problem;
}

function pythonRead(source: string): {
  lines: string[];
  problem: string | null;
} {
  let problem: string | null = null;
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    if (ch === '#') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = source.startsWith(ch.repeat(3), i);
      const close = triple ? ch.repeat(3) : ch;
      // A raw string's backslash still keeps the next quote inside the string.
      out += close;
      i += close.length;
      while (i < n && !source.startsWith(close, i)) {
        if (!triple && source[i] === '\n') break; // unterminated: stop at the line end
        if (source[i] === '\\' && i + 1 < n) {
          out += source[i + 1] === '\n' ? '\n' : ' ';
          i += 2;
          continue;
        }
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (source.startsWith(close, i)) {
        out += close;
        i += close.length;
      } else problem ??= 'a string is never closed';
      continue;
    }
    out += ch;
    i++;
  }
  const lines: string[] = [];
  let current = '';
  let depth = 0;
  // Third review N-1 and review 4 L-1: a backslash joins the next physical line. The file's one
  // final line ending starts no further line, so a backslash on the last line continues past
  // the end of the file (an error, even alone on its line); a blank or comment line after it
  // ends the statement, as Python reads it.
  let lastContinued = false;
  for (const raw of out.replace(/\r?\n$/, '').split(/\r?\n/)) {
    const continued = raw.endsWith('\\');
    lastContinued = continued;
    const line = continued ? raw.slice(0, -1) : raw;
    current = current ? `${current} ${line.trim()}` : line;
    for (const c of line) {
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0)
          problem ??= 'a bracket is closed that was never opened';
        depth = Math.max(0, depth - 1);
      }
    }
    if (depth === 0 && !continued) {
      if (current.trim()) lines.push(current);
      current = '';
    }
  }
  if (depth > 0) problem ??= 'a bracket is never closed';
  else if (lastContinued)
    problem ??= 'a line continues past the end of the file';
  if (current.trim()) lines.push(current);
  return { lines, problem };
}

/** Whether a module defines a top-level function (a `def` statement in the module body). */
export function hasTopLevelFunction(source: string): boolean {
  return pythonLogicalLines(source).some((l) =>
    /^def[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\(/.test(l),
  );
}

/**
 * Whether a module imports from the ledger package anywhere: `from ledger[.x] import ...`
 * (relative `from .ledger` too) or `import a, ledger[.x] [as b]`, as statements at any depth.
 */
export function importsLedger(source: string): boolean {
  const isLedger = (name: string) => name.split('.')[0] === 'ledger';
  for (const line of pythonLogicalLines(source))
    for (const stmt of line.split(/[;:]/)) {
      const t = stmt.trim();
      const from = /^from[ \t]+\.*([A-Za-z_][A-Za-z0-9_.]*)[ \t]+import\b/.exec(
        t,
      );
      if (from && isLedger(from[1]!)) return true;
      const imp = /^import[ \t]+(.+)$/.exec(t);
      if (
        imp &&
        imp[1]!
          .split(',')
          .map((x) =>
            x
              .trim()
              .split(/[ \t]+as[ \t]+/)[0]!
              .trim(),
          )
          .some(isLedger)
      )
        return true;
    }
  return false;
}

/**
 * The larger benchmark's structure bar, the rule of v4's grader (config/repo-benchmarks/v4/
 * grader.mjs STRUCTURE_CHECK): src/ledger has parse.py, rules.py and report.py, each with a
 * top-level function definition, and src/main.py imports from ledger anywhere. It reads the
 * packaged files with a Python-aware tokenizer (strings and comments are not code) and runs
 * nothing. Like the v4 grader, a checked file that can't be read as Python fails the bar
 * (`pythonReadProblem`: an open string, an unbalanced bracket, a dangling continuation); other
 * syntax errors are left to the frozen cases, which run the package.
 */
export function structureBar(
  files: readonly { path: string; content: string }[],
): RecipePassBar {
  const text = (p: string) => files.find((f) => f.path === p)?.content ?? null;
  const missing: string[] = [];
  for (const name of ['parse', 'rules', 'report']) {
    const t = text(`src/ledger/${name}.py`);
    if (t === null) missing.push(`src/ledger/${name}.py is missing`);
    else if (pythonReadProblem(t))
      missing.push(
        `src/ledger/${name}.py can't be read as Python (${pythonReadProblem(t)})`,
      );
    else if (!hasTopLevelFunction(t))
      missing.push(`src/ledger/${name}.py has no top-level function`);
  }
  const main = text('src/main.py');
  if (main === null) missing.push('src/main.py is missing');
  else if (pythonReadProblem(main))
    missing.push(
      `src/main.py can't be read as Python (${pythonReadProblem(main)})`,
    );
  else if (!importsLedger(main))
    missing.push('src/main.py does not import from ledger');
  return {
    key: 'structure',
    passed: !missing.length,
    detail: missing.length
      ? missing.join('; ')
      : 'src/ledger has parse.py, rules.py and report.py with functions, and src/main.py imports from ledger',
  };
}

/** Whether every bar passed; the attempt's state when the build reached a verdict. */
export const barsPassed = (bars: readonly RecipePassBar[]) =>
  bars.length > 0 && bars.every((b) => b.passed);
