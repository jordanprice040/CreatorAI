// ADR-0106: HTML that a viewer builds from a file (a Word document's pages) is shown only in
// an iframe with an empty sandbox (no scripts, forms, popups or navigation of the studio, and
// an opaque origin), under a Content-Security-Policy that allows nothing but inline styles and
// data: images and fonts. Before that, the markup is cleaned: no scripts, frames, objects,
// forms, event handlers, links or outside URLs. Each layer alone would stop a script.

const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const DROP = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'audio',
  'video',
  'source',
  'track',
  'portal',
  'template',
  'noscript',
]);
const URL_ATTRS = new Set([
  'src',
  'srcset',
  'href',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'background',
  'data',
  'ping',
  'cite',
  'longdesc',
]);

/** Keeps only data: URLs of raster images and fonts. */
function safeUrl(name: string, value: string): boolean {
  if (name !== 'src') return false;
  return /^data:(image\/(png|jpe?g|gif|webp|bmp)|font\/|application\/(font|x-font|octet-stream))[;,]/i.test(
    value.trim(),
  );
}

/** Cleans the children of `root` in place (an element of an inert document). */
export function cleanTree(root: Element): void {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.localName.toLowerCase();
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === 'a') {
      // Links become plain text; the target stays readable as a tooltip.
      const span = el.ownerDocument.createElement('span');
      span.className = 'link';
      const href = el.getAttribute('href');
      if (href && !href.startsWith('#')) span.title = href.slice(0, 500);
      while (el.firstChild) span.appendChild(el.firstChild);
      el.replaceWith(span);
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      if (
        n.startsWith('on') ||
        (URL_ATTRS.has(n) && !safeUrl(n, a.value)) ||
        (n === 'style' && /url\s*\((?!\s*['"]?data:)/i.test(a.value))
      )
        el.removeAttribute(a.name);
    }
  }
}

/** A whole srcdoc page: the policy, the given styles, then the cleaned body. */
export function inertPage(body: string, css: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${css.replace(/<\//g, '<\\/')}</style></head><body>${body}</body></html>`;
}

export function InertFrame({ html, title }: { html: string; title: string }) {
  return (
    <iframe
      className="file-frame"
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={html}
    />
  );
}
