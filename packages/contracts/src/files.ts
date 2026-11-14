import { z, id, timestamp } from './primitives.js';

// P05 (R19, ADR-0072): workspace files. An upload keeps its exact original bytes, their SHA-256,
// size and the name and type it arrived with. A file has numbered immutable versions. The
// studio inspects bytes itself: the browser's declared type is recorded but never trusted.
// Uploading never shares a file with a model provider and never makes it evidence.

/** What the studio can show a file as. Anything else is kept and downloadable only. */
export const FileKindSchema = z.enum([
  'text',
  'markdown',
  'json',
  'csv',
  'code',
  'image',
  'pdf',
  // ADR-0106: Office files and ZIP archives, recognised from the archive's own entries.
  'document',
  'spreadsheet',
  'presentation',
  'archive',
  'other',
]);
export type FileKind = z.infer<typeof FileKindSchema>;

/** Longest text kept for viewing and search, in characters. Longer text is cut and says so. */
export const FILE_TEXT_MAX = 2_000_000;
/** The per-file limit when the deployment sets none (CREATOR_FILE_MAX_BYTES). */
export const FILE_MAX_BYTES_DEFAULT = 25 * 1024 * 1024;
/** Longest display name. */
export const FILE_NAME_MAX = 200;

export const WorkspaceFileVersionSchema = z.strictObject({
  version: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size_bytes: z.number().int().min(0),
  kind: FileKindSchema,
  /** The media type the studio found from the bytes. */
  media_type: z.string().max(100),
  /** What the browser said it was; recorded, not trusted. */
  declared_type: z.string().max(200).nullable(),
  /** The name exactly as it arrived (control characters removed), for provenance. */
  original_name: z.string().max(500),
  /** The file name's extension disagreed with the bytes (for example a .png that is not one). */
  type_mismatch: z.boolean(),
  /** Text was kept for viewing and search; false for binary kinds. */
  has_text: z.boolean(),
  text_truncated: z.boolean(),
  created_by: id,
  created_at: timestamp,
});
export type WorkspaceFileVersion = z.infer<typeof WorkspaceFileVersionSchema>;

export const WorkspaceFileSchema = z.strictObject({
  id,
  workspace_id: id,
  name: z.string().min(1).max(FILE_NAME_MAX),
  status: z.enum(['active', 'deleted']),
  current_version: z.number().int().min(1),
  current: WorkspaceFileVersionSchema,
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
  deleted_at: timestamp.nullable(),
  /** Records this file is linked to (sources, projects, runs…), by id and kind. */
  links: z
    .array(
      z.strictObject({
        entity_id: id,
        kind: z.string().max(60),
        title: z.string().max(300),
      }),
    )
    .max(50),
});
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;

export const WorkspaceFileDetailSchema = z.strictObject({
  file: WorkspaceFileSchema,
  versions: z.array(WorkspaceFileVersionSchema),
});
export type WorkspaceFileDetail = z.infer<typeof WorkspaceFileDetailSchema>;

export const FileUploadResultSchema = z.strictObject({
  /** False when nothing new was stored: the same bytes are already in the library. */
  stored: z.boolean(),
  /** The request repeated an upload key already used for these bytes; the earlier result. */
  replayed: z.boolean(),
  file: WorkspaceFileSchema,
  /** An active file whose current version has these exact bytes, when one exists. */
  duplicate_of: WorkspaceFileSchema.nullable(),
});
export type FileUploadResult = z.infer<typeof FileUploadResultSchema>;

export const FileSortSchema = z.enum(['newest', 'oldest', 'name']);
export type FileSort = z.infer<typeof FileSortSchema>;

export const WorkspaceFilePageSchema = z.strictObject({
  items: z.array(
    WorkspaceFileSchema.extend({
      /** First matching lines of text when a search term was given (1-based line numbers). */
      matches: z
        .array(
          z.strictObject({
            line: z.number().int().min(1),
            text: z.string().max(300),
          }),
        )
        .max(3),
    }),
  ),
  next_cursor: z.string().max(400).nullable(),
  /** Bytes held by this workspace's files, every version, deleted ones included until purged. */
  used_bytes: z.number().int().min(0),
  limit_bytes: z.number().int().min(0),
  file_limit_bytes: z.number().int().min(0),
});
export type WorkspaceFilePage = z.infer<typeof WorkspaceFilePageSchema>;

export const FileTextViewSchema = z.strictObject({
  kind: FileKindSchema,
  version: z.number().int().min(1),
  text: z.string(),
  truncated: z.boolean(),
});
export type FileTextView = z.infer<typeof FileTextViewSchema>;

export const FileRenameRequestSchema = z.strictObject({
  expected_version: z.number().int().min(1),
  name: z.string().trim().min(1).max(FILE_NAME_MAX),
});
export const FileLinkRequestSchema = z.strictObject({
  entity_id: id,
  linked: z.boolean(),
});
export const FileStatusRequestSchema = z.strictObject({
  reason: z.string().trim().max(300).default(''),
});

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * A safe display name from whatever the browser sent: the last path part only, no control or
 * reserved characters, no leading/trailing dots or spaces, no Windows device names, at most
 * FILE_NAME_MAX characters with the extension kept. Never empty.
 */
export function safeFileName(raw: string): string {
  const last = raw.split(/[\\/]/).pop() ?? '';
  let name = last
    .normalize('NFC')
    // C0/C1 controls, DEL, reserved characters, and invisible format characters (bidi
    // overrides and isolates, zero-width marks, BOM) that could disguise the real extension
    // (PR #141 review L1).
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"|?*]|\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.]+$/, '')
    // One leading dot is kept when a name follows it, so `.env` stays a dotfile (review N2).
    .replace(/^\s+/, '')
    .replace(/^\.+(?=\.)|^\.+$/, '');
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > FILE_NAME_MAX) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, FILE_NAME_MAX - ext.length).trimEnd() + ext;
  }
  return name || 'file';
}

/**
 * Cuts text to at most `max` UTF-16 units without splitting a surrogate pair, which would
 * otherwise reach PostgreSQL as a lone half (review N1).
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const c = text.charCodeAt(max - 1);
  return text.slice(0, c >= 0xd800 && c <= 0xdbff ? max - 1 : max);
}

/** `name (2).ext`, `name (3).ext`… for a display name already in use. */
export function numberedName(name: string, n: number): string {
  const dot = name.lastIndexOf('.');
  const [base, ext] =
    dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  const suffix = ` (${n})`;
  return safeFileName(
    `${base.slice(0, FILE_NAME_MAX - ext.length - suffix.length)}${suffix}${ext}`,
  );
}

const EXT_KIND: Record<string, FileKind> = {
  txt: 'text',
  log: 'text',
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  csv: 'csv',
  tsv: 'csv',
};
const CODE_EXT = new Set([
  'py',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'rs',
  'go',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'rb',
  'php',
  'sh',
  'bash',
  'ps1',
  'bat',
  'sql',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'css',
  'scss',
  'xml',
  'html',
  'htm',
  'svg',
  'r',
  'swift',
  'lua',
]);
const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export type FileInspection = {
  kind: FileKind;
  media_type: string;
  type_mismatch: boolean;
  /** Decoded text for text kinds; null for binary. */
  text: string | null;
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) =>
  b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);

/** The raster image type the bytes really are, or null. */
export function sniffImage(b: Uint8Array): string | null {
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (
    startsWith(b, [0x47, 0x49, 0x46, 0x38]) &&
    (b[4] === 0x37 || b[4] === 0x39) &&
    b[5] === 0x61
  )
    return 'image/gif';
  if (
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(b, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return 'image/webp';
  return null;
}

/** One entry of a ZIP archive's central directory. Sizes are null when stored as ZIP64. */
export type ZipEntry = {
  name: string;
  size: number | null;
  compressed: number | null;
  dir: boolean;
};
/** Entries listed beyond this are not read; the listing says it stopped. */
export const ZIP_ENTRY_MAX = 5000;

/**
 * ADR-0106: the names and sizes in a ZIP archive's central directory, without inflating
 * anything (so a ZIP bomb costs nothing to list). Null when the bytes are not a readable ZIP.
 * `more` is true when the archive holds more than ZIP_ENTRY_MAX entries.
 */
export function zipEntries(
  b: Uint8Array,
): { entries: ZipEntry[]; total: number; more: boolean } | null {
  if (
    !startsWith(b, [0x50, 0x4b, 0x03, 0x04]) &&
    !startsWith(b, [0x50, 0x4b, 0x05, 0x06])
  )
    return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const total = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (at === 0xffffffff || at >= b.length) return null;
  const entries: ZipEntry[] = [];
  const utf8 = new TextDecoder('utf-8');
  const latin = new TextDecoder('latin1');
  for (let n = 0; n < total && n < ZIP_ENTRY_MAX; n++) {
    if (at + 46 > b.length || view.getUint32(at, true) !== 0x02014b50)
      return null;
    const flags = view.getUint16(at + 8, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    if (at + 46 + nameLen > b.length) return null;
    const raw = b.subarray(at + 46, at + 46 + nameLen);
    const name = (flags & 0x800 ? utf8 : latin).decode(raw);
    entries.push({
      name,
      size: size === 0xffffffff ? null : size,
      compressed: compressed === 0xffffffff ? null : compressed,
      dir: name.endsWith('/'),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, total, more: total > ZIP_ENTRY_MAX };
}

const OOXML: readonly [string, FileKind, string][] = [
  [
    'word/document.xml',
    'document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  [
    'xl/workbook.xml',
    'spreadsheet',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  [
    'ppt/presentation.xml',
    'presentation',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
];
/** What a name's extension promises, for the kinds the studio sniffs from bytes. */
const PROMISED: Record<string, FileKind> = {
  pdf: 'pdf',
  docx: 'document',
  docm: 'document',
  xlsx: 'spreadsheet',
  xlsm: 'spreadsheet',
  xls: 'spreadsheet',
  pptx: 'presentation',
  pptm: 'presentation',
  zip: 'archive',
};
/** The old binary Office container (OLE compound file). */
const CFB = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Text in UTF-8 (BOM optional, no NUL bytes) or UTF-16 with a byte-order mark; else null. */
export function decodeText(bytes: Uint8Array): string | null {
  const utf16 = startsWith(bytes, [0xff, 0xfe])
    ? 'utf-16le'
    : startsWith(bytes, [0xfe, 0xff])
      ? 'utf-16be'
      : null;
  try {
    if (utf16) {
      if (bytes.length % 2 !== 0) return null;
      const text = new TextDecoder(utf16, { fatal: true }).decode(bytes);
      // A UTF-16 file of text has no NUL characters; binary that starts FF FE usually does.
      return text.includes('\u0000') ? null : text;
    }
    if (bytes.includes(0)) return null;
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch {
    return null;
  }
}

/**
 * Decides what a file is from its bytes, using the name's extension only to choose among
 * text kinds. Text is valid UTF-8 without NUL bytes, or UTF-16 with a byte-order mark; HTML and
 * SVG stay inert code. ZIP archives are told apart by their entries (Word, Excel, PowerPoint or
 * a plain archive). A name whose extension promises something the bytes are not is marked as
 * a mismatch (ADR-0106 adds Office files, invalid JSON, and .svg or .html text that is not).
 */
export function inspectFile(name: string, bytes: Uint8Array): FileInspection {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const image = sniffImage(bytes);
  const promised: FileKind | null =
    ext in IMAGE_EXT ? 'image' : (PROMISED[ext] ?? null);
  const binary = (kind: FileKind, media_type: string): FileInspection => ({
    kind,
    media_type,
    type_mismatch: promised !== kind,
    text: null,
  });
  if (image) return binary('image', image);
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return binary('pdf', 'application/pdf');
  const zip = zipEntries(bytes);
  if (zip) {
    const names = new Set(zip.entries.map((e) => e.name));
    const office = names.has('[Content_Types].xml')
      ? OOXML.find(([part]) => names.has(part))
      : undefined;
    return office
      ? binary(office[1], office[2])
      : binary('archive', 'application/zip');
  }
  // Only .xls is opened from the old binary format; .doc and .ppt stay download-only.
  if (startsWith(bytes, CFB) && ext === 'xls')
    return binary('spreadsheet', 'application/vnd.ms-excel');
  const text = decodeText(bytes);
  if (text === null)
    return {
      kind: 'other',
      media_type: 'application/octet-stream',
      type_mismatch: promised !== null,
      text: null,
    };
  let kind: FileKind = EXT_KIND[ext] ?? (CODE_EXT.has(ext) ? 'code' : 'text');
  let mismatch = promised !== null;
  if (kind === 'json') {
    try {
      JSON.parse(text);
    } catch {
      kind = 'text';
      mismatch = true;
    }
  }
  let media_type =
    kind === 'json'
      ? 'application/json'
      : kind === 'csv'
        ? 'text/csv'
        : kind === 'markdown'
          ? 'text/markdown'
          : 'text/plain';
  if (ext === 'svg') {
    if (/<svg[\s>]/i.test(text)) media_type = 'image/svg+xml';
    else mismatch = true;
  }
  if (ext === 'html' || ext === 'htm') {
    if (/<[a-z!][^>]*>/i.test(text)) media_type = 'text/html';
    else mismatch = true;
  }
  return { kind, media_type, type_mismatch: mismatch, text };
}

/** A byte count in words: "512 bytes", "3.2 KiB", "25 MiB", "2 GiB". */
export function bytesText(n: number): string {
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  if (n < 1024) return `${n} byte${n === 1 ? '' : 's'}`;
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
