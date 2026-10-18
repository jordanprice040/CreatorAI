import { useEffect, useState } from 'react';
import {
  EntityDetailSchema,
  HistoryEntrySchema,
  StoredEntitySchema,
  WorkspaceSchema,
  parse,
  z,
  type EntityDetail,
  type HistoryEntry,
  type StoredEntity,
  type StoredLink,
  type Workspace,
} from '@creator/contracts';

async function get<T>(schema: z.ZodType<T>, path: string): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? JSON.stringify(body.error)
        : `API error ${response.status}`;
    throw new Error(message);
  }
  return parse(schema, body);
}
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

function LinkList({
  title,
  links,
  side,
  names,
  open,
}: {
  title: string;
  links: StoredLink[];
  side: 'from' | 'to';
  names: Map<string, string>;
  open: (id: string) => void;
}) {
  if (links.length === 0) return null;
  return (
    <>
      <h3>{title}</h3>
      <ul className="links">
        {links.map((l) => {
          const other = l[side];
          return (
            <li key={l.id} className={l.retracted_at ? 'retracted' : ''}>
              <span className="relation">
                {l.relation.replaceAll('_', ' ')}
              </span>
              <button className="text" onClick={() => open(other.id)}>
                {other.kind} · {names.get(other.id) ?? other.id.slice(0, 8)} · v
                {other.version}
              </button>
              {l.retracted_at && <small> retracted</small>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** Read-only view of persisted records and their audit history. Writes go through the CLI/API. */
export function Records({ persistent }: { persistent: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [entities, setEntities] = useState<StoredEntity[]>([]);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');

  async function refresh() {
    setError('');
    try {
      const list = await get(z.array(WorkspaceSchema), 'workspaces');
      setWorkspaces(list);
      setWorkspace((current) =>
        list.some((w) => w.id === current) ? current : (list[0]?.id ?? ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Records unavailable.');
    }
  }
  useEffect(() => {
    if (persistent) void refresh();
  }, [persistent]);
  useEffect(() => {
    setDetail(null);
    if (!workspace) return;
    void (async () => {
      try {
        setEntities(
          await get(
            z.array(StoredEntitySchema),
            `workspaces/${workspace}/entities`,
          ),
        );
        setHistory(
          await get(
            z.array(HistoryEntrySchema),
            `workspaces/${workspace}/history`,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Records unavailable.');
      }
    })();
  }, [workspace]);
  async function open(id: string) {
    setError('');
    try {
      setDetail(
        await get(EntityDetailSchema, `workspaces/${workspace}/entities/${id}`),
      );
      setHistory(
        await get(
          z.array(HistoryEntrySchema),
          `workspaces/${workspace}/history?subject=${id}`,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Record unavailable.');
    }
  }
  const names = new Map(entities.map((e) => [e.id, e.title]));
  const mode = workspaces.find((w) => w.id === workspace)?.record_mode;

  return (
    <section className="panel records" aria-labelledby="records-title">
      <div className="eyebrow">06 / SAVED RECORDS</div>
      <h2 id="records-title">Records and history</h2>
      {!persistent ? (
        <p>
          Persistence is off. Set CREATOR_DATABASE_URL, run{' '}
          <code>pnpm db:migrate</code>, and restart the API to keep records.
        </p>
      ) : (
        <>
          <p>
            Saved in PostgreSQL. Every change is a new version with an audit
            event; nothing here edits history. Create records with the CLI (for
            example <code>pnpm cli seed-lineage</code>).
          </p>
          <div className="connection">
            <label htmlFor="ws" className="inline">
              Workspace
            </label>
            <select
              id="ws"
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
            >
              {workspaces.length === 0 && (
                <option value="">No workspaces yet</option>
              )}
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.record_mode === 'fixture' ? 'FIXTURE' : 'real'}
                </option>
              ))}
            </select>
            <button className="secondary" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
          {mode === 'fixture' && (
            <span className="badge">SYNTHETIC · FIXTURE RECORDS</span>
          )}
          <div className="records-grid">
            <div>
              <h3>Records</h3>
              {entities.length === 0 ? (
                <p className="small">No records in this workspace.</p>
              ) : (
                <ul className="entities">
                  {entities.map((e) => (
                    <li key={e.id}>
                      <button
                        className={`text ${detail?.entity.id === e.id ? 'selected' : ''}`}
                        onClick={() => void open(e.id)}
                      >
                        <span className="kind">{e.kind}</span> {e.title}
                        <small>
                          {' '}
                          v{e.version}
                          {e.status !== 'active' ? ` · ${e.status}` : ''}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              {detail && (
                <>
                  <h3>
                    {detail.entity.kind}: {detail.entity.title}
                  </h3>
                  <ol className="versions">
                    {detail.versions.map((v) => (
                      <li key={v.version}>
                        v{v.version} · {v.status}
                        {v.corrects_version
                          ? ` · corrects v${v.corrects_version}`
                          : ''}
                        {v.reason ? ` · ${v.reason}` : ''}
                        <small> {when(v.created_at)}</small>
                      </li>
                    ))}
                  </ol>
                  <LinkList
                    title="Outgoing links"
                    links={detail.outgoing}
                    side="to"
                    names={names}
                    open={(id) => void open(id)}
                  />
                  <LinkList
                    title="Incoming links"
                    links={detail.incoming}
                    side="from"
                    names={names}
                    open={(id) => void open(id)}
                  />
                </>
              )}
              <h3>{detail ? 'History of this record' : 'Workspace history'}</h3>
              {history.length === 0 ? (
                <p className="small">No history yet.</p>
              ) : (
                <ol className="history">
                  {history.map((h) => (
                    <li key={h.event_id}>
                      <span>#{h.sequence}</span> {h.summary}
                      <small> {when(h.occurred_at)}</small>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
