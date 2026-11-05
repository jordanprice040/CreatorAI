import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  FILE_TEXT_MAX,
  cutText,
  bytesText,
  FileLinkRequestSchema,
  FileRenameRequestSchema,
  FileSortSchema,
  FileStatusRequestSchema,
  inspectFile,
  numberedName,
  parse,
  safeFileName,
  type FileTextView,
  type FileUploadResult,
  type WorkspaceFile,
  type WorkspaceFileDetail,
  type WorkspaceFilePage,
  type WorkspaceFileVersion,
} from '@creator/contracts';
import {
  fail,
  iso,
  normalize,
  Store,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

// ADR-0072 (P05): workspace files. Any member may read; owners and editors upload, rename,
// link and delete; only an owner purges. Membership is checked before a byte, snippet, name or
// count is read. Uploading stores bytes only: nothing is sent to a model or marked as evidence.

/** Storage bounds, from the deployment (environment); never raised by a request. */
export type FileLimits = { fileMaxBytes: number; workspaceMaxBytes: number };
export const DEFAULT_FILE_LIMITS: FileLimits = {
  fileMaxBytes: 25 * 1024 * 1024,
  workspaceMaxBytes: 2 * 1024 * 1024 * 1024,
};

export type FileUpload = {
  bytes: Buffer;
  name: string;
  declaredType: string | null;
  uploadKey: string;
  linkEntityId: string | null;
  /** Store even when the same bytes are already in the library. */
  keepDuplicate: boolean;
};

const PAGE = 50;
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const VERSION_COLUMNS = `v.version, v.sha256, v.size_bytes, v.kind, v.media_type, v.declared_type,
  v.original_name, v.type_mismatch, v.text_content is not null as has_text, v.text_truncated,
  v.created_by, v.created_at`;

function toVersion(r: Row): WorkspaceFileVersion {
  return {
    version: Number(r.version),
    sha256: String(r.sha256),
    size_bytes: Number(r.size_bytes),
    kind: r.kind as WorkspaceFileVersion['kind'],
    media_type: String(r.media_type),
    declared_type: r.declared_type === null ? null : String(r.declared_type),
    original_name: String(r.original_name),
    type_mismatch: Boolean(r.type_mismatch),
    has_text: Boolean(r.has_text),
    text_truncated: Boolean(r.text_truncated),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
  };
}

/** A name, cleaned of anything that would not belong in a header or a log line. */
const printable = (s: string, max: number) =>
  s.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max);

/** Keyset cursor: the sort key and id of the last item, base64url JSON. */
function encodeCursor(v: [string, string]) {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}
function decodeCursor(raw: string): [string, string] {
  try {
    const v = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as unknown;
    if (
      Array.isArray(v) &&
      v.length === 2 &&
      typeof v[0] === 'string' &&
      typeof v[1] === 'string' &&
      v[0].length <= 300
    )
      return [v[0], uuid(v[1])];
  } catch {
    // fall through
  }
  throw fail('INVALID_CONTRACT', 'Unknown page cursor.');
}

/** Characters of kept text returned for one search hit, from the line of its first match. */
const SNIPPET_WINDOW = 20_000;

/**
 * Review L6: a search returns only a window of kept text that starts at the line of the first
 * match, with that line's number, never a file's whole kept text.
 */
function snippetJoin(qParam: number): string {
  const hit = `strpos(lower(v.text_content), $${qParam})`;
  return `left join lateral (
    select substr(v.text_content, w.line_start, ${SNIPPET_WINDOW}) as body, w.first_line
    from (
      select case when k.nl > 0 then length(k.prefix) - k.nl + 2 else 1 end as line_start,
        1 + length(k.prefix) - length(replace(k.prefix, chr(10), '')) as first_line
      from (
        select pre.prefix, strpos(reverse(pre.prefix), chr(10)) as nl
        from (select substr(v.text_content, 1, greatest(${hit} - 1, 0)) as prefix) pre
      ) k
    ) w
    where v.text_content is not null and ${hit} > 0
  ) m on true`;
}

export class FileStore extends Store {
  constructor(
    pool: ConstructorParameters<typeof Store>[0],
    readonly limits: FileLimits = DEFAULT_FILE_LIMITS,
  ) {
    super(pool);
  }

  private async file(
    c: PoolClient,
    ws: string,
    fileId: string,
    lock = false,
  ): Promise<WorkspaceFile> {
    const { rows } = await c.query(
      `select f.*, ${VERSION_COLUMNS} from workspace_files f
       join workspace_file_versions v on v.file_id = f.id and v.version = f.current_version
       where f.workspace_id = $1 and f.id = $2${lock ? ' for update of f' : ''}`,
      [ws, fileId],
    );
    const r = rows[0] as Row | undefined;
    if (!r) throw fail('NOT_FOUND', 'File not found.');
    return this.toFile(c, r);
  }

  private async toFile(c: PoolClient, r: Row): Promise<WorkspaceFile> {
    const links = await c.query(
      `select e.id, e.kind, e.title from workspace_file_links l
       join entities e on e.id = l.entity_id
       where l.file_id = $1 order by l.created_at limit 50`,
      [r.id],
    );
    return {
      id: String(r.id),
      workspace_id: String(r.workspace_id),
      name: String(r.name),
      status: r.status as 'active' | 'deleted',
      current_version: Number(r.current_version),
      current: toVersion(r),
      created_by: String(r.created_by),
      created_at: iso(r.created_at),
      updated_at: iso(r.updated_at),
      deleted_at: r.deleted_at ? iso(r.deleted_at) : null,
      links: (links.rows as Row[]).map((l) => ({
        entity_id: String(l.id),
        kind: String(l.kind),
        title: String(l.title ?? '').slice(0, 300),
      })),
    };
  }

  private async usedBytes(c: PoolClient, ws: string): Promise<number> {
    const { rows } = await c.query(
      'select coalesce(sum(size_bytes), 0)::bigint as used from workspace_file_versions where workspace_id = $1',
      [ws],
    );
    return Number((rows[0] as Row).used);
  }

  /** A display name not used by another active file of the workspace. */
  private async freeName(
    c: PoolClient,
    ws: string,
    wanted: string,
    except: string | null,
  ): Promise<string> {
    const { rows } = await c.query(
      `select lower(name) as name from workspace_files
       where workspace_id = $1 and status = 'active' and ($2::uuid is null or id <> $2)`,
      [ws, except],
    );
    const taken = new Set((rows as Row[]).map((r) => String(r.name)));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let n = 2; n < 10_000; n++) {
      const candidate = numberedName(wanted, n);
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    throw fail('INVALID_CONTRACT', 'Too many files share this name.');
  }

  private async checkLinkTarget(c: PoolClient, ws: string, entity: string) {
    const { rows } = await c.query(
      `select 1 from entities where workspace_id = $1 and id = $2 and status = 'active'`,
      [ws, entity],
    );
    if (!rows.length)
      throw fail(
        'NOT_FOUND',
        'The record to link to was not found in this workspace.',
      );
  }

  /**
   * Review L2: refuses a non-member or a viewer before the route buffers an upload body. The
   * same check runs again inside `uploadFile`'s transaction.
   */
  async assertCanUpload(ctxIn: CommandContext, wsIn: string): Promise<void> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    await this.tx((c) => this.role(c, ws, ctx.actorId, true));
  }

  /**
   * Stores an upload as a new file, or (with `fileId`) as the next version of one. The whole
   * body has been read before this is called, so a cancelled transfer stores nothing. A repeated
   * upload key returns the earlier result instead of storing twice.
   */
  async uploadFile(
    ctxIn: CommandContext,
    wsIn: string,
    up: FileUpload,
    fileId: string | null = null,
  ): Promise<FileUploadResult> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const key = uuid(up.uploadKey);
    if (up.bytes.length > this.limits.fileMaxBytes)
      throw fail(
        'BODY_TOO_LARGE',
        `Files are limited to ${bytesText(this.limits.fileMaxBytes)} each.`,
      );
    const hash = sha256(up.bytes);
    const name = safeFileName(printable(up.name, 1000));
    const look = inspectFile(name, up.bytes);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      // One upload at a time per workspace, so the quota and duplicate checks hold.
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [
        `files:${ws}`,
      ]);
      const prior = await c.query(
        'select file_id, sha256 from workspace_file_versions where workspace_id = $1 and upload_key = $2',
        [ws, key],
      );
      const p = prior.rows[0] as Row | undefined;
      if (p) {
        if (String(p.sha256) !== hash)
          throw fail(
            'IDEMPOTENCY_CONFLICT',
            'This upload key was used for different bytes.',
          );
        // A reused key must also name the same target (review L3): the same file for a new
        // version, and a link the first upload made.
        const target = uuid(String(p.file_id));
        const linked = up.linkEntityId
          ? (
              await c.query(
                'select 1 from workspace_file_links where file_id = $1 and entity_id = $2',
                [target, uuid(up.linkEntityId)],
              )
            ).rows.length > 0
          : true;
        if ((fileId && uuid(fileId) !== target) || !linked)
          throw fail(
            'IDEMPOTENCY_CONFLICT',
            'This upload key was used for a different file or record.',
          );
        const earlier = await this.file(c, ws, target);
        // The file may have been deleted since; say so rather than "added" (review N3).
        return {
          stored: earlier.status === 'active',
          replayed: true,
          file: earlier,
          duplicate_of: null,
        };
      }
      const dup = await c.query(
        `select f.id from workspace_files f
         join workspace_file_versions v on v.file_id = f.id and v.version = f.current_version
         where f.workspace_id = $1 and f.status = 'active' and v.sha256 = $2
           and ($3::uuid is null or f.id <> $3)
         order by f.created_at desc limit 1`,
        [ws, hash, fileId],
      );
      const duplicate = dup.rows[0]
        ? await this.file(c, ws, String((dup.rows[0] as Row).id))
        : null;
      if (duplicate && !up.keepDuplicate && !fileId) {
        // The bytes are stored once, but a targeted drop still links them to its record
        // (review L3).
        if (up.linkEntityId) {
          const entity = uuid(up.linkEntityId);
          await this.checkLinkTarget(c, ws, entity);
          const added = await c.query(
            `insert into workspace_file_links (workspace_id, file_id, entity_id, created_by)
             values ($1, $2, $3, $4) on conflict do nothing`,
            [ws, duplicate.id, entity, ctx.actorId],
          );
          if (added.rowCount === 1) {
            await this.append(c, ctx, {
              workspaceId: ws,
              action: 'file.linked',
              subjectKind: 'file',
              subjectId: duplicate.id,
              subjectVersion: duplicate.current_version,
              contentHash: null,
              payload: {},
              relatedIds: [entity],
            });
            const linked = await this.file(c, ws, duplicate.id);
            return {
              stored: false,
              replayed: false,
              file: linked,
              duplicate_of: linked,
            };
          }
        }
        return {
          stored: false,
          replayed: false,
          file: duplicate,
          duplicate_of: duplicate,
        };
      }
      if (
        (await this.usedBytes(c, ws)) + up.bytes.length >
        this.limits.workspaceMaxBytes
      )
        throw fail(
          'BUDGET_EXCEEDED',
          'This workspace has no room for this file. Delete files permanently to free space.',
        );
      if (up.linkEntityId)
        await this.checkLinkTarget(c, ws, uuid(up.linkEntityId));
      let id: string;
      let version: number;
      if (fileId) {
        const current = await this.file(c, ws, uuid(fileId), true);
        if (current.status !== 'active')
          throw fail(
            'INVALID_TRANSITION',
            'Restore this file before adding a version.',
          );
        if (current.current.sha256 === hash)
          return {
            stored: false,
            replayed: false,
            file: current,
            duplicate_of: current,
          };
        id = current.id;
        version = current.current_version + 1;
      } else {
        id = randomUUID();
        version = 1;
        await c.query(
          `insert into workspace_files (id, workspace_id, name, current_version, created_by)
           values ($1, $2, $3, 1, $4)`,
          [id, ws, await this.freeName(c, ws, name, null), ctx.actorId],
        );
      }
      const text =
        look.text === null ? null : cutText(look.text, FILE_TEXT_MAX);
      await c.query(
        `insert into workspace_file_versions (workspace_id, file_id, version, sha256, size_bytes,
           kind, media_type, declared_type, original_name, type_mismatch, content, text_content,
           text_truncated, upload_key, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          ws,
          id,
          version,
          hash,
          up.bytes.length,
          look.kind,
          look.media_type,
          up.declaredType ? printable(up.declaredType, 200) : null,
          printable(up.name, 500),
          look.type_mismatch,
          up.bytes,
          text,
          look.text !== null && look.text.length > FILE_TEXT_MAX,
          key,
          ctx.actorId,
        ],
      );
      if (fileId)
        await c.query(
          `update workspace_files set current_version = $2, updated_at = clock_timestamp() where id = $1`,
          [id, version],
        );
      if (up.linkEntityId)
        await c.query(
          `insert into workspace_file_links (workspace_id, file_id, entity_id, created_by)
           values ($1, $2, $3, $4) on conflict do nothing`,
          [ws, id, uuid(up.linkEntityId), ctx.actorId],
        );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: fileId ? 'file.version_added' : 'file.uploaded',
        subjectKind: 'file',
        subjectId: id,
        subjectVersion: version,
        contentHash: hash,
        payload: { size_bytes: up.bytes.length, kind: look.kind },
        ...(up.linkEntityId ? { relatedIds: [uuid(up.linkEntityId)] } : {}),
      });
      return {
        stored: true,
        replayed: false,
        file: await this.file(c, ws, id),
        duplicate_of: duplicate,
      };
    });
  }

  /** Newest first by default; `q` matches names and kept text, case-insensitively. */
  async listFiles(
    ctxIn: CommandContext,
    wsIn: string,
    opts: { sort?: string; q?: string; cursor?: string; deleted?: boolean },
  ): Promise<WorkspaceFilePage> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const sort = parse(FileSortSchema, opts.sort ?? 'newest');
    const q = (opts.q ?? '').trim().slice(0, 200);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const params: unknown[] = [ws, opts.deleted ? 'deleted' : 'active'];
      const where = ['f.workspace_id = $1', 'f.status = $2'];
      let qParam = 0;
      if (q) {
        params.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
        where.push(
          `(f.name ilike $${params.length} or v.text_content ilike $${params.length})`,
        );
        params.push(q.toLowerCase());
        qParam = params.length;
      }
      const key =
        sort === 'name'
          ? 'lower(f.name)'
          : `to_char(f.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
      const dir = sort === 'oldest' || sort === 'name' ? '>' : '<';
      const order = sort === 'oldest' || sort === 'name' ? 'asc' : 'desc';
      if (opts.cursor) {
        const [k, id] = decodeCursor(opts.cursor);
        params.push(k, id);
        where.push(
          `(${key}, f.id) ${dir} ($${params.length - 1}, $${params.length}::uuid)`,
        );
      }
      params.push(PAGE + 1);
      const { rows } = await c.query(
        `select f.*, ${VERSION_COLUMNS}, ${key} as sort_key,
           ${q ? 'm.body, m.first_line' : 'null::text as body, 1 as first_line'}
         from workspace_files f
         join workspace_file_versions v on v.file_id = f.id and v.version = f.current_version
         ${q ? snippetJoin(qParam) : ''}
         where ${where.join(' and ')}
         order by ${key} ${order}, f.id ${order} limit $${params.length}`,
        params,
      );
      const page = (rows as Row[]).slice(0, PAGE);
      const items = [];
      for (const r of page) {
        const matches: { line: number; text: string }[] = [];
        if (q && typeof r.body === 'string') {
          const needle = q.toLowerCase();
          const lines = r.body.split(/\r?\n/);
          const first = Number(r.first_line ?? 1);
          for (let i = 0; i < lines.length && matches.length < 3; i++)
            if (lines[i]!.toLowerCase().includes(needle))
              matches.push({
                line: first + i,
                text: lines[i]!.trim().slice(0, 300),
              });
        }
        items.push({ ...(await this.toFile(c, r)), matches });
      }
      const last = page[page.length - 1];
      return {
        items,
        next_cursor:
          rows.length > PAGE && last
            ? encodeCursor([String(last.sort_key), String(last.id)])
            : null,
        used_bytes: await this.usedBytes(c, ws),
        limit_bytes: this.limits.workspaceMaxBytes,
        file_limit_bytes: this.limits.fileMaxBytes,
      };
    });
  }

  async fileDetail(
    ctxIn: CommandContext,
    wsIn: string,
    fileId: string,
  ): Promise<WorkspaceFileDetail> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const file = await this.file(c, ws, uuid(fileId));
      const { rows } = await c.query(
        `select ${VERSION_COLUMNS} from workspace_file_versions v
         where v.file_id = $1 order by v.version desc`,
        [file.id],
      );
      return { file, versions: (rows as Row[]).map(toVersion) };
    });
  }

  private async versionRow(
    c: PoolClient,
    ws: string,
    fileId: string,
    version: number | null,
  ) {
    const { rows } = await c.query(
      `select v.*, f.name from workspace_files f
       join workspace_file_versions v on v.file_id = f.id
         and v.version = coalesce($3::int, f.current_version)
       where f.workspace_id = $1 and f.id = $2`,
      [ws, uuid(fileId), version],
    );
    const r = rows[0] as Row | undefined;
    if (!r) throw fail('NOT_FOUND', 'File version not found.');
    return r;
  }

  /** The exact original bytes of a version (current when none given). */
  async fileContent(
    ctxIn: CommandContext,
    wsIn: string,
    fileId: string,
    version: number | null,
  ): Promise<{
    bytes: Buffer;
    name: string;
    media_type: string;
    kind: string;
    sha256: string;
  }> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const r = await this.versionRow(c, ws, fileId, version);
      return {
        bytes: r.content as Buffer,
        name: String(r.name),
        media_type: String(r.media_type),
        kind: String(r.kind),
        sha256: String(r.sha256),
      };
    });
  }

  /** Kept text of a text-kind version, for the inert viewers. */
  async fileText(
    ctxIn: CommandContext,
    wsIn: string,
    fileId: string,
    version: number | null,
  ): Promise<FileTextView> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const r = await this.versionRow(c, ws, fileId, version);
      if (r.text_content === null)
        throw fail(
          'INVALID_CONTRACT',
          'This file has no text to show; download it instead.',
        );
      return {
        kind: r.kind as FileTextView['kind'],
        version: Number(r.version),
        text: String(r.text_content),
        truncated: Boolean(r.text_truncated),
      };
    });
  }

  async renameFile(
    ctxIn: CommandContext,
    wsIn: string,
    fileId: string,
    raw: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const req = parse(FileRenameRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const f = await this.file(c, ws, uuid(fileId), true);
      if (f.current_version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'This file changed since you opened it.',
        );
      const name = await this.freeName(c, ws, safeFileName(req.name), f.id);
      if (name === f.name) return f;
      await c.query(
        `update workspace_files set name = $2, updated_at = clock_timestamp() where id = $1`,
        [f.id, name],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'file.renamed',
        subjectKind: 'file',
        subjectId: f.id,
        subjectVersion: f.current_version,
        contentHash: null,
        payload: {},
      });
      return this.file(c, ws, f.id);
    });
  }

  async linkFile(
    ctxIn: CommandContext,
    wsIn: string,
    fileId: string,
    raw: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const req = parse(FileLinkRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const f = await this.file(c, ws, uuid(fileId), true);
      if (req.linked) {
        await this.checkLinkTarget(c, ws, req.entity_id);
        await c.query(
          `insert into workspace_file_links (workspace_id, file_id, entity_id, created_by)
           values ($1, $2, $3, $4) on conflict do nothing`,
          [ws, f.id, req.entity_id, ctx.actorId],
        );
      } else
        await c.query(
          'delete from workspace_file_links where file_id = $1 and entity_id = $2',
          [f.id, req.entity_id],
        );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: req.linked ? 'file.linked' : 'file.unlinked',
        subjectKind: 'file',
        subjectId: f.id,
        subjectVersion: f.current_version,
        contentHash: null,
        payload: {},
        relatedIds: [req.entity_id],
      });
      return this.file(c, ws, f.id);
    });
  }

  /** Delete (hide, restorable) or restore. Bytes stay until purged. */
  async setFileDeleted(
    ctxIn: CommandContext,
    wsIn: string,
    fileId: string,
    deleted: boolean,
    raw: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    parse(FileStatusRequestSchema, raw ?? {});
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const f = await this.file(c, ws, uuid(fileId), true);
      if ((f.status === 'deleted') === deleted) return f;
      const name = deleted ? f.name : await this.freeName(c, ws, f.name, f.id);
      await c.query(
        `update workspace_files set status = $2, deleted_at = $3, name = $4,
           updated_at = clock_timestamp() where id = $1`,
        [
          f.id,
          deleted ? 'deleted' : 'active',
          deleted ? new Date() : null,
          name,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: deleted ? 'file.deleted' : 'file.restored',
        subjectKind: 'file',
        subjectId: f.id,
        subjectVersion: f.current_version,
        contentHash: null,
        payload: {},
      });
      return this.file(c, ws, f.id);
    });
  }

  /**
   * Permanently removes a deleted file and every version's bytes. Owner only. Backups taken
   * earlier still hold the bytes until they are themselves removed.
   */
  async purgeFile(ctxIn: CommandContext, wsIn: string, fileId: string) {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      if ((await this.role(c, ws, ctx.actorId, true)) !== 'owner')
        throw fail(
          'ACCESS_DENIED',
          'Only a workspace owner can delete files permanently.',
        );
      const f = await this.file(c, ws, uuid(fileId), true);
      if (f.status !== 'deleted')
        throw fail(
          'INVALID_TRANSITION',
          'Delete the file first; permanent deletion comes after.',
        );
      const { rows } = await c.query(
        'select count(*)::int as n, coalesce(sum(size_bytes), 0)::bigint as bytes from workspace_file_versions where file_id = $1',
        [f.id],
      );
      // Versions refuse updates, not deletes; the cascade removes them with the file.
      await c.query('delete from workspace_files where id = $1', [f.id]);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'file.purged',
        subjectKind: 'file',
        subjectId: f.id,
        subjectVersion: f.current_version,
        contentHash: f.current.sha256,
        payload: {
          versions: Number((rows[0] as Row).n),
          size_bytes: Number((rows[0] as Row).bytes),
        },
      });
      return { purged: true, id: f.id };
    });
  }
}
