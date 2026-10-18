import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isBlockedAddress } from '@creator/domain';

/** One request, no redirect following: the broker re-checks every hop against the policy. */
export interface HopRequest {
  url: URL;
  signal: AbortSignal;
  maxBytes: number;
  /** Earlier recorded retrievals of the requested URL (fixtures use it to serve versions). */
  prior: number;
}
export type HopOutcome =
  | {
      kind: 'response';
      status: number;
      location: string | null;
      content_type: string | null;
      content_encoding: string | null;
      body: Buffer;
      truncated: boolean;
    }
  | { kind: 'blocked'; reason_code: string; explanation: string }
  | {
      kind: 'error';
      reason_code: 'timeout' | 'network_error' | 'dns_failed';
      explanation: string;
    };
export interface SourceAdapter {
  readonly kind: 'fixture' | 'http';
  /** Never throws; network and policy failures come back as outcomes. */
  fetchHop(req: HopRequest): Promise<HopOutcome>;
}

export type Resolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;
export interface HttpAdapterOptions {
  resolve?: Resolver;
  /**
   * Test seam only: maps the already-checked address to where the socket actually connects
   * (a loopback test server). Production never sets it.
   */
  connectOverride?: (
    address: string,
    port: number,
  ) => {
    host: string;
    port: number;
  };
  userAgent?: string;
}
const systemResolve: Resolver = (host) =>
  lookup(host, { all: true, verbatim: true });

/**
 * Live HTTP(S) GET for owner-approved hosts. The hostname is resolved here and every answer is
 * checked before connecting; the socket then connects to that exact address (with the original
 * Host and TLS server name), so a later DNS answer cannot redirect it inward. It sends no
 * cookies, credentials or studio headers, uses no proxy or shared connection pool, and stops
 * reading at the byte limit.
 */
export class HttpFetchAdapter implements SourceAdapter {
  readonly kind = 'http' as const;
  readonly #resolve: Resolver;
  readonly #override: HttpAdapterOptions['connectOverride'];
  readonly #ua: string;
  constructor(options: HttpAdapterOptions = {}) {
    this.#resolve = options.resolve ?? systemResolve;
    this.#override = options.connectOverride;
    this.#ua =
      options.userAgent ??
      'CreatorAgent-SourceBroker/0.1 (+owner-approved research fetch)';
  }

  async fetchHop(req: HopRequest): Promise<HopOutcome> {
    const { url, signal, maxBytes } = req;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: { address: string; family: number }[];
    try {
      addresses = await this.#resolve(host);
    } catch {
      return signal.aborted
        ? timeoutOutcome
        : {
            kind: 'error',
            reason_code: 'dns_failed',
            explanation: `${host} did not resolve.`,
          };
    }
    if (!addresses.length)
      return {
        kind: 'error',
        reason_code: 'dns_failed',
        explanation: `${host} returned no addresses.`,
      };
    if (addresses.some((a) => isBlockedAddress(a.address)))
      return {
        kind: 'blocked',
        reason_code: 'private_address',
        explanation: `${host} resolves to a private, loopback, link-local or reserved address; not contacted.`,
      };
    const secure = url.protocol === 'https:';
    const port = Number(url.port || (secure ? 443 : 80));
    const target = addresses[0]!;
    const dest = this.#override
      ? this.#override(target.address, port)
      : { host: target.address, port };
    return new Promise<HopOutcome>((resolve) => {
      const options: https.RequestOptions = {
        host: dest.host,
        port: dest.port,
        method: 'GET',
        path: `${url.pathname}${url.search}`,
        headers: {
          Host: url.host,
          'User-Agent': this.#ua,
          Accept:
            'text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.1',
          'Accept-Encoding': 'identity',
        },
        agent: false,
        signal,
        ...(secure ? { servername: host } : {}),
      };
      const request = (secure ? https : http).request(options, (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        const header = (name: string) => {
          const v = res.headers[name];
          return typeof v === 'string' ? v : null;
        };
        const done = () =>
          resolve({
            kind: 'response',
            status: res.statusCode ?? 0,
            location: header('location'),
            content_type: header('content-type'),
            content_encoding: header('content-encoding'),
            body: Buffer.concat(chunks),
            truncated,
          });
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            res.destroy();
            done();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', done);
        res.on('error', () =>
          truncated ? undefined : resolve(networkOrTimeout(signal)),
        );
      });
      request.on('error', () => resolve(networkOrTimeout(signal)));
      request.end();
    });
  }
}
const timeoutOutcome: HopOutcome = {
  kind: 'error',
  reason_code: 'timeout',
  explanation: 'The fetch exceeded its time limit.',
};
const networkOrTimeout = (signal: AbortSignal): HopOutcome =>
  signal.aborted
    ? timeoutOutcome
    : {
        kind: 'error',
        reason_code: 'network_error',
        explanation: 'The connection failed before a complete response.',
      };
