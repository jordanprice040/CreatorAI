import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ProductSupervisor,
  TERMINAL_LIMIT,
  TERMINAL_POLICY,
  TerminalSupervisor,
  consoleCommand,
  digest,
  type Binding,
  type PackageFile,
  type TerminalPorts,
} from '@creator/executor';
import { ContractError, terminalCommand } from '@creator/contracts';

const owner = randomUUID();
const files: PackageFile[] = [
  {
    path: 'src/main.py',
    content: Buffer.from('print("hello")\n'),
  } as PackageFile,
];

function binding(): Binding {
  return {
    workspace_id: randomUUID(),
    owner_id: owner,
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: 'a'.repeat(64),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: 'b'.repeat(64), file_scope: ['src'] }],
  };
}

/**
 * A stand-in for the console window plus bridge. It never runs generated code: it reads
 * the lease the supervisor writes and answers with the bridge's management records.
 */
class FakeWindow extends EventEmitter {
  constructor(
    readonly program: string,
    readonly args: string[],
  ) {
    super();
  }
  get job(): string {
    return this.args[this.args.indexOf('-I') + 2]!;
  }
  async result(value: Record<string, unknown>) {
    await writeFile(
      join(this.job, 'environment.json'),
      JSON.stringify({
        unit: 'creator-term-x',
        policy: { runtime_seconds: 900 },
      }),
    );
    await writeFile(join(this.job, 'result.json'), JSON.stringify(value));
  }
  /** The bridge's identity record, written just before it starts the unit. */
  async began() {
    await writeFile(
      join(this.job, 'environment.json'),
      JSON.stringify({ unit: 'creator-term-x' }),
    );
  }
  close() {
    this.emit('exit');
  }
}

async function harness(
  t: test.TestContext,
  extra: Partial<TerminalPorts> = {},
) {
  const parent = resolve('.verification/terminal');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  // Session timers are unref'd (the studio's server keeps a real process alive).
  const keepAlive = setInterval(() => undefined, 1000);
  t.after(async () => {
    clearInterval(keepAlive);
    // Open sessions keep writing their lease until the folder is gone.
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  });
  const products = new ProductSupervisor(join(dir, 'products'));
  await products.initialize();
  const windows: FakeWindow[] = [];
  const reaps: string[][] = [];
  let reapAnswer: { cleaned: boolean; unit_state: string } | null = {
    cleaned: true,
    unit_state: 'inactive',
  };
  const ports: Partial<TerminalPorts> = {
    platform: 'win32',
    workerPath: (p) => p,
    heartbeatMs: 20,
    openConsole: (program, args) => {
      const w = new FakeWindow(program, args);
      windows.push(w);
      return w;
    },
    reap: async (args) => {
      reaps.push(args);
      return reapAnswer;
    },
    ...extra,
  };
  const terminals = new TerminalSupervisor(products, 'Ubuntu', ports);
  const product = async () => {
    const p = await products.create(binding());
    const productId = p.id;
    return productId;
  };
  return {
    products,
    terminals,
    windows,
    reaps,
    product,
    setReap: (v: typeof reapAnswer) => {
      reapAnswer = v;
    },
  };
}

const start = (
  terminals: TerminalSupervisor,
  productId: string,
  args: string[] = ['--practice'],
  who = owner,
) =>
  terminals.open({
    productId,
    artifactId: randomUUID(),
    manifestSha256: 'c'.repeat(64),
    packageSha256: 'd'.repeat(64),
    taskId: randomUUID(),
    commit: 'e'.repeat(40),
    files,
    owner: who,
    args,
  });

async function until<T>(f: () => Promise<T | null | undefined>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await f();
    if (v) return v;
    await sleep(10);
  }
  throw new Error('timed out');
}

test('terminal sessions start only on the Windows worker, for the owner, with bounded arguments', async (t) => {
  const linux = await harness(t, { platform: 'linux' });
  const p = await linux.product();
  await assert.rejects(start(linux.terminals, p), (e: unknown) => {
    assert.ok(e instanceof ContractError);
    assert.equal(e.code, 'LIVE_DISABLED');
    return true;
  });
  assert.equal(linux.windows.length, 0);
  await assert.rejects(readdir(join(linux.products.dir(p), 'terminals')), {
    code: 'ENOENT',
  });

  const h = await harness(t);
  const q = await h.product();
  await assert.rejects(start(h.terminals, q, [], randomUUID()));
  await assert.rejects(
    start(
      h.terminals,
      q,
      Array.from({ length: 13 }, () => '-x'),
    ),
  );
  assert.equal(h.windows.length, 0);
});

test('a session runs a fresh package copy in the worker with only the confirmed arguments, and records its end', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  const s = await start(h.terminals, p, ['--practice', '--fps', '60', 'a b']);
  assert.equal(s.state, 'running');
  assert.equal(s.command, "python3 src/main.py --practice --fps 60 'a b'");
  assert.equal(s.command, terminalCommand(s.args));
  assert.equal(s.policy_hash, digest(TERMINAL_POLICY));
  assert.match(TERMINAL_POLICY, /net=none/);
  assert.match(TERMINAL_POLICY, /time=900s/);
  const [w] = h.windows;
  assert.ok(w);
  assert.match(w.program, /wsl\.exe$/);
  // The worker gets a cleared environment and the interactive bridge; no studio settings.
  assert.deepEqual(w.args.slice(0, 5), [
    '--distribution',
    'Ubuntu',
    '--exec',
    '/usr/bin/env',
    '-i',
  ]);
  assert.ok(w.args.includes('--interactive'));
  assert.ok(!w.args.includes('--reap'));
  assert.ok(!w.args.some((a) => /CREATOR_|TOKEN|SECRET/i.test(a)));
  // Only the confirmed argument list crosses into the sandbox, beside the package copy.
  assert.deepEqual(
    JSON.parse(await readFile(join(w.job, 'launch.json'), 'utf8')),
    {
      args: ['--practice', '--fps', '60', 'a b'],
    },
  );
  assert.equal(
    await readFile(join(w.job, 'input', 'src', 'main.py'), 'utf8'),
    'print("hello")\n',
  );
  const lease = await until(async () =>
    JSON.parse(
      await readFile(join(w.job, 'lease.json'), 'utf8').catch(() => 'null'),
    ),
  );
  assert.equal(lease.execution_id, s.id);
  assert.equal(lease.cancelled, false);

  // The program exits normally; the window stays open on "Press Enter", which no longer counts.
  await w.result({
    exit_code: 0,
    reason: null,
    cleaned: true,
    unit_state: 'inactive',
  });
  const done = await until(async () => {
    const [x] = await h.terminals.list(p, owner);
    return x && x.state !== 'running' ? x : null;
  });
  assert.equal(done.state, 'ended');
  assert.equal(done.exit_code, 0);
  assert.equal(done.environment.capture, 'none');
  // The package copy is removed right after the outcome is written.
  await until(async () =>
    readFile(join(w.job, 'launch.json')).then(
      () => false,
      (e: NodeJS.ErrnoException) => e.code === 'ENOENT',
    ),
  );
  const events = await readdir(join(h.products.dir(p), 'events'));
  assert.ok(events.length >= 2);
  // Ended: a new session can start.
  await start(h.terminals, p);
  assert.equal(h.windows.length, 2);
});

test('runs of the same window are recorded with the outcome; a malformed run list is left out (ADR-0059)', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  await start(h.terminals, p, ['--practice']);
  const [w] = h.windows;
  const runs = [
    { args: ['--practice'], exit_code: 0, seconds: 420 },
    { args: ['--fps', '30'], exit_code: 0, seconds: 61 },
    { args: [], exit_code: 2, seconds: 0 },
  ];
  await w!.result({
    exit_code: 2,
    reason: null,
    cleaned: true,
    unit_state: 'inactive',
    runs,
    run_count: 3,
  });
  const done = await until(async () => {
    const [x] = await h.terminals.list(p, owner);
    return x && x.state !== 'running' ? x : null;
  });
  assert.equal(done.state, 'ended');
  // The session's exit code is the last run's; the first run's arguments stay the confirmed ones.
  assert.equal(done.exit_code, 2);
  assert.deepEqual(done.args, ['--practice']);
  assert.deepEqual(done.runs, runs);
  assert.equal(done.run_count, 3);

  // A worker report outside the contract (13 arguments) does not fail the outcome.
  const q = await h.product();
  await start(h.terminals, q);
  const w2 = h.windows[1]!;
  await w2.result({
    exit_code: 0,
    reason: 'stopped',
    cleaned: true,
    unit_state: 'inactive',
    runs: [{ args: Array(13).fill('x'), exit_code: 0, seconds: 1 }],
    run_count: 'many',
  });
  const stopped = await until(async () => {
    const [x] = await h.terminals.list(q, owner);
    return x && x.state !== 'running' ? x : null;
  });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.runs, undefined);
  assert.equal(stopped.run_count, undefined);
});

test('one open session per product and a studio-wide cap', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  await start(h.terminals, p);
  await assert.rejects(start(h.terminals, p), /already open/);
  for (let i = 1; i < TERMINAL_LIMIT; i++)
    await start(h.terminals, await h.product());
  await assert.rejects(start(h.terminals, await h.product()), (e: unknown) => {
    assert.ok(e instanceof ContractError);
    assert.equal(e.code, 'LIMIT_EXCEEDED');
    return true;
  });
  assert.equal(h.windows.length, TERMINAL_LIMIT);
});

test('concurrent starts cannot pass the limits, and a listing during a start does not mark it lost (review M-1, L-1)', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  const tries = await Promise.allSettled(
    Array.from({ length: 5 }, () => start(h.terminals, p)),
  );
  assert.equal(tries.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(h.windows.length, 1);
  const others = await Promise.all(
    Array.from({ length: 5 }, () => h.product()),
  );
  const listing = h.terminals.list(others[0]!, owner);
  const many = await Promise.allSettled(
    others.map((q) => start(h.terminals, q)),
  );
  assert.equal(
    many.filter((x) => x.status === 'fulfilled').length,
    TERMINAL_LIMIT - 1,
  );
  assert.equal(h.windows.length, TERMINAL_LIMIT);
  await listing;
  for (const q of others) {
    const [x] = await h.terminals.list(q, owner);
    if (x) assert.equal(x.state, 'running');
  }
  // A refused start leaves no folder behind that a listing could misread.
  assert.ok(many.some((x) => x.status === 'rejected'));
  let folders = 0;
  for (const q of others)
    folders += await readdir(join(h.products.dir(q), 'terminals')).then(
      (n) => n.length,
      () => 0,
    );
  assert.equal(folders, TERMINAL_LIMIT - 1);
});

test('a start that fails before its record exists leaves nothing that breaks the list (review N-1)', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  // The same package path twice fails while the files are copied, before the intent.
  await assert.rejects(
    h.terminals.open({
      productId: p,
      artifactId: randomUUID(),
      manifestSha256: 'c'.repeat(64),
      packageSha256: 'd'.repeat(64),
      taskId: randomUUID(),
      commit: 'e'.repeat(40),
      files: [...files, ...files],
      owner,
      args: [],
    }),
  );
  assert.equal(h.windows.length, 0);
  assert.deepEqual(
    await readdir(join(h.products.dir(p), 'terminals')).catch(() => []),
    [],
  );
  assert.deepEqual(await h.terminals.list(p, owner), []);
  // A folder with no record (left by an older build) is skipped, not fatal.
  await mkdir(join(h.products.dir(p), 'terminals', randomUUID(), 'job'), {
    recursive: true,
  });
  const s = await start(h.terminals, p);
  const [listed, ...rest] = await h.terminals.list(p, owner);
  assert.equal(listed?.id, s.id);
  assert.equal(rest.length, 0);
});

test('Stop reaches the worker through the lease; deadline and window close map to their own states', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  const s = await start(h.terminals, p);
  const w = h.windows[0]!;
  // The fake bridge answers once it sees the cancelled lease, as the real one does.
  void (async () => {
    await until(async () => {
      const l = JSON.parse(
        await readFile(join(w.job, 'lease.json'), 'utf8').catch(() => '{}'),
      );
      return l.cancelled === true;
    });
    await w.result({
      exit_code: -15,
      reason: 'stopped',
      cleaned: true,
      unit_state: 'inactive',
    });
  })();
  await assert.rejects(h.terminals.stop(p, s.id, randomUUID()));
  const stopped = await h.terminals.stop(p, s.id, owner);
  assert.equal(stopped.state, 'stopped');

  const p2 = await h.product();
  await start(h.terminals, p2);
  await h.windows[1]!.result({
    exit_code: -9,
    reason: 'deadline',
    cleaned: true,
    unit_state: 'inactive',
  });
  const timed = await until(async () => {
    const [x] = await h.terminals.list(p2, owner);
    return x?.state !== 'running' ? x : null;
  });
  assert.equal(timed.state, 'timed_out');

  const p3 = await h.product();
  await start(h.terminals, p3);
  await h.windows[2]!.result({
    exit_code: 0,
    reason: null,
    cleaned: false,
    unit_state: 'active',
  });
  const dirty = await until(async () => {
    const [x] = await h.terminals.list(p3, owner);
    return x?.state !== 'running' ? x : null;
  });
  assert.equal(dirty.state, 'cleanup_required');
  // Uncertain cleanup keeps the package copy for inspection.
  await readFile(join(h.windows[2]!.job, 'launch.json'));
});

test('a window closed before the worker reports is reaped, and an unconfirmed reap is not called clean', async (t) => {
  const h = await harness(t);
  const settledOf = async (productId: string) =>
    until(async () => {
      const [x] = await h.terminals.list(productId, owner);
      return x?.state !== 'running' ? x : null;
    });
  // The bridge started the unit, then the window was closed: reaped and confirmed.
  const p = await h.product();
  await start(h.terminals, p);
  await h.windows[0]!.began();
  h.windows[0]!.close();
  const closed = await settledOf(p);
  assert.equal(closed.state, 'window_closed');
  assert.equal(h.reaps.length, 1);
  assert.ok(h.reaps[0]!.includes('--reap'));
  assert.ok(h.reaps[0]!.includes('--interactive'));

  // Live check 2026-11-01: WSL was shutting down, so the window closed before the bridge
  // ran at all. That is "did not start", not "window closed".
  const q = await h.product();
  await start(h.terminals, q);
  h.windows[1]!.close();
  const never = await settledOf(q);
  assert.equal(never.state, 'blocked');
  assert.match(never.reason ?? '', /did not start.*try again/);

  // A bridge check failed: its reason is shown.
  const r = await h.product();
  await start(h.terminals, r);
  await writeFile(
    join(h.windows[2]!.job, 'blocked.json'),
    JSON.stringify({ reason: 'Missing isolation capability: /usr/bin/bwrap' }),
  );
  h.windows[2]!.close();
  const refused = await settledOf(r);
  assert.equal(refused.state, 'blocked');
  assert.match(refused.reason ?? '', /refused to start: Missing isolation/);

  // The unit started but the reap could not confirm it stopped.
  h.setReap(null);
  const u = await h.product();
  await start(h.terminals, u);
  await h.windows[3]!.began();
  h.windows[3]!.close();
  const unknown = await settledOf(u);
  assert.equal(unknown.state, 'cleanup_required');
});

test('after a studio restart an open session is recorded as lost, not as running', async (t) => {
  const h = await harness(t);
  const p = await h.product();
  const s = await start(h.terminals, p);
  const again = new TerminalSupervisor(h.products, 'Ubuntu', {
    platform: 'win32',
    workerPath: (x) => x,
  });
  const [x] = await again.list(p, owner);
  assert.equal(x!.id, s.id);
  assert.equal(x!.state, 'lost');
  assert.match(x!.reason ?? '', /not confirmed/);
});

test('the bridge and the recorded policy agree on the interactive limits', async () => {
  const bridge = await readFile('packages/executor/worker/bridge.py', 'utf8');
  const recipe = await readFile('packages/executor/worker/terminal.py', 'utf8');
  assert.match(bridge, /'runtime_seconds': 900/);
  assert.match(
    bridge,
    /'session_seconds': 3600, 'idle_seconds': 600, 'max_runs': 50/,
  );
  // Each run's unit limit is the 15-minute run limit, cut to what is left of the session.
  assert.match(
    bridge,
    /min\(TERMINAL_POLICY\['runtime_seconds'\], remaining\(\)\)/,
  );
  assert.match(bridge, /'RuntimeMaxSec=' \+ str\(limit\)/);
  assert.match(bridge, /'--pty'/);
  assert.match(bridge, /MemoryMax=268435456/);
  assert.match(bridge, /TasksMax=32/);
  assert.match(bridge, /CPUQuota=50%/);
  assert.match(bridge, /'--unshare-all'/);
  assert.match(
    TERMINAL_POLICY,
    /mem=256MiB;swap=0;pids=32;cpu=50%;time=900s;session=3600s;idle=600s;runs=50;/,
  );
  // Only the argument list enters; the recipe refuses anything else.
  assert.match(recipe, /set\(launch\) != \{'args'\}/);
  assert.doesNotMatch(recipe, /stdin|environ\b/);
});

test('the console launcher quotes only what cmd.exe and wsl.exe need, and refuses what it cannot pass', () => {
  assert.equal(
    consoleCommand('C:\\Windows\\System32\\wsl.exe', [
      '--distribution',
      'Ubuntu',
      '/mnt/c/Users/A B/x (1)/bridge.py',
      'a&b',
    ]),
    'start "Creator Agent" /wait C:\\Windows\\System32\\wsl.exe --distribution Ubuntu "/mnt/c/Users/A B/x (1)/bridge.py" "a&b"',
  );
  for (const bad of ['%PATH%', 'a"b', 'x!y', '', 'a\nb'])
    assert.throws(() => consoleCommand('wsl.exe', [bad]), /cannot pass safely/);
});
