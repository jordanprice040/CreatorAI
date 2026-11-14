import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeb } from './web-module.js';

// ADR-0106: which inert viewer a file opens in comes from the studio's kind; the extension only
// picks a code language and opens files stored as "other" before Office kinds existed.

type V = {
  kind: string;
  media_type: string;
  has_text: boolean;
  type_mismatch: boolean;
};
type Rules = {
  viewerFor(v: V, name: string): string;
  codeLanguage(
    name: string,
    kind: string,
  ): { id: string; label: string } | null;
  noViewerText(name: string): string;
  linesText(n: number): string;
  KIND_TEXT: Record<string, string>;
};
const rules = () => loadWeb('file-viewer-rules.ts') as Promise<Rules>;
const v = (kind: string, more: Partial<V> = {}): V => ({
  kind,
  media_type: 'text/plain',
  has_text: ['text', 'markdown', 'json', 'csv', 'code'].includes(kind),
  type_mismatch: false,
  ...more,
});

test('each kind opens its own viewer', async () => {
  const r = await rules();
  assert.equal(r.viewerFor(v('pdf'), 'a.pdf'), 'pdf');
  assert.equal(r.viewerFor(v('pdf'), 'a.txt'), 'pdf');
  assert.equal(r.viewerFor(v('document'), 'a.docx'), 'document');
  assert.equal(r.viewerFor(v('spreadsheet'), 'a.xls'), 'spreadsheet');
  assert.equal(r.viewerFor(v('presentation'), 'a.pptx'), 'presentation');
  assert.equal(r.viewerFor(v('archive'), 'a.zip'), 'archive');
  assert.equal(r.viewerFor(v('image'), 'a.png'), 'image');
  assert.equal(r.viewerFor(v('code'), 'a.py'), 'code');
  assert.equal(r.viewerFor(v('json'), 'a.json'), 'json');
  assert.equal(r.viewerFor(v('markdown'), 'a.md'), 'markdown');
  assert.equal(r.viewerFor(v('text'), 'a.txt'), 'text');
  // A text kind whose text was not kept has no viewer.
  assert.equal(r.viewerFor(v('text', { has_text: false }), 'a.txt'), 'none');
  // Every kind has a label; code is no longer "shown as text".
  for (const k of [
    'text',
    'markdown',
    'json',
    'csv',
    'code',
    'image',
    'pdf',
    'document',
    'spreadsheet',
    'presentation',
    'archive',
    'other',
  ])
    assert.ok(r.KIND_TEXT[k]);
  assert.equal(r.KIND_TEXT.code, 'Code');
});

test('SVG is drawn as a picture only when it really is SVG', async () => {
  const r = await rules();
  assert.equal(
    r.viewerFor(v('code', { media_type: 'image/svg+xml' }), 'logo.svg'),
    'svg',
  );
  assert.equal(
    r.viewerFor(v('code', { type_mismatch: true }), 'logo.svg'),
    'code',
  );
  assert.equal(r.viewerFor(v('code'), 'page.html'), 'code');
});

test('files stored as "other" before Office kinds open by extension unless flagged', async () => {
  const r = await rules();
  const other = v('other', { media_type: 'application/octet-stream' });
  assert.equal(r.viewerFor(other, 'old.docx'), 'document');
  assert.equal(r.viewerFor(other, 'old.XLSX'), 'spreadsheet');
  assert.equal(r.viewerFor(other, 'old.pptx'), 'presentation');
  assert.equal(r.viewerFor(other, 'old.zip'), 'archive');
  assert.equal(r.viewerFor(other, 'blob.bin'), 'none');
  // A new upload whose bytes are not what its .docx name says is flagged and not opened.
  assert.equal(
    r.viewerFor({ ...other, type_mismatch: true }, 'fake.docx'),
    'none',
  );
  assert.match(r.noViewerText('old.doc'), /Older Word files \(\.doc\).*\.docx/);
  assert.match(r.noViewerText('slides.ppt'), /PowerPoint.*\.pptx/);
  assert.match(r.noViewerText('x.bin'), /no viewer/);
});

test('code languages and their labels', async () => {
  const r = await rules();
  assert.deepEqual(r.codeLanguage('main.py', 'code'), {
    id: 'python',
    label: 'Python',
  });
  assert.deepEqual(r.codeLanguage('index.html', 'code'), {
    id: 'xml',
    label: 'HTML',
  });
  assert.deepEqual(r.codeLanguage('logo.svg', 'code'), {
    id: 'xml',
    label: 'SVG',
  });
  assert.deepEqual(r.codeLanguage('Setup.PS1', 'code'), {
    id: 'powershell',
    label: 'PowerShell',
  });
  assert.equal(r.codeLanguage('data.txt', 'json')?.id, 'json');
  assert.equal(r.codeLanguage('README', 'code'), null);
  assert.equal(r.linesText(1), '1 line');
  assert.equal(r.linesText(1204), '1,204 lines');
});
