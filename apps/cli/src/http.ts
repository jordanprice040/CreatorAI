import { request } from 'node:http';

export type HttpReply = {
  status: number;
  ok: boolean;
  setCookies: string[];
  body: string;
};

/**
 * One request to the loopback studio API over node:http (PR #123 third review M-1).
 *
 * Node's built-in fetch (undici) gives up after 300 s without response headers, whatever
 * AbortSignal it is given, and the API sends no headers until a Codex turn or a qualification
 * run is over. With the owner's timeouts uncapped (ADR-0062) those can take longer, so the CLI
 * waits with its own timer instead: node:http has no headers or body timeout of its own. The
 * whole exchange, headers and body, must finish within `timeoutMs`.
 */
export function httpRequest(
  url: string,
  init: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
  },
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: init.method ?? 'GET',
      headers: {
        ...init.headers,
        ...(init.body === undefined
          ? {}
          : { 'Content-Length': String(Buffer.byteLength(init.body)) }),
      },
    });
    const timer = setTimeout(() => {
      req.destroy(
        new Error(
          `The API did not answer within ${Math.round(init.timeoutMs / 1000)} s.`,
        ),
      );
    }, init.timeoutMs);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      res.on('end', () => {
        clearTimeout(timer);
        const status = res.statusCode ?? 0;
        const cookies = res.headers['set-cookie'];
        resolve({
          status,
          ok: status >= 200 && status < 300,
          setCookies: Array.isArray(cookies) ? cookies : [],
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
