// Audit L-9 and L-10 walk (2026-11-03), on a throwaway database and the review ports, $0, no
// model call. Usage: node walk.mjs <login-code> <database-url> <out-dir>
// L-9: a fixture workspace gets 201 budgets (inserted with SQL, test seam) and Budgets shows the
// newest 200, then "Show older budgets" adds the oldest one.
// L-10: a record open in Sources › Library is revised through the API while another tab is
// shown; going back shows the new title without a manual refresh, and the record stays open.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pg = require('pg');
const WEB = 'http://127.0.0.1:5183';
const [code, dbUrl, out = '.'] = process.argv.slice(2);
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = {
  'Content-Type': 'application/json',
  Cookie: cookie,
  'X-CSRF-Token': session.csrf_token,
};
const post = async (path, body) =>
  (
    await fetch(`${WEB}/api/${path}`, {
      method: 'POST',
      headers: write,
      body: JSON.stringify(body),
    })
  ).json();
const ws = await post('workspaces', {
  name: 'Refresh and paging walk',
  record_mode: 'fixture',
});
const pool = new pg.Pool({ connectionString: dbUrl });
await pool.query(
  `insert into budget_envelopes (id, workspace_id, fixture, kind, name, status, cap_nano, max_in_flight, created_by, created_at)
   select gen_random_uuid(), $1, true, 'global', 'Budget ' || g, 'active', 0, 1, $2, now() - interval '1 day' + g * interval '1 second'
   from generate_series(1, 201) g`,
  [ws.id, session.actor_id],
);
await pool.end();
const problem = await post(`workspaces/${ws.id}/entities`, {
  kind: 'problem',
  title: 'Walk problem, first title',
  body: {
    statement: 'A walk problem.',
    affected_group: 'Walkers',
    uncertainty: 'Synthetic.',
  },
});

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

// L-9
await page.goto(`${WEB}/#/monitor/budgets?ws=${ws.id}`);
await page.waitForTimeout(2500);
const names = () =>
  page
    .locator('.records-grid article.decision .decision-head strong')
    .allInnerTexts();
let shown = await names();
console.log(
  'budgets shown:',
  shown.length,
  '| first:',
  shown[0],
  '| last:',
  shown.at(-1),
);
const older = page.getByRole('button', { name: 'Show older budgets' });
console.log('show older button:', await older.count());
await older.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/01-budgets-show-older.png` });
await older.click();
await page.waitForTimeout(1500);
shown = await names();
console.log(
  'after show older:',
  shown.length,
  '| last:',
  shown.at(-1),
  '| button left:',
  await older.count(),
);

// PR #125 review L-1: an older budget closed elsewhere reads "closed" on return.
const oldest = (await (await fetch(`${WEB}/api/workspaces/${ws.id}/budgets?limit=1&before=${(await (await fetch(`${WEB}/api/workspaces/${ws.id}/budgets?limit=200`, { headers: write })).json()).at(-1).id}`, { headers: write })).json())[0];
await page.goto(`${WEB}/#/sources/library?ws=${ws.id}`);
await page.waitForTimeout(1000);
console.log('close oldest:', (await post(`workspaces/${ws.id}/budgets/${oldest.id}/close`, { expected_version: oldest.version, reason: 'Walk: closed elsewhere.' })).status);
await page.goBack();
await page.waitForTimeout(3000);
const last = page.locator('.records-grid article.decision').last();
console.log('after return:', (await names()).length, '| oldest row:', (await last.locator('.decision-head').innerText()).replace(/\s+/g, ' '), '| show older left:', await older.count());
await last.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/03-older-budget-refreshed.png` });

// L-10
await page.goto(`${WEB}/#/sources/library?ws=${ws.id}&id=${problem.id}`);
await page.waitForTimeout(2500);
const title = async () =>
  (
    await page
      .locator('main')
      .getByText(/Walk problem,/)
      .first()
      .innerText()
  ).replace(/\s+/g, ' ');
console.log('library before:', await title());
await page.goto(`${WEB}/#/monitor/budgets?ws=${ws.id}`);
await page.waitForTimeout(1000);
await post(`workspaces/${ws.id}/entities/${problem.id}/revisions`, {
  expected_version: 1,
  title: 'Walk problem, revised elsewhere',
  body: {
    statement: 'A walk problem.',
    affected_group: 'Walkers',
    uncertainty: 'Synthetic.',
  },
  reason: 'Walk: revised while another tab was shown.',
  corrects_version: null,
});
await page.goBack();
await page.waitForTimeout(2500);
console.log(
  'library after return:',
  await title(),
  '| address id kept:',
  page.url().includes(problem.id),
);
await page.screenshot({ path: `${out}/02-library-after-return.png` });
await browser.close();
