import type { RecipePassBar } from '@creator/contracts';
import {
  hasTopLevelFunction,
  pythonLogicalLines,
  pythonReadProblem,
} from './recipe-scoring.js';

/**
 * ADR-0114: a structure rule frozen in a benchmark's expectations (`structure`), for a package of
 * named modules. The ledger benchmark keeps its own rule (`structureBar` in recipe-scoring.ts),
 * which this file does not change; a benchmark's freeze names this file when it uses it.
 */
export interface PackageStructureRule {
  /** The entry point, for example `src/main.py`. */
  entry: string;
  /** The package's import name, for example `stockroom`. */
  package: string;
  /** Where the package lives, for example `src/stockroom`. */
  package_dir: string;
  /** Module names (without `.py`) that must each exist, define a function and be imported. */
  modules: string[];
}

/**
 * The dotted names one module's import statements reach, read like `importsLedger`: statements at
 * any depth, strings and comments ignored. `from X import a, b` reaches X, X.a and X.b; a relative
 * `from .X` or `from . import X` resolves against `pkg` when the file is in the package (a file
 * outside it has no package to resolve against, so its relative imports reach nothing).
 */
export function importedNames(source: string, pkg: string | null): string[] {
  const out: string[] = [];
  const resolve = (name: string) => {
    const dots = /^\.*/.exec(name)![0].length;
    if (!dots) return name;
    if (dots > 1 || !pkg) return null;
    return name.length > 1 ? `${pkg}.${name.slice(1)}` : pkg;
  };
  const target = (part: string) =>
    part
      .trim()
      .split(/[ \t]+as[ \t]+/)[0]!
      .trim();
  for (const line of pythonLogicalLines(source))
    for (const stmt of line.split(/[;:]/)) {
      const t = stmt.trim();
      const from = /^from[ \t]+(\.*[A-Za-z0-9_.]*)[ \t]+import[ \t]+(.+)$/.exec(
        t,
      );
      if (from) {
        const base = resolve(from[1]!);
        if (base === null || base === '') continue;
        out.push(base);
        for (const part of from[2]!.replace(/[()]/g, ' ').split(',')) {
          const name = target(part);
          if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
            out.push(`${base}.${name}`);
        }
        continue;
      }
      const imp = /^import[ \t]+(.+)$/.exec(t);
      if (imp)
        for (const part of imp[1]!.split(',')) {
          const name = target(part);
          if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) out.push(name);
        }
    }
  return out;
}

/**
 * ADR-0114: the package structure bar. The entry point and every named module exist and can be
 * read as Python (`pythonReadProblem`, as the ledger bar), each named module has a top-level
 * function, the package has `__init__.py`, the entry point imports from the package, and every
 * named module is imported by the entry point or by another file of the package. It reads the
 * packaged files and runs nothing; what the modules do is left to the frozen cases.
 */
export function packageStructureBar(
  files: readonly { path: string; content: string }[],
  rule: PackageStructureRule,
): RecipePassBar {
  const text = (p: string) => files.find((f) => f.path === p)?.content ?? null;
  const missing: string[] = [];
  const readable = new Map<string, string>();
  const read = (path: string) => {
    const t = text(path);
    if (t === null) missing.push(`${path} is missing`);
    else if (pythonReadProblem(t))
      missing.push(`${path} can't be read as Python (${pythonReadProblem(t)})`);
    else readable.set(path, t);
    return t !== null && readable.has(path);
  };
  const modulePath = (m: string) => `${rule.package_dir}/${m}.py`;
  if (text(`${rule.package_dir}/__init__.py`) === null)
    missing.push(`${rule.package_dir}/__init__.py is missing`);
  const entryOk = read(rule.entry);
  for (const m of rule.modules)
    if (
      read(modulePath(m)) &&
      !hasTopLevelFunction(readable.get(modulePath(m))!)
    )
      missing.push(`${modulePath(m)} has no top-level function`);
  // Every Python file of the package may import a named module, besides the entry point.
  const inPackage = files.filter(
    (f) => f.path.startsWith(`${rule.package_dir}/`) && f.path.endsWith('.py'),
  );
  const reached = new Map<string, string[]>();
  if (entryOk)
    reached.set(rule.entry, importedNames(readable.get(rule.entry)!, null));
  for (const f of inPackage)
    if (!pythonReadProblem(f.content))
      reached.set(f.path, importedNames(f.content, rule.package));
  const hits = (name: string, n: string) =>
    n === name || n.startsWith(`${name}.`);
  if (entryOk && !reached.get(rule.entry)!.some((n) => hits(rule.package, n)))
    missing.push(`${rule.entry} does not import from ${rule.package}`);
  for (const m of rule.modules) {
    if (!readable.has(modulePath(m))) continue;
    const name = `${rule.package}.${m}`;
    const by = [...reached].some(
      ([path, names]) =>
        path !== modulePath(m) && names.some((n) => hits(name, n)),
    );
    if (!by)
      missing.push(
        `${modulePath(m)} is not imported by ${rule.entry} or another module of ${rule.package}`,
      );
  }
  return {
    key: 'structure',
    passed: !missing.length,
    detail: missing.length
      ? missing.join('; ').slice(0, 600)
      : `${rule.package_dir} has __init__.py and all ${rule.modules.length} named modules, each with a function and imported, and ${rule.entry} imports from ${rule.package}`,
  };
}
