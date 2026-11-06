import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// PR #141 review L5/L7: an upload is bound to the workspace it was started in, a retry reuses
// its key and target, an oversized drop is refused before it is sent once the limit is known,
// and a session starting in the tab drops other people's transfers. transfers.ts runs with
// stand-ins for React, the studio event and XMLHttpRequest.

type Sent = {
  method: string;
  path: string;
  headers: Record<string, string>;
  xhr: FakeXhr;
};
class FakeXhr {
  static sent: Sent[] = [];
  headers: Record<string, string> = {};
  path = '';
  method = '';
  status = 0;
  responseText = '';
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, path: string) {
    this.method = method;
    this.path = path;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {
    FakeXhr.sent.push({
      method: this.method,
      path: this.path,
      headers: this.headers,
      xhr: this,
    });
  }
  abort() {
    this.onabort?.();
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

type Transfer = { id: string; ws: string; state: string; error: string };
type Mod = {
  startUploads(
    files: { name: string; size: number; type: string }[],
    to: { ws: string; wsName: string; csrf: string; limit?: number },
  ): void;
  retryTransfer(id: string, keep?: boolean): void;
  clearOtherTransfers(actor: string): void;
  noteUploadLimit(bytes: number): void;
  resetTransfers(): void;
  useTransfers(): readonly Transfer[];
};

async function load(): Promise<Mod> {
  const source = await readFile('apps/web/src/transfers.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Mod;
  const require = (name: string) =>
    name === 'react'
      ? {
          useSyncExternalStore: (_s: unknown, get: () => unknown) => get(),
        }
      : name === './oversight.js'
        ? { STUDIO_CHANGED: 'studio-changed' }
        : (() => {
            throw new Error(`unexpected import ${name}`);
          })();
  const g = globalThis as Record<string, unknown>;
  g.XMLHttpRequest = FakeXhr;
  g.window = { dispatchEvent: () => true };
  new Function('exports', 'require', code)(exports, require);
  return exports;
}

test('uploads keep their workspace, retry with the same key, and leave with their session', async () => {
  const m = await load();
  FakeXhr.sent = [];
  m.clearOtherTransfers('alice');
  const file = (name: string, size = 10) => ({
    name,
    size,
    type: 'text/plain',
  });
  m.startUploads([file('a.txt')], { ws: 'ws-A', wsName: 'A', csrf: 'c1' });
  // The person switches workspace and drops another file: each keeps its own target.
  m.startUploads([file('b.txt')], { ws: 'ws-B', wsName: 'B', csrf: 'c1' });
  assert.deepEqual(
    FakeXhr.sent.map((s) => s.path),
    ['/api/workspaces/ws-A/files', '/api/workspaces/ws-B/files'],
  );
  const firstKey = FakeXhr.sent[0]!.headers['X-Upload-Key'];
  // The first fails; Retry sends to the same workspace with the same key.
  FakeXhr.sent[0]!.xhr.onerror?.();
  const failed = m.useTransfers().find((t) => t.ws === 'ws-A')!;
  assert.equal(failed.state, 'failed');
  m.retryTransfer(failed.id);
  const retry = FakeXhr.sent[2]!;
  assert.equal(retry.path, '/api/workspaces/ws-A/files');
  assert.equal(retry.headers['X-Upload-Key'], firstKey);
  // A replay of a file deleted since is not reported as added (review N3).
  retry.xhr.answer(200, {
    stored: false,
    replayed: true,
    file: { id: 'f1', name: 'a.txt', status: 'deleted' },
  });
  assert.equal(m.useTransfers().find((t) => t.ws === 'ws-A')!.state, 'failed');
  // Once the limit is known, a drop over it is refused before it is sent (review N6).
  m.noteUploadLimit(100);
  m.startUploads([file('huge.bin', 101)], {
    ws: 'ws-A',
    wsName: 'A',
    csrf: 'c1',
  });
  assert.equal(FakeXhr.sent.length, 3);
  assert.match(
    m
      .useTransfers()
      .find((t) => t.state === 'failed' && /larger/.test(t.error))!.error,
    /larger than the studio accepts/,
  );
  // Another person's session starting in this tab removes alice's transfers (review L7).
  m.clearOtherTransfers('bob');
  assert.equal(m.useTransfers().length, 0);
  m.resetTransfers();
});
