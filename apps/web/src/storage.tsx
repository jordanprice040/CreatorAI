import { useEffect, useRef, useState } from 'react';
import {
  STORAGE_CLEANUP_CONFIRMATION,
  StorageCleanupResultSchema,
  StorageReportSchema,
  type SessionInfo,
  type StorageCleanupResult,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { Status, useLoad } from './ui.js';
import { removeLabel, resultText, sizeText } from './storage-text.js';
import './storage.css';

const DAYS = [7, 14, 30, 90] as const;
const KIND = { task: 'Task workspace', merge: 'Merge workspace' } as const;

/**
 * ADR-0121 (F10): Monitor > Storage. Disk used per project, and "Remove old build workspaces",
 * which shows exactly what it would remove and why everything else stays, asks first, keeps
 * every verified package (hashed before and after) and records the cleanup in the audit.
 */
export function Storage({ session }: { session: SessionInfo }) {
  const [days, setDays] = useState<number>(14);
  const data = useLoad(
    () => api(StorageReportSchema, `storage?older_than_days=${days}`),
    [days],
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StorageCleanupResult | null>(null);
  // Review N-4: focus moves to the confirming button when the confirmation appears.
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) confirmButton.current?.focus();
  }, [confirming]);
  const s = data.data;
  const projectName = (ws: string | null) =>
    s?.projects.find((p) => p.workspace_id === ws)?.name ?? 'Unknown project';

  async function remove() {
    if (!s) return;
    setBusy(true);
    setError('');
    try {
      const r = await api(StorageCleanupResultSchema, 'storage/cleanup', {
        csrf: session.csrf_token,
        body: {
          older_than_days: s.cleanup.older_than_days,
          plan_hash: s.cleanup.plan_hash,
          confirmation: STORAGE_CLEANUP_CONFIRMATION,
        },
        timeoutMs: 120000,
      });
      setResult(r);
      setConfirming(false);
      data.refresh();
    } catch (e) {
      setError(message(e));
      setConfirming(false);
      data.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel storage">
      <h2>Storage</h2>
      <p className="small">
        Space the studio uses on this computer, per project. Only build
        workspaces can be removed here; repositories, packages, records,
        previews, files and backups always stay.
      </p>
      <Status
        loading={data.loading}
        error={data.error}
        stale={data.stale}
        retry={data.reload}
      />
      {s && (
        <>
          <p className="small">Measured {when(s.measured_at)}.</p>
          {s.projects.length ? (
            <div className="storage-scroll">
              <table className="storage-table">
                <thead>
                  <tr>
                    <th scope="col">Project</th>
                    <th scope="col">Repositories</th>
                    <th scope="col">Build workspaces</th>
                    <th scope="col">Packages</th>
                    <th scope="col">Records</th>
                    <th scope="col">Files</th>
                    <th scope="col">Previews</th>
                  </tr>
                </thead>
                <tbody>
                  {s.projects.map((p) => (
                    <tr key={p.workspace_id}>
                      <th scope="row">
                        {p.name}
                        {p.fixture && <span className="badge">sample</span>}
                        {p.study && <span className="badge">study</span>}
                        <div className="small">
                          {p.products} product{p.products === 1 ? '' : 's'}
                        </div>
                      </th>
                      <td>{sizeText(p.repositories)}</td>
                      <td>
                        {sizeText(p.build_workspaces)}
                        <div className="small">
                          {p.build_workspace_count} workspace
                          {p.build_workspace_count === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td>
                        {sizeText(p.packages)}
                        <div className="small">
                          {p.verified_packages} verified
                        </div>
                      </td>
                      <td>{sizeText(p.records)}</td>
                      <td>{sizeText(p.files)}</td>
                      <td>
                        <div className="small">
                          {p.previews_live} open, {p.previews_ended} ended (no
                          files of their own)
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>You don't own any projects yet.</p>
          )}
          {s.studio.length > 0 && (
            <>
              <h3>Studio-wide</h3>
              <ul className="rows">
                {s.studio.map((i) => (
                  <li key={i.key}>
                    <strong>{i.label}</strong>: {sizeText(i.bytes)}.{' '}
                    <span className="small">{i.note}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Remove old build workspaces</h3>
          <p className="small">
            A task's workspace is offered only when its latest commit is in a
            verified package whose files still match their recorded hashes,
            nothing in it is uncommitted or ignored, and it hasn't changed for
            the days you pick. Its commits stay in the product's repository, and
            the workspace comes back by itself if you build that task again. A
            merge workspace is offered when its merge is already in the
            product's repository.
          </p>
          <label className="storage-days">
            Not changed for{' '}
            <select
              value={days}
              disabled={busy}
              onChange={(e) => {
                setDays(Number(e.target.value));
                setConfirming(false);
              }}
            >
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          {s.cleanup.packages_failed.length > 0 && (
            <p className="error" role="alert">
              {s.cleanup.packages_failed.length === 1
                ? '1 verified package no longer matches its recorded hashes.'
                : `${s.cleanup.packages_failed.length} verified packages no longer match their recorded hashes.`}{' '}
              {s.cleanup.packages_failed
                .map((c) => c.reason ?? 'Unknown reason.')
                .join(' ')}{' '}
              Workspaces they came from are kept.
            </p>
          )}
          {s.cleanup.remove.length ? (
            <>
              <p>
                {s.cleanup.remove.length} can go, freeing{' '}
                {sizeText(s.cleanup.remove_bytes)}. Checked{' '}
                {s.cleanup.packages_checked} verified package
                {s.cleanup.packages_checked === 1 ? '' : 's'} first.
              </p>
              <ul className="rows storage-list">
                {s.cleanup.remove.map((r) => (
                  <li key={`${r.product_id}/${r.name}`}>
                    <strong>{projectName(r.workspace_id)}</strong> ·{' '}
                    {KIND[r.kind]} {r.name.slice(0, 8)} · commit{' '}
                    {r.head.slice(0, 12)} · last changed{' '}
                    {when(r.last_changed_at)} · {sizeText(r.bytes)}
                  </li>
                ))}
              </ul>
              {!confirming ? (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setResult(null);
                    setError('');
                    setConfirming(true);
                  }}
                >
                  Remove old build workspaces…
                </button>
              ) : (
                <div
                  className="storage-confirm"
                  role="group"
                  aria-label="Confirm removal"
                >
                  <p>
                    Remove the {s.cleanup.remove.length} workspace
                    {s.cleanup.remove.length === 1 ? '' : 's'} listed above?
                    This deletes their checked-out files from this computer.
                    Packages, repositories and records stay, and the cleanup is
                    recorded in the audit.
                  </p>
                  <button
                    ref={confirmButton}
                    type="button"
                    className="secondary danger"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    {busy
                      ? 'Removing…'
                      : removeLabel(
                          s.cleanup.remove.length,
                          s.cleanup.remove_bytes,
                        )}
                  </button>{' '}
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          ) : (
            <p>Nothing to remove right now.</p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <div role="status">
              <p>
                {resultText({
                  removed: result.removed.length,
                  failed: result.failed.length,
                  bytes_freed: result.bytes_freed,
                  packages_changed: result.packages_changed.length,
                })}
              </p>
              {result.failed.length > 0 && (
                <ul className="rows">
                  {result.failed.map((f) => (
                    <li key={`${f.product_id}/${f.name}`}>
                      {f.name.slice(0, 8)}: {f.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {s.cleanup.keep.length > 0 && (
            <details className="storage-kept">
              <summary>
                {s.cleanup.keep.length} build workspace
                {s.cleanup.keep.length === 1 ? '' : 's'} kept, and why
              </summary>
              <ul className="rows">
                {s.cleanup.keep.map((k) => (
                  <li key={`${k.product_id}/${k.name}`}>
                    <strong>{projectName(k.workspace_id)}</strong> ·{' '}
                    {k.name.slice(0, 8)} · {sizeText(k.bytes)}: {k.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {s.history.length > 0 && (
            <>
              <h3>Recent cleanups</h3>
              <ul className="rows">
                {s.history.map((h) => (
                  <li key={h.id}>
                    {when(h.occurred_at)}:{' '}
                    {h.action === 'storage.cleanup.intent'
                      ? h.interrupted
                        ? `asked to remove ${h.removed}; no outcome was recorded, so it stopped part-way. If the Build page says the product is locked, use its Recover`
                        : `asked to remove ${h.removed}`
                      : `removed ${h.removed}, ${h.failed} left alone, freed ${sizeText(h.bytes_freed)}; packages ${h.packages_ok ? 'all still match' : 'changed, look at them'}`}
                    .
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
