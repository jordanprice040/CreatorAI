import type { IncomingMessage, ServerResponse } from 'node:http';
import { ContractError, bytesText } from '@creator/contracts';
import type { CommandContext, FileStore } from '@creator/db';

// ADR-0072 (P05) routes. Uploads are raw bytes (application/octet-stream) with the name and an
// upload key in headers, so the original bytes reach the store exactly as sent. Downloads are
// always attachments with a generic type; only sniffed raster images are served inline, and
// every file response forbids sniffing, scripts and framing.

export const FILES_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(files)(?:\/([^/]+)(?:\/(content|raw|text|rename|link|delete|restore|purge|versions))?)?$/;

/** Headers on every response that carries file bytes. */
const INERT = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'private, no-store',
} as const;

const INLINE_IMAGES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/** Reads the whole raw body up to `max` bytes; a cancelled transfer throws and stores nothing. */
async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  const type = req.headers['content-type']?.split(';')[0]?.trim();
  if (type !== 'application/octet-stream')
    throw new ContractError(
      'INVALID_CONTRACT',
      'Expected application/octet-stream.',
    );
  const tooLarge = () =>
    new ContractError(
      'BODY_TOO_LARGE',
      `Files are limited to ${bytesText(max)} each.`,
    );
  // Review R-M1: a refused body is not drained; bodyDeadline closes the connection once the
  // refusal has been sent.
  if (Number(req.headers['content-length'] ?? 0) > max) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += b.length;
    if (size > max) throw tooLarge();
    chunks.push(b);
  }
  if (req.readableAborted)
    throw new ContractError('INVALID_CONTRACT', 'The upload was cancelled.');
  return Buffer.concat(chunks);
}

const one = (req: IncomingMessage, name: string) => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
};

function decodeName(raw: string | undefined) {
  if (!raw)
    throw new ContractError('INVALID_CONTRACT', 'The file name is missing.');
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new ContractError('INVALID_CONTRACT', 'The file name is not valid.');
  }
}

/** RFC 6266/5987 attachment header: an ASCII fallback plus the exact UTF-8 name. */
function disposition(kind: 'attachment' | 'inline', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

function versionParam(url: URL): number | null {
  const v = url.searchParams.get('version');
  if (v === null) return null;
  if (!/^[1-9][0-9]{0,8}$/.test(v))
    throw new ContractError('INVALID_CONTRACT', 'Unknown file version.');
  return Number(v);
}

export async function fileRoutes(r: {
  store: FileStore;
  ctx: CommandContext;
  ws: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  url: URL;
  req: IncomingMessage;
  res: ServerResponse;
  json: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { store, ctx, ws, item, action, method, url, req, res, send } = r;
  const get = method === 'GET';
  const post = method === 'POST';
  const upload = async (fileId: string | null) => {
    const name = decodeName(one(req, 'x-file-name'));
    const key = one(req, 'x-upload-key');
    if (!key)
      throw new ContractError('INVALID_CONTRACT', 'The upload key is missing.');
    // Review L2: a non-member or viewer is refused before any of the body is buffered.
    await store.assertCanUpload(ctx, ws);
    // Review R-M1: only an upload the caller may make, declared within the size limit, gets
    // longer than the ordinary 10 seconds to arrive.
    const declared = Number(req.headers['content-length']);
    if (
      Number.isSafeInteger(declared) &&
      declared >= 0 &&
      declared <= store.limits.fileMaxBytes
    )
      extendBodyDeadline(req, uploadDeadlineMs(declared));
    const bytes = await readRaw(req, store.limits.fileMaxBytes);
    const link = one(req, 'x-link-entity');
    const result = await store.uploadFile(
      ctx,
      ws,
      {
        bytes,
        name,
        declaredType: one(req, 'x-declared-type') ?? null,
        uploadKey: key,
        linkEntityId: link || null,
        keepDuplicate: one(req, 'x-keep-duplicate') === 'true',
      },
      fileId,
    );
    return send(result.stored && !result.replayed ? 201 : 200, result, true);
  };
  if (!item) {
    if (get)
      return send(
        200,
        await store.listFiles(ctx, ws, {
          sort: url.searchParams.get('sort') ?? 'newest',
          q: url.searchParams.get('q') ?? '',
          ...(url.searchParams.get('cursor')
            ? { cursor: url.searchParams.get('cursor')! }
            : {}),
          deleted: url.searchParams.get('status') === 'deleted',
        }),
        false,
      );
    if (post) return upload(null);
    return false;
  }
  if (!action && get)
    return send(200, await store.fileDetail(ctx, ws, item), false);
  if (action === 'versions' && post) return upload(item);
  if (action === 'text' && get)
    return send(
      200,
      await store.fileText(ctx, ws, item, versionParam(url)),
      false,
    );
  if ((action === 'content' || action === 'raw') && get) {
    const f = await store.fileContent(ctx, ws, item, versionParam(url));
    const inline = action === 'raw';
    if (inline && !(f.kind === 'image' && INLINE_IMAGES.has(f.media_type)))
      throw new ContractError(
        'INVALID_CONTRACT',
        'Only images can be shown inline; download this file.',
      );
    res.writeHead(200, {
      ...INERT,
      'Content-Type': inline ? f.media_type : 'application/octet-stream',
      'Content-Length': String(f.bytes.length),
      'Content-Disposition': disposition(
        inline ? 'inline' : 'attachment',
        f.name,
      ),
      'X-Content-SHA256': f.sha256,
    });
    res.end(f.bytes);
    return true;
  }
  if (!post) return false;
  if (action === 'rename')
    return send(
      200,
      await store.renameFile(ctx, ws, item, await r.json()),
      true,
    );
  if (action === 'link')
    return send(200, await store.linkFile(ctx, ws, item, await r.json()), true);
  if (action === 'delete' || action === 'restore')
    return send(
      200,
      await store.setFileDeleted(
        ctx,
        ws,
        item,
        action === 'delete',
        await r.json(),
      ),
      true,
    );
  if (action === 'purge')
    return send(200, await store.purgeFile(ctx, ws, item), true);
  return false;
}

/** Storage bounds from the environment; invalid values fall back to the defaults. */
export function fileLimitsFromEnv(
  env: NodeJS.ProcessEnv,
  defaults: { fileMaxBytes: number; workspaceMaxBytes: number },
) {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isSafeInteger(x) && x > 0 ? x : d;
  };
  return {
    fileMaxBytes: n(env.CREATOR_FILE_MAX_BYTES, defaults.fileMaxBytes),
    workspaceMaxBytes: n(
      env.CREATOR_FILE_WORKSPACE_MAX_BYTES,
      defaults.workspaceMaxBytes,
    ),
  };
}

/** The whole of an ordinary request must arrive within this time, as before ADR-0072. */
export const REQUEST_BODY_MS = 10_000;
/** The server-wide limit, raised so a large upload on a slow link is not cut off (review L4). */
export const SERVER_REQUEST_MS = 30 * 60_000;
/** An upload may take this long at least, plus one second for every 256 KiB declared. */
const UPLOAD_BASE_MS = 60_000;
/** After a refusal is sent while the body is still arriving, the socket is closed this soon. */
const REFUSED_CLOSE_MS = 1_000;

/** The deadline an authorised upload of `declared` bytes gets, capped by the server limit. */
export function uploadDeadlineMs(declared: number): number {
  return Math.min(
    SERVER_REQUEST_MS,
    UPLOAD_BASE_MS + Math.ceil(declared / 262_144) * 1000,
  );
}

const deadlines = new WeakMap<IncomingMessage, (ms: number) => void>();

/**
 * PR #141 review L4 and R-M1: Node has one request timeout per server, so the servers' limit is
 * raised and every request gets its own deadline here: 10 seconds for its body, whatever its
 * path or declared size. Only the upload route lengthens it (extendBodyDeadline), after the
 * caller is authenticated, may upload, and declared a size within the limit. A request still
 * arriving at its deadline loses its connection, and a response sent before the body has
 * arrived (any refusal) closes the connection instead of draining the rest. Calling it again
 * for the same request (web server, then API handler) does nothing.
 */
export function bodyDeadline(req: IncomingMessage, res: ServerResponse): void {
  if (deadlines.has(req)) return;
  // Kept here: Node detaches req.socket from a finished request.
  const socket = req.socket;
  let timer: NodeJS.Timeout | undefined;
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (!req.complete) socket.destroy();
    }, ms);
    timer.unref();
  };
  deadlines.set(req, arm);
  const done = () => {
    if (timer) clearTimeout(timer);
  };
  req.once('end', done);
  req.once('close', done);
  res.once('finish', () => {
    if (req.complete) return;
    // The response is out; stop reading and close, rather than wait out a deadline.
    req.pause();
    socket.end();
    arm(REFUSED_CLOSE_MS);
  });
  if (req.complete) return;
  arm(REQUEST_BODY_MS);
}

/** Replaces a request's body deadline; used only by the upload route after its checks pass. */
export function extendBodyDeadline(req: IncomingMessage, ms: number): void {
  if (req.complete) return;
  deadlines.get(req)?.(ms);
}
