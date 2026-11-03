import { useEffect, useRef, useState } from 'react';
import { useShown } from './page-active.js';
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
  type SessionInfo,
  type StoredLink,
  type Workspace,
} from '@creator/contracts';
import { api, message, words } from './oversight.js';
import {
  Empty,
  Stamp,
  Status,
  eventText,
  shortId,
  useLoad,
  type View,
} from './ui.js';
import { canArchive, REASON_MAX } from './owner-actions.js';
import { ReasonForm } from './reason-form.js';

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
  return <FieldList body={body} depth={0} />;
}
const plain = (v: unknown) =>
  v === null ||
  typeof v === 'string' ||
  typeof v === 'number' ||
  typeof v === 'boolean';
/** Nested objects and lists become indented field lists instead of JSON text. */
function FieldList({
  body,
  depth,
}: {
  body: Record<string, unknown> | unknown[];
  depth: number;
}) {
  const entries = Array.isArray(body)
    ? body.map((v, i) => [`#${i + 1}`, v] as const)
    : Object.entries(body);
  return (
    <dl className={depth ? 'fields nested' : 'fields'}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k.startsWith('#') ? k : words(k)}</dt>
          <dd>
            <FieldValue v={v} depth={depth} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
function FieldValue({ v, depth }: { v: unknown; depth: number }) {
  if (v === null) return <>—</>;
  if (plain(v)) return <>{String(v).slice(0, 1200)}</>;
  if (Array.isArray(v) && v.every(plain))
    return <>{v.map((x) => (x === null ? '—' : String(x))).join('; ')}</>;
  if (depth >= 3 || typeof v !== 'object')
    return <>{JSON.stringify(v).slice(0, 1200)}</>;
  return <FieldList body={v as Record<string, unknown>} depth={depth + 1} />;
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
 * what. Records change through the views that own them (decisions, selection…); the one edit
 * here is archiving a hand-curated record (idea, problem, option…) that is no longer wanted,
 * which was `pnpm cli archive` only.
 */
export function Catalog({
  session,
  workspace,
  focus,
  onFocus,
  names: actorName,
  open: openView,
}: {
  session: SessionInfo;
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
  // The open record's "Archive…" form; closed whenever another record opens.
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState('');
  const [names, setNames] = useState(new Map<string, string>());
  useEffect(() => {
    if (list.data)
      setNames((m) => {
        const n = new Map(m);
        for (const e of list.data!) n.set(e.id, e.title);
        return n;
      });
  }, [list.data]);
  // The open record is read again when this tab is shown again (audit L-10); a return keeps
  // what is on screen until the new read arrives, and a traced lineage stays open.
  const shown = useShown();
  const openFor = useRef('');
  useEffect(() => {
    const key = `${workspace.id}:${selected}`;
    if (openFor.current !== key) {
      openFor.current = key;
      setDetail(null);
      setLineage(null);
      setActivity([]);
      setArchiving(false);
      setNotice('');
    }
    if (!selected) return;
    setError('');
    let stop = false;
    void (async () => {
      try {
        const d = await api(EntityDetailSchema, `${base}/entities/${selected}`);
        if (stop) return;
        setDetail(d);
        setNames((m) => new Map(m).set(d.entity.id, d.entity.title));
        const page = await api(
          ActivityPageSchema,
          `${base}/activity?subject=${selected}&limit=30`,
        );
        if (!stop) setActivity(page.entries);
      } catch (e) {
        if (!stop) setError(message(e));
      }
    })();
    return () => {
      stop = true;
    };
  }, [selected, workspace.id, shown]);
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
      <h2 id="cat-title">Library</h2>
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
        <div className="detail-pane">
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
                {canArchive(e, workspace.role) && !archiving && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setNotice('');
                      setArchiving(true);
                    }}
                  >
                    Archive…
                  </button>
                )}
              </div>
              {notice && (
                <p className="small" role="status">
                  {notice}
                </p>
              )}
              {archiving && canArchive(e, workspace.role) && (
                <ReasonForm
                  id={`archive-${e.id}`}
                  label={`Why archive this ${words(e.kind)}`}
                  placeholder="e.g. duplicate of a newer problem"
                  note="An archived record leaves the pickers and lists that show active records, here and on the other pages. Its versions, links and history are kept. It can't be made active again."
                  confirm="Archive it"
                  busyLabel="Archiving…"
                  keep="Keep it"
                  max={REASON_MAX.archive}
                  onCancel={() => setArchiving(false)}
                  onConfirm={async (reason) => {
                    try {
                      await api(
                        z.unknown(),
                        `${base}/entities/${e.id}/archive`,
                        {
                          csrf: session.csrf_token,
                          body: { expected_version: e.version, reason },
                        },
                      );
                    } catch (err) {
                      return message(err);
                    }
                    setArchiving(false);
                    setNotice(
                      'Archived. Set Status to “Archived” or “Any status” to find it again.',
                    );
                    try {
                      setDetail(
                        await api(
                          EntityDetailSchema,
                          `${base}/entities/${e.id}`,
                        ),
                      );
                    } catch (err) {
                      setError(message(err));
                    }
                    list.refresh();
                    return null;
                  }}
                />
              )}
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
                      {eventText(h.summary)}{' '}
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
