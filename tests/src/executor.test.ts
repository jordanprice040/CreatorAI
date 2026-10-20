import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  symlink,
  link,
  rm,
  readdir,
} from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  ProductSupervisor,
  ExecutionSupervisor,
  digest,
  TEMPLATE,
  type Binding,
} from '@creator/executor';
import { spawn } from 'node:child_process';

async function setup(t: test.TestContext) {
  const parent = resolve('.verification/executor-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  // Only delete a checked, explicitly created test directory.
  t.after(async () => {
    assert.equal(
      root.startsWith(parent + (process.platform === 'win32' ? '\\' : '/')),
      true,
    );
    await rm(root, { recursive: true, force: true });
  });
  const local = new ProductSupervisor(join(root, 'products'));
  const binding: Binding = {
    workspace_id: randomUUID(),
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest('spec'),
    freeze_id: randomUUID(),
    tasks: [
      { key: 'T1', hash: digest('task1'), file_scope: ['src'] },
      { key: 'T2', hash: digest('task2'), file_scope: ['src'] },
    ],
  };
  const product = await local.create(binding);
  const task = await local.createTask(
    product.id,
    'T1',
    product.initial_commit,
    binding,
  );
  return { root, local, product, task, binding };
}

test('local products use separate repositories, exact bases, scoped CAS patches and preserve dirty user work', async (t) => {
  const { local, product: p, task, binding } = await setup(t);
  const dir = local.worktree(p.id, task.id);
  assert.notEqual(local.repo(p.id), resolve('.'));
  assert.equal(
    (await readFile(join(dir, '.git'), 'utf8')).startsWith('gitdir:'),
    true,
  );
  await assert.rejects(
    local.createTask(p.id, 'T2', 'f'.repeat(40), binding),
    /Stale/,
  );
  await assert.rejects(
    local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'readme.md',
            before_hash: digest(TEMPLATE['readme.md']),
            content: 'forbidden',
          },
        ],
      },
      binding,
    ),
    /scope/,
  );
  for (const path of [
    '../secret',
    'src/../secret',
    'src\\secret',
    'src/con.txt',
    '.git/config',
    'src/a:stream',
    'src/a.',
  ]) {
    await assert.rejects(
      local.apply(
        p.id,
        task.id,
        {
          expected_commit: p.initial_commit,
          changes: [{ path, before_hash: null, content: 'bad' }],
        },
        binding,
      ),
    );
  }
  await assert.rejects(
    local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          { path: 'src/main.py', before_hash: digest('stale'), content: 'bad' },
        ],
      },
      binding,
    ),
    /Stale file/,
  );
  const change = {
    expected_commit: p.initial_commit,
    changes: [
      {
        path: 'src/main.py',
        before_hash: digest(TEMPLATE['src/main.py']),
        content: 'print("changed")\n',
      },
    ],
  };
  const result = await local.apply(p.id, task.id, change, binding);
  assert.notEqual(result.commit, p.initial_commit);
  await assert.rejects(
    local.apply(p.id, task.id, change, binding),
    /Stale task/,
  );
  await assert.rejects(
    local.apply(p.id, task.id, change, { ...binding, spec_version: 2 }),
    /specification/,
  );
  await writeFile(join(dir, 'src/main.py'), 'user edits\n');
  await assert.rejects(
    local.apply(
      p.id,
      task.id,
      { ...change, expected_commit: result.commit },
      binding,
    ),
    /User edits/,
  );
  assert.equal(
    await readFile(join(dir, 'src/main.py'), 'utf8'),
    'user edits\n',
  );
});

test('symlink, junction and hardlink inputs are refused before Git reads product files', async (t) => {
  const { root, local, product: p, task, binding } = await setup(t);
  const outside = join(root, 'secret');
  await writeFile(outside, 'synthetic host canary');
  const dir = local.worktree(p.id, task.id);
  const target = join(dir, 'src', 'secret.txt');
  await link(outside, target);
  await assert.rejects(
    local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'src/secret.txt',
            before_hash: digest('synthetic host canary'),
            content: 'bad',
          },
        ],
      },
      binding,
    ),
    /unlinked regular/,
  );
  await rm(target);
  const outsideDir = join(root, 'private');
  await mkdir(outsideDir);
  await symlink(
    outsideDir,
    join(dir, 'src', 'private'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    local
      .createTask(p.id, 'T2', p.initial_commit, binding)
      .then(async (other) => {
        // Snapshot of the linked task must fail even though the other task is clean.
        await mkdir(join(root, 'snapshot'));
        await local.snapshot(
          p.id,
          task.id,
          p.initial_commit,
          join(root, 'snapshot'),
        );
        return other;
      }),
    /Linked|canonical/,
  );
  assert.equal(await readFile(outside, 'utf8'), 'synthetic host canary');
});

test('one integration owner, stale heads and real merge conflicts preserve every checkout', async (t) => {
  const { local, product: p, task: a, binding } = await setup(t);
  const b = await local.createTask(p.id, 'T2', p.initial_commit, binding);
  const patch = (content: string) => ({
    expected_commit: p.initial_commit,
    changes: [
      {
        path: 'src/main.py',
        before_hash: digest(TEMPLATE['src/main.py']),
        content,
      },
    ],
  });
  const ar = await local.apply(p.id, a.id, patch('print("a")\n'), binding);
  const br = await local.apply(p.id, b.id, patch('print("b")\n'), binding);
  const first = await local.integrate(
    p.id,
    a.id,
    p.initial_commit,
    ar.commit,
    binding,
  );
  assert.equal(first.state, 'integrated');
  await assert.rejects(
    local.integrate(p.id, b.id, p.initial_commit, br.commit, binding),
    /Stale/,
  );
  await assert.rejects(
    local.integrate(p.id, b.id, first.commit, br.commit, {
      ...binding,
      owner_id: randomUUID(),
    }),
    /specification/,
  );
  const second = await local.integrate(
    p.id,
    b.id,
    first.commit,
    br.commit,
    binding,
  );
  assert.equal(second.state, 'conflict');
  assert.match(
    await readFile(join(second.merge_workspace, 'src/main.py'), 'utf8'),
    /<<<<<<< HEAD/,
  );
  assert.equal(
    await readFile(join(local.repo(p.id), 'src/main.py'), 'utf8'),
    'print("a")\n',
  );
  assert.equal(
    await readFile(join(local.worktree(p.id, b.id), 'src/main.py'), 'utf8'),
    'print("b")\n',
  );
  assert.ok((await readdir(join(local.dir(p.id), 'events'))).length > 5);
});

const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
test('QA dispatch mounts only runtime inputs, never expected answers or case labels', async (t) => {
  const { local, product: p, task, binding } = await setup(t);
  let mounted: unknown;
  const result = await new ExecutionSupervisor(local).run(
    p.id,
    task.id,
    p.initial_commit,
    binding,
    async (executionId) => {
      mounted = JSON.parse(
        await readFile(
          join(
            local.dir(p.id),
            'executions',
            executionId,
            'job',
            'acceptance.json',
          ),
          'utf8',
        ),
      );
      throw new Error('Audit probe stops before native dispatch');
    },
    {
      check_key: 'A1',
      args: ['runtime-argument'],
      stdin: 'runtime input',
      stdout: 'HELD_OUT_EXPECTED_ANSWER',
      exit_code: 7,
    },
  );
  assert.equal(result.state, 'blocked');
  assert.deepEqual(mounted, {
    args: ['runtime-argument'],
    stdin: 'runtime input',
  });
});
test('an unresolved dispatch blocks another worker instead of silently retrying', async (t) => {
  const { local, product: p, task, binding } = await setup(t);
  await writeFile(
    join(local.root, 'pending-worker.json'),
    JSON.stringify({ execution_id: randomUUID(), supervisor_pid: 99999999 }),
  );
  await assert.rejects(
    new ExecutionSupervisor(local).run(
      p.id,
      task.id,
      p.initial_commit,
      binding,
    ),
    /needs reconciliation/,
  );
  assert.equal(
    (await new ExecutionSupervisor(local).executions(p.id)).length,
    0,
  );
});
test(
  'real WSL worker builds the reviewed template with observed cgroup limits and disposes the workspace',
  { skip: !real && 'Set CREATOR_TEST_ISOLATION=wsl2 for the real worker gate' },
  async (t) => {
    const { local, product: p, task, binding } = await setup(t);
    const worker = new ExecutionSupervisor(local);
    const result = await worker.run(p.id, task.id, p.initial_commit, binding);
    assert.equal(result.state, 'succeeded', JSON.stringify(result));
    assert.match(result.log, /checklist\/1/);
    assert.match(
      String(result.environment.effective_limits),
      /MemoryMax=268435456/,
    );
    assert.equal(result.environment.cleanup, 'inactive');
    await assert.rejects(
      readFile(
        join(local.dir(p.id), 'executions', result.id, 'job', 'lease.json'),
      ),
      /ENOENT/,
    );
  },
);

test(
  'real WSL worker denies secret reads, metadata/public/loopback network and privilege escalation',
  { skip: !real && 'Real isolation gate is opt-in' },
  async (t) => {
    const { root, local, product: p, task, binding } = await setup(t);
    const canary = join(root, 'studio-secret.txt');
    await writeFile(canary, 'synthetic-secret-never-mounted');
    const linuxCanary = `/mnt/${canary[0]!.toLowerCase()}/${canary.slice(3).replaceAll('\\', '/')}`;
    const code = `import os, pathlib, socket, subprocess\nassert os.getuid() == 1000\nstatus=pathlib.Path('/proc/self/status').read_text()\nassert 'NoNewPrivs:\\t1' in status\nassert 'CapEff:\\t0000000000000000' in status\nfor p in [${JSON.stringify(linuxCanary)}, '/home', '/mnt/c', '/run/user/1000/bus', '/var/run/docker.sock', '/input/.git', '/sys']:\n assert not pathlib.Path(p).exists(), p\nfor host in ['169.254.169.254','1.1.1.1','127.0.0.1']:\n s=socket.socket(); s.settimeout(0.2)\n try:\n  s.connect((host,80)); raise AssertionError('network escaped')\n except OSError: pass\n finally: s.close()\ntry:\n os.setuid(0); raise AssertionError('root escaped')\nexcept OSError: pass\nassert os.getuid() == 1000\nfor p in ['/input/src/main.py', '/escape', '/dev/escape']:\n try:\n  pathlib.Path(p).write_text('escape'); raise AssertionError('write escaped')\n except OSError: pass\nos.symlink('/mnt/c', '/work/escape')\nassert not pathlib.Path('/work/escape/Users').exists()\nprint('NETNS',os.readlink('/proc/self/ns/net'))\nprint('BOUNDARIES_PASSED')\n`;
    const changed = await local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(TEMPLATE['src/main.py']),
            content: code,
          },
        ],
      },
      binding,
    );
    const result = await new ExecutionSupervisor(local).run(
      p.id,
      task.id,
      changed.commit,
      binding,
    );
    assert.equal(result.state, 'succeeded', JSON.stringify(result));
    assert.match(result.log, /BOUNDARIES_PASSED/);
    assert.ok(
      !result.log.includes(String(result.environment.host_network_namespace)),
      'network namespace differs from management host',
    );
  },
);

test(
  'real cancellation kills a detached child process tree and repeated cancel is idempotent',
  { skip: !real && 'Real isolation gate is opt-in' },
  async (t) => {
    const { local, product: p, task, binding } = await setup(t);
    const code = `import subprocess,time,signal\np=subprocess.Popen(['/usr/bin/python3','-I','-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(120)'], start_new_session=True)\nprint('child',p.pid,flush=True)\ntime.sleep(120)\n`;
    const changed = await local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(TEMPLATE['src/main.py']),
            content: code,
          },
        ],
      },
      binding,
    );
    const worker = new ExecutionSupervisor(local);
    let executionId = '';
    const running = worker.run(p.id, task.id, changed.commit, binding, (id) => {
      executionId = id;
    });
    while (!executionId) await new Promise((r) => setTimeout(r, 30));
    await new Promise((r) => setTimeout(r, 2500));
    await assert.rejects(
      worker.run(p.id, task.id, changed.commit, binding),
      /locked/,
    );
    await assert.rejects(
      worker.cancel(p.id, executionId, randomUUID()),
      /integration owner/,
    );
    await worker.cancel(p.id, executionId, binding.owner_id);
    await worker.cancel(p.id, executionId, binding.owner_id);
    const result = await running;
    assert.equal(result.state, 'cancelled', JSON.stringify(result));
    assert.match(result.log, /child/);
    assert.equal(result.environment.cleanup, 'inactive');
  },
);

test(
  'real worker enforces disk, memory, process and output bounds',
  { skip: !real && 'Real isolation gate is opt-in' },
  async (t) => {
    const { local, product: p, task, binding } = await setup(t);
    const worker = new ExecutionSupervisor(local);
    let commit = p.initial_commit,
      content = TEMPLATE['src/main.py'];
    const runCode = async (code: string) => {
      const changed = await local.apply(
        p.id,
        task.id,
        {
          expected_commit: commit,
          changes: [
            {
              path: 'src/main.py',
              before_hash: digest(content),
              content: code,
            },
          ],
        },
        binding,
      );
      commit = changed.commit;
      content = code;
      return worker.run(p.id, task.id, commit, binding);
    };
    const disk = await runCode(
      `import pathlib,errno\ntry:\n for i in range(30): pathlib.Path('file'+str(i)).write_bytes(b'x'*1000000)\n raise AssertionError('disk unbounded')\nexcept OSError as e:\n assert e.errno == errno.ENOSPC, e\nprint('DISK_BOUNDED')\n`,
    );
    assert.equal(disk.state, 'succeeded', JSON.stringify(disk));
    assert.match(disk.log, /DISK_BOUNDED/);
    const memory = await runCode(
      `a=bytearray(400*1024*1024)\nprint('MEMORY_ESCAPED')\n`,
    );
    assert.equal(memory.state, 'failed', JSON.stringify(memory));
    assert.doesNotMatch(memory.log, /MEMORY_ESCAPED/);
    const tasks = await runCode(
      `import subprocess,errno\nchildren=[]\ntry:\n for i in range(100): children.append(subprocess.Popen(['/usr/bin/sleep','10']))\n raise AssertionError('tasks unbounded')\nexcept OSError as e:\n assert e.errno == errno.EAGAIN,e\n print('TASKS_BOUNDED',flush=True)\nfinally:\n for p in children: p.kill()\n for p in children: p.wait()\n`,
    );
    assert.equal(tasks.state, 'succeeded', JSON.stringify(tasks));
    assert.match(tasks.log, /TASKS_BOUNDED/);
    const output = await runCode(
      `import sys\nwhile True: sys.stdout.write('x'*4096); sys.stdout.flush()\n`,
    );
    assert.equal(output.state, 'failed', JSON.stringify(output));
    assert.equal(output.reason, 'log_limit');
    assert.ok(Buffer.byteLength(output.log) <= 65536);
    const start = Date.now();
    const deadline = await runCode('import time\ntime.sleep(120)\n');
    assert.equal(deadline.state, 'failed', JSON.stringify(deadline));
    assert.ok(
      Date.now() - start < 30000,
      'systemd hard deadline bounds an uncooperative job',
    );
    assert.equal(deadline.environment.cleanup, 'inactive');
  },
);

test(
  'real killed supervisor loses its lease; explicit reconciliation stops the unit without redispatch',
  { skip: !real && 'Real isolation gate is opt-in' },
  async (t) => {
    const { root, local, product: p, task, binding } = await setup(t);
    const code = 'import time\nprint("started",flush=True)\ntime.sleep(120)\n';
    const changed = await local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(TEMPLATE['src/main.py']),
            content: code,
          },
        ],
      },
      binding,
    );
    const config = join(root, 'crash.json');
    await writeFile(
      config,
      JSON.stringify({
        root: local.root,
        product_id: p.id,
        task_id: task.id,
        commit: changed.commit,
        binding,
      }),
    );
    const child = spawn(
      process.execPath,
      [resolve('scripts/executor-crash-worker.mjs'), config],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let text = '',
      executionId = '';
    child.stdout.on('data', (b: Buffer) => {
      text += b.toString();
      const line = text.split('\n')[0];
      if (line) {
        try {
          executionId = (JSON.parse(line) as { execution_id: string })
            .execution_id;
        } catch {
          /* incomplete line */
        }
      }
    });
    let errors = '';
    child.stderr.on('data', (b: Buffer) => {
      errors += b.toString();
    });
    const until = Date.now() + 10000;
    while (!executionId && Date.now() < until && child.exitCode === null)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(executionId, errors);
    const worker = new ExecutionSupervisor(local);
    await assert.rejects(
      worker.reconcile(p.id, executionId, binding.owner_id),
      /Supervisor still exists/,
    );
    await new Promise((r) => setTimeout(r, 1800));
    const closed = new Promise<void>((r) => child.once('close', () => r()));
    child.kill('SIGKILL');
    await closed;
    await new Promise((r) => setTimeout(r, 6500));
    const recovered = await worker.reconcile(
      p.id,
      executionId,
      binding.owner_id,
    );
    assert.equal(recovered.state, 'lost');
    assert.equal(recovered.environment.cleanup, 'inactive');
    assert.equal((await worker.executions(p.id)).length, 1);
    await assert.rejects(
      readFile(join(local.root, 'supervisor.lock')),
      /ENOENT/,
    );
  },
);

test(
  'a missing real isolation backend blocks execution without a host fallback',
  { skip: !real && 'Real isolation gate is opt-in' },
  async (t) => {
    const { local, product: p, task, binding } = await setup(t);
    const result = await new ExecutionSupervisor(
      local,
      'Creator-Missing-T11-Distribution',
    ).run(p.id, task.id, p.initial_commit, binding);
    assert.equal(result.state, 'blocked');
    assert.ok(result.reason);
  },
);

test(
  'real QA worker cannot copy expected answers from its runtime input mount',
  { skip: !real && 'Real isolation gate is opt-in' },
  async (t) => {
    const { local, product: p, task, binding } = await setup(t);
    const code =
      "import json,pathlib,sys\ncase=json.loads(pathlib.Path('/acceptance.json').read_text())\nassert set(case)=={'args','stdin'}, list(case)\nassert not pathlib.Path('/input/acceptance.json').exists()\nprint('NO_EXPECTED_ANSWERS')\n";
    const changed = await local.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(TEMPLATE['src/main.py']),
            content: code,
          },
        ],
      },
      binding,
    );
    const result = await new ExecutionSupervisor(local).run(
      p.id,
      task.id,
      changed.commit,
      binding,
      () => {},
      {
        check_key: 'A1',
        args: [],
        stdin: 'input',
        stdout: 'NO_EXPECTED_ANSWERS\n',
        exit_code: 0,
      },
    );
    assert.equal(result.state, 'succeeded', JSON.stringify(result));
    assert.equal(result.log, 'NO_EXPECTED_ANSWERS\n');
  },
);
