import { useEffect, useRef, useState } from 'react';
import {
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// ADR-0106: PDFs drawn by pdf.js (Apache-2.0), bundled with the studio: the parser runs in its
// own worker from the studio's own files, with character maps, fonts and decoders served next
// to the app (vite.config.ts), never a CDN. A PDF's scripts and XFA forms never run. Links and
// form fields are drawn as they look on the page but cannot be used (no annotation layer). A
// text layer makes the words selectable. Pages far from view free their canvases.

GlobalWorkerOptions.workerSrc = workerUrl;
const assets = `${import.meta.env.BASE_URL}pdfjs/`;

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Canvases larger than this many pixels are drawn at a lower resolution. */
const MAX_PIXELS = 16_000_000;

type Size = { w: number; h: number };

function PdfPage({
  pdf,
  number,
  scale,
  estimate,
  onSize,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  scale: number;
  estimate: Size;
  onSize: (n: number, s: Size) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setNear(Boolean(e?.isIntersecting)),
      { rootMargin: '150% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) {
      // Review M-1: a page far from view gives back its pixels and text layer; the box keeps
      // its size, and the page is drawn again when it comes back near.
      const c = canvas.current;
      if (c && c.width) {
        c.width = 0;
        c.height = 0;
      }
      text.current?.replaceChildren();
      return;
    }
    let stop = false;
    let task: { cancel: () => void } | null = null;
    let layer: TextLayer | null = null;
    void (async () => {
      try {
        const page = await pdf.getPage(number);
        if (stop) return;
        const viewport = page.getViewport({ scale });
        const s = { w: viewport.width, h: viewport.height };
        setSize(s);
        onSize(number, { w: s.w / scale, h: s.h / scale });
        const c = canvas.current;
        if (!c) return;
        let ratio = window.devicePixelRatio || 1;
        if (s.w * s.h * ratio * ratio > MAX_PIXELS)
          ratio = Math.sqrt(MAX_PIXELS / (s.w * s.h));
        c.width = Math.floor(s.w * ratio);
        c.height = Math.floor(s.h * ratio);
        c.style.width = `${Math.floor(s.w)}px`;
        c.style.height = `${Math.floor(s.h)}px`;
        const render = page.render({
          canvas: c,
          viewport,
          transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
          annotationMode: AnnotationMode.ENABLE,
        });
        task = render;
        await render.promise;
        if (stop || !text.current) return;
        text.current.replaceChildren();
        layer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: text.current,
          viewport,
        });
        await layer.render();
      } catch (e) {
        if (
          !stop &&
          !(e instanceof Error && e.name === 'RenderingCancelledException')
        )
          setFailed(true);
      }
    })();
    return () => {
      stop = true;
      task?.cancel();
      layer?.cancel();
    };
  }, [near, pdf, number, scale]);
  const shown = size ?? { w: estimate.w * scale, h: estimate.h * scale };
  return (
    <div
      ref={box}
      className="pdf-page"
      data-page={number}
      style={{
        width: `${Math.floor(shown.w)}px`,
        height: `${Math.floor(shown.h)}px`,
        ['--total-scale-factor' as string]: String(scale),
      }}
      role="img"
      aria-label={`Page ${number}`}
    >
      <canvas ref={canvas} />
      <div ref={text} className="textLayer" />
      {failed && (
        <p className="small pdf-page-error">This page could not be drawn.</p>
      )}
    </div>
  );
}

export function PdfView({ bytes, name }: { bytes: ArrayBuffer; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [scale, setScale] = useState<number | 'fit'>('fit');
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [jump, setJump] = useState('1');
  const sizes = useRef(new Map<number, Size>());
  const [first, setFirst] = useState<Size>({ w: 612, h: 792 });
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop = false;
    // pdf.js takes ownership of the buffer it is given; give it a copy.
    const task = getDocument({
      data: new Uint8Array(bytes.slice(0)),
      cMapUrl: `${assets}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assets}standard_fonts/`,
      wasmUrl: `${assets}wasm/`,
      iccUrl: `${assets}iccs/`,
      enableXfa: false,
      useSystemFonts: false,
      stopAtErrors: false,
    });
    task.onPassword = (_: unknown, reason: number) => {
      if (stop) return;
      setError(
        reason === PasswordResponses.NEED_PASSWORD
          ? 'This PDF is password-protected. Download the original to open it.'
          : 'The password was not accepted.',
      );
      void task.destroy();
    };
    task.promise.then(
      async (doc) => {
        if (stop) return;
        const p1 = await doc.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        if (stop) return;
        setFirst({ w: v.width, h: v.height });
        setPdf(doc);
      },
      () => {
        if (!stop)
          setError(
            (e) =>
              e ||
              'The studio could not read this PDF. It may be damaged; download the original to open it.',
          );
      },
    );
    return () => {
      stop = true;
      void task.destroy();
    };
  }, [bytes]);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pdf]);
  const fit = width > 0 ? Math.max(0.25, (width - 32) / first.w) : 1;
  const z = scale === 'fit' ? fit : scale;
  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    for (const p of Array.from(el.querySelectorAll<HTMLElement>('.pdf-page'))) {
      const r = p.getBoundingClientRect();
      if (r.bottom - top > el.clientHeight / 3) {
        const n = Number(p.dataset.page);
        if (n !== current) {
          setCurrent(n);
          setJump(String(n));
        }
        break;
      }
    }
  }
  function goTo(n: number) {
    const el = scroller.current?.querySelector<HTMLElement>(
      `.pdf-page[data-page="${n}"]`,
    );
    el?.scrollIntoView({ block: 'start' });
  }
  function zoom(step: 1 | -1) {
    // The next step that is visibly different (fit width can sit just below a step).
    const next =
      step > 0
        ? (ZOOMS.find((x) => x > z * 1.05) ?? ZOOMS.at(-1)!)
        : ([...ZOOMS].reverse().find((x) => x < z / 1.05) ?? ZOOMS[0]!);
    setScale(next);
  }
  if (error) return <p className="notice">{error}</p>;
  if (!pdf) return <p className="small">Opening the PDF…</p>;
  const n = pdf.numPages;
  return (
    <div className="pdf-view">
      <div className="pdf-bar" role="toolbar" aria-label="PDF controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const p = Math.min(n, Math.max(1, Math.round(Number(jump)) || 1));
            setJump(String(p));
            goTo(p);
          }}
        >
          <label htmlFor="pdf-page" className="inline">
            Page
          </label>
          <input
            id="pdf-page"
            className="pdf-page-input"
            inputMode="numeric"
            value={jump}
            onChange={(e) => setJump(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => setJump(String(current))}
          />
          <span className="small">of {n}</span>
        </form>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom out"
          disabled={z <= ZOOMS[0]! + 0.001}
          onClick={() => zoom(-1)}
        >
          −
        </button>
        <span className="small pdf-zoom" aria-live="polite">
          {Math.round(z * 100)}%
        </span>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom in"
          disabled={z >= ZOOMS.at(-1)! - 0.001}
          onClick={() => zoom(1)}
        >
          +
        </button>
        <button
          type="button"
          className="text"
          aria-pressed={scale === 'fit'}
          onClick={() => setScale('fit')}
        >
          Fit width
        </button>
      </div>
      <div
        ref={scroller}
        className="pdf-scroll"
        tabIndex={0}
        aria-label={`${name}, ${n} page${n === 1 ? '' : 's'}`}
        onScroll={onScroll}
      >
        {Array.from({ length: n }, (_, i) => (
          <PdfPage
            key={i + 1}
            pdf={pdf}
            number={i + 1}
            scale={z}
            estimate={sizes.current.get(i + 1) ?? first}
            onSize={(p, s) => sizes.current.set(p, s)}
          />
        ))}
      </div>
      <p className="small">
        Drawn by the studio; the PDF’s own scripts are switched off, and its
        links and form fields are drawn but cannot be used. Select text to copy
        it.
      </p>
    </div>
  );
}
