// Monitor › Storage (F10, ADR-0121), checked in the real studio. Throwaway database, review
// ports, fixture provider only, $0, no model call. Start the studio first, with a throwaway
// product store:
//   CREATOR_DATABASE_URL=<walk db> CREATOR_PRODUCTS_ROOT=<dir> node tracking/evidence/owner-actions/stack.mjs
// then (from the repo root):
//   node tracking/evidence/storage-page/walk.mjs <database-url> <products-root> <out-dir>
// Seeds a fixture project through the CLI, makes a product in it with one task build and a
// finished merge (aged 30 days), then in the browser: the per-project table, the cleanup list
// and its kept reasons, Cancel, the confirmation, the result and the audit history.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdtemp, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ProductSupervisor,
  TEMPLATE,
  digest,
} from '../../../packages/executor/dist/index.js';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const OWNER = '00000000-0000-4000-8000-000000000001';
const [dbUrl, root, out = '.'] = process.argv.slice(2);
if (!dbUrl || !/walk|throwaway/.test(dbUrl) || !root)
  throw new Error('Use a throwaway database whose name contains "walk".');
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
async function age(path, ms) {
  const t = new Date(Date.now() - ms);
  const st = await lstat(path);
  if (st.isDirectory())
    for (const n of await readdir(path)) await age(join(path, n), ms);
  await utimes(path, t, t);
}

const dir = await mkdtemp(join(tmpdir(), 'storage-page-'));
const cenv = {
  ...process.env,
  CREATOR_API_URL: 'http://127.0.0.1:4330',
  CREATOR_SESSION_FILE: join(dir, 'session.json'),
};
const cli = async (...args) =>
  JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        ['apps/cli/dist/main.js', ...args],
        { env: cenv },
      )
    ).stdout,
  );
await cli('login', CODE);
const seed = await cli('seed-discovery');
const ws = seed.workspace?.id ?? seed.workspace;

// A synthetic product in that project: one task build and its finished merge.
const products = new ProductSupervisor(root);
const binding = {
  workspace_id: ws,
  owner_id: OWNER,
  spec_id: crypto.randomUUID(),
  spec_version: 1,
  spec_hash: digest('walk spec'),
  freeze_id: crypto.randomUUID(),
  tasks: [{ key: 'T1', hash: digest('walk task'), file_scope: ['src'] }],
};
const p = await products.create(binding);
const task = await products.createTask(p.id, 'T1', p.initial_commit, binding);
const built = await products.apply(
  p.id,
  task.id,
  {
    expected_commit: p.initial_commit,
    changes: [
      {
        path: 'src/main.py',
        before_hash: digest(TEMPLATE['src/main.py']),
        content: 'print("walk")\n',
      },
    ],
  },
  binding,
);
const merged = await products.integrate(
  p.id,
  task.id,
  p.initial_commit,
  built.commit,
  binding,
);
await age(join(products.dir(p.id), 'worktrees'), 30 * 86_400_000);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
await page.goto(WEB);
await page.getByLabel(/login code|code/i).first().fill(CODE);
await page.keyboard.press('Enter');
await page.waitForTimeout(1500);
await page.goto(`${WEB}/#/monitor/storage?ws=${ws}`);
await page.getByRole('heading', { name: 'Storage', level: 2 }).waitFor();
await page.getByText('can go, freeing').waitFor();
check(
  await page.getByRole('link', { name: 'Storage' }).first().isVisible(),
  'Monitor lists the Storage tab',
);
const row = page.locator('.storage-table tbody tr').first();
check((await row.textContent()).includes('1 product'), 'the project row counts its product');
check(
  (await row.textContent()).includes('2 workspaces'),
  'the project row counts both build workspaces',
);
check(
  (await page.locator('.storage-list li').count()) === 1,
  'one workspace can go (the finished merge)',
);
await page.locator('.storage-kept summary').click();
check(
  (await page.locator('.storage-kept').textContent()).includes(
    'No verified package of its latest commit yet.',
  ),
  'the task workspace is kept: it has no verified package',
);
await page.screenshot({ path: join(out, 'storage-before.png'), fullPage: true });
await page.getByRole('button', { name: 'Remove old build workspaces…' }).click();
check(
  await page.getByRole('button', { name: /^Remove 1 build workspace \(/ }).isVisible(),
  'the confirming button names the count and size',
);
await page.getByRole('button', { name: 'Cancel' }).click();
check(
  await page.getByRole('button', { name: 'Remove old build workspaces…' }).isVisible(),
  'Cancel removes nothing and goes back',
);
await page.getByRole('button', { name: 'Remove old build workspaces…' }).click();
await page.screenshot({ path: join(out, 'storage-confirm.png'), fullPage: true });
await page.getByRole('button', { name: /^Remove 1 build workspace \(/ }).click();
await page.getByText('Every verified package still matches').waitFor();
check(
  !(await lstat(merged.merge_workspace).then(
    () => true,
    () => false,
  )),
  'the merge workspace is gone from disk',
);
check(
  await lstat(products.worktree(p.id, task.id)).then(
    () => true,
    () => false,
  ),
  'the task workspace is still there',
);
await page.getByText('Recent cleanups').waitFor();
check(
  (await page.locator('.storage').textContent()).includes('asked to remove 1'),
  'the audit history lists the intent and outcome',
);
await page.screenshot({ path: join(out, 'storage-after.png'), fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: join(out, 'storage-phone.png'), fullPage: true });
const wide = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check(!wide, 'no sideways page scroll at phone width');
await browser.close();
