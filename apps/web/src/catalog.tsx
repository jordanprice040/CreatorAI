import { useEffect, useState } from 'react';
import {
  ActivityPageSchema,
  EntityDetailSchema,
  StoredEntitySchema,
  StoredKindSchema,
  StoredLinkSchema,
  provenanceOrigin,
  z,
  type ActivityEntry,
  type EntityDetail,
  type StoredLink,
  type Workspace,
} from '@creator/contracts';
import { api, message, words } from './oversight.js';
import { Empty, Stamp, Status, shortId, useLoad, type View } from './ui.js';

const LineageSchema = z.array(
  z.strictObject({ depth: z.number(), link: StoredLinkSchema }),
);
type Lineage = z.infer<typeof LineageSchema>;

/** A record body as labeled fields; nested values stay readable without raw JSON. */
function Fields({ body }: { body: Record<string, unknown> | null }) {
  if (!body)
    return (
      <p className="small">
        Redacted: only the identity, versions and hashes remain.
      </p>
    );
  const show = (v: unknown): string =>
    v === null
      ? '—'
      : typeof v === 'string'
        ? v
        : typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : Array.isArray(v)
            ? v.map(show).join('; ')
            : JSON.stringify(v);
  return (
    <dl className="fields">
      {Object.entries(body).map(([k, v]) => (
        <div key={k}>
          <dt>{words(k)}</dt>
          <dd>{show(v).slice(0, 1200)}</dd>
        </div>
      ))}
    </dl>
  );
}

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
      <ul className="rows">
        {links.map((l) => {
          const other = l[side];
          return (
            <li key={l.id} className={l.retracted_at ? 'retracted' : ''}>
              <span className="relation">{words(l.relation)}</span>{' '}
              <button className="text" onClick={() => open(other.id)}>
                {words(other.kind)} ·{' '}
                {names.get(other.id)?.slice(0, 90) ?? shortId(other.id)} · v
                {other.version}
              </button>
              {l.retracted_at && <small> · retracted</small>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/**
 * Every saved record with filters, versions, typed links, bounded lineage and who changed
 * what. Read-only: records change through the views that own them (decisions, selection…).
 */
export function Catalog({
  workspace,
  focus,
  onFocus,
  names: actorName,
  open: openView,
}: {
  workspace: Workspace;
  /** An open record id, or `kind:<kind>` to filter. */
  focus: string;
  onFocus: (focus: string) => void;
  names: (id: string) => string;
  open: (view: View, id?: string, q?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const preset = focus.startsWith('kind:') ? focus.slice(5) : '';
  const [kind, setKind] = useState(preset);
  const [status, setStatus] = useState('active');
  const selected = focus.startsWith('kind:') ? '' : focus;
  useEffect(() => {
    if (preset) setKind(preset);
  }, [preset]);
  const list = useLoad(
    () =>
      api(
        z.array(StoredEntitySchema),
        `${base}/entities?${new URLSearchParams({
          ...(kind ? { kind } : {}),
          ...(status ? { status } : {}),
        }).toString()}`,
      ),
    [workspace.id, kind, status],
  );
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const [direction, setDirection] = useState<'upstream' | 'downstream'>(
    'upstream',
  );
  const [depth, setDepth] = useState(3);
  const [error, setError] = useState('');
  const [names, setNames] = useState(new Map<string, string>());
  useEffect(() => {
    if (list.data)
      setNames((m) => {
        const n = new Map(m);
        for (const e of list.data!) n.set(e.id, e.title);
        return n;
      });
  }, [list.data]);
  useEffect(() => {
    setDetail(null);
    setLineage(null);
    setActivity([]);
    if (!selected) return;
    setError('');
    void (async () => {
      try {
        const d = await api(EntityDetailSchema, `${base}/entities/${selected}`);
        setDetail(d);
        setNames((m) => new Map(m).set(d.entity.id, d.entity.title));
        setActivity(
          (
            await api(
              ActivityPageSchema,
              `${base}/activity?subject=${selected}&limit=30`,
            )
          ).entries,
        );
      } catch (e) {
        setError(message(e));
      }
    })();
  }, [selected, workspace.id]);
  async function trace() {
    if (!selected) return;
    setError('');
    try {
      setLineage(
        await api(
          LineageSchema,
          `${base}/entities/${selected}/lineage?direction=${direction}&depth=${depth}`,
        ),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  const e = detail?.entity;
  return (
    <section className="panel" aria-labelledby="cat-title">
      <h2 id="cat-title">Catalog</h2>
      <p>
        Every saved record, its versions and links. Nothing here edits history:
        a change is a new version with an audit event.
      </p>
      <div className="filters">
        <label htmlFor="cat-kind" className="inline">
          Kind
        </label>
        <select
          id="cat-kind"
          value={kind}
          onChange={(x) => setKind(x.target.value)}
        >
          <option value="">All kinds</option>
          {StoredKindSchema.options.map((k) => (
            <option key={k} value={k}>
              {words(k)}
            </option>
          ))}
        </select>
        <label htmlFor="cat-status" className="inline">
          Status
        </label>
        <select
          id="cat-status"
          value={status}
          onChange={(x) => setStatus(x.target.value)}
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="redacted">Redacted</option>
        </select>
        <button className="secondary" onClick={list.reload}>
          Refresh
        </button>
      </div>
      <div className="records-grid">
        <div>
          <Status loading={list.loading} error={list.error} retry={list.reload}>
            {list.data && list.data.length === 0 ? (
              <Empty>No records match these filters.</Empty>
            ) : (
              <>
                <p className="small">
                  {list.data?.length ?? 0} records
                  {list.data?.length === 500
                    ? ' (first 500; narrow the filters)'
                    : ''}
                </p>
                <ul className="rows entities">
                  {list.data?.map((x) => (
                    <li key={x.id}>
                      <button
                        className="text"
                        aria-current={x.id === selected}
                        onClick={() => onFocus(x.id)}
                      >
                        <span className="kind">{words(x.kind)}</span> {x.title}
                      </button>
                      <small>
                        {' '}
                        v{x.version}
                        {x.status !== 'active' ? ` · ${x.status}` : ''}
                        {x.kind === 'product' && x.body?.stage
                          ? ` · stage ${words(String(x.body.stage))}`
                          : ''}
                        {x.kind === 'run' && x.body?.state
                          ? ` · ${words(String(x.body.state))}`
                          : ''}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Status>
        </div>
        <div>
          {!selected ? (
            <Empty>
              Select a record to see its versions, links and history.
            </Empty>
          ) : !e ? (
            <Status loading={!error} error={error} />
          ) : (
            <article aria-labelledby="rec-title">
              <span className="kind">{words(e.kind)}</span>
              <h3 id="rec-title" className="question">
                {e.title}
              </h3>
              <p className="small">
                v{e.version} · {e.status} · id <code>{e.id}</code>
                {e.fixture ? ' · fixture' : ''}
              </p>
              <div className="actions">
                {e.kind === 'problem' && (
                  <button
                    className="secondary"
                    onClick={() => openView('compare', e.id)}
                  >
                    Compare its alternatives
                  </button>
                )}
                {(e.kind === 'claim' || e.kind === 'source') && (
                  <button
                    className="secondary"
                    onClick={() => openView('evidence', `${e.kind}:${e.id}`)}
                  >
                    Inspect evidence
                  </button>
                )}
                <button
                  className="secondary"
                  onClick={() => openView('search', '', e.id)}
                >
                  Find mentions of this id
                </button>
              </div>
              <Fields body={e.body} />
              <h3>Versions</h3>
              <ol className="rows">
                {detail.versions.map((v) => (
                  <li key={v.version}>
                    v{v.version} · {v.status}
                    {v.corrects_version
                      ? ` · corrects v${v.corrects_version}`
                      : ''}
                    {v.reason ? ` · ${v.reason}` : ''}{' '}
                    <Stamp actor={actorName(v.actor_id)} at={v.created_at} />
                  </li>
                ))}
              </ol>
              <LinkList
                title="Links from this record"
                links={detail.outgoing}
                side="to"
                names={names}
                open={onFocus}
              />
              <LinkList
                title="Links to this record"
                links={detail.incoming}
                side="from"
                names={names}
                open={onFocus}
              />
              <h3>Lineage</h3>
              <div className="filters">
                <label htmlFor="lin-dir" className="inline">
                  Direction
                </label>
                <select
                  id="lin-dir"
                  value={direction}
                  onChange={(x) =>
                    setDirection(x.target.value as typeof direction)
                  }
                >
                  <option value="upstream">Where it came from</option>
                  <option value="downstream">What came from it</option>
                </select>
                <label htmlFor="lin-depth" className="inline">
                  Steps
                </label>
                <select
                  id="lin-depth"
                  value={depth}
                  onChange={(x) => setDepth(Number(x.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={() => void trace()}>
                  Trace
                </button>
              </div>
              {lineage &&
                (lineage.length === 0 ? (
                  <Empty>
                    No {direction} links within {depth} steps.
                  </Empty>
                ) : (
                  <ol className="rows lineage">
                    {lineage.map(({ depth: d, link }) => {
                      // The step's far end: the origin going upstream, the descendant going down.
                      const originIsTo =
                        provenanceOrigin[link.relation] === 'to';
                      const origin = originIsTo ? link.to : link.from;
                      const descendant = originIsTo ? link.from : link.to;
                      const shown =
                        direction === 'upstream' ? origin : descendant;
                      return (
                        <li
                          key={link.id}
                          style={{ paddingLeft: `${(d - 1) * 14}px` }}
                        >
                          <small>step {d} · </small>
                          <span className="relation">
                            {words(link.relation)}
                          </span>{' '}
                          <button
                            className="text"
                            onClick={() => onFocus(shown.id)}
                          >
                            {words(shown.kind)} ·{' '}
                            {names.get(shown.id)?.slice(0, 80) ??
                              shortId(shown.id)}{' '}
                            · v{shown.version}
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ))}
              <p className="small">
                Lineage follows provenance (what a record was derived from or
                supported by), at most 8 steps.
              </p>
              <h3>History of this record</h3>
              {activity.length === 0 ? (
                <Empty>No history yet.</Empty>
              ) : (
                <ol className="history">
                  {activity.map((h) => (
                    <li key={h.event_id}>
                      {h.summary}{' '}
                      <Stamp
                        actor={`${h.actor.display_name}${h.actor.kind === 'human' ? '' : ` (${h.actor.kind})`}`}
                        at={h.occurred_at}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </article>
          )}
          {error && e && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <p className="small">
        Times are in your browser’s time zone (
        {Intl.DateTimeFormat().resolvedOptions().timeZone}).
      </p>
    </section>
  );
}
