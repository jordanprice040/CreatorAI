import { useSyncExternalStore } from 'react';
import { STUDIO_CHANGED } from './oversight.js';

// ADR-0072 (P05): uploads in progress, shown in the transfer tray on every page. The workspace
// is fixed when a file is dropped or picked, so switching workspace mid-transfer cannot send it
// elsewhere. Each upload has its own key: a retry reuses it, so the server stores it once.
// Uploads never navigate, so drafts on the page stay as they are.

export type TransferState =
  'queued' | 'uploading' | 'done' | 'duplicate' | 'failed' | 'cancelled';

export type Transfer = {
  id: string;
  ws: string;
  wsName: string;
  name: string;
  size: number;
  loaded: number;
  state: TransferState;
  error: string;
  /** The stored file, or the existing one with the same bytes. */
  fileId: string;
  fileName: string;
  /** Add as a new version of this file instead of a new file. */
  versionOf: string | null;
  link: string | null;
  keep: boolean;
};

type Internal = Transfer & {
  /** Whose session started it (review L7). */
  actor: string | null;
  file: File;
  key: string;
  csrf: string;
  xhr?: XMLHttpRequest;
};

const MAX_PARALLEL = 2;
/** The person whose session is open in this tab, stamped on each new transfer. */
let sessionActor: string | null = null;
/** The studio's per-file limit as last reported by the Files page (review N6). */
let knownLimit: number | undefined;

/** Remembers the per-file limit so a drop anywhere is refused before it is sent. */
export function noteUploadLimit(bytes: number) {
  knownLimit = bytes;
}
let items: Internal[] = [];
let snapshot: readonly Transfer[] = [];
const listeners = new Set<() => void>();

function emit() {
  snapshot = items.map(
    ({ file: _f, key: _k, csrf: _c, xhr: _x, actor: _a, ...t }) => t,
  );
  for (const l of listeners) l();
}
function patch(id: string, p: Partial<Internal>) {
  items = items.map((t) => (t.id === id ? { ...t, ...p } : t));
  emit();
}

export function useTransfers(): readonly Transfer[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

function pump() {
  const running = items.filter((t) => t.state === 'uploading').length;
  for (const t of items
    .filter((x) => x.state === 'queued')
    .slice(0, MAX_PARALLEL - running))
    send(t);
}

function send(t: Internal) {
  const xhr = new XMLHttpRequest();
  const path = t.versionOf
    ? `/api/workspaces/${t.ws}/files/${t.versionOf}/versions`
    : `/api/workspaces/${t.ws}/files`;
  xhr.open('POST', path);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.setRequestHeader('X-CSRF-Token', t.csrf);
  xhr.setRequestHeader('X-File-Name', encodeURIComponent(t.name));
  xhr.setRequestHeader('X-Upload-Key', t.key);
  if (t.file.type)
    xhr.setRequestHeader('X-Declared-Type', t.file.type.slice(0, 200));
  if (t.link) xhr.setRequestHeader('X-Link-Entity', t.link);
  if (t.keep) xhr.setRequestHeader('X-Keep-Duplicate', 'true');
  xhr.upload.onprogress = (e) => patch(t.id, { loaded: e.loaded });
  xhr.onload = () => {
    let body: {
      stored?: boolean;
      replayed?: boolean;
      file?: { id: string; name: string; status?: string };
      error?: { message?: string };
    } = {};
    try {
      body = JSON.parse(xhr.responseText) as typeof body;
    } catch {
      // handled below
    }
    if (body.replayed && body.file?.status === 'deleted') {
      // Review N3: it landed earlier, but the file has been deleted since.
      patch(t.id, {
        state: 'failed',
        fileId: body.file.id,
        fileName: body.file.name,
        error: `This upload was stored earlier as “${body.file.name}”, which has since been deleted. Restore it under Sources › Files.`,
      });
    } else if (xhr.status >= 200 && xhr.status < 300 && body.file) {
      patch(t.id, {
        state: body.stored ? 'done' : 'duplicate',
        loaded: t.size,
        fileId: body.file.id,
        fileName: body.file.name,
        error: '',
      });
      window.dispatchEvent(new Event(STUDIO_CHANGED));
      // A finished upload leaves the tray by itself; failures and duplicates wait for a choice.
      if (body.stored)
        setTimeout(() => {
          if (items.find((x) => x.id === t.id)?.state === 'done')
            dismissTransfers([t.id]);
        }, 12_000);
    } else
      patch(t.id, {
        state: 'failed',
        error: body.error?.message ?? `The upload failed (${xhr.status}).`,
      });
    pump();
  };
  xhr.onerror = () => {
    patch(t.id, {
      state: 'failed',
      error: 'The connection was lost. Retry to send it again.',
    });
    pump();
  };
  xhr.onabort = () => {
    patch(t.id, { state: 'cancelled', error: '' });
    pump();
  };
  patch(t.id, { state: 'uploading', loaded: 0, error: '', xhr });
  xhr.send(t.file);
}

export function startUploads(
  files: readonly File[],
  to: {
    ws: string;
    wsName: string;
    csrf: string;
    link?: string | null;
    versionOf?: string | null;
    limit?: number;
  },
) {
  for (const file of files) {
    const id = crypto.randomUUID();
    const limit = to.limit ?? knownLimit;
    const tooBig = limit !== undefined && file.size > limit;
    items = [
      ...items,
      {
        id,
        ws: to.ws,
        wsName: to.wsName,
        name: file.name || 'file',
        size: file.size,
        loaded: 0,
        state: tooBig ? 'failed' : 'queued',
        error: tooBig ? 'This file is larger than the studio accepts.' : '',
        fileId: '',
        fileName: '',
        versionOf: to.versionOf ?? null,
        link: to.link ?? null,
        keep: false,
        actor: sessionActor,
        file,
        key: crypto.randomUUID(),
        csrf: to.csrf,
      },
    ];
  }
  emit();
  pump();
}

export function cancelTransfer(id: string) {
  const t = items.find((x) => x.id === id);
  if (!t) return;
  if (t.state === 'uploading') t.xhr?.abort();
  else if (t.state === 'queued') patch(id, { state: 'cancelled' });
}

/** Sends again with the same upload key, so a transfer that did land is not stored twice. */
export function retryTransfer(id: string, keep = false) {
  const t = items.find((x) => x.id === id);
  if (!t || t.state === 'uploading' || t.state === 'queued') return;
  patch(id, { state: 'queued', keep: keep || t.keep, error: '' });
  pump();
}

export function dismissTransfers(ids?: readonly string[]) {
  items = items.filter((t) =>
    ids ? !ids.includes(t.id) : t.state === 'uploading' || t.state === 'queued',
  );
  emit();
}

/**
 * Review L7: when a session starts in this tab, transfers left by anyone else (a session that
 * expired, or a sign-out from another tab) are cancelled and removed, as notes drafts are.
 */
export function clearOtherTransfers(actor: string) {
  sessionActor = actor;
  const others = items.filter((t) => t.actor !== actor);
  if (!others.length) return;
  for (const t of others) if (t.state === 'uploading') t.xhr?.abort();
  items = items.filter((t) => t.actor === actor);
  emit();
}

/** Clears everything on sign-out so the next person on this tab sees nothing. */
export function resetTransfers() {
  sessionActor = null;
  for (const t of items) if (t.state === 'uploading') t.xhr?.abort();
  items = [];
  emit();
}
