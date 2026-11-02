import type { ArtifactGuide, CliOption } from '@creator/contracts';
import type { PackageFile } from './tar.js';

/**
 * ADR-0059: the command-line options a Python package declares, read from its source text so
 * Try can say which arguments the program takes. Nothing is imported or run: the text is
 * scanned for literal `add_argument(...)` calls (argparse) and, failing that, for `--flag`
 * string literals in files that read `sys.argv`. Anything that is not a plain literal (a
 * computed name, a help text built at run time) is shown as missing rather than guessed.
 */
export const MAX_GUIDE_OPTIONS = 40;
const MAX_SOURCE_BYTES = 512 * 1024;
/** All Python sources read for one guide, entry point first; the rest are skipped. */
const MAX_TOTAL_BYTES = 1024 * 1024;
/** `add_argument(` calls examined per file; far more than the options a guide lists. */
const MAX_CALLS = 200;
/** Characters read for one call's arguments. */
const CALL_WINDOW = 4000;

type Token =
  | { kind: 'string'; value: string; end: number }
  | { kind: 'other'; end: number };

/**
 * Reads one Python string literal (with an optional r/b/u/f prefix) starting at `i`. An
 * unterminated one runs to the end of its line (single quotes) or of the source (triple
 * quotes) and is not a literal, so every scan below moves forward and stays linear in the
 * source size, whatever the package contains (review M-1).
 */
function stringAt(
  src: string,
  i: number,
  /** Scan no further than this; a string still open there ends there (re-review M-1). */
  limit = src.length,
): Token | null {
  const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
  if (!m) return null;
  const prefix = m[1]!.toLowerCase();
  const quote = m[2]!;
  // A formatted string's value depends on the running program.
  const formatted = prefix.includes('f');
  const raw = prefix.includes('r');
  let j = i + m[0].length;
  let value = '';
  while (j < limit) {
    if (src.startsWith(quote, j)) {
      return formatted
        ? { kind: 'other', end: j + quote.length }
        : { kind: 'string', value, end: j + quote.length };
    }
    const c = src[j]!;
    if (quote.length === 1 && c === '\n') return { kind: 'other', end: j };
    if (c === '\\' && j + 1 < src.length) {
      const n = src[j + 1]!;
      if (raw) value += c + n;
      else
        value +=
          n === 'n'
            ? '\n'
            : n === 't'
              ? '\t'
              : n === '\n'
                ? ''
                : n === '\\' || n === "'" || n === '"'
                  ? n
                  : c + n;
      j += 2;
      continue;
    }
    value += c;
    j++;
  }
  return { kind: 'other', end: limit };
}

/** The text between the parentheses of a call whose `(` is at `open`, or null. */
function callBody(src: string, open: number): string | null {
  let depth = 0;
  // A hard window, string contents included, so nested calls cannot rescan a long string.
  const limit = Math.min(src.length, open + CALL_WINDOW);
  for (let j = open; j < limit;) {
    const s = stringAt(src, j, limit);
    if (s) {
      j = s.end;
      continue;
    }
    const c = src[j]!;
    if (c === '#') {
      const nl = src.indexOf('\n', j);
      j = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, j);
    }
    j++;
  }
  return null;
}

/** Splits call arguments at top-level commas. */
function splitArgs(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let j = 0; j < body.length;) {
    const s = stringAt(body, j);
    if (s) {
      j = s.end;
      continue;
    }
    const c = body[j]!;
    if (c === '#') {
      const nl = body.indexOf('\n', j);
      j = nl < 0 ? body.length : nl;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, j));
      start = j + 1;
    }
    j++;
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length);
}

/** The value of an expression made only of adjacent string literals, or null. */
function literal(expr: string): string | null {
  let j = 0;
  let out = '';
  let any = false;
  const text = expr.trim().replace(/^\(([\s\S]*)\)$/, '$1');
  while (j < text.length) {
    if (/\s/.test(text[j]!)) {
      j++;
      continue;
    }
    if (text[j] === '#') {
      const nl = text.indexOf('\n', j);
      j = nl < 0 ? text.length : nl;
      continue;
    }
    const s = stringAt(text, j);
    if (!s || s.kind !== 'string') return null;
    out += s.value;
    any = true;
    j = s.end;
  }
  return any ? out : null;
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Two same-length views of a source: `text` with comments blanked, and `code` with string
 * contents blanked too, so a call is found only where it is code.
 */
function views(src: string): { text: string; code: string } {
  let text = '';
  let code = '';
  for (let j = 0; j < src.length;) {
    const s = stringAt(src, j);
    if (s) {
      const piece = src.slice(j, s.end);
      text += piece;
      code += piece.replace(/[^\n]/g, ' ');
      j = s.end;
      continue;
    }
    if (src[j] === '#') {
      const nl = src.indexOf('\n', j);
      const end = nl < 0 ? src.length : nl;
      const blank = ' '.repeat(end - j);
      text += blank;
      code += blank;
      j = end;
      continue;
    }
    text += src[j];
    code += src[j];
    j++;
  }
  return { text, code };
}

function argparseOptions(path: string, original: string): CliOption[] {
  const out: CliOption[] = [];
  const { text: src, code } = views(original);
  const re = /\.add_argument\s*\(/g;
  let calls = 0;
  for (let m = re.exec(code); m && calls++ < MAX_CALLS; m = re.exec(code)) {
    const body = callBody(src, m.index + m[0].length - 1);
    if (body === null) continue;
    const names: string[] = [];
    const kw: Record<string, string> = {};
    for (const part of splitArgs(body)) {
      const k = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)([\s\S]*)$/.exec(part);
      if (k) kw[k[1]!] = k[2]!.trim();
      else {
        const v = literal(part);
        if (v !== null && names.length < 4) names.push(clip(v, 80));
      }
    }
    if (!names.length || names.some((n) => !n.length)) continue;
    const action = kw.action ? literal(kw.action) : null;
    // argparse.BooleanOptionalAction also accepts --no-NAME.
    const boolean =
      !!kw.action && /^(argparse\.)?BooleanOptionalAction$/.test(kw.action);
    if (boolean)
      for (const n of [...names])
        if (n.startsWith('--') && names.length < 4)
          names.push(`--no-${n.slice(2)}`);
    const flag =
      boolean ||
      (action !== null &&
        /^(store_true|store_false|store_const|count|help|version|append_const)$/.test(
          action,
        ));
    const positional = !names[0]!.startsWith('-');
    let value: string | null = null;
    if (!flag) {
      const metavar = kw.metavar ? literal(kw.metavar) : null;
      if (metavar) value = metavar;
      else if (kw.choices && choiceList(kw.choices))
        value = choiceList(kw.choices);
      else if (kw.type && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(kw.type))
        value = kw.type.toUpperCase();
      else if (positional) value = null;
      else
        value =
          names
            .find((n) => n.startsWith('--'))
            ?.replace(/^--/, '')
            .toUpperCase() ?? 'VALUE';
      if (value) value = clip(value, 120);
    }
    const rawDefault = kw.default?.trim() ?? null;
    const shownDefault =
      rawDefault === null
        ? null
        : (literal(rawDefault) ??
          (/^[-+]?[0-9.]+$|^(True|False|None)$/.test(rawDefault)
            ? rawDefault
            : null));
    // A hidden option stays hidden.
    if (kw.help && /^(argparse\.)?SUPPRESS$/.test(kw.help)) continue;
    let help = kw.help ? literal(kw.help) : null;
    if (help !== null) {
      help = help
        .replaceAll('%(default)s', shownDefault ?? 'the default')
        .replaceAll('%(prog)s', 'main.py')
        .replaceAll('%%', '%');
      help = clip(oneLine(help), 400);
    }
    out.push({
      names,
      value,
      help: help || null,
      default:
        shownDefault !== null && shownDefault !== 'None' && !flag
          ? clip(shownDefault, 80)
          : null,
      required: positional
        ? !kw.nargs || !/^['"][?*]['"]$/.test(kw.nargs)
        : kw.required === 'True',
      file: clip(path, 200),
    });
  }
  return out;
}

/**
 * Literal choices as `{a,b}`, a literal `range(a, b)` as `{a..b-1}`; null for anything else
 * (a constant's name says nothing about its values).
 */
function choiceList(expr: string): string | null {
  const r = /^range\(\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)$/.exec(expr.trim());
  if (r) {
    const [lo, hi] =
      r[2] === undefined ? [0, Number(r[1])] : [Number(r[1]), Number(r[2])];
    return hi > lo ? `{${lo}..${hi - 1}}` : null;
  }
  const inner = /^[[({]([\s\S]*)[\])}]$/.exec(expr.trim());
  if (!inner) return null;
  const items = splitArgs(inner[1]!).map(
    (x) => literal(x) ?? (/^[-+]?[0-9.]+$/.test(x) ? x : null),
  );
  if (!items.length || items.some((x) => x === null)) return null;
  return `{${items.join(',')}}`;
}

function argvOptions(path: string, src: string): CliOption[] {
  if (!/\bsys\.argv\b|\bargv\b/.test(src)) return [];
  const seen = new Set<string>();
  const out: CliOption[] = [];
  for (let j = 0; j < src.length;) {
    if (src[j] === '#') {
      const nl = src.indexOf('\n', j);
      j = nl < 0 ? src.length : nl;
      continue;
    }
    const s = stringAt(src, j);
    if (!s) {
      j++;
      continue;
    }
    if (
      s.kind === 'string' &&
      /^--?[A-Za-z][A-Za-z0-9-]{0,40}$/.test(s.value) &&
      !seen.has(s.value)
    ) {
      seen.add(s.value);
      out.push({
        names: [s.value],
        value: null,
        help: null,
        default: null,
        required: false,
        file: clip(path, 200),
      });
    }
    j = s.end;
  }
  return out;
}

/** The options of a package's Python sources, entry point first. */
export function cliOptions(
  files: readonly PackageFile[],
): Pick<
  ArtifactGuide,
  'options' | 'options_source' | 'options_truncated' | 'help_flag'
> {
  let total = 0;
  const sources = files
    .filter(
      (f) => f.path.endsWith('.py') && f.content.length <= MAX_SOURCE_BYTES,
    )
    .sort(
      (a, b) =>
        Number(b.path === 'src/main.py') - Number(a.path === 'src/main.py') ||
        a.path.localeCompare(b.path),
    )
    .filter((f) => (total += f.content.length) <= MAX_TOTAL_BYTES)
    .map((f) => ({ path: f.path, src: f.content.toString('utf8') }));
  // An option declared twice (for example in two parsers) is listed once.
  const unique = (list: CliOption[]) => {
    const seen = new Set<string>();
    return list.filter((o) => {
      if (o.names.some((n) => seen.has(n))) return false;
      o.names.forEach((n) => seen.add(n));
      return true;
    });
  };
  const declaresHelp = (list: CliOption[]) =>
    list.some((o) => o.names.includes('--help'));
  // argparse adds -h/--help unless a parser in the code says add_help=False.
  const automaticHelp =
    sources.some((f) => /ArgumentParser\s*\(/.test(views(f.src).code)) &&
    !sources.some((f) => /add_help\s*=\s*False/.test(views(f.src).code));
  const result = (
    source: 'argparse' | 'argv',
    list: CliOption[],
  ): ReturnType<typeof cliOptions> => ({
    options: list.slice(0, MAX_GUIDE_OPTIONS),
    options_source: source,
    options_truncated: list.length > MAX_GUIDE_OPTIONS,
    help_flag: declaresHelp(list) || (source === 'argparse' && automaticHelp),
  });
  const parsed = unique(sources.flatMap((f) => argparseOptions(f.path, f.src)));
  if (parsed.length) return result('argparse', parsed);
  const argv = unique(sources.flatMap((f) => argvOptions(f.path, f.src)));
  if (argv.length) return result('argv', argv);
  return {
    options: [],
    options_source: 'none',
    options_truncated: false,
    help_flag: automaticHelp,
  };
}
