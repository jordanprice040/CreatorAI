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
  'other',
]);
export type FileKind = z.infer<typeof FileKindSchema>;

/** Kinds shown as inert text (never run, never rendered as HTML). */
export const TEXT_KINDS: readonly FileKind[] = [
  'text',
  'markdown',
  'json',
  'csv',
  'code',
];

/** Longest text kept for viewing and search, in characters. Longer text is cut and says so. */
export const FILE_TEXT_MAX = 2_000_000;
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
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (WINDOWS_RESERVED.test(name)) name = `_${name}`;
  if (name.length > FILE_NAME_MAX) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = name.slice(0, FILE_NAME_MAX - ext.length).trimEnd() + ext;
  }
  return name || 'file';
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

/**
 * Decides what a file is from its bytes, using the name's extension only to choose among
 * text kinds. Valid UTF-8 without NUL bytes is text; HTML and SVG stay inert code. A name whose
 * extension promises an image or PDF the bytes are not is marked as a mismatch.
 */
export function inspectFile(name: string, bytes: Uint8Array): FileInspection {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const image = sniffImage(bytes);
  const pdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const promised = ext in IMAGE_EXT ? 'image' : ext === 'pdf' ? 'pdf' : null;
  if (image)
    return {
      kind: 'image',
      media_type: image,
      type_mismatch: promised !== 'image',
      text: null,
    };
  if (pdf)
    return {
      kind: 'pdf',
      media_type: 'application/pdf',
      type_mismatch: promised !== 'pdf',
      text: null,
    };
  let text: string | null = null;
  if (!bytes.includes(0)) {
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
        bytes,
      );
    } catch {
      text = null;
    }
  }
  if (text === null)
    return {
      kind: 'other',
      media_type: 'application/octet-stream',
      type_mismatch: promised !== null,
      text: null,
    };
  let kind: FileKind = EXT_KIND[ext] ?? (CODE_EXT.has(ext) ? 'code' : 'text');
  if (kind === 'json') {
    try {
      JSON.parse(text);
    } catch {
      kind = 'text';
    }
  }
  return {
    kind,
    media_type:
      kind === 'json'
        ? 'application/json'
        : kind === 'csv'
          ? 'text/csv'
          : kind === 'markdown'
            ? 'text/markdown'
            : 'text/plain',
    type_mismatch: promised !== null,
    text,
  };
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
