import type { RecipePassBar } from '@creator/contracts';

/**
 * ADR-0105: how the studio checks the pass bars of its in-app recipe benchmarks (the v5 copies
 * under config/recipe-benchmarks). Each FREEZE.json there names this file's SHA-256
 * (`scorer:recipe-scoring.ts`), and a test holds them equal: changing a rule here needs new
 * benchmark versions, never an edited freeze.
 */
export const RECIPE_SCORER_VERSION = 'recipe-scorer/1';

/**
 * A build stop that judged nothing about the roles' work: a role request that got no answer
 * (sign-in, plan limit, outage, refused admission), a worker that did not finish a case, or roles
 * the studio could not admit before sending anything. The frozen rules call these infrastructure
 * faults: the attempt is invalid and may be replaced once. Every other stop (repair limit,
 * reviewer blocked, an answer that is not the contract, the call cap or the deadline) is a
 * failed attempt.
 */
export function infrastructureStop(reason: string): boolean {
  return (
    /^Error: Role stopped: /.test(reason) ||
    /^Error: The worker did not finish check /.test(reason) ||
    /^Error: Plan roles are not ready: /.test(reason)
  );
}

/**
 * The larger benchmark's structure bar: src/ledger has parse.py, rules.py and report.py, each
 * with a top-level function definition (`def name(` at the start of a line), and src/main.py
 * imports from ledger (`from ledger... import` or `import ledger...` on a line of its own). It reads
 * the packaged files as text and runs nothing.
 */
export function structureBar(
  files: readonly { path: string; content: string }[],
): RecipePassBar {
  const text = (p: string) => files.find((f) => f.path === p)?.content ?? null;
  const missing: string[] = [];
  for (const name of ['parse', 'rules', 'report']) {
    const t = text(`src/ledger/${name}.py`);
    if (t === null) missing.push(`src/ledger/${name}.py is missing`);
    else if (!/^def [A-Za-z_][A-Za-z0-9_]*\s*\(/m.test(t))
      missing.push(`src/ledger/${name}.py has no top-level function`);
  }
  const main = text('src/main.py');
  if (main === null) missing.push('src/main.py is missing');
  else if (
    !/^[ \t]*(from[ \t]+ledger(\.[A-Za-z0-9_.]+)?[ \t]+import\b|import[ \t]+ledger\b)/m.test(
      main,
    )
  )
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
