import { useEffect, useMemo, useRef, useState } from 'react';
import { parseAsync, renderDocument, type Options } from 'docx-preview';
import { InertFrame, cleanTree, inertPage } from './inert-html.js';

// ADR-0106: Word documents (.docx) laid out as pages by docx-preview (Apache-2.0). It builds
// its elements in a separate inert document (no browsing context, so nothing in it loads or
// runs), with images and fonts as data: URLs and embedded HTML chunks turned off. The result
// is cleaned and shown in InertFrame.

/** docx-preview's element builder, pointed at an inert document instead of the page's own. */
function inertBuilder(doc: Document): Options['h'] {
  const h: Options['h'] = (elem) => {
    if (typeof elem === 'string') return doc.createTextNode(elem);
    if (elem instanceof Node) return elem;
    const { ns, tagName, className, style, children, ...props } =
      elem as unknown as {
        ns?: string;
        tagName: string;
        className?: string;
        style?: string | Record<string, string>;
        children?: unknown[];
        [k: string]: unknown;
      };
    if (tagName === '#fragment') {
      const f = doc.createDocumentFragment();
      for (const c of children ?? []) f.appendChild(h(c as string));
      return f;
    }
    if (tagName === '#comment') return doc.createComment('');
    const el = ns
      ? doc.createElementNS(ns, tagName)
      : doc.createElement(tagName);
    if (className) el.setAttribute('class', className);
    if (typeof style === 'string') el.setAttribute('style', style);
    else if (style) Object.assign((el as HTMLElement).style, style);
    for (const [k, v] of Object.entries(props))
      if (v !== undefined) (el as unknown as Record<string, unknown>)[k] = v;
    for (const c of children ?? []) el.appendChild(h(c as string));
    return el;
  };
  return h;
}

/** The cleaned pages, their styles, and the widest page in CSS pixels. */
export async function docxPages(
  bytes: ArrayBuffer,
): Promise<{ body: string; css: string; width: number }> {
  const doc = document.implementation.createHTMLDocument('');
  const options: Partial<Options> = {
    useBase64URL: true,
    renderAltChunks: false,
    renderComments: false,
    renderChanges: false,
    experimental: false,
    breakPages: true,
    inWrapper: true,
    h: inertBuilder(doc),
  };
  const parsed: unknown = await parseAsync(new Blob([bytes]), options);
  const nodes = await renderDocument(parsed, options);
  const css: string[] = [];
  const body = doc.createElement('div');
  for (const n of nodes) {
    if (n.nodeName.toLowerCase() === 'style') css.push(n.textContent ?? '');
    else body.appendChild(doc.importNode(n, true));
  }
  cleanTree(body);
  let width = 0;
  for (const section of Array.from(
    body.querySelectorAll<HTMLElement>('section.docx'),
  )) {
    const m = /^([\d.]+)(pt|px)$/.exec(section.style.width);
    if (m)
      width = Math.max(width, Number(m[1]) * (m[2] === 'pt' ? 96 / 72 : 1));
  }
  return { body: body.innerHTML, css: css.join('\n'), width: width || 816 };
}

/** The srcdoc page at a zoom, on the studio's backdrop colour. */
function page(
  pages: { body: string; css: string },
  backdrop: string,
  zoom: number,
): string {
  return inertPage(
    pages.body,
    `${pages.css}
html,body{margin:0;background:${backdrop}}
body{zoom:${zoom.toFixed(3)}}
.docx-wrapper{background:${backdrop} !important;padding:16px !important;${zoom < 1 ? '' : 'align-items:flex-start !important;'}}
.docx-wrapper>section.docx{margin-bottom:16px !important;box-shadow:0 1px 4px rgba(0,0,0,.35) !important}
.link{color:#0b57d0;text-decoration:underline dotted;cursor:help}`,
  );
}

export function DocxView({
  bytes,
  name,
}: {
  bytes: ArrayBuffer;
  name: string;
}) {
  const [pages, setPages] = useState<{
    body: string;
    css: string;
    width: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [fit, setFit] = useState(true);
  const [frameWidth, setFrameWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stop = false;
    docxPages(bytes).then(
      (p) => !stop && setPages(p),
      () =>
        !stop &&
        setError(
          'The studio could not read this Word document. It may be damaged or password-protected; download the original to open it.',
        ),
    );
    return () => {
      stop = true;
    };
  }, [bytes]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameWidth(el.clientWidth));
    ro.observe(el);
    setFrameWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pages]);
  // Review N-4: the page backdrop follows the studio's theme when it changes while open.
  const [theme, setTheme] = useState(() =>
    document.documentElement.getAttribute('data-theme'),
  );
  useEffect(() => {
    const mo = new MutationObserver(() =>
      setTheme(document.documentElement.getAttribute('data-theme')),
    );
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => mo.disconnect();
  }, []);
  const zoom =
    fit && pages && frameWidth > 0
      ? Math.min(1, Math.max(0.3, (frameWidth - 20) / (pages.width + 32)))
      : 1;
  const html = useMemo(() => {
    if (!pages) return '';
    const backdrop =
      getComputedStyle(document.body)
        .getPropertyValue('--surface-sunken')
        .trim() || '#6b7280';
    // Rounded so a resize redraws the frame only when the zoom really changes.
    return page(pages, backdrop, Math.round(zoom * 50) / 50);
  }, [pages, zoom, theme]);
  if (error) return <p className="notice">{error}</p>;
  if (!pages) return <p className="small">Laying out the document…</p>;
  return (
    <div className="docx-view" ref={box}>
      <div className="code-bar">
        <span className="small">
          Shown as pages, as the studio reads them; fonts and layout can differ
          a little from Word. Links and embedded content are switched off.
        </span>
        <label className="chip">
          <input
            type="checkbox"
            checked={fit}
            onChange={(e) => setFit(e.target.checked)}
          />
          Fit width
        </label>
      </div>
      <InertFrame html={html} title={`${name}, as pages`} />
    </div>
  );
}
