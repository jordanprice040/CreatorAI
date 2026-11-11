import { createHash } from 'node:crypto';
import { Parser } from 'htmlparser2';
import type { ExtractedDocument } from '@creator/db';
import { looksLikeInstructions } from '@creator/domain';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
// Content in these elements is never page text: code, styles, embedded objects.
const SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'iframe',
  'object',
  'canvas',
  'select',
]);
const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'caption',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);
// Site chrome: text inside these is navigation, sign-in, sharing or forms, not page text
// (walkthrough item 15, ADR-0086). It is still stored, flagged, and after the page text.
const CHROME = new Set([
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'menu',
  'dialog',
]);
// Short interface labels that sit inside article text on documentation and news sites.
const UI_LABEL =
  /^(copy( markdown)?|print|share|feedback|note|tip|important|warning|caution|edit|edit this page|sign in|sign up|log in|subscribe|menu|search|skip to (main )?content|table of contents|in this article|contents|was this (page|article) helpful\??|yes|no|accept( all)?( cookies)?|reject( all)?|cookie (settings|preferences)|read (more|next)|previous|next|back to top|related (articles|content|links)|additional resources|theme|summarize this article( for me)?|ask learn)(\s+(copy( markdown)?|print|share|feedback|edit))*$/i;
/** True for paragraph text that is page furniture rather than content. */
export function looksLikeFurniture(text: string): boolean {
  return (
    text.length <= 80 && UI_LABEL.test(text.replace(/[.:!·•|]+$/g, '').trim())
  );
}
const PUBLISHED_META = new Set([
  'article:published_time',
  'og:published_time',
  'citation_publication_date',
  'dc.date',
  'dc.date.issued',
  'date',
  'publish-date',
  'pubdate',
]);

function isoDate(v: string | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v.trim());
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
function httpUrl(href: string | undefined, base: URL): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}
function decode(body: Buffer, contentType: string | null): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

/**
 * Deterministic text extraction. Paragraphs are block-level text runs; their offsets index the
 * joined text (paragraphs separated by a blank line) whose hash is the locator's text_hash.
 * Hidden text is kept, because it is part of what the page served, and instruction-like text
 * is labeled; neither is interpreted.
 */
export function extractDocument(
  body: Buffer,
  contentType: string | null,
  finalUrl: URL,
): ExtractedDocument {
  const raw = decode(body, contentType);
  const media = contentType?.split(';')[0]?.trim().toLowerCase();
  let title: string | null = null;
  let published: string | null = null;
  let timeCandidate: string | null = null;
  let canonical: string | null = null;
  const blocks: { text: string; main: boolean; chrome: boolean }[] = [];
  let hasMain = false;
  if (media === 'text/plain') {
    for (const part of raw.split(/\n\s*\n/)) {
      const text = squash(part);
      if (text) blocks.push({ text, main: true, chrome: false });
    }
  } else {
    let skip = 0;
    let inTitle = false;
    let titleText = '';
    let mainDepth = 0;
    let chromeDepth = 0;
    let buf = '';
    const flush = () => {
      const text = squash(buf);
      buf = '';
      if (text)
        blocks.push({ text, main: mainDepth > 0, chrome: chromeDepth > 0 });
    };
    const parser = new Parser(
      {
        onopentag(name, attrs) {
          if (name === 'meta') {
            const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
            if (!published && PUBLISHED_META.has(key))
              published = isoDate(attrs.content);
          } else if (name === 'link') {
            const rel = (attrs.rel ?? '').toLowerCase().split(/\s+/);
            if (!canonical && rel.includes('canonical'))
              canonical = httpUrl(attrs.href, finalUrl);
          } else if (name === 'time' && !timeCandidate)
            timeCandidate = isoDate(attrs.datetime);
          if (SKIP.has(name)) skip += 1;
          if (name === 'title') inTitle = true;
          if (name === 'article' || name === 'main') {
            if (BLOCK.has(name)) flush();
            mainDepth += 1;
            hasMain = true;
          } else if (BLOCK.has(name) || CHROME.has(name)) flush();
          if (CHROME.has(name)) chromeDepth += 1;
        },
        ontext(text) {
          if (skip > 0) return;
          if (inTitle) titleText += text;
          else buf += text;
        },
        onclosetag(name) {
          if (SKIP.has(name)) skip = Math.max(0, skip - 1);
          if (name === 'title') {
            inTitle = false;
            title = squash(titleText) || null;
          }
          if (BLOCK.has(name) || CHROME.has(name)) flush();
          if (CHROME.has(name)) chromeDepth = Math.max(0, chromeDepth - 1);
          if (name === 'article' || name === 'main')
            mainDepth = Math.max(0, mainDepth - 1);
        },
      },
      { decodeEntities: true, lowerCaseTags: true },
    );
    parser.write(raw);
    parser.end();
    flush();
  }
  const paragraphs: ExtractedDocument['paragraphs'] = [];
  let offset = 0;
  for (const b of blocks) {
    paragraphs.push({
      text: b.text,
      start: offset,
      end: offset + b.text.length,
      // Outside the marked article, inside site chrome, or an interface label.
      boilerplate:
        (hasMain && !b.main) || b.chrome || looksLikeFurniture(b.text),
    });
    offset += b.text.length + 2;
  }
  const joined = blocks.map((b) => b.text).join('\n\n');
  // Reposts differ in site chrome; compare the article/main text when the page marks it.
  const core = (hasMain ? blocks.filter((b) => b.main) : blocks)
    .map((b) => b.text)
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return {
    title,
    published_at: published ?? timeCandidate,
    canonical_url: canonical,
    text_hash: sha256(joined),
    fingerprint: sha256(core),
    paragraphs,
    instruction_like: blocks.some((b) => looksLikeInstructions(b.text)),
  };
}
