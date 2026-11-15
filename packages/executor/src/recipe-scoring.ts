import type { RecipePassBar } from '@creator/contracts';

/**
 * ADR-0105: how the studio checks the pass bars of its in-app recipe benchmarks (the v5 copies
 * under config/recipe-benchmarks). Each FREEZE.json there names this file's SHA-256
 * (`scorer:recipe-scoring.ts`), and a test holds them equal: changing a rule here needs new
 * benchmark versions, never an edited freeze.
 */
export const RECIPE_SCORER_VERSION = 'recipe-scorer/2';

/**
 * Review 1 L-2: role answers that end a request without the contract, caused by the role itself
 * (too long, out of turns, a model other than the one asked for, a refusal to use it). They are
 * the model's work, so they fail the attempt instead of earning a free replacement.
 */
export const ROLE_CAUSED_STOPS: readonly string[] = [
  'incomplete',
  'output_cap_exceeded',
  'studio_output_cap',
  'claude_max_turns',
  'model_substituted',
  'claude_model_refused',
];

/**
 * A build stop that judged nothing about the roles' work, which the frozen rules call an
 * infrastructure fault: the attempt is invalid and may be replaced once.
 * - A role request that got no answer (`Role stopped: <status> <code>`) for any reason not in
 *   `ROLE_CAUSED_STOPS`: network, provider, stream, rate or usage limit, sign-in, token, timeout.
 * - A request the studio refused at admission (review 1 M-1): an earlier request with an
 *   unknown outcome, one still running, the daily cap, a lost sign-in.
 * - A worker that did not finish a case, or roles not ready before anything was sent.
 * Every other stop (repair limit, reviewer blocked, an answer that is not the contract, the call
 * cap, the deadline, or a `ROLE_CAUSED_STOPS` code) is a failed attempt.
 */
export function infrastructureStop(reason: string): boolean {
  const role = /^Error: Role stopped: \S+ (\S+)/.exec(reason);
  if (role) return !ROLE_CAUSED_STOPS.includes(role[1]!);
  return (
    /^ContractError: This plan request is not admitted\./.test(reason) ||
    /^ContractError: This build qualification request is not covered by its start\./.test(
      reason,
    ) ||
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
      }
      continue;
    }
    out += ch;
    i++;
  }
  const lines: string[] = [];
  let current = '';
  let depth = 0;
  for (const raw of out.split(/\r?\n/)) {
    const continued = raw.endsWith('\\');
    const line = continued ? raw.slice(0, -1) : raw;
    current = current ? `${current} ${line.trim()}` : line;
    for (const c of line) {
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    }
    if (depth === 0 && !continued) {
      if (current.trim()) lines.push(current);
      current = '';
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
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
 * nothing. Unlike the v4 grader it does not reject a file Python could not parse; the frozen
 * cases, which run the package, catch that.
 */
export function structureBar(
  files: readonly { path: string; content: string }[],
): RecipePassBar {
  const text = (p: string) => files.find((f) => f.path === p)?.content ?? null;
  const missing: string[] = [];
  for (const name of ['parse', 'rules', 'report']) {
    const t = text(`src/ledger/${name}.py`);
    if (t === null) missing.push(`src/ledger/${name}.py is missing`);
    else if (!hasTopLevelFunction(t))
      missing.push(`src/ledger/${name}.py has no top-level function`);
  }
  const main = text('src/main.py');
  if (main === null) missing.push('src/main.py is missing');
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
