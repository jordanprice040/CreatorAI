import type { WorkspaceFileVersion } from '@creator/contracts';

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
  if (v.kind === 'code' && ext === 'svg' && !v.type_mismatch) return 'svg';
  return v.kind;
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
