import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { RESERVED_PORTS, defaultPorts } from '@creator/domain';

/**
 * ADR-0108: say which program holds a busy port, and let a development run move off a port
 * an unrelated program holds. The installed app never moves (see ADR-0108 for why).
 */
const run = promisify(execFile);
const LOOKUP_MS = 3000;

export type PortHolder = { pid: number; name: string | null };

/** The listening PID for `port` in `netstat -ano` output (any language: matched by shape). */
export function pidFromNetstat(text: string, port: number): number | null {
  for (const line of text.split(/\r?\n/)) {
    // "  TCP    127.0.0.1:5173    0.0.0.0:0    LISTENING    1234". The state word is
    // translated on some Windows languages, so a listener is told by its 0-port remote.
    const m = line
      .trim()
      .match(/^TCP\s+(\S+):(\d+)\s+(?:0\.0\.0\.0|\[::\]):0\s+\S+\s+(\d+)$/i);
    if (m && Number(m[2]) === port && Number(m[3]) > 0) return Number(m[3]);
  }
  return null;
}

/** The image name for a PID in `tasklist /FO CSV /NH` output, or null. */
export function nameFromTasklist(text: string, pid: number): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^"([^"]+)","(\d+)"/);
    if (m && Number(m[2]) === pid) return m[1]!;
  }
  return null;
}

/** The first process in `lsof -Fpc` output. */
export function holderFromLsof(text: string): PortHolder | null {
  let pid: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('p') && pid === null)
      pid = Number(line.slice(1)) || null;
    else if (line.startsWith('c') && pid !== null)
      return { pid, name: line.slice(1) || null };
  }
  return pid === null ? null : { pid, name: null };
}

/** Best effort: the program listening on a loopback port, or null when it can't be told. */
export async function portHolder(port: number): Promise<PortHolder | null> {
  const opts = { timeout: LOOKUP_MS, windowsHide: true } as const;
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('netstat', ['-ano', '-p', 'TCP'], opts);
      const { stdout: v6 } = await run(
        'netstat',
        ['-ano', '-p', 'TCPv6'],
        opts,
      ).catch(() => ({ stdout: '' }));
      const pid = pidFromNetstat(`${stdout}\n${v6}`, port);
      if (pid === null) return null;
      const { stdout: tasks } = await run(
        'tasklist',
        ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
        opts,
      ).catch(() => ({ stdout: '' }));
      return { pid, name: nameFromTasklist(tasks, pid) };
    }
    const { stdout } = await run(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'],
      opts,
    );
    return holderFromLsof(stdout);
  } catch {
    return null;
  }
}

/** "Port 4410 is already in use by node.exe (process 1234)." */
export function portInUseText(port: number, holder: PortHolder | null) {
  const who = !holder
    ? 'another program'
    : holder.name
      ? `${holder.name} (process ${holder.pid})`
      : `process ${holder.pid}`;
  return `Port ${port} is already in use by ${who}.`;
}

const canListen = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen({ port, host });
  });

/**
 * Whether `host:port` can be listened on right now. A loopback port is also checked on all
 * interfaces: Windows lets a loopback listener start beside another program's wildcard one.
 */
export async function portFree(port: number, host = '127.0.0.1') {
  return (
    (await canListen(port, host)) &&
    (host === '0.0.0.0' || (await canListen(port, '0.0.0.0')))
  );
}

/** Whether a Creator Agent API (or a studio UI in front of one) answers on the port. */
export async function creatorAgentOn(port: number) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const body = (await r.json()) as { service?: unknown };
    return body.service === 'creator-agent-api';
  } catch {
    return false;
  }
}

type Role = 'api' | 'preview' | 'web';
const VARS: Record<Role, string> = {
  api: 'CREATOR_API_PORT',
  preview: 'CREATOR_PREVIEW_PORT',
  web: 'CREATOR_WEB_PORT',
};
const LABEL: Record<Role, string> = {
  api: 'API',
  preview: 'private previews',
  web: 'web app',
};
/** How far past its default a development port may move. */
export const FALLBACK_SPAN = 20;

export type DevPortPlan = {
  /** CREATOR_*_PORT values every piece of this run must use. */
  env: Record<string, string>;
  /** One line per port that moved, for the startup output. */
  moved: string[];
};

export class PortPlanError extends Error {}

type Probe = {
  free: (port: number, host: string) => Promise<boolean>;
  holder: (port: number) => Promise<PortHolder | null>;
  creatorAgent: (port: number) => Promise<boolean>;
};
const PROBE: Probe = {
  free: portFree,
  holder: portHolder,
  creatorAgent: creatorAgentOn,
};

/**
 * Chooses the API, preview and web ports for a development run before anything starts, so all
 * pieces agree. A default port held by an unrelated program moves to the next free one in
 * its range; it never moves when the port was set explicitly, when sign-in is OIDC (its
 * redirect address is registered with a fixed port), when CREATOR_PORT_FALLBACK=off, or
 * when another Creator Agent answers there: two studios on one database would run two
 * workflow workers, so that is refused with the holder named instead.
 */
export async function planDevPorts(
  env: Record<string, string | undefined>,
  probe: Probe = PROBE,
): Promise<DevPortPlan> {
  const host = env.CREATOR_LISTEN_HOST ?? env.CREATOR_HOST ?? '127.0.0.1';
  const defaults = defaultPorts(env);
  const oidc =
    env.CREATOR_AUTH_MODE === 'oidc' || env.CREATOR_OIDC_ISSUER !== undefined;
  const fallback =
    !oidc &&
    env.CREATOR_PORT_FALLBACK !== 'off' &&
    env.CREATOR_DEPLOYMENT_MODE !== 'hosted';
  const chosen = new Map<Role, number>();
  const busy: { role: Role; port: number }[] = [];
  for (const role of ['api', 'preview', 'web'] as const) {
    const raw = env[VARS[role]];
    const port = raw !== undefined ? Number(raw) : defaults[role];
    chosen.set(role, port);
    if (!Number.isInteger(port)) continue; // serviceConfig reports the bad value
    if (!(await probe.free(port, host))) busy.push({ role, port });
  }
  // Another studio first: moving around it would start a second one on the same records.
  for (const { port } of busy)
    if (await probe.creatorAgent(port))
      throw new PortPlanError(
        `${portInUseText(port, await probe.holder(port))} Another Creator Agent studio is already running there. Stop it first (two studios on one database would run two workflow workers), or open that one.`,
      );
  const moved: string[] = [];
  for (const { role, port } of busy) {
    const explicit = env[VARS[role]] !== undefined;
    if (explicit || !fallback) {
      const why = explicit
        ? `${VARS[role]} asks for it`
        : oidc
          ? 'OIDC sign-in redirects to a fixed address'
          : 'CREATOR_PORT_FALLBACK=off';
      throw new PortPlanError(
        `${portInUseText(port, await probe.holder(port))} The ${LABEL[role]} cannot move because ${why}. Close that program, or set ${VARS[role]} to a free port.`,
      );
    }
    const taken = new Set(chosen.values());
    let next: number | null = null;
    for (let p = port + 1; p <= port + FALLBACK_SPAN && p <= 65535; p++)
      if (
        !RESERVED_PORTS.has(p) &&
        !taken.has(p) &&
        (await probe.free(p, host))
      ) {
        next = p;
        break;
      }
    if (next === null)
      throw new PortPlanError(
        `${portInUseText(port, await probe.holder(port))} No free port for the ${LABEL[role]} in ${port + 1}–${port + FALLBACK_SPAN}. Close that program, or set ${VARS[role]} to a free port.`,
      );
    chosen.set(role, next);
    moved.push(
      `${portInUseText(port, await probe.holder(port))} The ${LABEL[role]} uses ${next} for this run instead.`,
    );
  }
  return {
    env: Object.fromEntries(
      [...chosen].map(([role, port]) => [VARS[role], String(port)]),
    ),
    moved,
  };
}
