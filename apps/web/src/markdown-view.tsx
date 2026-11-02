import { Fragment, useMemo, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from './markdown.js';

// Renders a model answer's Markdown as React elements only: text is always a text node, so an
// answer can't inject HTML or scripts, and links are absolute http(s)/mailto (markdown.ts).

function inlines(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={k}>{n.v}</Fragment>;
      case 'br':
        return <br key={k} />;
      case 'code':
        return <code key={k}>{n.v}</code>;
      case 'strong':
        return <strong key={k}>{inlines(n.c)}</strong>;
      case 'em':
        return <em key={k}>{inlines(n.c)}</em>;
      case 'del':
        return <del key={k}>{inlines(n.c)}</del>;
      case 'link':
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer">
            {inlines(n.c)}
          </a>
        );
    }
  });
}

function blocks(list: Block[]): ReactNode[] {
  return list.map((b, k) => {
    switch (b.t) {
      case 'heading': {
        // Answer headings sit inside a page that already has h1–h3, so they start at h4.
        const H = (['h4', 'h5', 'h6', 'h6', 'h6', 'h6'] as const)[b.level - 1]!;
        return (
          <H key={k} className={`md-h md-h${Math.min(b.level, 3)}`}>
            {inlines(b.c)}
          </H>
        );
      }
      case 'para':
        return <p key={k}>{inlines(b.c)}</p>;
      case 'rule':
        return <hr key={k} />;
      case 'code':
        return (
          <pre key={k} className="md-code">
            <code>{b.v}</code>
          </pre>
        );
      case 'quote':
        return <blockquote key={k}>{blocks(b.c)}</blockquote>;
      case 'list': {
        const items = b.items.map((item, j) => <li key={j}>{blocks(item)}</li>);
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
                      {inlines(c)}
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
                        {inlines(c)}
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
  const tree = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md">{blocks(tree)}</div>;
}
