// A small Markdown reader for model answers in Chat. It turns text into a plain tree that
// markdown-view.tsx renders as React elements, so nothing in an answer is ever read as HTML:
// tags show as text, and a link keeps its href only when it is an absolute http(s) or mailto
// URL. It covers what chat models usually write (headings, paragraphs, bold, italic, code,
// lists, quotes, tables, rules, links) and leaves anything else as literal text.
// No imports, so the tests load it directly.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong' | 'em' | 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'heading'; level: number; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'rule' }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] };

/** Longest answer text read as Markdown; past it the tail is kept as plain text. */
export const MARKDOWN_MAX_CHARS = 200_000;
const MAX_DEPTH = 8;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+|$)/;
const TABLE_SEP = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

const blank = (l: string) => l.trim() === '';
const indentOf = (l: string) => l.length - l.trimStart().length;

/** A header row followed by a matching separator row, so a table can follow a text line. */
function startsTable(lines: string[], i: number) {
  const l = lines[i]!;
  const sep = lines[i + 1];
  return (
    l.includes('|') &&
    sep !== undefined &&
    sep.length <= 2000 &&
    TABLE_SEP.test(sep) &&
    cells(l).length === cells(sep).length
  );
}

function startsBlock(l: string) {
  return (
    FENCE.test(l) ||
    RULE.test(l) ||
    HEADING.test(l) ||
    QUOTE.test(l) ||
    ITEM.test(l)
  );
}

/** Only absolute web and mail links are kept; anything else (javascript:, data:, relative) is not. */
export function safeHref(raw: string): string | null {
  const s = raw.trim();
  if (!s || /[\s<>"]/.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return url.host ? url.href : null;
  }
  if (url.protocol === 'mailto:') return url.href;
  return null;
}

const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'lan',
  'home',
  'internal',
  'intranet',
  'home.arpa',
];

function publicHostName(raw: string): boolean {
  const host = raw.replace(/\.$/, '').toLowerCase();
  const labels = host.split('.');
  if (labels.length < 2 || host.length > 253) return false;
  if (labels.some((l) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l)))
    return false;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return false; // an IPv4 address
  return !LOCAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/**
 * Whether the desktop app hands this link to the system browser or mail app (ADR-0061). This
 * mirrors `external_link` in apps/desktop/src-tauri/src/external.rs, which decides; here it
 * only chooses between a clickable link and a copy-only address.
 */
export function desktopOpens(href: string): boolean {
  if (href.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') {
    return (
      !url.username &&
      !url.password &&
      !url.port &&
      publicHostName(url.hostname)
    );
  }
  if (url.protocol === 'mailto:') {
    const to = url.pathname;
    const at = to.indexOf('@');
    return (
      !url.search &&
      !url.hash &&
      !to.includes(',') &&
      !to.includes('%') &&
      at > 0 &&
      at === to.lastIndexOf('@') &&
      /^[A-Za-z0-9._+-]+$/.test(to.slice(0, at)) &&
      publicHostName(to.slice(at + 1))
    );
  }
  return false;
}

export function parseMarkdown(text: string): Block[] {
  const src = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  if (src.length <= MARKDOWN_MAX_CHARS) return blocks(src.split('\n'), 0);
  const head = blocks(src.slice(0, MARKDOWN_MAX_CHARS).split('\n'), 0);
  return [
    ...head,
    { t: 'para', c: [{ t: 'text', v: src.slice(MARKDOWN_MAX_CHARS) }] },
  ];
}

function blocks(lines: string[], depth: number): Block[] {
  if (depth >= MAX_DEPTH) {
    const v = lines.join('\n').trim();
    return v ? [{ t: 'para', c: [{ t: 'text', v }] }] : [];
  }
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1]!;
      const indent = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i]!;
        const t = l.trim();
        if (t.startsWith(mark[0]!.repeat(mark.length)) && /^(`+|~+)$/.test(t)) {
          i++;
          break;
        }
        body.push(l.slice(Math.min(indent, indentOf(l))));
        i++;
      }
      out.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: 'rule' });
      i++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      // Closing #s ("## Title ##") are not part of the title.
      const title = headingTitle(line.slice(heading[0].length).trim());
      out.push({ t: 'heading', level: heading[1]!.length, c: inline(title) });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && !blank(lines[i]!)) {
        const l = lines[i]!;
        if (QUOTE.test(l)) body.push(l.replace(QUOTE, ''));
        else if (startsBlock(l)) break;
        else body.push(l); // lazy continuation of the quoted paragraph
        i++;
      }
      out.push({ t: 'quote', c: blocks(body, depth + 1) });
      continue;
    }
    if (ITEM.test(line)) {
      i = list(lines, i, depth, out);
      continue;
    }
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      lines[i + 1]!.length <= 2000 &&
      TABLE_SEP.test(lines[i + 1]!)
    ) {
      const head = cells(line);
      const align = cells(lines[i + 1]!).map((c): Align => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      if (head.length === align.length) {
        i += 2;
        const rows: Inline[][][] = [];
        while (
          i < lines.length &&
          !blank(lines[i]!) &&
          lines[i]!.includes('|')
        ) {
          const row = cells(lines[i]!).slice(0, head.length);
          while (row.length < head.length) row.push('');
          rows.push(row.map((c) => inline(c)));
          i++;
        }
        out.push({ t: 'table', align, head: head.map((c) => inline(c)), rows });
        continue;
      }
    }
    const para: string[] = [];
    while (i < lines.length && !blank(lines[i]!)) {
      const l = lines[i]!;
      if (para.length > 0 && (startsBlock(l) || startsTable(lines, i))) break;
      para.push(l.trim());
      i++;
    }
    out.push({ t: 'para', c: inline(para.join('\n')) });
  }
  return out;
}

function list(lines: string[], i: number, depth: number, out: Block[]): number {
  const first = ITEM.exec(lines[i]!)!;
  const base = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: Block[][] = [];
  while (i < lines.length) {
    const m = ITEM.exec(lines[i]!);
    if (!m || m[1]!.length > base + 1 || m[1]!.length < base) break;
    if (/\d/.test(m[2]!) !== ordered) break;
    if (RULE.test(lines[i]!)) break;
    const content = m[0].length;
    const body = [lines[i]!.slice(content)];
    i++;
    while (i < lines.length) {
      const l = lines[i]!;
      if (blank(l)) {
        let j = i + 1;
        while (j < lines.length && blank(lines[j]!)) j++;
        if (j < lines.length && indentOf(lines[j]!) >= base + 2) {
          for (; i < j; i++) body.push('');
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind >= base + 2) {
        body.push(l.slice(Math.min(ind, content)));
      } else if (!startsBlock(l) && !blank(body[body.length - 1]!)) {
        body.push(l.trim()); // lazy continuation of the item's paragraph
      } else {
        break;
      }
      i++;
    }
    items.push(blocks(body, depth + 1));
    // A blank line between items of the same list keeps the list going.
    let j = i;
    while (j < lines.length && blank(lines[j]!)) j++;
    if (j > i && j < lines.length) {
      const next = ITEM.exec(lines[j]!);
      if (next && next[1]!.length >= base && next[1]!.length <= base + 1) i = j;
    }
  }
  out.push({
    t: 'list',
    ordered,
    start: ordered ? Number.parseInt(first[2]!, 10) : 1,
    items,
  });
  return i;
}

function cells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]!;
    if (ch === '\\' && s[k + 1] === '|') {
      cur += '|';
      k++;
    } else if (ch === '|') {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;

/** A heading's text without closing #s ("## Title ##"); a scan, not a regex, so it stays linear. */
function headingTitle(t: string): string {
  let end = t.length;
  while (end > 0 && t[end - 1] === '#') end--;
  if (end === t.length) return t;
  if (end === 0) return '';
  let start = end;
  while (start > 0 && /\s/.test(t[start - 1]!)) start--;
  return start < end ? t.slice(0, start) : t;
}

/** Inline Markdown: emphasis, code spans, links and line breaks. Unmatched marks stay as text. */
export function inline(s: string, depth = 0, inLink = false): Inline[] {
  const out: Inline[] = [];
  // Once a mark has no closer from some point on, it has none from any later point, so a
  // long run of unmatched marks is scanned once instead of once per mark.
  const none = new Map<string, number>();
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };
  // Inside a link's label nothing else becomes a link: an <a> can't hold another.
  const nested = (v: string, label = false) =>
    depth >= MAX_DEPTH
      ? [{ t: 'text', v } as Inline]
      : inline(v, depth + 1, inLink || label);
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1]!)) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '\n') {
      push({ t: 'br' });
      i++;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const ticks = '`'.repeat(n);
      let end = s.indexOf(ticks, i + n);
      while (end !== -1 && s[end + n] === '`') {
        let k = end;
        while (s[k] === '`') k++;
        end = s.indexOf(ticks, k);
      }
      if (end !== -1) {
        let v = s.slice(i + n, end).replace(/\n/g, ' ');
        if (v.length > 2 && v.startsWith(' ') && v.endsWith(' '))
          v = v.slice(1, -1);
        push({ t: 'code', v });
        i = end + n;
        continue;
      }
      text += ticks;
      i += n;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      const prev = i > 0 ? s[i - 1]! : ' ';
      const double = s[i + 1] === ch;
      // Intraword underscores (snake_case) are text, as in GitHub Markdown.
      const opens = !(ch === '_' && WORD.test(prev));
      if (ch === '~' && !double) {
        text += ch;
        i++;
        continue;
      }
      const mark = double ? ch + ch : ch;
      const after = s[i + mark.length];
      if (opens && after !== undefined && !/\s/.test(after)) {
        const end = closing(s, i + mark.length, mark, none);
        if (end !== -1) {
          const kind = ch === '~' ? 'del' : double ? 'strong' : 'em';
          push({ t: kind, c: nested(s.slice(i + mark.length, end)) });
          i = end + mark.length;
          continue;
        }
      }
      text += mark;
      i += mark.length;
      continue;
    }
    if (ch === '[' && !inLink) {
      const link = parseLink(s, i);
      if (link) {
        const label = nested(link.label, true);
        const href = safeHref(link.href);
        if (href) push({ t: 'link', href, c: label });
        else {
          // An unsafe or relative target keeps its words and drops the link.
          flush();
          out.push(...label);
        }
        i = link.end;
        continue;
      }
    }
    if (ch === '<' && !inLink) {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i));
      const href = m ? safeHref(m[1]!) : null;
      if (m && href) {
        push({ t: 'link', href, c: [{ t: 'text', v: m[1]! }] });
        i += m[0].length;
        continue;
      }
    }
    if (
      (ch === 'h' || ch === 'H') &&
      !inLink &&
      !WORD.test(i > 0 ? s[i - 1]! : ' ')
    ) {
      const m = /^https?:\/\/[^\s<>]+/i.exec(s.slice(i));
      if (m) {
        let raw = m[0];
        // Trailing sentence punctuation is not part of a bare link, nor is a ")" that
        // closes nothing in it. Parens are counted once, so a long ")" run stays linear.
        const open = count(raw, '(');
        let close = count(raw, ')');
        for (;;) {
          const last = raw[raw.length - 1]!;
          if (/[.,;:!?'"*_~]/.test(last)) raw = raw.slice(0, -1);
          else if (last === ')' && open < close) {
            raw = raw.slice(0, -1);
            close--;
          } else break;
        }
        const href = safeHref(raw);
        if (href) {
          push({ t: 'link', href, c: [{ t: 'text', v: raw }] });
          i += raw.length;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

const count = (s: string, c: string) => s.split(c).length - 1;

/** Where `mark` closes an emphasis opened before `from`: not after a space, not inside code. */
function closing(
  s: string,
  from: number,
  mark: string,
  none: Map<string, number>,
): number {
  if (from >= (none.get(mark) ?? Infinity)) return -1;
  let k = from;
  while (k < s.length) {
    const ch = s[k]!;
    if (ch === '\\') {
      k += 2;
      continue;
    }
    if (ch === '`') {
      let n = 1;
      while (s[k + n] === '`') n++;
      const end = s.indexOf('`'.repeat(n), k + n);
      k = end === -1 ? k + n : end + n;
      continue;
    }
    if (s.startsWith(mark, k) && !/\s/.test(s[k - 1]!) && k > from) {
      // In a longer run ("***"), the closer is the run's last marks, so "**a *b***" nests.
      let run = k;
      while (s[run] === mark[0]) run++;
      if (mark.length === 2 && run - k > 2) k = run - 2;
      const nextCh = s[k + mark.length];
      // A single * or _ next to another of the same mark belongs to a ** pair, not to us.
      if (mark.length === 1 && nextCh === mark) {
        const close = closing(s, k + 2, mark + mark, none);
        if (close !== -1) {
          k = close + 2;
          continue;
        }
      }
      if (mark[0] === '_' && nextCh !== undefined && WORD.test(nextCh)) {
        k++;
        continue;
      }
      return k;
    }
    k++;
  }
  none.set(mark, Math.min(from, none.get(mark) ?? Infinity));
  return -1;
}

function parseLink(
  s: string,
  i: number,
): { label: string; href: string; end: number } | null {
  let depth = 0;
  let k = i;
  // A link label is short; an unmatched [ only looks this far ahead.
  const limit = Math.min(s.length, i + 1000);
  for (; k < limit; k++) {
    const ch = s[k]!;
    if (ch === '\\') {
      k++;
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) break;
  }
  if (k >= limit || s[k + 1] !== '(') return null;
  const m =
    /^\(\s*<?([^\s()<>]*(?:\([^\s()<>]*\)[^\s()<>]*)*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(
      s.slice(k + 1),
    );
  if (!m) return null;
  return { label: s.slice(i + 1, k), href: m[1]!, end: k + 1 + m[0].length };
}
