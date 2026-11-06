import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useDesktopApp } from './desktop-app.js';
import {
  desktopOpens,
  parseMarkdown,
  type Block,
  type Inline,
} from './markdown.js';

// Renders a model answer's Markdown as React elements only: text is always a text node, so an
// answer can't inject HTML or scripts, and links are absolute http(s)/mailto (markdown.ts).
// A link's address is always readable. In the desktop app (ADR-0061) a public https or plain
// mailto link opens in the system browser or mail app, and shows its address and a Copy
// button too; any other link there (http, local or IP addresses, ports) can't be opened, so it
// shows as its words and address with Copy instead of an anchor that would do nothing.

const textOf = (nodes: Inline[]): string =>
  nodes
    .map((n) =>
      n.t === 'text' || n.t === 'code' ? n.v : n.t === 'br' ? ' ' : textOf(n.c),
    )
    .join('');

/** The address as people read it: mailto: dropped, a bare trailing slash dropped. */
const shown = (href: string) =>
  href.startsWith('mailto:')
    ? href.slice(7)
    : href.replace(/^(https?:\/\/[^/]+)\/$/, '$1');

function CopyLink({ href }: { href: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="text md-copy"
      onClick={() => {
        navigator.clipboard
          .writeText(shown(href))
          .then(() => setState('copied'))
          .catch(() => setState('failed'));
      }}
    >
      {state === 'copied'
        ? 'Copied'
        : state === 'failed'
          ? 'Copy failed: select it'
          : 'Copy'}
    </button>
  );
}

function link(n: Extract<Inline, { t: 'link' }>, k: number, desktop: boolean) {
  const label = textOf(n.c).trim();
  const address = shown(n.href);
  const same = label === address || label === n.href;
  if (desktop && desktopOpens(n.href)) {
    return (
      <span key={k} className="md-link">
        <a
          href={n.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`Opens in your ${n.href.startsWith('mailto:') ? 'mail app' : 'browser'}: ${address}`}
        >
          {inlines(n.c, desktop)}
        </a>
        {!same && <span className="md-url"> ({address})</span>}{' '}
        <CopyLink href={n.href} />
      </span>
    );
  }
  if (desktop) {
    return (
      <span key={k} className="md-link">
        {!same && <>{inlines(n.c, desktop)} </>}
        <span className="md-url">
          {same ? inlines(n.c, desktop) : `(${address})`}
        </span>{' '}
        <CopyLink href={n.href} />
      </span>
    );
  }
  // In a browser the address shows on hover and in the status bar.
  return (
    <a
      key={k}
      href={n.href}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
    >
      {inlines(n.c, desktop)}
    </a>
  );
}

function inlines(nodes: Inline[], desktop: boolean): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={k}>{n.v}</Fragment>;
      case 'br':
        return <br key={k} />;
      case 'code':
        return <code key={k}>{n.v}</code>;
      case 'strong':
        return <strong key={k}>{inlines(n.c, desktop)}</strong>;
      case 'em':
        return <em key={k}>{inlines(n.c, desktop)}</em>;
      case 'del':
        return <del key={k}>{inlines(n.c, desktop)}</del>;
      case 'link':
        return link(n, k, desktop);
    }
  });
}

function blocks(list: Block[], desktop: boolean): ReactNode[] {
  return list.map((b, k) => {
    switch (b.t) {
      case 'heading': {
        // Answer headings sit inside a page that already has h1–h3, so they start at h4.
        const H = (['h4', 'h5', 'h6', 'h6', 'h6', 'h6'] as const)[b.level - 1]!;
        return (
          <H key={k} className={`md-h md-h${Math.min(b.level, 3)}`}>
            {inlines(b.c, desktop)}
          </H>
        );
      }
      case 'para':
        return <p key={k}>{inlines(b.c, desktop)}</p>;
      case 'rule':
        return <hr key={k} />;
      case 'code':
        return (
          <pre
            key={k}
            className={b.lang === 'text' ? 'md-code md-code-text' : 'md-code'}
          >
            <code>{b.v}</code>
          </pre>
        );
      case 'quote':
        return <blockquote key={k}>{blocks(b.c, desktop)}</blockquote>;
      case 'list': {
        const items = b.items.map((item, j) => (
          <li key={j}>{blocks(item, desktop)}</li>
        ));
        return b.ordered ? (
          <ol key={k} start={b.start === 1 ? undefined : b.start}>
            {items}
          </ol>
        ) : (
          <ul key={k}>{items}</ul>
        );
      }
      case 'table':
        return (
          <div key={k} className="md-table">
            <table>
              <thead>
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} style={{ textAlign: b.align[j] ?? undefined }}>
                      {inlines(c, desktop)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, j) => (
                      <td
                        key={j}
                        style={{ textAlign: b.align[j] ?? undefined }}
                      >
                        {inlines(c, desktop)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

/** A model answer shown as formatted Markdown. */
export function Markdown({ text }: { text: string }) {
  const desktop = useDesktopApp();
  const tree = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{blocks(tree, desktop)}</div>;
}
