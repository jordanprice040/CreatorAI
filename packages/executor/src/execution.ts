import { spawn } from 'node:child_process';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  unlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProductSupervisor } from './products.js';
import {
  digest,
  checked,
  executionSchema,
  id,
  type Binding,
  type Execution,
  qaCaseSchema,
  type QaCase,
} from './contracts.js';
import { canonical, jsonWrite, readJson, event, withLock } from './files.js';

const WORKER = fileURLToPath(new URL('../worker/bridge.py', import.meta.url));
const RECIPE = fileURLToPath(new URL('../worker/recipe.py', import.meta.url));
const POLICY =
  'wsl2-bwrap-systemd/1;uid=1000;net=none;mem=256MiB;swap=0;pids=32;cpu=50%;time=20s;lease=5s;work=16MiB;tmp=1MiB;log=64KiB;file=8MiB';
function wslPath(p: string): string {
  const full = resolve(p);
  if (!/^[A-Za-z]:\\/.test(full))
    throw new Error('Reviewed backend requires a Windows drive path');
  return `/mnt/${full[0]!.toLowerCase()}/${full.slice(3).replaceAll('\\', '/')}`;
}
export class ExecutionSupervisor {
  constructor(
    readonly products: ProductSupervisor,
    readonly distro = 'Ubuntu',
  ) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(distro))
      throw new Error('Invalid configured WSL distribution');
  }
  private dir(productId: string, executionId: string): string {
    return join(
      this.products.dir(productId),
      'executions',
      checked(id, executionId),
    );
  }
  async status(productId: string, executionId: string): Promise<Execution> {
    const dir = this.dir(productId, executionId);
    try {
      return checked(
        executionSchema,
        await readJson(join(dir, 'reconciliation.json')),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    try {
      return checked(
        executionSchema,
        await readJson(join(dir, 'outcome.json')),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    return checked(executionSchema, await readJson(join(dir, 'intent.json')));
  }
  async cancel(
    productId: string,
    executionId: string,
    owner: string,
  ): Promise<void> {
    const p = await this.products.product(productId);
    this.products.assertOwner(p, owner);
    const dir = this.dir(productId, executionId);
    const state = await this.status(productId, executionId);
    if (state.state !== 'running') return;
    try {
      await jsonWrite(join(dir, 'cancel.json'), {
        execution_id: executionId,
        actor_id: owner,
        at: new Date().toISOString(),
      });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    await event(this.products.dir(productId), 'execution.cancel.requested', {
      execution_id: executionId,
      owner,
    });
  }
  async run(
    productId: string,
    taskId: string,
    commit: string,
    binding: Binding,
    onStarted: (id: string) => void = () => {},
    qa?: QaCase,
  ): Promise<Execution> {
    // One local generated-code unit at a time. A crash leaves the lock for explicit reconciliation.
    return withLock(this.products.root, async () => {
      try {
        await readJson(join(this.products.root, 'pending-worker.json'));
        throw new Error(
          'A worker outcome needs reconciliation before another dispatch',
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      return this.runOne(productId, taskId, commit, binding, onStarted, qa);
    });
  }
  private async runOne(
    productId: string,
    taskId: string,
    commit: string,
    binding: Binding,
    onStarted: (id: string) => void,
    qa?: QaCase,
  ): Promise<Execution> {
    const p = await this.products.product(productId);
    this.products.assertBinding(p, binding);
    this.products.assertOwner(p, binding.owner_id);
    const executionId = randomUUID(),
      dir = this.dir(productId, executionId),
      job = join(dir, 'job');
    await mkdir(dir);
    await mkdir(job);
    await mkdir(join(job, 'input'));
    let inputHash: string;
    try {
      inputHash = await withLock(this.products.dir(productId), () =>
        this.products.snapshot(productId, taskId, commit, join(job, 'input')),
      );
    } catch (e) {
      await rm(job, { recursive: true });
      throw e;
    }
    const recipeHash = digest(await readFile(RECIPE));
    if (qa)
      await jsonWrite(join(job, 'acceptance.json'), checked(qaCaseSchema, qa));
    const record: Execution = {
      id: executionId,
      product_id: productId,
      task_id: taskId,
      commit,
      recipe: 'python-build/1',
      recipe_hash: recipeHash,
      policy_hash: digest(POLICY),
      input_hash: inputHash,
      state: 'running',
      started_at: new Date().toISOString(),
      finished_at: null,
      environment: {
        backend: 'wsl2-bwrap-systemd',
        distribution: this.distro,
        supervisor_pid: process.pid,
        bridge_hash: digest(await readFile(WORKER)),
        local_compute_billing: 'not_metered_by_studio',
        acceptance_hash: qa
          ? digest(JSON.stringify(checked(qaCaseSchema, qa)))
          : null,
      },
      log: '',
      exit_code: null,
      reason: null,
    };
    await jsonWrite(join(dir, 'intent.json'), record);
    await event(this.products.dir(productId), 'execution.intent', record);
    let cancelled = false;
    const heartbeat = async () => {
      try {
        await readFile(join(dir, 'cancel.json'));
        cancelled = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      await canonical(job);
      const tmp = join(job, `lease-${randomUUID()}.json`);
      await writeFile(
        tmp,
        JSON.stringify({
          execution_id: executionId,
          heartbeat_ms: Date.now(),
          cancelled,
        }),
        { flag: 'wx' },
      );
      await rename(tmp, join(job, 'lease.json'));
    };
    await heartbeat();
    onStarted(executionId);
    let busy = false;
    let heartbeatWriteErrors = 0;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      heartbeat()
        .catch(() => {
          heartbeatWriteErrors += 1;
        })
        .finally(() => {
          busy = false;
        });
    }, 750);
    let dispatchIntent = false;
    try {
      if (process.platform !== 'win32')
        throw new Error(
          'Isolation unavailable: this reviewed backend requires Windows + WSL2',
        );
      await canonical(WORKER);
      await canonical(RECIPE);
      await jsonWrite(join(this.products.root, 'pending-worker.json'), {
        product_id: productId,
        execution_id: executionId,
        supervisor_pid: process.pid,
      });
      dispatchIntent = true;
      const messages = await this.launch(job, executionId);
      let result:
        | {
            exit_code: number;
            reason: string | null;
            log: string;
            cleaned: boolean;
            unit_state: string;
          }
        | undefined;
      for (const message of messages) {
        const m = message as { type: string; value: unknown };
        if (m.type === 'environment')
          record.environment = {
            ...record.environment,
            ...(m.value as Record<string, unknown>),
          };
        if (m.type === 'limits') record.environment.effective_limits = m.value;
        if (m.type === 'blocked') record.reason = String(m.value);
        if (m.type === 'result') result = m.value as typeof result;
      }
      if (result) {
        record.exit_code = result.exit_code;
        record.log = result.log;
        record.reason = result.reason;
        record.environment.cleanup = result.unit_state;
        if (record.environment.recipe_hash !== recipeHash)
          throw new Error('Reviewed recipe changed during dispatch');
        record.state = !result.cleaned
          ? 'cleanup_required'
          : result.reason === 'cancelled'
            ? 'cancelled'
            : result.reason === 'lease_lost'
              ? 'lost'
              : result.exit_code === 0 && !result.reason
                ? 'succeeded'
                : 'failed';
      } else {
        record.state = record.environment.unit ? 'cleanup_required' : 'blocked';
        record.reason ??= 'Isolation bridge returned no execution outcome';
      }
    } catch (error) {
      record.state =
        dispatchIntent && (error as NodeJS.ErrnoException).code !== 'ENOENT'
          ? 'cleanup_required'
          : 'blocked';
      record.reason = String(error);
    } finally {
      clearInterval(timer);
      while (busy) await new Promise((r) => setTimeout(r, 10));
      record.environment.heartbeat_write_errors = heartbeatWriteErrors;
      // Preserve uncertain worker input for reconciliation; never imply it was cleaned.
      if (!['blocked', 'cleanup_required'].includes(record.state)) {
        await canonical(job);
        await rm(job, { recursive: true });
      }
    }
    record.finished_at = new Date().toISOString();
    if (dispatchIntent && record.state !== 'cleanup_required')
      await unlink(join(this.products.root, 'pending-worker.json'));
    checked(executionSchema, record);
    await jsonWrite(join(dir, 'outcome.json'), record);
    await event(this.products.dir(productId), 'execution.outcome', record);
    return record;
  }
  private async launch(
    job: string,
    executionId: string,
    reap = false,
  ): Promise<unknown[]> {
    const executable = join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'wsl.exe',
    );
    const recipeHash = digest(await readFile(RECIPE));
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        executable,
        [
          '--distribution',
          this.distro,
          '--exec',
          '/usr/bin/env',
          '-i',
          'PATH=/usr/sbin:/usr/bin:/sbin:/bin',
          'XDG_RUNTIME_DIR=/run/user/1000',
          'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus',
          '/usr/bin/python3',
          '-I',
          wslPath(WORKER),
          wslPath(job),
          executionId,
          '--recipe-hash',
          recipeHash,
          ...(reap ? ['--reap'] : []),
        ],
        {
          shell: false,
          windowsHide: true,
          env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let out = '',
        err = '',
        excessive = false;
      child.stdout.on('data', (b: Buffer) => {
        if (out.length + b.length > 150000) {
          excessive = true;
          child.kill();
        } else out += b.toString('utf8');
      });
      child.stderr.on('data', (b: Buffer) => {
        if (err.length < 10000) err += b.toString('utf8');
      });
      const timer = setTimeout(() => child.kill(), 40000);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (excessive)
          return reject(
            new Error(
              'Isolation bridge output limit; worker lease will expire',
            ),
          );
        try {
          if (
            out
              .replaceAll('\0', '')
              .includes('Wsl/Service/WSL_E_DISTRO_NOT_FOUND')
          ) {
            return resolveResult([
              {
                type: 'blocked',
                value:
                  'Isolation unavailable: configured WSL distribution does not exist',
              },
            ]);
          }
          const messages = out
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((s) => JSON.parse(s) as unknown);
          if (!messages.length)
            throw new Error(err || 'Isolation bridge unavailable');
          resolveResult(messages);
        } catch (e) {
          reject(e);
        }
      });
    });
  }
  async executions(productId: string): Promise<Execution[]> {
    return Promise.all(
      (await readdir(join(this.products.dir(productId), 'executions'))).map(
        (n) => this.status(productId, n),
      ),
    );
  }
  async reconcile(
    productId: string,
    executionId: string,
    owner: string,
  ): Promise<Execution> {
    const p = await this.products.product(productId);
    this.products.assertOwner(p, owner);
    return withLock(this.products.dir(productId), async () => {
      const record = await this.status(productId, executionId);
      if (!['running', 'cleanup_required'].includes(record.state))
        return record;
      const pid = record.environment.supervisor_pid;
      if (typeof pid !== 'number')
        throw new Error('Unknown supervisor; manual inspection required');
      try {
        process.kill(pid, 0);
        throw new Error(
          'Supervisor still exists; cancel it and wait. PID reuse also blocks recovery.',
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
      const dir = this.dir(productId, executionId),
        job = join(dir, 'job');
      const lease = (await readJson(join(job, 'lease.json'))) as {
        heartbeat_ms: number;
      };
      if (
        !Number.isFinite(lease.heartbeat_ms) ||
        Date.now() - lease.heartbeat_ms < 6000
      )
        throw new Error('Lease has not expired');
      const messages = await this.launch(job, executionId, true);
      const result = messages.find(
        (m) => (m as { type: string }).type === 'result',
      ) as { value: { cleaned: boolean; unit_state: string } } | undefined;
      if (!result?.value.cleaned)
        throw new Error(
          'Worker cleanup could not be verified; outcome remains unresolved',
        );
      record.state = 'lost';
      record.reason =
        'Supervisor died; worker unit stopped and verified inactive, no automatic redispatch';
      record.finished_at = new Date().toISOString();
      record.environment.cleanup = result.value.unit_state;
      await canonical(job);
      await rm(job, { recursive: true });
      await jsonWrite(join(dir, 'reconciliation.json'), record);
      await event(this.products.dir(productId), 'execution.reconciled', record);
      const lock = join(this.products.root, 'supervisor.lock');
      try {
        const lockOwner = (await readJson(lock)) as { pid: number };
        if (lockOwner.pid === pid) await unlink(lock);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      const pending = join(this.products.root, 'pending-worker.json');
      try {
        const marker = (await readJson(pending)) as { execution_id: string };
        if (marker.execution_id === executionId) await unlink(pending);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      return record;
    });
  }
}
