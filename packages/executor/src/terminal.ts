import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  RunInputSchema,
  TerminalSessionSchema,
  terminalCommand,
  type TerminalSession,
} from '@creator/contracts';
import { ProductSupervisor } from './products.js';
import { checked, digest, hash, id, sha } from './contracts.js';
import {
  canonical,
  event,
  fileAt,
  jsonPublish,
  jsonWrite,
  newFile,
  readJson,
} from './files.js';
import type { PackageFile } from './tar.js';

const WORKER = fileURLToPath(new URL('../worker/bridge.py', import.meta.url));
const RECIPE = fileURLToPath(new URL('../worker/terminal.py', import.meta.url));
/**
 * ADR-0058. The same sandbox as QA (no network, 256 MiB, 32 tasks, half a CPU, read-only
 * package, no studio files) with a 15-minute runtime and the owner's console as its terminal.
 * ADR-0059: the window can run the program again (fresh unit and sandbox each time) until
 * the owner quits: at most 50 runs, 60 minutes in all, and 10 idle minutes at the prompt.
 */
export const TERMINAL_POLICY =
  'wsl2-bwrap-systemd-pty/2;uid=1000;net=none;mem=256MiB;swap=0;pids=32;cpu=50%;time=900s;session=3600s;idle=600s;runs=50;lease=5s;work=16MiB;tmp=1MiB;file=8MiB;terminal=console;capture=none';
/** At most this many interactive sessions on one studio at once, and one per product. */
export const TERMINAL_LIMIT = 3;
const MSIX_HINT =
  "This studio was started inside another app's container (for example Claude desktop), so its folders are redirected. Close Creator Agent and start it from the Start menu, then try again.";

export function wslPath(p: string): string {
  const full = resolve(p);
  if (!/^[A-Za-z]:\\/.test(full))
    throw new Error('Reviewed backend requires a Windows drive path');
  return `/mnt/${full[0]!.toLowerCase()}/${full.slice(3).replaceAll('\\', '/')}`;
}

/**
 * The `start` command line for cmd.exe: `start "Creator Agent" /wait <program> <args>`.
 * Each word is quoted only when it holds a space or a cmd.exe operator (wsl.exe refuses a
 * quoted option name); a word with a quote, % or ! is refused.
 */
export function consoleCommand(
  program: string,
  args: readonly string[],
): string {
  const word = (w: string) => {
    // Inside quotes cmd.exe reads & | < > ^ ( ) literally; % and ! would still expand.
    if (!w.length || /["%!\r\n]/.test(w))
      throw new ContractError(
        'INVALID_CONTRACT',
        'The terminal command has a character the window launcher cannot pass safely (a quote, % or ! in a folder name). Nothing was started.',
      );
    return /[ \t&|<>^()]/.test(w) ? `"${w}"` : w;
  };
  return [
    'start',
    '"Creator Agent"',
    '/wait',
    word(program),
    ...args.map(word),
  ].join(' ');
}

export interface ConsoleChild {
  once(event: 'exit', cb: () => void): unknown;
  once(event: 'error', cb: (e: Error) => void): unknown;
}
export interface TerminalPorts {
  platform: NodeJS.Platform;
  /** Opens a visible console window running the given program (default: conhost.exe). */
  openConsole: (program: string, args: string[]) => ConsoleChild;
  /** Stops the session's unit through the bridge's reap path; reports whether it is gone. */
  reap: (
    bridgeArgs: string[],
  ) => Promise<{ cleaned: boolean; unit_state: string } | null>;
  workerPath: (p: string) => string;
  heartbeatMs: number;
  /**
   * Test seam: awaited after a session is marked as ending and before its outcome is
   * written, so tests can observe that window deterministically. Unset in the studio.
   */
  beforeOutcome?: (sessionId: string) => Promise<void>;
}

function system32(name: string): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
}

const defaultPorts: TerminalPorts = {
  platform: process.platform,
  openConsole(program, args) {
    // Live check 2026-11-01: spawning conhost.exe directly exited within ~0.2 s without
    // starting its program on Jordan's PC (default-terminal handoff), while
    // `start "" /wait` opened a working window every time. `start` makes a new console
    // window (or Windows Terminal tab, per the owner's default terminal), and /wait keeps
    // cmd.exe alive until the program exits, so the exit event still means the window
    // closed. Arguments are fixed strings, validated ids and drive paths; anything cmd.exe
    // could read as syntax is refused rather than escaped.
    return spawn(
      system32('cmd.exe'),
      ['/d', '/s', '/c', `"${consoleCommand(program, args)}"`],
      {
        shell: false,
        detached: true,
        windowsHide: false,
        windowsVerbatimArguments: true,
        stdio: 'ignore',
        env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
      },
    );
  },
  reap(bridgeArgs) {
    return new Promise((done) => {
      const child = spawn(system32('wsl.exe'), bridgeArgs, {
        shell: false,
        windowsHide: true,
        env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      child.stdout.on('data', (b: Buffer) => {
        if (out.length < 20000) out += b.toString('utf8');
      });
      const timer = setTimeout(() => child.kill(), 20000);
      child.on('error', () => {
        clearTimeout(timer);
        done(null);
      });
      child.on('close', () => {
        clearTimeout(timer);
        for (const line of out.replaceAll('\0', '').split('\n')) {
          try {
            const m = JSON.parse(line) as {
              type?: string;
              value?: { cleaned?: unknown; unit_state?: unknown };
            };
            if (m.type === 'result' && typeof m.value?.cleaned === 'boolean')
              return done({
                cleaned: m.value.cleaned,
                unit_state: String(m.value.unit_state ?? ''),
              });
          } catch {
            // Not a bridge record.
          }
        }
        done(null);
      });
    });
  },
  workerPath: wslPath,
  heartbeatMs: 750,
};

interface Active {
  productId: string;
  cancelled: boolean;
  /**
   * Set when the session's end is being recorded. It no longer holds the product's slot
   * or counts toward the cap, but stays listed as ours until its outcome is readable.
   */
  ending?: boolean;
  finished: Promise<TerminalSession>;
}

const resultSchema = TerminalSessionSchema.pick({
  exit_code: true,
  runs: true,
  run_count: true,
}).extend({
  reason: TerminalSessionSchema.shape.reason,
});

/**
 * Owner-started interactive sessions of one verified package (ADR-0058). Each session runs
 * a fresh copy of the exact archive bytes in the isolated WSL worker, attached to a console
 * window on this computer. The studio records the intent, the confirmed command, the hashes
 * and the outcome; it never captures what the program prints.
 */
export class TerminalSupervisor {
  private readonly active = new Map<string, Active>();
  private readonly ports: TerminalPorts;
  constructor(
    readonly products: ProductSupervisor,
    readonly distro = 'Ubuntu',
    ports: Partial<TerminalPorts> = {},
  ) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(distro))
      throw new Error('Invalid configured WSL distribution');
    this.ports = { ...defaultPorts, ...ports };
  }
  private dir(productId: string, sessionId: string): string {
    return join(
      this.products.dir(productId),
      'terminals',
      checked(id, sessionId),
    );
  }
  private bridgeArgs(job: string, sessionId: string, recipeHash: string) {
    return [
      '--distribution',
      this.distro,
      '--exec',
      '/usr/bin/env',
      '-i',
      'PATH=/usr/sbin:/usr/bin:/sbin:/bin',
      'XDG_RUNTIME_DIR=/run/user/1000',
      'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus',
      'TERM=xterm-256color',
      '/usr/bin/python3',
      '-I',
      this.ports.workerPath(WORKER),
      this.ports.workerPath(job),
      sessionId,
      '--recipe-hash',
      recipeHash,
      '--interactive',
    ];
  }

  async open(o: {
    productId: string;
    artifactId: string;
    manifestSha256: string;
    packageSha256: string;
    taskId: string;
    commit: string;
    files: PackageFile[];
    owner: string;
    args: string[];
    /** Chosen by the caller so its audit row can be written before the window opens. */
    sessionId?: string;
  }): Promise<TerminalSession> {
    const p = await this.products.product(o.productId);
    this.products.assertOwner(p, o.owner);
    checked(sha, o.commit);
    checked(hash, o.packageSha256);
    checked(hash, o.manifestSha256);
    const args = checked(RunInputSchema.shape.args, o.args);
    if (this.ports.platform !== 'win32')
      throw new ContractError(
        'LIVE_DISABLED',
        'Running a package in a terminal needs the Windows studio with its WSL worker. Nothing was started.',
      );
    const holding = [...this.active.values()].filter((a) => !a.ending);
    if (holding.some((a) => a.productId === o.productId))
      throw new ContractError(
        'INVALID_TRANSITION',
        'A terminal for this product is already open. Stop it or close its window first.',
      );
    if (holding.length >= TERMINAL_LIMIT)
      throw new ContractError(
        'LIMIT_EXCEEDED',
        `At most ${TERMINAL_LIMIT} terminals can be open at once. Stop one first.`,
      );
    const sessionId = checked(id, o.sessionId ?? randomUUID());
    // Claim the slot in the same synchronous step as the checks above, so concurrent
    // starts cannot all pass them (review M-1), and so a listing during the start sees
    // the session as ours rather than as left over from a restart (L-1).
    const entry: Active = {
      productId: o.productId,
      cancelled: false,
      finished: new Promise<TerminalSession>(() => {}),
    };
    this.active.set(sessionId, entry);
    try {
      return await this.launch(o, args, sessionId, entry);
    } catch (e) {
      this.active.delete(sessionId);
      throw e;
    }
  }

  private async launch(
    o: Parameters<TerminalSupervisor['open']>[0],
    args: string[],
    sessionId: string,
    entry: Active,
  ): Promise<TerminalSession> {
    const dir = this.dir(o.productId, sessionId);
    const job = join(dir, 'job');
    await mkdir(join(job, 'input'), { recursive: true });
    try {
      await canonical(job);
    } catch (e) {
      await rm(dir, { recursive: true, force: true });
      if (/Noncanonical path refused/.test(String(e)))
        throw new ContractError('INVALID_TRANSITION', MSIX_HINT);
      throw e;
    }
    // Until the intent exists, a failure must not leave an intent-less folder behind:
    // list() could not read it once this start is no longer active (review N-1).
    let record: TerminalSession;
    let recipeHash: string;
    try {
      for (const f of o.files) {
        await fileAt(join(job, 'input'), f.path);
        await newFile(join(job, 'input', f.path), f.content.toString('utf8'));
      }
      await jsonWrite(join(job, 'launch.json'), { args });
      recipeHash = digest(await readFile(RECIPE));
      record = {
        id: sessionId,
        product_id: o.productId,
        artifact_id: o.artifactId,
        manifest_sha256: o.manifestSha256,
        package_sha256: o.packageSha256,
        task_id: o.taskId,
        commit: o.commit,
        args,
        command: terminalCommand(args),
        recipe: 'python-terminal/1',
        recipe_hash: recipeHash,
        bridge_hash: digest(await readFile(WORKER)),
        policy_hash: digest(TERMINAL_POLICY),
        state: 'running',
        started_at: new Date().toISOString(),
        finished_at: null,
        exit_code: null,
        reason: null,
        environment: {
          backend: 'wsl2-bwrap-systemd',
          distribution: this.distro,
          supervisor_pid: process.pid,
          policy: TERMINAL_POLICY,
          capture: 'none',
          local_compute_billing: 'not_metered_by_studio',
          source: 'exported_package',
        },
      };
      checked(TerminalSessionSchema, record);
      await jsonPublish(join(dir, 'intent.json'), record);
    } catch (e) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw e;
    }
    await event(this.products.dir(o.productId), 'terminal.intent', record);

    const heartbeat = async () => {
      await canonical(job);
      const tmp = join(job, `lease-${randomUUID()}.json`);
      await writeFile(
        tmp,
        JSON.stringify({
          execution_id: sessionId,
          heartbeat_ms: Date.now(),
          cancelled: entry.cancelled,
        }),
        { flag: 'wx' },
      );
      await rename(tmp, join(job, 'lease.json'));
    };
    try {
      await heartbeat();
      await canonical(WORKER);
      await canonical(RECIPE);
    } catch (e) {
      // Release the slot only after the outcome exists, so a listing in between cannot
      // record this session as lost (review N-2).
      try {
        return await this.settle(record, dir, job, {
          state: 'blocked',
          reason: String(e).slice(0, 2000),
        });
      } finally {
        this.active.delete(sessionId);
      }
    }
    let child: ConsoleChild;
    try {
      child = this.ports.openConsole(
        system32('wsl.exe'),
        this.bridgeArgs(job, sessionId, recipeHash),
      );
    } catch (e) {
      // Release the slot only after the outcome exists, so a listing in between cannot
      // record this session as lost (review N-2).
      try {
        return await this.settle(record, dir, job, {
          state: 'blocked',
          reason: String(e).slice(0, 2000),
        });
      } finally {
        this.active.delete(sessionId);
      }
    }
    entry.finished = new Promise<TerminalSession>((done) => {
      let exited = false;
      let busy = false;
      let over = false;
      const finish = async () => {
        if (over) return;
        over = true;
        clearInterval(timer);
        try {
          done(await this.finish(record, dir, job));
        } catch (e) {
          // The record could not be written (for example the store went away). Report the
          // session as unconfirmed rather than leaving it open forever.
          done({
            ...record,
            state: 'cleanup_required',
            reason: `The outcome could not be recorded: ${String(e)}`.slice(
              0,
              2000,
            ),
            finished_at: new Date().toISOString(),
          });
        } finally {
          this.active.delete(sessionId);
        }
      };
      const tick = async () => {
        if (busy || over) return;
        busy = true;
        try {
          // The bridge writes result.json when the program ends; its window may stay open
          // on "Press Enter" so the last screen can be read, and that no longer counts.
          const done = await readFile(join(job, 'result.json')).then(
            () => true,
            () => false,
          );
          if (done || exited) return void (await finish());
          await heartbeat().catch(() => undefined);
        } catch {
          // finish() reports its own failures; a failed tick retries on the next one.
        } finally {
          busy = false;
        }
      };
      const timer = setInterval(() => void tick(), this.ports.heartbeatMs);
      // The studio's server keeps the process alive; a session alone must not.
      timer.unref();
      child.once('exit', () => {
        exited = true;
        void tick();
      });
      child.once('error', () => {
        exited = true;
        void tick();
      });
    });
    void entry.finished.catch(() => undefined);
    return record;
  }

  /** Reads the bridge's management records; without a result, reaps the unit. */
  private async finish(
    record: TerminalSession,
    dir: string,
    job: string,
  ): Promise<TerminalSession> {
    let environment: Record<string, unknown> = {};
    try {
      environment = (await readJson(join(job, 'environment.json'))) as Record<
        string,
        unknown
      >;
    } catch {
      // The bridge never started or was stopped before it wrote its identity.
    }
    type Raw = {
      exit_code?: unknown;
      reason?: unknown;
      cleaned?: unknown;
      runs?: unknown;
      run_count?: unknown;
    };
    const raw = (await readJson(join(job, 'result.json')).catch(
      () => null,
    )) as Raw | null;
    const merged = { ...record.environment, worker: environment };
    if (raw && typeof raw.cleaned === 'boolean') {
      // The run list is the worker's report; one that does not fit the contract is left
      // out rather than failing the whole outcome.
      const runs = resultSchema.shape.runs.safeParse(raw.runs);
      const count = resultSchema.shape.run_count.safeParse(raw.run_count);
      const r = checked(resultSchema, {
        exit_code: typeof raw.exit_code === 'number' ? raw.exit_code : null,
        reason: typeof raw.reason === 'string' ? raw.reason : null,
        ...(runs.success && runs.data ? { runs: runs.data } : {}),
        ...(count.success && count.data !== undefined
          ? { run_count: count.data }
          : {}),
      });
      const state: TerminalSession['state'] = !raw.cleaned
        ? 'cleanup_required'
        : r.reason === null
          ? 'ended'
          : r.reason === 'stopped'
            ? 'stopped'
            : r.reason === 'deadline'
              ? 'timed_out'
              : r.reason === 'window_closed'
                ? 'window_closed'
                : 'lost';
      return this.settle(
        {
          ...record,
          environment: merged,
          ...(r.runs ? { runs: r.runs } : {}),
          ...(r.run_count !== undefined ? { run_count: r.run_count } : {}),
        },
        dir,
        job,
        { state, reason: r.reason, exit_code: r.exit_code },
      );
    }
    // The window closed without the bridge's result (or the bridge never ran). Make sure
    // the unit is gone before calling the session over.
    const blocked = (await readJson(join(job, 'blocked.json')).catch(
      () => null,
    )) as { reason?: unknown } | null;
    const reaped = await this.ports
      .reap([...this.bridgeArgs(job, record.id, record.recipe_hash), '--reap'])
      .catch(() => null);
    const environmentWritten = typeof environment.unit === 'string';
    // The bridge writes its identity just before it starts the unit, so without it the
    // program never ran: for example WSL was starting or shutting down, or a check failed.
    if (!environmentWritten && (reaped?.cleaned ?? true))
      return this.settle({ ...record, environment: merged }, dir, job, {
        state: 'blocked',
        reason:
          typeof blocked?.reason === 'string'
            ? `The worker refused to start: ${blocked.reason}`.slice(0, 2000)
            : 'The program did not start: the window closed before the WSL worker began (WSL may have been starting or shutting down). Nothing ran; try again.',
      });
    return this.settle({ ...record, environment: merged }, dir, job, {
      state: reaped?.cleaned ? 'window_closed' : 'cleanup_required',
      reason: reaped
        ? reaped.cleaned
          ? 'The window closed before the worker reported; the session unit was stopped.'
          : `The session unit could not be confirmed stopped (state ${reaped.unit_state}).`
        : 'The worker could not be reached to confirm the session stopped.',
    });
  }

  private async settle(
    record: TerminalSession,
    dir: string,
    job: string,
    end: Pick<TerminalSession, 'state' | 'reason'> & {
      exit_code?: number | null;
    },
  ): Promise<TerminalSession> {
    const outcome = checked(TerminalSessionSchema, {
      ...record,
      state: end.state,
      reason: end.reason,
      exit_code: end.exit_code ?? null,
      finished_at: new Date().toISOString(),
    });
    // The session is over: free the product's slot before the outcome is written, so a
    // restart from the listing is not refused as "already open" while the write and the
    // cleanup below run. The entry stays until the outcome is in place so a listing in
    // between cannot record it as lost (review N-2). The outcome appears only complete
    // (jsonPublish), so readers never see a partial record, even after a crash.
    const entry = this.active.get(record.id);
    if (entry) entry.ending = true;
    await this.ports.beforeOutcome?.(record.id);
    await jsonPublish(join(dir, 'outcome.json'), outcome);
    this.active.delete(record.id);
    await event(
      this.products.dir(record.product_id),
      'terminal.outcome',
      outcome,
    );
    // The fresh package copy is not needed after a confirmed end; keep it for inspection
    // when cleanup is uncertain.
    if (outcome.state !== 'cleanup_required')
      await rm(job, { recursive: true, force: true }).catch(() => undefined);
    return outcome;
  }

  async status(productId: string, sessionId: string): Promise<TerminalSession> {
    const dir = this.dir(productId, sessionId);
    // Decide "ours" before reading the outcome: settle() lets go of a session only once
    // its outcome is in place, so a session ours at this point is either still open or
    // about to have its outcome. Checking afterwards could miss an outcome written in
    // between and record the session as lost a second time.
    const ours = this.active.has(sessionId);
    const outcomePath = join(dir, 'outcome.json');
    let unreadable = false;
    try {
      return checked(TerminalSessionSchema, await readJson(outcomePath));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        // No outcome yet.
      } else if (!ours && e instanceof SyntaxError) {
        // A partial record left by a version that wrote outcomes in place (review L-2).
        unreadable = true;
      } else throw e;
    }
    const intent = checked(
      TerminalSessionSchema,
      await readJson(join(dir, 'intent.json')),
    );
    if (ours) return intent;
    if (unreadable)
      // Reported, not recorded: the broken file stays for inspection and is never
      // overwritten, and the listing keeps working.
      return {
        ...intent,
        state: 'lost',
        reason:
          'The end of this terminal was not recorded completely (its outcome record is unreadable). The worker ends a session within 5 seconds of losing the studio, but that was not confirmed here.',
      };
    // Not ours and not finished: the studio restarted while it was open. The worker ends a
    // session within 5 seconds of losing the heartbeat; record that honestly.
    try {
      return await this.settle(intent, dir, join(dir, 'job'), {
        state: 'lost',
        reason:
          'The studio stopped while this terminal was open. The worker ends a session within 5 seconds of losing the studio, but that was not confirmed here.',
      });
    } catch (e) {
      // Another listing recorded it first (review L-1); its record is complete.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      return checked(TerminalSessionSchema, await readJson(outcomePath));
    }
  }

  /** Newest first, for one artifact's sessions. */
  async list(
    productId: string,
    owner: string,
    artifactId?: string,
  ): Promise<TerminalSession[]> {
    const p = await this.products.product(productId);
    this.products.assertOwner(p, owner);
    let names: string[] = [];
    try {
      names = await readdir(join(this.products.dir(productId), 'terminals'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    const all = await Promise.all(
      names
        .filter((n) => id.safeParse(n).success)
        .map((n) =>
          this.status(productId, n).catch((e: unknown) => {
            // A session being started right now has no intent record yet, and a folder
            // left by a start that failed before its intent was never a session.
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
          }),
        ),
    );
    return all
      .filter((s): s is TerminalSession => s !== null)
      .filter((s) => !artifactId || s.artifact_id === artifactId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 20);
  }

  async stop(
    productId: string,
    sessionId: string,
    owner: string,
  ): Promise<TerminalSession> {
    const p = await this.products.product(productId);
    this.products.assertOwner(p, owner);
    const entry = this.active.get(checked(id, sessionId));
    if (!entry || entry.productId !== productId)
      return this.status(productId, sessionId);
    entry.cancelled = true;
    await event(this.products.dir(productId), 'terminal.stop.requested', {
      session_id: sessionId,
      owner,
    });
    // The worker sees the stop on the next heartbeat; don't hold the request on a stuck one.
    const wait = new Promise<null>((r) =>
      setTimeout(() => r(null), 10000).unref(),
    );
    return (
      (await Promise.race([entry.finished, wait])) ??
      this.status(productId, sessionId)
    );
  }

  /** Test and shutdown helper: resolves when the session has an outcome. */
  async settled(sessionId: string): Promise<TerminalSession | null> {
    return (await this.active.get(sessionId)?.finished) ?? null;
  }
}
