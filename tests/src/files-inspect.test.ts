import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesText,
  inspectFile,
  numberedName,
  safeFileName,
} from '@creator/contracts';

// ADR-0072: names and kinds come from the studio's own checks, never from the browser.

test('file names: last path part, no control/reserved characters, never empty', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\me\\report.pdf'), 'report.pdf');
  assert.equal(safeFileName('a\u0000b\nc<>:"|?*.txt'), 'abc.txt');
  assert.equal(safeFileName('  ..hidden.  '), 'hidden');
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('lpt1.txt'), '_lpt1.txt');
  assert.equal(safeFileName('...'), 'file');
  assert.equal(safeFileName(''), 'file');
  const long = safeFileName(`${'x'.repeat(400)}.markdown`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.markdown'));
  assert.equal(numberedName('notes.md', 2), 'notes (2).md');
  assert.equal(numberedName('README', 3), 'README (3)');
});

test('kinds come from bytes; extensions only choose among text kinds', () => {
  const t = (s: string) => new TextEncoder().encode(s);
  assert.equal(inspectFile('a.md', t('# hi')).kind, 'markdown');
  assert.equal(inspectFile('a.json', t('{"a":1}')).kind, 'json');
  assert.equal(inspectFile('a.json', t('{oops')).kind, 'text');
  assert.equal(inspectFile('a.csv', t('a,b\n1,2')).kind, 'csv');
  // HTML and SVG are kept as inert code, never as a renderable type.
  const html = inspectFile('page.html', t('<script>alert(1)</script>'));
  assert.deepEqual([html.kind, html.media_type], ['code', 'text/plain']);
  assert.equal(inspectFile('logo.svg', t('<svg onload="x()"/>')).kind, 'code');
  // Binary that is not a known image or PDF.
  const bin = inspectFile('a.txt', new Uint8Array([0, 1, 2, 255]));
  assert.equal(bin.kind, 'other');
  assert.equal(bin.text, null);
  // Invalid UTF-8 is not text.
  assert.equal(
    inspectFile('a.txt', new Uint8Array([0xc3, 0x28])).kind,
    'other',
  );
  // A PDF named .txt is a PDF with a mismatch; a .pdf that is text is text with one.
  const pdf = inspectFile('doc.txt', t('%PDF-1.7\n'));
  assert.deepEqual([pdf.kind, pdf.type_mismatch], ['pdf', true]);
  const notPdf = inspectFile('doc.pdf', t('hello'));
  assert.deepEqual([notPdf.kind, notPdf.type_mismatch], ['text', true]);
  const gif = inspectFile(
    'x.gif',
    new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1]),
  );
  assert.deepEqual(
    [gif.kind, gif.media_type, gif.type_mismatch],
    ['image', 'image/gif', false],
  );
  assert.equal(bytesText(5), '5 bytes');
  assert.equal(bytesText(25 * 1048576), '25 MiB');
  assert.equal(bytesText(1536), '1.5 KiB');
});
