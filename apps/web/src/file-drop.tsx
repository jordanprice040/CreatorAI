import { useEffect, useRef, useState } from 'react';
import { bytesText, type Workspace } from '@creator/contracts';
import {
  cancelTransfer,
  dismissTransfers,
  retryTransfer,
  startUploads,
  useTransfers,
} from './transfers.js';
import type { View } from './pages.js';

const hasFiles = (e: DragEvent) =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');

/**
 * ADR-0072 (P05): drop files anywhere in the studio. While files are dragged over the window an
 * overlay names the workspace they will go to; dropping uploads them to its Files and the tray
 * shows progress. The page underneath is never navigated or reloaded, so its drafts stay. A drop
 * outside the overlay is caught too, so the browser never replaces the studio with the file.
 */
export function FileDrop({
  workspace,
  csrf,
  open,
}: {
  workspace: Workspace;
  csrf: string;
  open: (view: View, id?: string) => void;
}) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  // The workspace at the moment of the drop, never a later one.
  const target = useRef(workspace);
  target.current = workspace;
  const viewer = workspace.role === 'viewer';
  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = viewer ? 'none' : 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      const ws = target.current;
      if (!files.length || ws.role === 'viewer') return;
      startUploads(files, { ws: ws.id, wsName: ws.name, csrf });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [csrf, viewer]);
  return (
    <>
      {over && (
        <div className="file-drop-overlay" role="status" aria-live="polite">
          <div>
            <strong>
              {viewer
                ? 'You can read this workspace but not add files.'
                : `Drop to add to Files in “${workspace.name}”`}
            </strong>
            {!viewer && (
              <span>
                Kept exactly as they are. Nothing is sent to a model or marked
                as evidence. This page and its drafts stay open.
              </span>
            )}
          </div>
        </div>
      )}
      <TransferTray open={open} ws={workspace.id} />
    </>
  );
}

const STATE_TEXT = {
  queued: 'Waiting',
  uploading: 'Uploading',
  done: 'Added',
  duplicate: 'Already in Files',
  failed: 'Failed',
  cancelled: 'Cancelled',
} as const;

function TransferTray({
  open,
  ws,
}: {
  open: (view: View, id?: string) => void;
  ws: string;
}) {
  const transfers = useTransfers();
  const [hidden, setHidden] = useState(false);
  if (!transfers.length) return null;
  const finished = transfers.filter(
    (t) => t.state !== 'uploading' && t.state !== 'queued',
  );
  return (
    <aside className="transfer-tray" aria-label="File transfers">
      <div className="transfer-head">
        <strong>Files ({transfers.length})</strong>
        <button
          type="button"
          className="text"
          aria-expanded={!hidden}
          onClick={() => setHidden((h) => !h)}
        >
          {hidden ? 'Show' : 'Hide'}
        </button>
        {!hidden && finished.length > 0 && (
          <button
            type="button"
            className="text"
            onClick={() => dismissTransfers()}
          >
            Clear finished
          </button>
        )}
      </div>
      <ul hidden={hidden}>
        {transfers.map((t) => (
          <li key={t.id} className={`transfer state-${t.state}`}>
            <div className="transfer-line">
              <span className="transfer-name" title={t.name}>
                {t.name}
              </span>
              <span className="small">
                {STATE_TEXT[t.state]} · {bytesText(t.size)} · {t.wsName}
              </span>
            </div>
            {t.state === 'uploading' && (
              <progress
                max={t.size || 1}
                value={t.loaded}
                aria-label={`Uploading ${t.name}`}
              />
            )}
            {t.error && <p className="error small">{t.error}</p>}
            {t.state === 'duplicate' && (
              <p className="small">
                The same bytes are already stored as “{t.fileName}”.
              </p>
            )}
            <div className="transfer-actions">
              {(t.state === 'uploading' || t.state === 'queued') && (
                <button
                  type="button"
                  className="text"
                  onClick={() => cancelTransfer(t.id)}
                >
                  Cancel
                </button>
              )}
              {(t.state === 'failed' || t.state === 'cancelled') && (
                <button
                  type="button"
                  className="text"
                  onClick={() => retryTransfer(t.id)}
                >
                  Retry
                </button>
              )}
              {t.state === 'duplicate' && (
                <button
                  type="button"
                  className="text"
                  onClick={() => retryTransfer(t.id, true)}
                >
                  Keep both
                </button>
              )}
              {(t.state === 'done' || t.state === 'duplicate') &&
                t.fileId &&
                t.ws === ws && (
                  <button
                    type="button"
                    className="text"
                    onClick={() => open('files', t.fileId)}
                  >
                    Open
                  </button>
                )}
              {t.state !== 'uploading' && t.state !== 'queued' && (
                <button
                  type="button"
                  className="text"
                  onClick={() => dismissTransfers([t.id])}
                >
                  Dismiss
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
