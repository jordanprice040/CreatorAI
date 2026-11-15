// Throwaway studio for the B3 Build page walk in the cloud container (no WSL2 worker here).
// TEST DOUBLE: QA cases run with the host's python3 directly on the committed files in a
// temporary folder (no isolation; records name the backend "test-double"). Fixture roles are
// scripted through the API's buildPorts test seam for the frozen repair benchmark's spec only:
// the builder's first answer in a build is a first draft with two easy-to-miss mistakes
// (floating point averages, +5 accepted); later answers are the reference. B3_CASE_DELAY_MS
// slows each case so the running state can be seen.
// Run from the repo root after `pnpm build:code`, on a throwaway database migrated first
// (`pnpm db:migrate`). Environment as tracking/evidence/p1-build-retry/dev-double.mjs:
// CREATOR_DATABASE_URL (throwaway), CREATOR_PRODUCTS_ROOT, CREATOR_API_PORT=4330,
// CREATOR_WEB_PORT=5183, CREATOR_PREVIEW_PORT=4340, CREATOR_DEV_LOGIN_CODE.
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const from = (p) => pathToFileURL(resolve(p)).href;
const { createServer } = await import(
  pathToFileURL(createRequire(resolve('apps/web/package.json')).resolve('vite'))
    .href
);
const { createApi } = await import(from('apps/api/dist/index.js'));
const { ArtifactSupervisor, ProductSupervisor } = await import(
  from('packages/executor/dist/index.js')
);
const { TestDoubleExecutor } = await import(
  from('tests/dist/artifact-double.js')
);
const REPAIR = 'config/repo-benchmarks/repair-v1/p14-repair-v1';
const reference = await readFile(join(REPAIR, 'reference/src/main.py'), 'utf8');
const firstDraft = reference
  .replace(
    /    # Tenths, rounded half up[\s\S]*?return '%d\.%d' % \(tenths \/\/ 10, tenths % 10\)/,
    "    return '%.1f' % (total / count)",
  )
  .replace(
    "    if not (1 <= len(text) <= 3 and all('0' <= ch <= '9' for ch in text)):\n        return None\n    value = int(text)",
    '    try:\n        value = int(text)\n    except ValueError:\n        return None\n    if value < 0:\n        return None',
  );
const delay = Number(process.env.B3_CASE_DELAY_MS ?? 0);
const products = new ProductSupervisor(
  resolve(process.env.CREATOR_PRODUCTS_ROOT),
);
class LocalPython extends TestDoubleExecutor {
  async run(...a) {
    const e = await super.run(...a);
    const c = a[5];
    if (!c || !('args' in c)) return e;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const dir = await mkdtemp(join(tmpdir(), 'b3-walk-qa-'));
    try {
      for (const f of await this.products.committedFiles(a[0], a[1], a[2])) {
        await mkdir(dirname(join(dir, f.path)), { recursive: true });
        await writeFile(join(dir, f.path), f.content);
      }
      const r = spawnSync(
        'sh',
        ['-c', 'exec python3 -I src/main.py "$@" 2>&1', 'qa', ...c.args],
        { cwd: dir, input: c.stdin, timeout: 20000 },
      );
      return {
        ...e,
        state: r.status === 0 ? 'succeeded' : 'failed',
        log: r.stdout.toString(),
        exit_code: r.status,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
const firstAnswer = new Set();
const buildPorts = (ports) => ({
  ...ports,
  call: async (runId, request) => {
    const result = await ports.call(runId, request);
    if (result.status !== 'succeeded' || !result.output) return result;
    const packet = JSON.parse(request.input[1].text);
    const web = (packet.task?.file_scope ?? []).includes('site');
    if (web) {
      // The frozen P15 sign-up benchmark's reference site, so a web package can be exported.
      const site = 'config/web-benchmarks/p15-small-signup-v4/reference/site';
      const answer = request.input[0].text.startsWith('builder/')
        ? {
            summary: 'Scripted fixture web builder (walk)',
            submission: {
              expected_commit: packet.candidate,
              changes: await Promise.all(
                ['index.html', 'style.css', 'app.js'].map(async (n) => ({
                  path: `site/${n}`,
                  before_hash:
                    packet.files.find((f) => f.path === `site/${n}`)?.hash ??
                    null,
                  content: await readFile(join(site, n), 'utf8'),
                })),
              ),
            },
            blocker: null,
          }
        : {
            candidate: packet.candidate,
            spec_hash: packet.spec_hash,
            task_hash: packet.task_hash,
            verdict: 'approve',
            findings: [],
          };
      return {
        ...result,
        output: { text: JSON.stringify(answer), json: answer, vector: null },
      };
    }
    if (!String(packet.problem ?? '').includes('averages scores'))
      return result;
    if (delay) await new Promise((r) => setTimeout(r, delay * 2));
    const builder = request.input[0].text.startsWith('builder/');
    const main = packet.files.find((f) => f.path === 'src/main.py');
    const draft =
      builder && !firstAnswer.has(request.justification.split(' ')[2]);
    if (builder) firstAnswer.add(request.justification.split(' ')[2]);
    const answer = builder
      ? {
          summary: 'Scripted fixture builder (walk)',
          submission: {
            expected_commit: packet.candidate,
            changes: [
              {
                path: 'src/main.py',
                before_hash: main?.hash ?? null,
                content: draft ? firstDraft : reference,
              },
            ],
          },
          blocker: null,
        }
      : {
          candidate: packet.candidate,
          spec_hash: packet.spec_hash,
          task_hash: packet.task_hash,
          verdict: 'approve',
          findings: [],
        };
    return {
      ...result,
      output: { text: JSON.stringify(answer), json: answer, vector: null },
    };
  },
});
const api = createApi(process.env, {
  artifacts: new ArtifactSupervisor(products, new LocalPython(products)),
  buildPorts,
});
await new Promise((r) =>
  api.server.listen(Number(process.env.CREATOR_API_PORT), '127.0.0.1', r),
);
await new Promise((r) =>
  api.preview.listen(Number(process.env.CREATOR_PREVIEW_PORT), '127.0.0.1', r),
);
await api.ready();
const web = await createServer({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
});
await web.listen();
console.log('ready (test-double executor, scripted fixture roles)');
