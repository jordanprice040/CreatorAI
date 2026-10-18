import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  ContractError,
  contractSchemas,
  HealthSchema,
  parse,
} from '@creator/contracts';
import { runFixture, serviceConfig } from '@creator/domain';

const MAX_BODY = 65536;
function respond(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new ContractError('INVALID_CONTRACT', 'Expected application/json.');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
    req.resume();
    throw new ContractError('BODY_TOO_LARGE', 'Request exceeds 64 KiB.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY)
      throw new ContractError('BODY_TOO_LARGE', 'Request exceeds 64 KiB.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ContractError('INVALID_CONTRACT', 'Malformed JSON.');
  }
}
export function createApi(env: Record<string, string | undefined> = {}) {
  const config = serviceConfig(env);
  const server = createServer((req, res) => {
    void (async () => {
      // Restrict Host and browser origins even for this stateless, fixture-only local service.
      const localPort = req.socket.localPort;
      if (
        req.headers.host !== `127.0.0.1:${localPort}` &&
        req.headers.host !== `localhost:${localPort}`
      )
        throw new ContractError(
          'ORIGIN_DENIED',
          'Only loopback Host headers are accepted.',
        );
      const origin = req.headers.origin;
      if (
        origin &&
        ![
          `http://127.0.0.1:${config.web_port}`,
          `http://localhost:${config.web_port}`,
          `http://127.0.0.1:${localPort}`,
          `http://localhost:${localPort}`,
        ].includes(origin)
      )
        throw new ContractError('ORIGIN_DENIED', 'Browser origin denied.');
      if (req.method === 'GET' && req.url === '/api/health')
        return respond(
          res,
          200,
          parse(HealthSchema, {
            schema_version: '1.0',
            status: 'ok',
            service: 'creator-agent-api',
            data_mode: 'fixture',
            provider: 'deterministic-fixture-v1',
            live_enabled: false,
            persistent: false,
          }),
        );
      if (req.method === 'POST' && req.url === '/api/fixture')
        return respond(res, 200, runFixture(await readJson(req)));
      if (req.method === 'POST' && req.url === '/api/validate') {
        const body = await readJson(req);
        if (
          !body ||
          typeof body !== 'object' ||
          !('kind' in body) ||
          !('value' in body) ||
          Object.keys(body).length !== 2 ||
          typeof body.kind !== 'string' ||
          !Object.hasOwn(contractSchemas, body.kind)
        )
          throw new ContractError(
            'INVALID_CONTRACT',
            'Expected {kind, value} with a registered contract kind.',
          );
        const schema =
          contractSchemas[body.kind as keyof typeof contractSchemas];
        const validated = schema.safeParse(body.value);
        if (!validated.success)
          throw new ContractError(
            'INVALID_CONTRACT',
            'Contract validation failed.',
            validated.error.issues.map(
              (i) => `${i.path.join('.')}: ${i.message}`,
            ),
          );
        return respond(res, 200, {
          valid: true,
          schema_version: '1.0',
          kind: body.kind,
          note: 'Structural validation only; not authorization or verified evidence.',
        });
      }
      throw new ContractError('NOT_FOUND', 'Route not found.');
    })().catch((error: unknown) => {
      const e =
        error instanceof ContractError
          ? error
          : new ContractError('INTERNAL_ERROR', 'Unexpected server failure.');
      const status =
        e.code === 'INTERNAL_ERROR'
          ? 500
          : e.code === 'NOT_FOUND'
            ? 404
            : e.code === 'ORIGIN_DENIED'
              ? 403
              : e.code === 'BODY_TOO_LARGE'
                ? 413
                : 400;
      if (!res.destroyed && !res.headersSent)
        respond(res, status, {
          error: { code: e.code, message: e.message, details: e.details },
        });
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return { server, config };
}
