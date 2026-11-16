import { useEffect, useState, type FormEvent } from 'react';
import {
  BackupStartedSchema,
  BackupsViewSchema,
  type BackupEntry,
  type SessionInfo,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import { usePageActive } from './page-drafts.js';
import { Status, useLoad } from './ui.js';
import {
  KIND_LABEL,
  dailyText,
  runLine,
  sizeText,
  suggestDatabase,
} from './backups-text.js';
import './backups.css';

/**
 * Settings › Backups (ADR-0123, F1). Back up now, the daily backup while the app runs, a hash
 * check of any backup, and restore into a new database and folder. The server decides who may
 * use it (the studio owner alone) and runs each step as a recorded background job; this page
 * shows what it reports and polls while one runs.
 */
export function Backups({ session }: { session: SessionInfo }) {
  const data = useLoad(
    () =>
      api(BackupsViewSchema, 'settings/backups').catch((e: unknown) => {
        if (e instanceof ApiError && e.code === 'ACCESS_DENIED')
          return 'not_owner' as const;
        throw e;
      }),
    [],
  );
  const v = data.data === 'not_owner' ? null : data.data;
  const running = v?.running ?? null;
  const active = usePageActive();
  useEffect(() => {
    if (active) data.refresh();
  }, [active]);
  // While a job runs, read again every 2 s so its end shows without a reload.
  useEffect(() => {
    if (!running || !active) return;
    const t = setInterval(() => data.refresh(), 2000);
    return () => clearInterval(t);
  }, [running?.id, active]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [daily, setDaily] = useState(true);
  const [keep, setKeep] = useState('7');
  const [folder, setFolder] = useState('');
  const [restoring, setRestoring] = useState<BackupEntry | null>(null);
  const [dbName, setDbName] = useState('');
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);

  if (data.data === 'not_owner')
    return (
      <>
        <h3>Backups</h3>
        <p className="small">
          Backups hold every workspace in this studio, so only the studio owner
          can see or make them. Owning a workspace does not include it.
        </p>
      </>
    );

  async function act(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(BackupStartedSchema, path, { csrf: session.csrf_token, body });
      data.refresh();
      return true;
    } catch (e) {
      setError(message(e));
      data.refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  function startEdit() {
    if (!v) return;
    setDaily(v.settings.daily_enabled);
    setKeep(String(v.settings.keep_daily));
    setFolder(v.settings.folder);
    setError('');
    setEditing(true);
  }
  const keepN = Number(keep);
  const keepOk = Number.isInteger(keepN) && keepN >= 1 && keepN <= 60;
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!v || !keepOk || !folder.trim()) return;
    setBusy(true);
    setError('');
    try {
      await api(BackupsViewSchema, 'settings/backups/settings', {
        csrf: session.csrf_token,
        body: {
          expected_version: v.settings.version,
          daily_enabled: daily,
          keep_daily: keepN,
          folder: folder.trim(),
        },
      });
      setEditing(false);
      data.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        data.reload();
        setEditing(false);
      }
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  function startRestore(b: BackupEntry) {
    setRestoring(b);
    setDbName(suggestDatabase(b.name));
    setTarget('');
    setConfirming(false);
    setError('');
  }
  async function restore() {
    if (!restoring) return;
    const ok = await act(
      `settings/backups/${encodeURIComponent(restoring.name)}/restore`,
      { database_name: dbName.trim(), products_root: target.trim() },
    );
    if (ok) setRestoring(null);
    setConfirming(false);
  }
  const dbOk = /^[a-z][a-z0-9_]{0,62}$/.test(dbName.trim());
  const lastRestore = v?.runs.find(
    (r) => r.trigger === 'restore' && r.status === 'succeeded',
  );

  return (
    <>
      <h3 id="backups-title">Backups</h3>
      <p className="small">
        A backup is a copy of this studio&apos;s records database (every
        workspace, decision, piece of evidence and connection record) and its
        product files, with a fingerprint (SHA-256 hash) of each file so a
        changed or missing file is caught before anything is restored. Sign-ins
        to ChatGPT or Claude are not in it; sign in again after a restore. Keep
        backups as private as the studio itself. Only you, the studio owner, can
        see or make them here.
      </p>
      <Status
        loading={data.loading && !v}
        error={data.error}
        stale={data.stale}
        retry={data.reload}
      >
        {v && (
          <div className="backups">
            <dl className="facts">
              <dt>Folder</dt>
              <dd>
                <code>{v.settings.folder}</code>
                {v.settings.folder !== v.settings.default_folder && (
                  <small>
                    {' '}
                    (the studio&apos;s own folder is {v.settings.default_folder}
                    )
                  </small>
                )}
              </dd>
              <dt>Daily backup</dt>
              <dd>{dailyText(v, new Date().toISOString().slice(0, 10))}</dd>
            </dl>
            <div className="actions">
              <button
                className="primary"
                type="button"
                disabled={busy || !!running}
                onClick={() => void act('settings/backups/runs', {})}
              >
                Back up now
              </button>
              {!editing && (
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={startEdit}
                >
                  Change backup settings
                </button>
              )}
            </div>
            <div aria-live="polite">
              {running && <p className="notice">{runLine(running)}</p>}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>

            {editing && (
              <form className="backup-settings" onSubmit={(e) => void save(e)}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={daily}
                    onChange={(e) => setDaily(e.target.checked)}
                  />{' '}
                  Make a backup once a day while the app runs
                </label>
                <label htmlFor="backup-keep">Daily backups to keep</label>
                <input
                  id="backup-keep"
                  inputMode="numeric"
                  value={keep}
                  onChange={(e) => setKeep(e.target.value)}
                />
                {!keepOk && (
                  <p className="error">Enter a whole number from 1 to 60.</p>
                )}
                <p className="small">
                  Only daily backups are removed when there are more than this.
                  Backups you make, and the ones taken before an upgrade, stay
                  until you delete them.
                </p>
                <label htmlFor="backup-folder">Folder</label>
                <input
                  id="backup-folder"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="C:\CreatorAgentBackups"
                />
                <p className="small">
                  A full path outside the studio&apos;s product folder. Backups
                  already made stay where they are; this page lists the folder
                  chosen here.
                </p>
                <div className="actions">
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="primary"
                    type="submit"
                    disabled={busy || !keepOk || !folder.trim()}
                  >
                    {busy ? 'Saving…' : 'Save backup settings'}
                  </button>
                </div>
              </form>
            )}

            <h4>In the folder</h4>
            {v.folder_problem && <p className="small">{v.folder_problem}</p>}
            {v.other_studio_backups > 0 && (
              <p className="small">
                {v.other_studio_backups} backup(s) here were made by another
                studio, or by an earlier copy of this one (for example before a
                reinstall). You can check and restore them; this studio never
                removes them.
              </p>
            )}
            {!v.folder_problem && v.backups.length === 0 && (
              <p className="small">No backups yet.</p>
            )}
            {v.backups.length > 0 && (
              <ol className="rows backup-list">
                {v.backups.map((b) => (
                  <li key={b.name}>
                    <div className="backup-row">
                      <div>
                        <strong>{when(b.created_at)}</strong>{' '}
                        <span className="backup-kind">
                          {KIND_LABEL[b.kind]}
                        </span>
                        {b.other_studio && (
                          <span className="backup-kind">
                            Another studio or earlier copy
                          </span>
                        )}
                        <br />
                        <small>
                          {b.name} · {sizeText(b.bytes)} · schema{' '}
                          {b.schema_version}
                          {b.format === 'creator-backup/1'
                            ? ` · ${b.product_files} product file(s)`
                            : ' · database only'}
                        </small>
                        {b.restore_note && (
                          <>
                            <br />
                            <small>{b.restore_note}</small>
                          </>
                        )}
                      </div>
                      <div className="actions">
                        <button
                          className="secondary"
                          type="button"
                          disabled={busy || !!running}
                          onClick={() =>
                            void act(
                              `settings/backups/${encodeURIComponent(b.name)}/check`,
                              {},
                            )
                          }
                        >
                          Check
                        </button>
                        {b.restorable && (
                          <button
                            className="secondary"
                            type="button"
                            disabled={busy || !!running}
                            onClick={() => startRestore(b)}
                          >
                            Restore…
                          </button>
                        )}
                      </div>
                    </div>
                    {restoring?.name === b.name && (
                      <form
                        className="backup-restore"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (dbOk && target.trim()) setConfirming(true);
                        }}
                      >
                        <p className="small">
                          Restore makes a new, separate copy of the studio from
                          this backup. It checks every hash first and verifies
                          the copy afterwards. This studio is not changed or
                          replaced.
                        </p>
                        <label htmlFor="restore-db">New database name</label>
                        <input
                          id="restore-db"
                          value={dbName}
                          disabled={confirming}
                          onChange={(e) => setDbName(e.target.value)}
                        />
                        {!dbOk && (
                          <p className="error">
                            Use lowercase letters, digits and underscores,
                            starting with a letter.
                          </p>
                        )}
                        {dbName.trim() === v.database_name && (
                          <p className="error">
                            That is the database this studio uses.
                          </p>
                        )}
                        <label htmlFor="restore-folder">
                          New folder for the product files
                        </label>
                        <input
                          id="restore-folder"
                          value={target}
                          disabled={confirming}
                          placeholder="C:\CreatorAgentRestored\products"
                          onChange={(e) => setTarget(e.target.value)}
                        />
                        {!confirming ? (
                          <div className="actions">
                            <button
                              className="secondary"
                              type="button"
                              onClick={() => setRestoring(null)}
                            >
                              Cancel
                            </button>
                            <button
                              className="secondary strong"
                              type="submit"
                              disabled={
                                !dbOk ||
                                !target.trim() ||
                                dbName.trim() === v.database_name
                              }
                            >
                              Review restore
                            </button>
                          </div>
                        ) : (
                          <div
                            className="notice"
                            role="group"
                            aria-label="Confirm"
                          >
                            <p>
                              Restore the backup from{' '}
                              <strong>{when(b.created_at)}</strong> into a new
                              database <strong>{dbName.trim()}</strong> and the
                              folder <strong>{target.trim()}</strong>? Both must
                              be new or empty. If anything fails, what this
                              restore created is removed.
                            </p>
                            <div className="actions">
                              <button
                                className="secondary"
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirming(false)}
                              >
                                Back
                              </button>
                              <button
                                className="primary"
                                type="button"
                                disabled={busy || !!running}
                                onClick={() => void restore()}
                              >
                                {busy ? 'Starting…' : 'Restore into a new copy'}
                              </button>
                            </div>
                          </div>
                        )}
                      </form>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {lastRestore && (
              <p className="small">
                To open a restored copy, start a studio whose database is the
                restored one and whose products folder is the restored folder
                (for a development studio, set CREATOR_DATABASE_URL and
                CREATOR_PRODUCTS_ROOT; see docs/BACKUP_AND_RESTORE.md). The
                desktop app can&apos;t switch to another studio from here yet.
              </p>
            )}

            <h4>Recent backup activity</h4>
            {v.runs.length === 0 ? (
              <p className="small">Nothing yet.</p>
            ) : (
              <ol className="rows">
                {v.runs.map((r) => (
                  <li key={r.id}>
                    {runLine(r)}{' '}
                    <small>
                      · {when(r.started_at)}
                      {r.error ? ` · ${r.error}` : ''}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Status>
    </>
  );
}
