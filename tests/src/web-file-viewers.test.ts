import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
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
  officeRefusal(bytes: Uint8Array): string | null;
  officeCheck(bytes: Uint8Array): Promise<string | null>;
  svgDataUrl(text: string): string;
  OFFICE_PART_MAX_BYTES: number;
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

test('an .svg is drawn as a picture unless its upload was flagged as not SVG', async () => {
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

// Review H-1: the picture's URL is a data: URL of the exact text (UTF-8), never a blob: URL of
// the studio's origin, so opening it in its own tab cannot run the SVG's scripts as the studio.
test('SVG pictures come from a data: URL of the same text', async () => {
  const r = await rules();
  const text =
    '<svg xmlns="http://www.w3.org/2000/svg"><text>日本語 ✓</text></svg>';
  const url = r.svgDataUrl(text);
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  assert.equal(
    Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8'),
    text,
  );
  // Long files are encoded in pieces without overflowing the argument limit.
  const big = `<svg>${'x'.repeat(300_000)}</svg>`;
  assert.equal(
    Buffer.from(r.svgDataUrl(big).split(',')[1]!, 'base64').length,
    big.length,
  );
});

/** A ZIP whose central directory declares these uncompressed sizes (no data is needed). */
function declared(sizes: Record<string, number>, total?: number): Uint8Array {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
  const local = [...u32(0x04034b50), ...new Array<number>(26).fill(0)];
  const central: number[] = [];
  let count = 0;
  for (const [name, size] of Object.entries(sizes)) {
    const n = Buffer.from(name);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0));
    central.push(...u16(8), ...u32(0), ...u32(0), ...u32(100), ...u32(size));
    central.push(...u16(n.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0));
    central.push(...u32(0), ...u32(0), ...n);
    count++;
  }
  const n = total ?? count;
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(n),
    ...u16(n),
    ...u32(central.length),
    ...u32(local.length),
    ...u16(0),
  ];
  return new Uint8Array([...local, ...central, ...end]);
}

// Review L-1: an Office file whose parts would inflate past the bounds is refused before any
// viewer inflates it.
test('Office files that expand too far are refused before they are opened', async () => {
  const r = await rules();
  const MiB = 1024 * 1024;
  assert.equal(r.OFFICE_PART_MAX_BYTES, 64 * MiB);
  const ok = declared({
    '[Content_Types].xml': 2000,
    'ppt/presentation.xml': 5 * MiB,
    'ppt/media/image1.png': 30 * MiB,
  });
  assert.equal(r.officeRefusal(ok), null);
  // One part over 64 MiB (a 400 KB file holding a 400 MB slide).
  assert.match(
    r.officeRefusal(declared({ 'ppt/slides/slide1.xml': 400 * MiB })) ?? '',
    /expands to more than the studio opens.*Download the original/,
  );
  // Parts each under the bound but over 256 MiB together.
  const many: Record<string, number> = {};
  for (let i = 0; i < 5; i++) many[`xl/worksheets/sheet${i}.xml`] = 60 * MiB;
  assert.ok(r.officeRefusal(declared(many)));
  // A size stored as ZIP64 (unknown here) is refused rather than trusted.
  assert.ok(r.officeRefusal(declared({ 'word/document.xml': 0xffffffff })));
  // More entries than the listing reads, and a directory that does not match its count.
  const lots: Record<string, number> = {};
  for (let i = 0; i < 5001; i++) lots[`p${i}`] = 1;
  assert.ok(r.officeRefusal(declared(lots)));
  assert.ok(r.officeRefusal(declared({ a: 1 }, 3)));
  // Not a ZIP (an old .xls is a compound file): left to its viewer.
  assert.equal(
    r.officeRefusal(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])),
    null,
  );
});

/** A real ZIP with deflated parts; `declare` overrides the size its headers state. */
function deflated(
  parts: {
    name: string;
    data: Uint8Array;
    declare?: number;
    raw?: Uint8Array;
    /** Compression method in the central directory, when it should differ from the local 8. */
    centralMethod?: number;
    localName?: string;
    /** A ZIP64 extra field's two sizes in the central (and local) header. */
    zip64?: [number, number];
    /**
     * Sizes after the data (a data descriptor): the local header then says `size` for both
     * sizes, and `local64` (if given) in a local ZIP64 field instead of `zip64`.
     */
    stream?: { size: number; local64?: [number, number] };
  }[],
): Uint8Array {
  const u16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  const u32 = (n: number) => [...u16(n & 0xffff), ...u16(n >>> 16)];
  const chunks: number[][] = [];
  const central: number[] = [];
  let offset = 0;
  for (const p of parts) {
    const n = [...Buffer.from(p.name)];
    const ln = [...Buffer.from(p.localName ?? p.name)];
    const body = [...(p.raw ?? deflateRawSync(p.data))];
    const size = p.declare ?? p.data.length;
    const u64 = (v: number) => [
      ...u32(v % 2 ** 32),
      ...u32(Math.floor(v / 2 ** 32)),
    ];
    const z64 = (v?: [number, number]) =>
      v ? [...u16(1), ...u16(16), ...u64(v[0]), ...u64(v[1])] : [];
    const extra = z64(p.zip64);
    const localExtra = p.stream ? z64(p.stream.local64) : extra;
    const flags = p.stream ? 8 : 0;
    const descriptor = p.stream
      ? [...u32(0x08074b50), ...u32(0), ...u32(body.length), ...u32(size)]
      : [];
    const head = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(flags),
      ...u16(8),
      ...u32(0),
      ...u32(0),
      ...u32(p.stream ? p.stream.size : body.length),
      ...u32(p.stream ? p.stream.size : size),
      ...u16(ln.length),
      ...u16(localExtra.length),
      ...ln,
      ...localExtra,
    ];
    chunks.push(head, body, descriptor);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags));
    central.push(
      ...u16(p.centralMethod ?? 8),
      ...u32(0),
      ...u32(0),
      ...u32(body.length),
    );
    central.push(...u32(size), ...u16(n.length), ...u16(extra.length));
    central.push(...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset));
    central.push(...n, ...extra);
    offset += head.length + body.length + descriptor.length;
  }
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(parts.length),
    ...u16(parts.length),
    ...u32(central.length),
    ...u32(offset),
    ...u16(0),
  ];
  return new Uint8Array([...chunks.flat(), ...central, ...end]);
}

// Re-review L-1: a part whose headers understate its size is caught by inflating it once,
// counting, and stopping just past the stated size, before any viewer inflates it in full.
test('an Office part that lies about its size is refused without inflating it all', async () => {
  const r = await rules();
  const text = new TextEncoder().encode('<p:presentation/>'.repeat(1000));
  const honest = deflated([
    { name: '[Content_Types].xml', data: new TextEncoder().encode('<x/>') },
    { name: 'ppt/presentation.xml', data: text },
  ]);
  assert.equal(r.officeRefusal(honest), null);
  assert.equal(await r.officeCheck(honest), null);
  // 32 MiB of zeros saying they are 1,000 bytes: the stated sizes pass, the check does not.
  const liar = deflated([
    { name: 'ppt/presentation.xml', data: text },
    {
      name: 'ppt/slides/slide1.xml',
      data: new Uint8Array(32 * 1024 * 1024),
      declare: 1000,
    },
  ]);
  assert.equal(r.officeRefusal(liar), null);
  const t = Date.now();
  assert.match(
    (await r.officeCheck(liar)) ?? '',
    /expands to more than the studio opens/,
  );
  assert.ok(Date.now() - t < 2000, 'stopped early, not after inflating it all');
  // A damaged deflate stream is refused as damaged.
  assert.match(
    (await r.officeCheck(
      deflated([
        {
          name: 'word/document.xml',
          data: text,
          raw: new Uint8Array([0xff, 0xff, 0xff, 0xff]),
        },
      ]),
    )) ?? '',
    /may be damaged/,
  );
  // Not a ZIP: left to its viewer.
  assert.equal(await r.officeCheck(new Uint8Array([0xd0, 0xcf, 0x11])), null);
});

// Review 3 L-1: SheetJS reads a part's method from its local header and JSZip from the central
// directory, so a part "stored" centrally but deflated locally would be counted as its stored
// size and inflated in full by SheetJS. Headers that disagree are refused as damaged.
test('an Office part whose local and central headers disagree is refused', async () => {
  const r = await rules();
  const raw = deflateRawSync(new Uint8Array(8 * 1024 * 1024));
  const sneaky = deflated([
    { name: 'xl/workbook.xml', data: new TextEncoder().encode('<w/>') },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: raw,
      raw,
      declare: raw.length,
      centralMethod: 0,
    },
  ]);
  assert.equal(r.officeRefusal(sneaky), null);
  assert.match((await r.officeCheck(sneaky)) ?? '', /may be damaged/);
  // A local name that is not the central one.
  const renamed = deflated([
    {
      name: 'xl/workbook.xml',
      localName: 'xl/other.xml',
      data: new TextEncoder().encode('<w/>'),
    },
  ]);
  assert.match((await r.officeCheck(renamed)) ?? '', /may be damaged/);
});

/** Rewrites a ZIP's end record: `edit(view, eocd)` changes it; `tail` is appended as comment. */
function withEnd(
  zip: Uint8Array,
  edit: (v: DataView, eocd: number) => void,
  tail: number[] = [],
): Uint8Array {
  const out = new Uint8Array([...zip, ...tail]);
  const v = new DataView(out.buffer);
  const eocd = zip.length - 22;
  v.setUint16(eocd + 20, tail.length, true);
  edit(v, eocd);
  return out;
}

// Review 4 L-1: SheetJS finds the end record and counts entries by other rules than the
// studio, so a file whose end record or central directory can be read two ways would show the
// check one list of parts and SheetJS another. Only one unambiguous layout is opened.
test('an Office file whose ZIP layout can be read two ways is refused', async () => {
  const r = await rules();
  const text = new TextEncoder().encode('<workbook/>'.repeat(100));
  const honest = deflated([
    { name: '[Content_Types].xml', data: new TextEncoder().encode('<x/>') },
    { name: 'xl/workbook.xml', data: text },
  ]);
  assert.equal(await r.officeCheck(honest), null);
  // A second end record hidden in the comment, where SheetJS (scanning from the last 4 bytes)
  // finds it and the studio's scan (from the last 22) does not.
  const second = [0x50, 0x4b, 0x05, 0x06, ...new Array<number>(16).fill(0)];
  const hidden = withEnd(honest, () => {}, second);
  assert.match((await r.officeCheck(hidden)) ?? '', /may be damaged/);
  // "Entries on this disk" (what SheetJS counts) differs from the total (what the studio counts).
  const counts = withEnd(honest, (v, e) => v.setUint16(e + 8, 3, true));
  assert.match((await r.officeCheck(counts)) ?? '', /may be damaged/);
  // A comment that does not end the file, and a central directory larger than its count.
  const short = withEnd(honest, (v, e) => v.setUint16(e + 20, 5, true));
  assert.match((await r.officeCheck(short)) ?? '', /may be damaged/);
  const more = withEnd(honest, (v, e) => {
    v.setUint16(e + 8, 1, true);
    v.setUint16(e + 10, 1, true);
  });
  assert.match((await r.officeCheck(more)) ?? '', /may be damaged/);
});

// Review 4 N-1: a ZIP64 extra field that repeats the real sizes (as some .NET tools write) is
// fine; one that says something else is refused.
test('consistent ZIP64 sizes are accepted and inconsistent ones refused', async () => {
  const r = await rules();
  const data = new TextEncoder().encode('<document/>'.repeat(100));
  const packed = deflateRawSync(data);
  const ok = deflated([
    {
      name: 'word/document.xml',
      data,
      zip64: [data.length, packed.length],
    },
  ]);
  assert.equal(await r.officeCheck(ok), null);
  const lying = deflated([
    { name: 'word/document.xml', data, zip64: [1 << 30, packed.length] },
  ]);
  assert.match((await r.officeCheck(lying)) ?? '', /may be damaged/);
});

// Review 5 L-1: SheetJS allocates its output from the local header's uncompressed size (the
// local ZIP64 value when non-zero), even when the real sizes follow the data. A streamed part
// may say 0 there (unknown) or the true size; anything else is refused.
test('a streamed part must not claim another size in its local header', async () => {
  const r = await rules();
  const data = new TextEncoder().encode('<worksheet/>'.repeat(100));
  const packed = deflateRawSync(data);
  const part = (stream: { size: number; local64?: [number, number] }) =>
    deflated([{ name: 'xl/workbook.xml', data, stream }]);
  // What Go, Java and JSZip streaming writers do: zeros, real sizes in the descriptor.
  assert.equal(await r.officeCheck(part({ size: 0 })), null);
  // The true sizes repeated in the local header are fine too.
  assert.equal(
    await r.officeCheck(
      part({ size: 0, local64: [data.length, packed.length] }),
    ),
    null,
  );
  // The reviewer's usz.xlsx: honest central sizes and descriptor, local header 0x1FFFFF00.
  assert.match(
    (await r.officeCheck(part({ size: 0x1fffff00 }))) ?? '',
    /may be damaged/,
  );
  // Python's streamed force_zip64: 0xFFFFFFFF with a ZIP64 value of 0, so SheetJS would
  // allocate 4 GiB.
  assert.match(
    (await r.officeCheck(part({ size: 0xffffffff, local64: [0, 0] }))) ?? '',
    /may be damaged/,
  );
});
