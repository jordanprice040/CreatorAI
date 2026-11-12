import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileTextViewSchema,
  WorkspaceFileDetailSchema,
  WorkspaceFilePageSchema,
  bytesText,
  z,
  type FileSort,
  type SessionInfo,
  type WorkspaceFilePage,
  type WorkspaceFileVersion,
} from '@creator/contracts';
import { STUDIO_CHANGED, api, message, when, words } from './oversight.js';
import { Empty, Status, useLoad } from './ui.js';
import { Markdown } from './markdown-view.js';
import { MARKDOWN_MAX_CHARS } from './markdown.js';
import { noteUploadLimit, startUploads } from './transfers.js';
import type { Workspace } from '@creator/contracts';

const SORT_TEXT: Record<FileSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name A–Z',
};
const KIND_TEXT: Record<string, string> = {
  text: 'Text',
  markdown: 'Markdown',
  json: 'JSON',
  csv: 'CSV',
  code: 'Code (shown as text)',
  image: 'Image',
  pdf: 'PDF',
  other: 'Other',
};

const filesPath = (ws: string) => `workspaces/${ws}/files`;

/**
 * Sources › Files (ADR-0072, P05): the workspace's uploaded files, newest first. Upload with the
 * picker here or by dropping files anywhere; view text, Markdown, JSON, CSV, code and images
 * without running anything; download the exact original bytes of any version.
 */
export function Files({
  session,
  workspace,
  focus,
  onFocus,
}: {
  session: SessionInfo;
  workspace: Workspace;
  focus: string;
  onFocus: (id: string) => void;
}) {
  const base = filesPath(workspace.id);
  const [sort, setSort] = useState<FileSort>('newest');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [more, setMore] = useState<WorkspaceFilePage['items']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [moreError, setMoreError] = useState('');
  const viewer = workspace.role === 'viewer';
  const picker = useRef<HTMLInputElement>(null);
  const params = (c?: string | null) =>
    new URLSearchParams({
      sort,
      ...(query ? { q: query } : {}),
      ...(deleted ? { status: 'deleted' } : {}),
      ...(c ? { cursor: c } : {}),
    }).toString();
  const page = useLoad(async () => {
    const p = await api(WorkspaceFilePageSchema, `${base}?${params()}`);
    setMore([]);
    setCursor(p.next_cursor);
    return p;
  }, [workspace.id, sort, query, deleted]);
  useEffect(() => {
    const changed = () => page.refresh();
    window.addEventListener(STUDIO_CHANGED, changed);
    return () => window.removeEventListener(STUDIO_CHANGED, changed);
  }, [page.refresh]);
  async function loadMore() {
    if (!cursor) return;
    setMoreError('');
    try {
      const p = await api(WorkspaceFilePageSchema, `${base}?${params(cursor)}`);
      setMore((m) => [...m, ...p.items]);
      setCursor(p.next_cursor);
    } catch (e) {
      setMoreError(message(e));
    }
  }
  const items = [...(page.data?.items ?? []), ...more];
  const d = page.data;
  useEffect(() => {
    if (d) noteUploadLimit(d.file_limit_bytes);
  }, [d?.file_limit_bytes]);
  return (
    <section className="panel files" aria-labelledby="files-title">
      <h2 id="files-title">Files</h2>
      <p className="small">
        Everyone in this workspace can see its files. Uploading keeps the exact
        original and its SHA-256; it never sends a file to a model or makes it
        evidence. Drop files anywhere in the studio, or pick them here.
      </p>
      <div className="files-bar">
        <button
          type="button"
          className="primary"
          disabled={viewer}
          onClick={() => picker.current?.click()}
        >
          Add files
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (list.length)
              startUploads(list, {
                ws: workspace.id,
                wsName: workspace.name,
                csrf: session.csrf_token,
                ...(d ? { limit: d.file_limit_bytes } : {}),
              });
          }}
        />
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q.trim());
          }}
        >
          <label htmlFor="files-q" className="inline">
            Find
          </label>
          <input
            id="files-q"
            value={q}
            placeholder="Name or text inside"
            maxLength={200}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="submit" className="secondary">
            Search
          </button>
          {query && (
            <button
              type="button"
              className="text"
              onClick={() => {
                setQ('');
                setQuery('');
              }}
            >
              Clear
            </button>
          )}
        </form>
        <label htmlFor="files-sort" className="inline">
          Sort
        </label>
        <select
          id="files-sort"
          value={sort}
          onChange={(e) => setSort(e.target.value as FileSort)}
        >
          {(Object.keys(SORT_TEXT) as FileSort[]).map((s) => (
            <option key={s} value={s}>
              {SORT_TEXT[s]}
            </option>
          ))}
        </select>
        <label className="chip">
          <input
            type="checkbox"
            checked={deleted}
            onChange={(e) => setDeleted(e.target.checked)}
          />
          Deleted files
        </label>
      </div>
      {d && (
        <p className="small">
          {bytesText(d.used_bytes)} of {bytesText(d.limit_bytes)} used (every
          version, deleted files included until deleted permanently). Each file
          can be up to {bytesText(d.file_limit_bytes)}.
        </p>
      )}
      <div className="files-layout">
        <Status
          loading={page.loading}
          error={page.error}
          stale={page.stale}
          retry={page.reload}
        >
          {items.length === 0 ? (
            <Empty>
              {query
                ? 'No file name or text matches.'
                : deleted
                  ? 'No deleted files.'
                  : 'No files yet. Drop files anywhere in the studio, or use Add files.'}
            </Empty>
          ) : (
            <ul className="rows file-list">
              {items.map((f) => (
                <li
                  key={f.id}
                  className={f.id === focus ? 'selected' : undefined}
                >
                  <button
                    type="button"
                    className="text file-open"
                    aria-current={f.id === focus ? 'true' : undefined}
                    onClick={() => onFocus(f.id)}
                  >
                    {f.name}
                  </button>
                  <span className="small">
                    {KIND_TEXT[f.current.kind]} ·{' '}
                    {bytesText(f.current.size_bytes)}
                    {f.current_version > 1
                      ? ` · version ${f.current_version}`
                      : ''}{' '}
                    · <time dateTime={f.created_at}>{when(f.created_at)}</time>
                  </span>
                  {f.matches.map((m) => (
                    <span key={m.line} className="small file-match">
                      Line {m.line}: {m.text}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <button
              type="button"
              className="secondary"
              onClick={() => void loadMore()}
            >
              Show older
            </button>
          )}
          {moreError && <p className="error">{moreError}</p>}
        </Status>
        {focus && (
          <FileDetail
            key={focus}
            id={focus}
            session={session}
            workspace={workspace}
            close={() => onFocus('')}
            changed={() => page.refresh()}
          />
        )}
      </div>
    </section>
  );
}

function FileDetail({
  id,
  session,
  workspace,
  close,
  changed,
}: {
  id: string;
  session: SessionInfo;
  workspace: Workspace;
  close: () => void;
  changed: () => void;
}) {
  const base = `${filesPath(workspace.id)}/${id}`;
  const detail = useLoad(
    () => api(WorkspaceFileDetailSchema, base),
    [workspace.id, id],
  );
  const [version, setVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const owner = workspace.role === 'owner';
  const writer = workspace.role !== 'viewer';
  const newVersion = useRef<HTMLInputElement>(null);
  async function act(path: string, body: unknown, after?: () => void) {
    setBusy(true);
    setError('');
    try {
      await api(z.unknown(), `${base}/${path}`, {
        csrf: session.csrf_token,
        body,
      });
      after?.();
      detail.refresh();
      changed();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="file-detail" aria-labelledby="file-detail-title">
      <Status
        loading={detail.loading}
        error={detail.error}
        stale={detail.stale}
        retry={detail.reload}
      >
        {detail.data &&
          (() => {
            const f = detail.data.file;
            const v =
              detail.data.versions.find((x) => x.version === version) ??
              detail.data.versions[0]!;
            return (
              <>
                <div className="file-detail-head">
                  <h3 id="file-detail-title">{f.name}</h3>
                  <button type="button" className="text" onClick={close}>
                    Close
                  </button>
                </div>
                {f.status === 'deleted' && (
                  <p className="notice">
                    Deleted {f.deleted_at ? when(f.deleted_at) : ''}. It stays
                    restorable until an owner deletes it permanently.
                  </p>
                )}
                <VersionFacts v={v} />
                <div className="actions">
                  <a
                    className="button secondary"
                    href={`/api/${base}/content?version=${v.version}`}
                    download={f.name}
                  >
                    Download original
                  </a>
                  {detail.data.versions.length > 1 && (
                    <>
                      <label htmlFor="file-version" className="inline">
                        Version
                      </label>
                      <select
                        id="file-version"
                        value={v.version}
                        onChange={(e) => setVersion(Number(e.target.value))}
                      >
                        {detail.data.versions.map((x) => (
                          <option key={x.version} value={x.version}>
                            {x.version} · {when(x.created_at)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <FileView base={base} name={f.name} v={v} />
                {f.links.length > 0 && (
                  <>
                    <h4>Linked records</h4>
                    <ul className="rows">
                      {f.links.map((l) => (
                        <li key={l.entity_id}>
                          {words(l.kind)}: {l.title}
                          {writer && f.status === 'active' && (
                            <button
                              type="button"
                              className="text"
                              disabled={busy}
                              onClick={() =>
                                void act('link', {
                                  entity_id: l.entity_id,
                                  linked: false,
                                })
                              }
                            >
                              Unlink
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {writer && (
                  <div className="actions">
                    {f.status === 'active' ? (
                      <>
                        {renaming === null ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setRenaming(f.name)}
                          >
                            Rename
                          </button>
                        ) : (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void act(
                                'rename',
                                {
                                  expected_version: f.current_version,
                                  name: renaming,
                                },
                                () => setRenaming(null),
                              );
                            }}
                          >
                            <label htmlFor="file-rename" className="inline">
                              New name
                            </label>
                            <input
                              id="file-rename"
                              value={renaming}
                              maxLength={200}
                              onChange={(e) => setRenaming(e.target.value)}
                            />
                            <button
                              type="submit"
                              className="secondary"
                              disabled={busy}
                            >
                              Save name
                            </button>
                            <button
                              type="button"
                              className="text"
                              onClick={() => setRenaming(null)}
                            >
                              Cancel
                            </button>
                          </form>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => newVersion.current?.click()}
                        >
                          Upload a new version
                        </button>
                        <input
                          ref={newVersion}
                          type="file"
                          hidden
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file)
                              startUploads([file], {
                                ws: workspace.id,
                                wsName: workspace.name,
                                csrf: session.csrf_token,
                                versionOf: f.id,
                              });
                          }}
                        />
                        <button
                          type="button"
                          className="text danger"
                          disabled={busy}
                          onClick={() => void act('delete', { reason: '' })}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={() => void act('restore', { reason: '' })}
                        >
                          Restore
                        </button>
                        {owner && (
                          <button
                            type="button"
                            className="text danger"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete “${f.name}” and all ${detail.data!.versions.length} of its versions permanently? This cannot be undone here. Backups made earlier still contain it until they are removed.`,
                                )
                              )
                                void act('purge', {}, close);
                            }}
                          >
                            Delete permanently
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </>
            );
          })()}
      </Status>
    </article>
  );
}

function VersionFacts({ v }: { v: WorkspaceFileVersion }) {
  return (
    <dl className="file-facts">
      <div>
        <dt>Type</dt>
        <dd>
          {KIND_TEXT[v.kind]} ({v.media_type})
          {v.type_mismatch &&
            ' · the name’s extension does not match the contents'}
        </dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>{bytesText(v.size_bytes)}</dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>
          {v.version} · {when(v.created_at)}
        </dd>
      </div>
      <div>
        <dt>Uploaded as</dt>
        <dd>
          {v.original_name}
          {v.declared_type ? ` · browser said ${v.declared_type}` : ''}
        </dd>
      </div>
      <div>
        <dt>SHA-256</dt>
        <dd>
          <code className="hash">{v.sha256}</code>
        </dd>
      </div>
    </dl>
  );
}

/** Inert viewers: text is always text, images come from a sandboxed same-origin URL. */
function FileView({
  base,
  name,
  v,
}: {
  base: string;
  name: string;
  v: WorkspaceFileVersion;
}) {
  const text = useLoad(
    async () =>
      v.has_text
        ? api(FileTextViewSchema, `${base}/text?version=${v.version}`, {
            timeoutMs: 20000,
          })
        : null,
    [base, v.version, v.has_text],
  );
  const [source, setSource] = useState(false);
  if (v.kind === 'image')
    return (
      <figure className="file-view">
        <img src={`/api/${base}/raw?version=${v.version}`} alt={name} />
      </figure>
    );
  if (!v.has_text)
    return (
      <p className="notice">
        {v.kind === 'pdf'
          ? 'PDF preview is not available in the studio yet. Download the original to open it.'
          : 'The studio has no viewer for this kind of file. Download the original to open it.'}
      </p>
    );
  return (
    <Status
      loading={text.loading}
      error={text.error}
      stale={text.stale}
      retry={text.reload}
    >
      {text.data && (
        <div className="file-view">
          {text.data.truncated && (
            <p className="small">
              Only the beginning is kept for viewing and search; the download is
              the whole file.
            </p>
          )}
          {v.kind === 'markdown' && (
            <label className="chip">
              <input
                type="checkbox"
                checked={source}
                onChange={(e) => setSource(e.target.checked)}
              />
              Show Markdown source
            </label>
          )}
          <TextView kind={v.kind} text={text.data.text} source={source} />
        </div>
      )}
    </Status>
  );
}

function TextView({
  kind,
  text,
  source,
}: {
  kind: string;
  text: string;
  source: boolean;
}) {
  const rendered = useMemo(() => {
    if (kind === 'json') {
      try {
        return { pre: JSON.stringify(JSON.parse(text), null, 2) };
      } catch {
        return { pre: text };
      }
    }
    if (kind === 'csv') return { table: parseCsv(text, 200) };
    return { pre: text };
  }, [kind, text]);
  if (kind === 'markdown' && !source && text.length <= MARKDOWN_MAX_CHARS)
    return (
      <div className="file-markdown">
        <Markdown text={text} />
      </div>
    );
  if (rendered.table)
    return (
      <div className="file-table">
        <table>
          <tbody>
            {rendered.table.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) =>
                  i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>,
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rendered.table.more && (
          <p className="small">
            Showing the first 200 rows; download for all of them.
          </p>
        )}
      </div>
    );
  return <pre className="file-text">{rendered.pre}</pre>;
}

/** A small CSV reader (quoted fields, doubled quotes, commas or tabs) for display only. */
export function parseCsv(text: string, maxRows: number) {
  const sep =
    text.split('\n', 1)[0]!.includes('\t') &&
    !text.split('\n', 1)[0]!.includes(',')
      ? '\t'
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (rows.length > maxRows) break;
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { rows: rows.slice(0, maxRows), more: rows.length > maxRows };
}
