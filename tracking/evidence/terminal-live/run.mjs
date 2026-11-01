// ADR-0058 live check: the real console window + WSL + systemd-run --pty path, with a
// throwaway product store under .verification/ (no database, no studio data, no model).
// Usage (Windows, repo root, after `pnpm build:code`):
//   node tracking/evidence/terminal-live/run.mjs <source-dir-with-src/main.py> [--stop-after <s>] -- <program args...>
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ProductSupervisor,
  TerminalSupervisor,
} from '../../../packages/executor/dist/index.js';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const programArgs = dash >= 0 ? argv.slice(dash + 1) : [];
const own = dash >= 0 ? argv.slice(0, dash) : argv;
const source = resolve(own[0] ?? '');
const stopAt = own.indexOf('--stop-after');
const stopAfter = stopAt >= 0 ? Number(own[stopAt + 1]) : null;

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__pycache__') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/\.(py|md|txt|json)$/.test(e.name)) out.push(p);
  }
  return out;
}
const files = [];
for (const p of await walk(source)) {
  const rel = relative(source, p).replaceAll('\\', '/');
  if (!/^[a-z0-9/_.-]+$/.test(rel)) continue;
  files.push({ path: rel, content: await readFile(p) });
}
if (!files.some((f) => f.path === 'src/main.py'))
  throw new Error(`No src/main.py under ${source}`);

const root = resolve(
  '.verification/terminal-live',
  new Date().toISOString().replace(/[:.]/g, '-'),
);
const products = new ProductSupervisor(join(root, 'products'));
await products.initialize();
const owner = randomUUID();
const product = await products.create({
  workspace_id: randomUUID(),
  owner_id: owner,
  spec_id: randomUUID(),
  spec_version: 1,
  spec_hash: 'a'.repeat(64),
  freeze_id: randomUUID(),
  tasks: [{ key: 'T1', hash: 'b'.repeat(64), file_scope: ['src'] }],
});
const terminals = new TerminalSupervisor(
  products,
  process.env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
);
const session = await terminals.open({
  productId: product.id,
  artifactId: randomUUID(),
  manifestSha256: 'c'.repeat(64),
  packageSha256: 'd'.repeat(64),
  taskId: randomUUID(),
  commit: product.initial_commit,
  files,
  owner,
  args: programArgs,
});
console.log(
  'started',
  JSON.stringify({
    id: session.id,
    state: session.state,
    command: session.command,
  }),
);
const started = Date.now();
let stopped = false;
for (;;) {
  await new Promise((r) => setTimeout(r, 1000));
  if (
    stopAfter !== null &&
    !stopped &&
    Date.now() - started > stopAfter * 1000
  ) {
    stopped = true;
    console.log('requesting Stop');
    const s = await terminals.stop(product.id, session.id, owner);
    console.log('stop returned', s.state);
  }
  const s = await terminals.status(product.id, session.id);
  if (s.state !== 'running') {
    const out = {
      at: new Date().toISOString(),
      files: files.map((f) => f.path),
      session: s,
    };
    await mkdir('tracking/evidence/terminal-live', { recursive: true });
    const name = `result-${stopAfter !== null ? 'stop' : 'run'}-${Date.now()}.json`;
    await writeFile(
      join('tracking/evidence/terminal-live', name),
      JSON.stringify(out, null, 2),
    );
    console.log(
      'outcome',
      JSON.stringify({
        state: s.state,
        exit_code: s.exit_code,
        reason: s.reason,
        limits: s.environment.worker?.effective_limits ?? null,
      }),
    );
    console.log('saved', name);
    break;
  }
}
