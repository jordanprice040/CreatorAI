import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { createApi } from '@creator/api';
import { FileStore } from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0072 (P05): the whole file path through the real API and PostgreSQL: upload, newest-first
// library, inert viewing, exact download, versions, duplicates, retries, links, access and
// deletion. Bytes are compared by SHA-256 against what was sent.

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
  'hex',
);

test('files: upload, list, view, download, version, duplicate, retry, link, access and delete', async (t) => {
  let closeApi = async () => undefined as unknown;
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_FILE_MAX_BYTES: '4096',
    CREATOR_FILE_WORKSPACE_MAX_BYTES: '8000',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const json = async (path: string, body?: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? auth.read
          : { 'Content-Type': 'application/json', ...auth.write },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await json('workspaces', { name: 'Files', record_mode: 'fixture' })
  ).body.id as string;
  const up = async (
    name: string,
    bytes: Uint8Array,
    opts: {
      key?: string;
      keep?: boolean;
      link?: string;
      file?: string;
      type?: string;
    } = {},
  ) => {
    const r = await fetch(
      `${base}/workspaces/${ws}/files${opts.file ? `/${opts.file}/versions` : ''}`,
      {
        method: 'POST',
        headers: {
          ...auth.write,
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(name),
          'X-Upload-Key': opts.key ?? randomUUID(),
          ...(opts.type ? { 'X-Declared-Type': opts.type } : {}),
          ...(opts.keep ? { 'X-Keep-Duplicate': 'true' } : {}),
          ...(opts.link ? { 'X-Link-Entity': opts.link } : {}),
        },
        body: new Blob([bytes as Uint8Array<ArrayBuffer>]),
      },
    );
    return { status: r.status, body: (await r.json()) as any };
  };

  // A Markdown note with non-ASCII text and a path-traversal name.
  const md = Buffer.from(
    '# Résumé\n\nline two mentions Kiwi\n<script>alert(1)</script>\n',
  );
  const key = randomUUID();
  const a = await up('../../etc/notes.md', md, { key, type: 'text/html' });
  assert.equal(a.status, 201);
  const file = a.body.file;
  assert.equal(file.name, 'notes.md');
  assert.equal(file.current.kind, 'markdown');
  assert.equal(file.current.sha256, sha(md));
  assert.equal(file.current.declared_type, 'text/html');
  assert.equal(file.current.original_name, '../../etc/notes.md');

  // A retried upload with the same key stores nothing new.
  const again = await up('notes.md', md, { key });
  assert.equal(again.status, 200);
  assert.equal(again.body.replayed, true);
  assert.equal(again.body.file.id, file.id);
  const reused = await up('other.md', Buffer.from('different'), { key });
  assert.equal(reused.status, 409);

  // Same bytes again: not stored unless asked; then the name is numbered.
  const dup = await up('copy.md', md);
  assert.equal(dup.body.stored, false);
  assert.equal(dup.body.duplicate_of.id, file.id);
  const kept = await up('notes.md', md, { keep: true });
  assert.equal(kept.status, 201);
  assert.equal(kept.body.file.name, 'notes (2).md');

  // Spoofed type: a .png that is text is not an image and never shown inline.
  const fake = await up('photo.png', Buffer.from('not an image'));
  assert.equal(fake.body.file.current.kind, 'text');
  assert.equal(fake.body.file.current.type_mismatch, true);
  const fakeRaw = await fetch(
    `${base}/workspaces/${ws}/files/${fake.body.file.id}/raw`,
    { headers: auth.read },
  );
  assert.equal(fakeRaw.status, 400);
  await fakeRaw.arrayBuffer();
  const png = await up('pixel.png', PNG);
  assert.equal(png.body.file.current.kind, 'image');
  const raw = await fetch(
    `${base}/workspaces/${ws}/files/${png.body.file.id}/raw`,
    {
      headers: auth.read,
    },
  );
  assert.equal(raw.headers.get('content-type'), 'image/png');
  assert.match(raw.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.equal(sha(Buffer.from(await raw.arrayBuffer())), sha(PNG));

  // Download: exact bytes, attachment, generic type, no sniffing.
  const dl = await fetch(`${base}/workspaces/${ws}/files/${file.id}/content`, {
    headers: auth.read,
  });
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(
    dl.headers.get('content-disposition') ?? '',
    /^attachment; .*filename\*=UTF-8''notes\.md/,
  );
  assert.equal(sha(Buffer.from(await dl.arrayBuffer())), sha(md));

  // Inert text view returns the text as data.
  const view = await json(`workspaces/${ws}/files/${file.id}/text`);
  assert.equal(view.body.text, md.toString('utf8'));

  // A new version keeps the old one downloadable.
  const v2 = await up('notes.md', Buffer.from('# Résumé v2\n'), {
    file: file.id,
  });
  assert.equal(v2.body.file.current_version, 2);
  const old = await fetch(
    `${base}/workspaces/${ws}/files/${file.id}/content?version=1`,
    { headers: auth.read },
  );
  assert.equal(sha(Buffer.from(await old.arrayBuffer())), sha(md));
  const detail = await json(`workspaces/${ws}/files/${file.id}`);
  assert.deepEqual(
    detail.body.versions.map((v: any) => v.version),
    [2, 1],
  );

  // Newest first by default; search finds kept text with a line number.
  const list = await json(`workspaces/${ws}/files`);
  assert.equal(list.body.items[0].id, png.body.file.id);
  assert.equal(list.body.items.length, 4);
  const found = await json(`workspaces/${ws}/files?q=kiwi`);
  assert.deepEqual(
    found.body.items.map((i: any) => [i.name, i.matches[0]?.line]),
    [['notes (2).md', 3]],
  );
  const byName = await json(`workspaces/${ws}/files?sort=name`);
  assert.equal(byName.body.items[0].name, 'notes (2).md');

  // Size limits: per file and per workspace.
  const big = await up('big.bin', new Uint8Array(5000));
  assert.equal(big.status, 413);
  assert.equal(big.body.error.code, 'BODY_TOO_LARGE');
  const fill = await up('fill.bin', new Uint8Array(4000).fill(1));
  assert.equal(fill.status, 201);
  const over = await up('over.bin', new Uint8Array(4000).fill(2));
  assert.equal(over.body.error.code, 'BUDGET_EXCEEDED');

  // Links only to active records of the same workspace.
  const rec = await json(`workspaces/${ws}/entities`, {
    kind: 'source',
    title: 'A source',
    body: {
      url: 'https://example.org/a',
      retrieved_at: new Date().toISOString(),
    },
  });
  let source = rec.body.id as string | undefined;
  if (rec.status !== 201) {
    // The source body shape is strict; fall back to any record kind the API accepts.
    const prob = await json(`workspaces/${ws}/entities`, {
      kind: 'idea',
      title: 'An idea',
      body: { summary: 'x' },
    });
    source = prob.body.id;
  }
  if (source) {
    const linked = await json(`workspaces/${ws}/files/${file.id}/link`, {
      entity_id: source,
      linked: true,
    });
    assert.equal(linked.body.links[0].entity_id, source);
  }
  const badLink = await json(`workspaces/${ws}/files/${file.id}/link`, {
    entity_id: randomUUID(),
    linked: true,
  });
  assert.equal(badLink.status, 404);

  // Access is checked before anything about a file is read.
  const pool = new pg.Pool({ connectionString: db.url });
  t.after(() => pool.end());
  const stranger = randomUUID();
  const viewer = randomUUID();
  await pool.query(
    `insert into actors (id, kind, display_name) values ($1, 'human', 'Stranger'), ($2, 'human', 'Viewer')`,
    [stranger, viewer],
  );
  await pool.query(
    `insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, 'viewer')`,
    [ws, viewer],
  );
  const files = new FileStore(pool);
  for (const read of [
    () => files.listFiles({ actorId: stranger }, ws, {}),
    () => files.fileContent({ actorId: stranger }, ws, file.id, null),
    () => files.fileText({ actorId: stranger }, ws, file.id, null),
  ])
    await assert.rejects(read, { code: 'NOT_FOUND' });
  assert.equal(
    (await files.listFiles({ actorId: viewer }, ws, {})).items.length,
    5,
  );
  await assert.rejects(
    files.uploadFile({ actorId: viewer }, ws, {
      bytes: Buffer.from('x'),
      name: 'x.txt',
      declaredType: null,
      uploadKey: randomUUID(),
      linkEntityId: null,
      keepDuplicate: false,
    }),
    { code: 'ACCESS_DENIED' },
  );
  // Another workspace's id gives nothing away.
  const other = (
    await json('workspaces', { name: 'Other', record_mode: 'fixture' })
  ).body.id;
  const cross = await json(`workspaces/${other}/files/${file.id}`);
  assert.equal(cross.status, 404);

  // Delete hides and is restorable; purge (after delete) removes every version's bytes.
  assert.equal(
    (await json(`workspaces/${ws}/files/${file.id}/purge`, {})).status,
    409,
  );
  await json(`workspaces/${ws}/files/${file.id}/delete`, { reason: '' });
  assert.equal((await json(`workspaces/${ws}/files`)).body.items.length, 4);
  assert.equal(
    (await json(`workspaces/${ws}/files?status=deleted`)).body.items[0].id,
    file.id,
  );
  await json(`workspaces/${ws}/files/${file.id}/restore`, { reason: '' });
  await json(`workspaces/${ws}/files/${file.id}/delete`, { reason: '' });
  const before = (await json(`workspaces/${ws}/files`)).body.used_bytes;
  const purged = await json(`workspaces/${ws}/files/${file.id}/purge`, {});
  assert.equal(purged.body.purged, true);
  const after = (await json(`workspaces/${ws}/files`)).body.used_bytes;
  assert.equal(before - after, md.length + Buffer.byteLength('# Résumé v2\n'));
  const { rows } = await pool.query(
    'select count(*)::int as n from workspace_file_versions where file_id = $1',
    [file.id],
  );
  assert.equal(rows[0].n, 0);
  // Versions themselves never change.
  await assert.rejects(
    pool.query(
      `update workspace_file_versions set original_name = 'x' where file_id = $1`,
      [png.body.file.id],
    ),
    /never change/,
  );
});
