import {
  zip64Extra,
  zipEntries,
  zipLayoutProblem,
  type WorkspaceFileVersion,
} from '@creator/contracts';

// ADR-0106: which inert viewer a file version opens in. Pure, so it is unit-tested. The kind
// comes from the studio's own look at the bytes; the name's extension only picks a code
// language, and opens a viewer for files uploaded before the studio knew Office kinds (those
// were stored as "other"). Every viewer parses the bytes itself and shows an error, never the
// file's own scripts, when they are not what the kind says.

export type Viewer =
  | 'image'
  | 'svg'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'archive'
  | 'markdown'
  | 'json'
  | 'csv'
  | 'code'
  | 'text'
  | 'none';

export const KIND_TEXT: Record<WorkspaceFileVersion['kind'], string> = {
  text: 'Text',
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'CSV',
  code: 'Code',
  image: 'Image',
  pdf: 'PDF',
  document: 'Word document',
  spreadsheet: 'Spreadsheet',
  presentation: 'Presentation',
  archive: 'ZIP archive',
  other: 'Other',
};

/** Code longer than this is shown without colours, so a large file stays quick to open. */
export const HIGHLIGHT_MAX_CHARS = 400_000;
/** Rows and columns a spreadsheet sheet shows; the download has all of them. */
export const SHEET_MAX_ROWS = 1000;
export const SHEET_MAX_COLS = 100;

/**
 * Review L-1: an Office file is a ZIP, and its parts are inflated in the page. Before a viewer
 * opens one, the sizes its central directory declares must stay under these, so a small file
 * that inflates to gigabytes is refused instead of freezing the tab.
 */
export const OFFICE_PART_MAX_BYTES = 64 * 1024 * 1024;
export const OFFICE_TOTAL_MAX_BYTES = 256 * 1024 * 1024;

const OFFICE_TOO_LARGE =
  'This file expands to more than the studio opens in the page. Download the original to open it.';
const OFFICE_DAMAGED =
  'The studio could not read this file; it may be damaged. Download the original to open it.';

/**
 * Why an Office file (a ZIP) is too large to open in the studio by the sizes its central
 * directory declares, or null when they are within bounds. Bytes that are not a ZIP (an old
 * .xls) are left to their viewer; a ZIP whose central directory cannot be read is refused.
 */
export function officeRefusal(bytes: Uint8Array): string | null {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  // A ZIP whose directory the studio cannot read (ZIP64, damaged) is not handed to a viewer.
  const list = zipEntries(bytes);
  if (!list) return OFFICE_TOO_LARGE;
  // Review 4 L-1: one unambiguous layout, so every reader sees the parts checked here.
  if (zipLayoutProblem(bytes)) return OFFICE_DAMAGED;
  if (list.more || list.entries.length < list.total) return OFFICE_TOO_LARGE;
  let total = 0;
  for (const e of list.entries) {
    if (e.size === null || e.size > OFFICE_PART_MAX_BYTES)
      return OFFICE_TOO_LARGE;
    total += e.size;
  }
  return total > OFFICE_TOTAL_MAX_BYTES ? OFFICE_TOO_LARGE : null;
}

/** Compressed bytes handed to the inflater at a time, so one step makes at most ~4 MiB. */
const INFLATE_SLICE = 4096;

/**
 * Inflates raw deflate data natively, counting what comes out, and stops as soon as it passes
 * `limit`. Returns the output (or only its size when `keep` is false), or null when it went
 * past the limit.
 */
async function inflated(
  data: Uint8Array,
  limit: number,
  into: Uint8Array | null,
): Promise<number | null> {
  let at = 0;
  const input = new ReadableStream<BufferSource>(
    {
      pull(c) {
        if (at >= data.length) c.close();
        else {
          c.enqueue(data.slice(at, at + INFLATE_SLICE));
          at += INFLATE_SLICE;
        }
      },
    },
    { highWaterMark: 0 },
  );
  const reader = input
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.byteLength > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    // Review 7 N-1: written straight into its place in the re-packed ZIP, not kept apart.
    into?.set(value, n);
    n += value.byteLength;
  }
  return n;
}

/**
 * Review 6: a fresh ZIP of stored parts, written by the studio, for SheetJS to read instead of
 * the original file. SheetJS then never parses a header the file's author wrote: every part
 * is one the check inflated and counted, at the size it counted. Review 7 N-2: each name is
 * copied byte for byte from the part's local header (which the check found to name the same
 * part as its central entry), with its UTF-8 flag. CRCs are left 0: SheetJS does not check
 * them, and these bytes go nowhere else. Review 7 N-1: the buffer is allocated once, from the
 * declared sizes (each already checked to be at least the real one), and each part is inflated
 * straight into its place.
 */
class StoredZip {
  readonly out: Uint8Array<ArrayBuffer>;
  private at = 0;
  private readonly central: {
    name: Uint8Array;
    flags: number;
    size: number;
    offset: number;
  }[] = [];
  constructor(capacity: number) {
    this.out = new Uint8Array(capacity);
  }
  /** Writes a local header; the caller then writes the part's bytes at `data`, up to `room`. */
  begin(name: Uint8Array, flags: number): number {
    this.out.set(name, this.at + 30);
    this.central.push({ name, flags, size: 0, offset: this.at });
    return this.at + 30 + name.length;
  }
  end(size: number): void {
    const e = this.central[this.central.length - 1]!;
    const v = new DataView(this.out.buffer);
    v.setUint32(this.at, 0x04034b50, true);
    v.setUint16(this.at + 4, 20, true);
    v.setUint16(this.at + 6, e.flags, true);
    v.setUint32(this.at + 18, size, true);
    v.setUint32(this.at + 22, size, true);
    v.setUint16(this.at + 26, e.name.length, true);
    e.size = size;
    this.at += 30 + e.name.length + size;
  }
  finish(): ArrayBuffer {
    const v = new DataView(this.out.buffer);
    const start = this.at;
    for (const e of this.central) {
      const c = this.at;
      v.setUint32(c, 0x02014b50, true);
      v.setUint16(c + 4, 20, true);
      v.setUint16(c + 6, 20, true);
      v.setUint16(c + 8, e.flags, true);
      v.setUint32(c + 20, e.size, true);
      v.setUint32(c + 24, e.size, true);
      v.setUint16(c + 28, e.name.length, true);
      v.setUint32(c + 42, e.offset, true);
      this.out.set(e.name, c + 46);
      this.at += 46 + e.name.length;
    }
    v.setUint32(this.at, 0x06054b50, true);
    v.setUint16(this.at + 8, this.central.length, true);
    v.setUint16(this.at + 10, this.central.length, true);
    v.setUint32(this.at + 12, this.at - start, true);
    v.setUint32(this.at + 16, start, true);
    this.at += 22;
    // Only when a part inflated to less than it declared is there room left over to cut.
    return this.at === this.out.length
      ? this.out.buffer
      : this.out.buffer.slice(0, this.at);
  }
}

/**
 * Review 3 L-1: JSZip reads a part by its central directory entry, SheetJS by its local header
 * (method, flags, name, and ZIP64 sizes from either). So the two must say the same thing, or
 * the check here could count one part while a viewer inflates another: the method, the
 * data-descriptor flag (and no encryption), the name, and (when the sizes are not after the
 * data) both sizes must agree. Review 4 N-1: a ZIP64 extra field (written by some .NET tools)
 * is accepted when its sizes are the same ones; review 5 narrows what a part with a data
 * descriptor may say (below).
 */
function localDisagrees(
  bytes: Uint8Array,
  view: DataView,
  e: {
    name: string;
    method: number;
    flags: number;
    zip64: { size: number; compressed: number } | null;
    extraMalformed: boolean;
    size: number | null;
    compressed: number | null;
    offset: number | null;
  },
): boolean {
  const at = e.offset!;
  const flags = view.getUint16(at + 6, true);
  if ((flags | e.flags) & 0x2041) return true;
  if ((flags & 0x08) !== (e.flags & 0x08)) return true;
  if (view.getUint16(at + 8, true) !== e.method) return true;
  if (
    e.zip64 &&
    (e.zip64.size !== e.size || e.zip64.compressed !== e.compressed)
  )
    return true;
  const nameLen = view.getUint16(at + 26, true);
  const extraLen = view.getUint16(at + 28, true);
  if (at + 30 + nameLen + extraLen > bytes.length) return true;
  // Review 5 L-1: SheetJS sizes its output buffer from the local header's uncompressed size
  // (its ZIP64 value when that is non-zero, else the 32-bit field), whether or not the sizes
  // also follow the data. So the sizes it will use must be 0 (a streaming writer's "unknown",
  // which SheetJS grows from) or the central ones, with or without a data descriptor.
  const localExtra = zip64Extra(view, at + 30 + nameLen, extraLen);
  // Review 6: an extra area that could be read two ways (short or repeated ZIP64 fields, a
  // partial field at the end) is refused, here and in the central entry.
  if (e.extraMalformed || localExtra.malformed) return true;
  const local64 = localExtra.zip64;
  const used = (field: number, wide: number | null | undefined) =>
    wide ? wide : view.getUint32(at + field, true);
  const sizeOk = (v: number, want: number | null) => v === 0 || v === want;
  if (
    !sizeOk(used(22, local64?.size), e.size) ||
    !sizeOk(used(18, local64?.compressed), e.compressed)
  )
    return true;
  // Without a data descriptor the local header is the only record of the sizes: it must
  // carry them (a ZIP64 value, when present, too).
  if (!(flags & 0x08)) {
    if (
      used(22, local64?.size) !== e.size ||
      used(18, local64?.compressed) !== e.compressed
    )
      return true;
  }
  const raw = bytes.subarray(at + 30, at + 30 + nameLen);
  const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(raw);
  return name !== e.name;
}

/**
 * Re-review L-1: the sizes a ZIP declares can lie, and JSZip, docx-preview and SheetJS inflate
 * a whole part before they compare it. So before an Office viewer opens a file, every part is
 * inflated once here (natively, a slice at a time, counting the output) and the file is
 * refused as soon as a part passes its declared size or 64 MiB, or all parts pass 256 MiB.
 * Nothing inflated is kept. Null when the viewer may open the file.
 */
export async function officeCheck(bytes: Uint8Array): Promise<string | null> {
  return (await officeOpen(bytes, false)).refusal;
}

/**
 * officeCheck, and for spreadsheets (`repack`) also a fresh stored ZIP of the parts it checked
 * (StoredZip), which is what SheetJS is given. `repacked` is absent when the bytes are not a
 * ZIP (an old .xls, which SheetJS reads as a compound file).
 */
export async function officeOpen(
  bytes: Uint8Array,
  repack: boolean,
): Promise<{ refusal: string | null; repacked?: ArrayBuffer }> {
  const declared = officeRefusal(bytes);
  if (declared || bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return { refusal: declared };
  const refuse = (refusal: string) => ({ refusal });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = zipEntries(bytes)!.entries;
  let capacity = 22;
  for (const e of entries) {
    if (e.offset === null || e.compressed === null || e.size === null)
      return refuse(OFFICE_TOO_LARGE);
    if (e.offset + 30 > bytes.length) return refuse(OFFICE_DAMAGED);
    // The re-packed part: local and central headers with the local name, and its data.
    if (!e.dir)
      capacity += 76 + 2 * view.getUint16(e.offset + 26, true) + e.size;
  }
  let zip: StoredZip | null = null;
  let total = 0;
  for (const e of entries) {
    const at = e.offset!;
    if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50)
      return refuse(OFFICE_DAMAGED);
    if (localDisagrees(bytes, view, e)) return refuse(OFFICE_DAMAGED);
    const nameLen = view.getUint16(at + 26, true);
    const start = at + 30 + nameLen + view.getUint16(at + 28, true);
    if (start + e.compressed! > bytes.length) return refuse(OFFICE_DAMAGED);
    const limit = Math.min(e.size!, OFFICE_TOTAL_MAX_BYTES - total);
    const raw = bytes.subarray(start, start + e.compressed!);
    let into: Uint8Array | null = null;
    if (repack && !e.dir) {
      zip ??= new StoredZip(capacity);
      const data = zip.begin(
        bytes.slice(at + 30, at + 30 + nameLen),
        view.getUint16(at + 6, true) & 0x800,
      );
      into = zip.out.subarray(data, data + limit);
    }
    let size: number | null;
    if (e.method === 0) {
      size = raw.length > limit ? null : raw.length;
      if (size !== null) into?.set(raw);
    } else if (e.method === 8)
      try {
        size = await inflated(raw, limit, into);
      } catch {
        return refuse(OFFICE_DAMAGED);
      }
    // Office files use only stored and deflated parts; the viewers read nothing else.
    else return refuse(OFFICE_DAMAGED);
    if (size === null) return refuse(OFFICE_TOO_LARGE);
    total += size;
    if (into) zip!.end(size);
  }
  if (!repack) return { refusal: null };
  return { refusal: null, repacked: (zip ?? new StoredZip(22)).finish() };
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Kinds stored as "other" before ADR-0106, by extension; only when nothing disagreed. */
const LEGACY: Record<string, Viewer> = {
  docx: 'document',
  docm: 'document',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  xls: 'spreadsheet',
  pptx: 'presentation',
  pptm: 'presentation',
  zip: 'archive',
};

export function viewerFor(
  v: Pick<
    WorkspaceFileVersion,
    'kind' | 'media_type' | 'has_text' | 'type_mismatch'
  >,
  name: string,
): Viewer {
  const ext = extensionOf(name);
  switch (v.kind) {
    case 'image':
    case 'pdf':
    case 'document':
    case 'spreadsheet':
    case 'presentation':
    case 'archive':
      return v.kind;
    case 'other':
      return (!v.type_mismatch && LEGACY[ext]) || 'none';
  }
  if (!v.has_text) return 'none';
  // An .svg whose text has no <svg> element is flagged as a mismatch at upload and shown as
  // source. Files stored before that check are drawn; one that does not draw falls back to its
  // source. Either way it is drawn only as an image from a data: URL (files.tsx).
  if (v.kind === 'code' && ext === 'svg' && !v.type_mismatch) return 'svg';
  return v.kind;
}

/**
 * Review H-1: an SVG's picture URL. A data: URL has an opaque origin, so if it is opened as a
 * page its scripts run with no studio cookie, CSRF token or API access (never as the studio).
 */
export function svgDataUrl(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** Why a file has no viewer, in words. */
export function noViewerText(name: string): string {
  const ext = extensionOf(name);
  if (ext === 'doc' || ext === 'ppt')
    return `Older ${ext === 'doc' ? 'Word' : 'PowerPoint'} files (.${ext}) can’t be shown here. Download the original, or save it as .${ext}x and upload that.`;
  return 'The studio has no viewer for this kind of file. Download the original to open it.';
}

/** highlight.js language names by extension (all registered in code-view.tsx). */
const LANGUAGE: Record<string, string> = {
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  ps1: 'powershell',
  bat: 'dos',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  css: 'css',
  scss: 'scss',
  xml: 'xml',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  r: 'r',
  swift: 'swift',
  lua: 'lua',
  json: 'json',
  md: 'markdown',
  markdown: 'markdown',
};

/** Shown next to the code: "Python", "HTML"… */
const LANGUAGE_TEXT: Record<string, string> = {
  python: 'Python',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  kotlin: 'Kotlin',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  ruby: 'Ruby',
  php: 'PHP',
  bash: 'Shell',
  powershell: 'PowerShell',
  dos: 'Batch',
  sql: 'SQL',
  yaml: 'YAML',
  ini: 'Settings',
  css: 'CSS',
  scss: 'SCSS',
  xml: 'XML',
  r: 'R',
  swift: 'Swift',
  lua: 'Lua',
  json: 'JSON',
  markdown: 'Markdown',
};

export function codeLanguage(
  name: string,
  kind: string,
): { id: string; label: string } | null {
  const ext = extensionOf(name);
  const id = kind === 'json' ? 'json' : LANGUAGE[ext];
  if (!id) return null;
  const label =
    ext === 'html' || ext === 'htm'
      ? 'HTML'
      : ext === 'svg'
        ? 'SVG'
        : ext === 'toml'
          ? 'TOML'
          : (LANGUAGE_TEXT[id] ?? id);
  return { id, label };
}

/** "1 line", "1,204 lines". */
export function linesText(n: number): string {
  return `${n.toLocaleString('en-US')} line${n === 1 ? '' : 's'}`;
}
