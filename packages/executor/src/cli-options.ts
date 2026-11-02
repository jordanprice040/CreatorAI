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

type Token =
  | { kind: 'string'; value: string; end: number }
  | { kind: 'other'; end: number };

/** Reads one Python string literal (with an optional r/b/u/f prefix) starting at `i`. */
function stringAt(src: string, i: number): Token | null {
  const m = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
  if (!m) return null;
  const prefix = m[1]!.toLowerCase();
  const quote = m[2]!;
  // A formatted string's value depends on the running program.
  const formatted = prefix.includes('f');
  const raw = prefix.includes('r');
  let j = i + m[0].length;
  let value = '';
  while (j < src.length) {
    if (src.startsWith(quote, j)) {
      return formatted
        ? { kind: 'other', end: j + quote.length }
        : { kind: 'string', value, end: j + quote.length };
    }
    const c = src[j]!;
    if (quote.length === 1 && c === '\n') return null;
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
  return null;
}

/** The text between the parentheses of a call whose `(` is at `open`, or null. */
function callBody(src: string, open: number): string | null {
  let depth = 0;
  for (let j = open; j < src.length && j - open < 4000;) {
    const s = stringAt(src, j);
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
  for (let m = re.exec(code); m; m = re.exec(code)) {
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
    const flag =
      action !== null &&
      /^(store_true|store_false|store_const|count|help|version|append_const)$/.test(
        action,
      );
    const positional = !names[0]!.startsWith('-');
    let value: string | null = null;
    if (!flag) {
      const metavar = kw.metavar ? literal(kw.metavar) : null;
      if (metavar) value = metavar;
      else if (kw.choices)
        value = `{${oneLine(kw.choices.replace(/^[[({]|[\])}]$/g, ''))
          .replace(/['"]/g, '')
          .replace(/\s*,\s*/g, ',')}}`;
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
      file: clip(path, 200),
    });
  }
  return out;
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
): Pick<ArtifactGuide, 'options' | 'options_source' | 'options_truncated'> {
  const sources = files
    .filter(
      (f) => f.path.endsWith('.py') && f.content.length <= MAX_SOURCE_BYTES,
    )
    .sort(
      (a, b) =>
        Number(b.path === 'src/main.py') - Number(a.path === 'src/main.py') ||
        a.path.localeCompare(b.path),
    )
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
  const result = (
    source: 'argparse' | 'argv',
    list: CliOption[],
  ): ReturnType<typeof cliOptions> => ({
    options: list.slice(0, MAX_GUIDE_OPTIONS),
    options_source: source,
    options_truncated: list.length > MAX_GUIDE_OPTIONS,
  });
  const parsed = unique(sources.flatMap((f) => argparseOptions(f.path, f.src)));
  if (parsed.length) return result('argparse', parsed);
  const argv = unique(sources.flatMap((f) => argvOptions(f.path, f.src)));
  if (argv.length) return result('argv', argv);
  return { options: [], options_source: 'none', options_truncated: false };
}
