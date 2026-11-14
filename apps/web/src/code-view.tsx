import { useMemo, useState, type ReactNode } from 'react';
import { common, createLowlight } from 'lowlight';
import dos from 'highlight.js/lib/languages/dos';
import powershell from 'highlight.js/lib/languages/powershell';
import {
  HIGHLIGHT_MAX_CHARS,
  codeLanguage,
  linesText,
} from './file-viewer-rules.js';

// ADR-0106: code in colour, IDE style. highlight.js grammars (BSD-3-Clause) through lowlight
// (MIT) turn the text into a tree of spans, rendered here as React elements: the text is never
// parsed as HTML, so markup in the file stays text.

const lowlight = createLowlight(common);
lowlight.register({ dos, powershell });

type Hast =
  | { type: 'text'; value: string }
  | {
      type: 'element';
      properties?: { className?: unknown };
      children: Hast[];
    }
  | { type: 'root'; children: Hast[] };

function render(node: Hast, key: number): ReactNode {
  if (node.type === 'text') return node.value;
  const kids = node.children.map(render);
  if (node.type === 'root') return kids;
  const cls = node.properties?.className;
  return (
    <span key={key} className={Array.isArray(cls) ? cls.join(' ') : undefined}>
      {kids}
    </span>
  );
}

export function CodeView({
  text,
  name,
  kind,
}: {
  text: string;
  name: string;
  kind: string;
}) {
  const language = codeLanguage(name, kind);
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => text.split(/\r\n|\r|\n/).length, [text]);
  const colour =
    language !== null &&
    text.length <= HIGHLIGHT_MAX_CHARS &&
    lowlight.registered(language.id);
  const body = useMemo(() => {
    if (!colour) return text;
    try {
      return render(lowlight.highlight(language.id, text) as Hast, 0);
    } catch {
      return text;
    }
  }, [colour, language?.id, text]);
  return (
    <div className="code-view">
      <div className="code-bar">
        <span className="small">
          {language ? language.label : 'Plain text'} · {linesText(lines)}
          {language && !colour ? ' · too long to colour' : ''}
        </span>
        <label className="chip">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
          />
          Wrap lines
        </label>
        <button
          type="button"
          className="text"
          onClick={() => {
            void navigator.clipboard?.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={wrap ? 'code-scroll wrap' : 'code-scroll'} tabIndex={0}>
        {!wrap && (
          <pre className="code-gutter" aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
          </pre>
        )}
        <pre className="code-body hljs">
          <code>{body}</code>
        </pre>
      </div>
    </div>
  );
}
