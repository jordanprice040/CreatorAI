import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bytesText,
  cutText,
  decodeText,
  inspectFile,
  numberedName,
  zipEntries,
  safeFileName,
} from '@creator/contracts';

// ADR-0072: names and kinds come from the studio's own checks, never from the browser.

test('file names: last path part, no control/reserved characters, never empty', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\me\\report.pdf'), 'report.pdf');
  assert.equal(safeFileName('a\u0000b\nc<>:"|?*.txt'), 'abc.txt');
  // One leading dot stays so a dotfile keeps what it is (review N2).
  assert.equal(safeFileName('  ..hidden.  '), '.hidden');
  assert.equal(safeFileName('.env'), '.env');
  // Bidi overrides, C1 controls and zero-width marks cannot disguise the extension (L1).
  assert.equal(safeFileName('invoice\u202etxt.exe'), 'invoicetxt.exe');
  assert.equal(
    safeFileName('a\u0085b\u200e\u200f\u200b\u2066c\ufeff.pdf'),
    'abc.pdf',
  );
  assert.equal(safeFileName('CON'), '_CON');
  assert.equal(safeFileName('lpt1.txt'), '_lpt1.txt');
  assert.equal(safeFileName('...'), 'file');
  assert.equal(safeFileName(''), 'file');
  const long = safeFileName(`${'x'.repeat(400)}.markdown`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.markdown'));
  assert.equal(numberedName('notes.md', 2), 'notes (2).md');
  assert.equal(numberedName('README', 3), 'README (3)');
  // Cutting kept text never splits a surrogate pair (review N1).
  assert.equal(cutText('ab😀', 3), 'ab');
  assert.equal(cutText('ab😀', 4), 'ab😀');
  assert.equal(cutText('abc', 2), 'ab');
});

test('kinds come from bytes; extensions only choose among text kinds', () => {
  const t = (s: string) => new TextEncoder().encode(s);
  assert.equal(inspectFile('a.md', t('# hi')).kind, 'markdown');
  assert.equal(inspectFile('a.json', t('{"a":1}')).kind, 'json');
  assert.equal(inspectFile('a.json', t('{oops')).kind, 'text');
  assert.equal(inspectFile('a.csv', t('a,b\n1,2')).kind, 'csv');
  // HTML and SVG are kept as inert code; the media type only names what they are.
  const html = inspectFile('page.html', t('<script>alert(1)</script>'));
  assert.deepEqual([html.kind, html.media_type], ['code', 'text/html']);
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

/** A ZIP with stored (uncompressed) entries, enough for the studio's central-directory reader. */
function zip(entries: Record<string, string>, utf8Names = false): Uint8Array {
  const enc = new TextEncoder();
  const local: number[] = [];
  const central: number[] = [];
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
  let count = 0;
  for (const [name, body] of Object.entries(entries)) {
    const n = enc.encode(name);
    const b = enc.encode(body);
    const offset = local.length;
    const flags = utf8Names ? 0x800 : 0;
    local.push(...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(0));
    local.push(...u32(0), ...u32(0), ...u32(b.length), ...u32(b.length));
    local.push(...u16(n.length), ...u16(0), ...n, ...b);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags));
    central.push(
      ...u16(0),
      ...u32(0),
      ...u32(0),
      ...u32(b.length),
      ...u32(b.length),
    );
    central.push(...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    central.push(...u32(0), ...u32(offset), ...n);
    count++;
  }
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(count),
    ...u16(count),
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ];
  return new Uint8Array([...local, ...central, ...end]);
}

// ADR-0106: Office files and archives are told apart by their entries, not their names.
test('ZIP-based files: Word, Excel, PowerPoint and plain archives', () => {
  const ct = '[Content_Types].xml';
  const word = inspectFile(
    'report.docx',
    zip({ [ct]: '<x/>', 'word/document.xml': '<w/>' }),
  );
  assert.deepEqual(
    [word.kind, word.type_mismatch, word.text],
    ['document', false, null],
  );
  assert.equal(
    word.media_type,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );
  const sheet = inspectFile(
    'book.xlsx',
    zip({ [ct]: '', 'xl/workbook.xml': '' }),
  );
  assert.deepEqual([sheet.kind, sheet.type_mismatch], ['spreadsheet', false]);
  const deck = inspectFile(
    'deck.pptx',
    zip({ [ct]: '', 'ppt/presentation.xml': '' }),
  );
  assert.deepEqual([deck.kind, deck.type_mismatch], ['presentation', false]);
  // A workbook named .docx is a spreadsheet with a mismatch.
  const renamed = inspectFile(
    'book.docx',
    zip({ [ct]: '', 'xl/workbook.xml': '' }),
  );
  assert.deepEqual(
    [renamed.kind, renamed.type_mismatch],
    ['spreadsheet', true],
  );
  // Without [Content_Types].xml it is only an archive that happens to hold such a path.
  const plain = inspectFile(
    'bundle.zip',
    zip({ 'word/document.xml': '', 'a.txt': 'hi' }),
  );
  assert.deepEqual(
    [plain.kind, plain.media_type, plain.type_mismatch],
    ['archive', 'application/zip', false],
  );
  // A .docx that is not a ZIP at all is "other", flagged.
  const fake = inspectFile('fake.docx', new Uint8Array([1, 2, 3, 0]));
  assert.deepEqual([fake.kind, fake.type_mismatch], ['other', true]);
  // Text named .xlsx is text, flagged.
  const text = inspectFile('notes.xlsx', new TextEncoder().encode('a,b'));
  assert.deepEqual([text.kind, text.type_mismatch], ['text', true]);
  // Only .xls opens from the old binary Office format; .doc stays download-only.
  const ole = new Uint8Array([
    0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0,
  ]);
  assert.equal(inspectFile('old.xls', ole).kind, 'spreadsheet');
  assert.equal(inspectFile('old.doc', ole).kind, 'other');
});

test('the archive listing reads names and sizes without unpacking', () => {
  const z = zipEntries(
    zip({ 'docs/': '', 'docs/caf\u00e9.txt': 'hello' }, true),
  )!;
  assert.equal(z.total, 2);
  assert.equal(z.more, false);
  assert.deepEqual(z.entries, [
    {
      name: 'docs/',
      size: 0,
      compressed: 0,
      dir: true,
      method: 0,
      offset: 0,
      flags: 2048,
      zip64: false,
    },
    {
      name: 'docs/caf\u00e9.txt',
      size: 5,
      compressed: 5,
      dir: false,
      method: 0,
      offset: 35,
      flags: 2048,
      zip64: false,
    },
  ]);
  // Re-review N-2: a UTF-8 name saved without the UTF-8 flag reads as the ZIP format says
  // (Latin-1 here), or as UTF-8 the way JSZip and Office read it.
  const unflagged = zip({ 'caf\u00e9.png': 'x' });
  assert.equal(zipEntries(unflagged)!.entries[0]!.name, 'caf\u00c3\u00a9.png');
  assert.equal(
    zipEntries(unflagged, 'utf8')!.entries[0]!.name,
    'caf\u00e9.png',
  );
  // Truncated or not-ZIP bytes give null, never an exception.
  const whole = zip({ 'a.txt': 'x' });
  assert.equal(zipEntries(whole.subarray(0, whole.length - 30)), null);
  assert.equal(zipEntries(new TextEncoder().encode('PK not really')), null);
});

test('UTF-16 text with a byte-order mark is text (live check follow-up 1)', () => {
  const le = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00, 0x0a, 0x00]);
  const be = new Uint8Array([0xfe, 0xff, 0x00, 0x68, 0x00, 0x69]);
  assert.equal(decodeText(le), 'hi\n');
  assert.equal(decodeText(be), 'hi');
  const look = inspectFile('notes.txt', le);
  assert.deepEqual(
    [look.kind, look.text, look.type_mismatch],
    ['text', 'hi\n', false],
  );
  // An odd length or NUL characters are not UTF-16 text.
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x68])), null);
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0, 0, 1, 0])), null);
  // A UTF-8 byte-order mark is dropped from the text.
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a');
});

test('extensions the text does not live up to are flagged (live check follow-up 4)', () => {
  const t = (s: string) => new TextEncoder().encode(s);
  const badJson = inspectFile('a.json', t('{oops'));
  assert.deepEqual([badJson.kind, badJson.type_mismatch], ['text', true]);
  assert.equal(inspectFile('a.json', t('{"a":1}')).type_mismatch, false);
  const svg = inspectFile(
    'logo.svg',
    t('<?xml version="1.0"?><svg xmlns="x"></svg>'),
  );
  assert.deepEqual(
    [svg.kind, svg.media_type, svg.type_mismatch],
    ['code', 'image/svg+xml', false],
  );
  const notSvg = inspectFile('logo.svg', t('just words'));
  assert.deepEqual(
    [notSvg.media_type, notSvg.type_mismatch],
    ['text/plain', true],
  );
  assert.equal(inspectFile('page.html', t('<p>hi</p>')).type_mismatch, false);
  assert.equal(inspectFile('page.html', t('plain words')).type_mismatch, true);
});
