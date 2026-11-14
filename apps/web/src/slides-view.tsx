import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { sniffImage } from '@creator/contracts';

// ADR-0106: PowerPoint (.pptx) shown as an outline of its slides: each slide's title, text,
// tables and pictures, in order, with the speaker notes. The studio reads the slide XML itself
// (XML parsing is inert) and renders React elements; pictures are shown only when their bytes
// are a raster image. Layout, themes, charts and animations are not reproduced.

export type SlideBlock =
  | { type: 'text'; paragraphs: { text: string; level: number }[] }
  | { type: 'image'; key: string; alt: string }
  | { type: 'table'; rows: string[][] };
export type Slide = {
  number: number;
  title: string;
  blocks: SlideBlock[];
  notes: string;
};
export type Deck = {
  slides: Slide[];
  /** Picture bytes by key, typed from their own bytes. */
  images: Map<string, Blob>;
  more: boolean;
};

const SLIDE_MAX = 300;
const IMAGE_MAX_BYTES = 40 * 1024 * 1024;

const R_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function xml(text: string): Document {
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.getElementsByTagName('parsererror').length) throw new Error('Not XML');
  return d;
}
const children = (el: Element, name: string) =>
  Array.from(el.children).filter((c) => c.localName === name);
const child = (el: Element | undefined, name: string) =>
  el ? children(el, name)[0] : undefined;
const all = (el: Element | Document, name: string) =>
  Array.from(el.getElementsByTagNameNS('*', name));

function resolve(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

async function rels(
  zip: JSZip,
  part: string,
): Promise<Map<string, { target: string; type: string; external: boolean }>> {
  const slash = part.lastIndexOf('/');
  const path = `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
  const file = zip.file(path);
  const out = new Map<
    string,
    { target: string; type: string; external: boolean }
  >();
  if (!file) return out;
  for (const r of all(xml(await file.async('string')), 'Relationship')) {
    const external = r.getAttribute('TargetMode') === 'External';
    const target = r.getAttribute('Target') ?? '';
    out.set(r.getAttribute('Id') ?? '', {
      target: external ? target : resolve(part, target),
      type: r.getAttribute('Type') ?? '',
      external,
    });
  }
  return out;
}

const paragraphs = (body: Element) =>
  children(body, 'p')
    .map((p) => ({
      text: all(p, 't')
        .map((t) => t.textContent ?? '')
        .join(''),
      level: Number(child(p, 'pPr')?.getAttribute('lvl') ?? 0) || 0,
    }))
    .filter((p) => p.text.trim() !== '');

function rid(el: Element | undefined, name: string) {
  return el?.getAttributeNS(R_NS, name) ?? el?.getAttribute(`r:${name}`) ?? '';
}

export async function readDeck(bytes: ArrayBuffer): Promise<Deck> {
  const zip = await JSZip.loadAsync(bytes);
  const presFile = zip.file('ppt/presentation.xml');
  if (!presFile) throw new Error('Not a presentation');
  const pres = xml(await presFile.async('string'));
  const presRels = await rels(zip, 'ppt/presentation.xml');
  const ids = all(pres, 'sldId');
  const images = new Map<string, Blob>();
  let imageBytes = 0;
  const slides: Slide[] = [];
  for (const [i, id] of ids.slice(0, SLIDE_MAX).entries()) {
    const target = presRels.get(rid(id, 'id'));
    const file = target && !target.external ? zip.file(target.target) : null;
    if (!target || !file) continue;
    const part = target.target;
    const doc = xml(await file.async('string'));
    const slideRels = await rels(zip, part);
    const slide: Slide = { number: i + 1, title: '', blocks: [], notes: '' };
    const walk = async (tree: Element) => {
      for (const el of Array.from(tree.children)) {
        if (el.localName === 'grpSp') await walk(el);
        else if (el.localName === 'sp') {
          const body = child(el, 'txBody');
          if (!body) continue;
          const ph = all(el, 'ph')[0]?.getAttribute('type');
          const ps = paragraphs(body);
          if (!ps.length) continue;
          if ((ph === 'title' || ph === 'ctrTitle') && !slide.title)
            slide.title = ps.map((p) => p.text).join(' ');
          else slide.blocks.push({ type: 'text', paragraphs: ps });
        } else if (el.localName === 'pic') {
          const blip = all(el, 'blip')[0];
          const rel = slideRels.get(rid(blip, 'embed'));
          const media = rel && !rel.external ? zip.file(rel.target) : null;
          if (!media) continue;
          const data = await media.async('uint8array');
          const type = sniffImage(data);
          if (!type || imageBytes + data.length > IMAGE_MAX_BYTES) continue;
          imageBytes += data.length;
          const key = rel!.target;
          if (!images.has(key))
            images.set(key, new Blob([data as BlobPart], { type }));
          const alt = all(el, 'cNvPr')[0]?.getAttribute('descr') ?? '';
          slide.blocks.push({ type: 'image', key, alt });
        } else if (el.localName === 'graphicFrame') {
          const tbl = all(el, 'tbl')[0];
          if (!tbl) continue;
          const rows = all(tbl, 'tr').map((tr) =>
            children(tr, 'tc').map((tc) =>
              all(tc, 't')
                .map((t) => t.textContent ?? '')
                .join(''),
            ),
          );
          if (rows.length) slide.blocks.push({ type: 'table', rows });
        }
      }
    };
    const tree = all(doc, 'spTree')[0];
    if (tree) await walk(tree);
    const notesRel = [...slideRels.values()].find(
      (r) => !r.external && r.type.endsWith('/notesSlide'),
    );
    const notesFile = notesRel ? zip.file(notesRel.target) : null;
    if (notesFile) {
      const notes = xml(await notesFile.async('string'));
      slide.notes = all(notes, 'sp')
        .filter((sp) => all(sp, 'ph')[0]?.getAttribute('type') === 'body')
        .flatMap((sp) => {
          const b = child(sp, 'txBody');
          return b ? paragraphs(b).map((p) => p.text) : [];
        })
        .join('\n');
    }
    slides.push(slide);
  }
  return { slides, images, more: ids.length > SLIDE_MAX };
}

export function SlidesView({ bytes }: { bytes: ArrayBuffer }) {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = false;
    readDeck(bytes).then(
      (d) => !stop && setDeck(d),
      () =>
        !stop &&
        setError(
          'The studio could not read this presentation. It may be damaged or password-protected; download the original to open it.',
        ),
    );
    return () => {
      stop = true;
    };
  }, [bytes]);
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const [k, b] of deck?.images ?? []) m.set(k, URL.createObjectURL(b));
    return m;
  }, [deck]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  if (error) return <p className="notice">{error}</p>;
  if (!deck) return <p className="small">Reading the slides…</p>;
  if (!deck.slides.length)
    return <p className="small">This presentation has no slides.</p>;
  return (
    <div className="slides-view">
      <p className="small">
        {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}, shown
        as text, tables and pictures. Layout, charts and animations are not
        reproduced; download the original to present it.
      </p>
      <ol className="slide-list">
        {deck.slides.map((s) => (
          <li key={s.number} className="slide-card">
            <h4>
              <span className="small">Slide {s.number}</span>
              {s.title || <span className="muted">Untitled</span>}
            </h4>
            {s.blocks.map((b, i) =>
              b.type === 'text' ? (
                <ul key={i} className="slide-text">
                  {b.paragraphs.map((p, j) => (
                    <li key={j} style={{ marginLeft: `${p.level * 1.25}rem` }}>
                      {p.text}
                    </li>
                  ))}
                </ul>
              ) : b.type === 'image' ? (
                <img
                  key={i}
                  src={urls.get(b.key)}
                  alt={b.alt || `Picture on slide ${s.number}`}
                />
              ) : (
                <div key={i} className="file-table">
                  <table>
                    <tbody>
                      {b.rows.map((r, j) => (
                        <tr key={j}>
                          {r.map((c, k) => (
                            <td key={k}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ),
            )}
            {s.blocks.length === 0 && !s.title && (
              <p className="small">No text or pictures on this slide.</p>
            )}
            {s.notes && (
              <details className="slide-notes">
                <summary>Speaker notes</summary>
                <p>{s.notes}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
      {deck.more && (
        <p className="small">
          Showing the first 300 slides; download for the rest.
        </p>
      )}
    </div>
  );
}
