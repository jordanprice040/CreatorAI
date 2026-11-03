// Owner actions that were CLI-only (2026-11-03), walked on a throwaway database and the review
// ports, fixture provider only, $0, no model call. Start stack.mjs first, then:
//   node tracking/evidence/owner-actions/walk.mjs <database-url> <out-dir>
// Seeds `seed-discovery` through the real CLI and API, adds one ChatGPT plan connection whose
// quota is marked exhausted with SQL (test seam: the fixture cannot reach a plan), then uses the
// app: Models "Usage has reset", Budgets "Close this budget…", Library "Archive…", Evidence
// "Retract…", Runs "Show the evidence packet", and one form at phone width.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
// pg is a dependency of packages/db, so it resolves from there.
const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const [dbUrl, out = '.'] = process.argv.slice(2);
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};

const dir = await mkdtemp(join(tmpdir(), 'owner-actions-'));
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
console.log('workspace', ws);

const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const headers = { Cookie: cookie };
const write = {
  ...headers,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrf_token,
};
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers })).json();
const post = async (path, body) =>
  (
    await fetch(`${WEB}/api/${path}`, {
      method: 'POST',
      headers: write,
      body: JSON.stringify(body),
    })
  ).json();
const base = `workspaces/${ws}`;

// Wait for the fixture discoveries to finish so the budget holds nothing in flight.
for (let i = 0; i < 60; i++) {
  const wfs = await get(`${base}/workflows`);
  if (wfs.every((w) => w.finished_at)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const workflows = await get(`${base}/workflows`);
const discovery = workflows.find((w) => w.role === 'r02_discovery');

const settings = JSON.parse(
  await readFile('config/connections/chatgpt-plan.json', 'utf8'),
);
const conn = await post(`${base}/plan-connections`, {
  label: 'Walk ChatGPT plan',
  settings,
});
check(Boolean(conn.id), `plan connection created (${conn.error?.code ?? 'ok'})`);
const pool = new pg.Pool({ connectionString: dbUrl });
await pool.query(
  `update plan_connections set quota = jsonb_build_object('state', 'exhausted', 'reason_code', 'usage_limit_reached', 'observed_at', $2::text) where id = $1`,
  [conn.id, new Date().toISOString()],
);
const walkBudget = await post(`${base}/budgets`, {
  parent_id: null,
  kind: 'global',
  run_id: null,
  name: 'Walk budget to close',
  cap_nano_usd: '5000000000',
  starts_at: null,
  ends_at: null,
  max_in_flight: 1,
});
const problems = await get(`${base}/entities?kind=problem&status=active`);
const problem = problems[0];
const claims = await get(`${base}/entities?kind=claim`);
let claim = null;
let supportRow = null;
for (const c of claims) {
  const ev = await get(`${base}/claims/${c.id}/evidence`);
  const row = ev.rows?.find((r) => !r.support.retracted_at && r.counted);
  if (row) {
    claim = c;
    supportRow = row;
    break;
  }
}
check(Boolean(problem && claim && discovery), 'seeded problem, supported claim, discovery');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (file) => page.screenshot({ path: join(out, file), fullPage: false });

// 1. Models: usage limit reached, owner allows requests again.
await page.goto(`${WEB}/#/models?ws=${ws}`);
const reset = page.getByRole('button', { name: 'Usage has reset: allow requests again' });
await reset.waitFor({ timeout: 10000 });
await reset.scrollIntoViewIfNeeded();
await shot('01-models-limit-reached.png');
await reset.click();
await page.waitForTimeout(1500);
check((await reset.count()) === 0, 'Models: reset box gone after the click');
const after = await get(`${base}/plan-connections/${conn.id}`);
const quota = (after.connection ?? after).quota.state;
check(quota === 'unknown', `Models: quota state is now ${quota}`);

// 2. Budgets: an empty reason is refused in the form, then the budget closes.
await page.goto(`${WEB}/#/budgets?ws=${ws}`);
const card = page.locator('article.decision', { hasText: 'Walk budget to close' });
await card.getByRole('button', { name: 'Close this budget…' }).click();
await card.getByRole('button', { name: 'Close this budget', exact: true }).click();
check(
  (await card.getByRole('alert').innerText()).includes('Say why'),
  'Budgets: blank reason refused before sending',
);
await card.getByLabel('Why close this budget').fill('The walk is finished.');
await shot('02-budget-close-form.png');
await card.getByRole('button', { name: 'Close this budget', exact: true }).click();
await page.waitForTimeout(1500);
check((await card.locator('.badge').innerText()) === 'closed', 'Budgets: badge reads closed');
const env = await get(`${base}/budgets/${walkBudget.id}`);
check(env.status === 'closed', `Budgets: server says ${env.status}`);
await shot('03-budget-closed.png');

// 3. Library: archive a problem.
await page.goto(`${WEB}/#/catalog?ws=${ws}&id=${problem.id}`);
await page.getByRole('button', { name: 'Archive…' }).click();
await page.getByLabel('Why archive this problem').fill('Duplicate of a newer problem (walk).');
await shot('04-library-archive-form.png');
// Review L-3: the record changes elsewhere while the form is open. The first confirm is refused
// and the record is read again, so the second confirm (same typed reason) goes through.
await post(`${base}/entities/${problem.id}/revisions`, {
  expected_version: problem.version,
  title: `${problem.title} (revised elsewhere)`,
  body: problem.body,
  reason: 'Walk: changed while the archive form was open.',
  corrects_version: null,
});
await page.getByRole('button', { name: 'Archive it' }).click();
const stale = page.locator('.reason-form [role=alert]');
await stale.waitFor({ timeout: 5000 });
check(
  (await stale.innerText()).includes('It has been read again'),
  'Library: a stale version is refused and the record read again',
);
check(
  (await page.getByLabel('Why archive this problem').inputValue()).includes('Duplicate'),
  'Library: the typed reason is kept',
);
check(
  (await page.locator('.reason-form .small').innerText()).includes('Decide stops'),
  'Library: archiving a problem warns that Decide stops',
);
await page.getByRole('button', { name: 'Archive it' }).click();
await page.getByText('Archived. Set Status').waitFor({ timeout: 5000 });
const archived = await get(`${base}/entities/${problem.id}`);
check(archived.entity.status === 'archived', `Library: server says ${archived.entity.status}`);
check((await page.getByRole('button', { name: 'Archive…' }).count()) === 0, 'Library: no Archive button on an archived record');
await shot('05-library-archived.png');

// 4. Evidence: retract one support row.
await page.goto(`${WEB}/#/evidence?ws=${ws}&id=claim:${claim.id}`);
await page.getByRole('button', { name: 'Retract…' }).first().waitFor({ timeout: 10000 });
const retractCount = await page.getByRole('button', { name: 'Retract…' }).count();
await page.getByRole('button', { name: 'Retract…' }).first().click();
await page.getByLabel('Why this evidence is wrong').fill('Quote is about another clinic (walk).');
await shot('06-evidence-retract-form.png');
await page.getByRole('button', { name: 'Retract it' }).click();
await page.getByText(/Retracted .*Quote is about another clinic/).waitFor({ timeout: 5000 });
check(
  (await page.getByRole('button', { name: 'Retract…' }).count()) === retractCount - 1,
  'Evidence: one fewer Retract button',
);
const ev = await get(`${base}/claims/${claim.id}/evidence`);
check(
  ev.rows.some((r) => r.support.id === supportRow.support.id && r.support.retracted_at && !r.counted),
  'Evidence: server marks the row retracted and not counted',
);
await shot('07-evidence-retracted.png');

// 5. Runs: the discovery's evidence packet.
await page.goto(`${WEB}/#/runs?ws=${ws}&id=${discovery.id}`);
await page.getByRole('button', { name: 'Show the evidence packet' }).click();
await page.locator('.packet').waitFor({ timeout: 5000 });
const packetText = await page.locator('.packet').innerText();
check(/evidence judged (sufficient|insufficient)/.test(packetText), 'Runs: packet summary shown');
await page.locator('.packet').scrollIntoViewIfNeeded();
await shot('08-runs-packet.png');

// 6. Phone width: the budget close form fits without horizontal scroll.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${WEB}/#/budgets?ws=${ws}`);
await page.locator('article.decision', { hasText: 'Fixture discovery budget' }).waitFor();
const fixtureCard = page.locator('article.decision', { hasText: 'Fixture discovery budget' });
const fixtureClose = fixtureCard.getByRole('button', { name: 'Close this budget…' });
if (await fixtureClose.count()) await fixtureClose.click();
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
check(!overflow, 'Phone width: no horizontal overflow on Budgets');
await fixtureCard.scrollIntoViewIfNeeded();
await shot('09-phone-budget.png');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
await pool.end();
