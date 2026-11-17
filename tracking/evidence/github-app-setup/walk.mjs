// P32 GitHub App setup (ADR-0132), looked at in the real studio. Throwaway database, review
// ports, CREATOR_GITHUB=live with the development file vault, and no call to github.com: the
// browser that "Create the GitHub App" opens has nowhere to go here, and the later steps are
// shown by writing setup rows straight into the throwaway database. Start
// ../owner-actions/stack.mjs with those settings first, then (from the repo root):
//   node tracking/evidence/github-app-setup/walk.mjs <database-url> <out-dir>
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pg = createRequire(
  new URL('../../../packages/db/package.json', import.meta.url),
)('pg');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const [dbUrl, out = '.'] = process.argv.slice(2);
if (!dbUrl || !/walk|throwaway/.test(dbUrl))
  throw new Error('Use a throwaway database whose name contains "walk".');
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = {
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrf_token,
};
const post = async (path, body) => {
  const r = await fetch(`${WEB}/api/${path}`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const ws = (
  await post('workspaces', { name: 'GitHub walk', record_mode: 'real' })
).body.id;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${WEB}/#/connections/github?ws=${ws}`);
await page.waitForTimeout(1500);
const panel = page.locator('.gh-app-setup');
check(
  (await panel
    .getByRole('button', { name: 'Create the GitHub App' })
    .count()) === 1,
  'a real workspace offers Create the GitHub App',
);
await panel.screenshot({ path: `${out}/01-start.png` });

// The later steps, as GitHub would leave them (rows written directly; no GitHub call).
const db = new pg.Client({ connectionString: dbUrl });
await db.connect();
const actor = (
  await db.query('select created_by from workspaces where id = $1', [ws])
).rows[0].created_by;
const account = { login: 'jordan-example', id: 4100001, type: 'User' };
const app = {
  id: 777001,
  slug: 'creator-agent-abc123',
  client_id: 'Iv23example',
  name: 'Creator Agent abc123',
  owner: account,
  html_url: 'https://github.com/apps/creator-agent-abc123',
};
const id = randomUUID();
await db.query(
  `insert into github_app_setups (id, workspace_id, status, app, key_ref, created_by)
   values ($1,$2,'app_created',$3,$4,$5)`,
  [id, ws, JSON.stringify(app), `github-app-key/${randomUUID()}`, actor],
);
await page.reload();
await page.waitForTimeout(1500);
check(
  (await panel
    .getByRole('link', { name: 'Install on GitHub' })
    .getAttribute('href')) ===
    'https://github.com/apps/creator-agent-abc123/installations/new',
  'after creation the page links to the installation page',
);
await panel.screenshot({ path: `${out}/02-install.png` });
await db.query(
  `update github_app_setups set status = 'installed', installation = $2 where id = $1`,
  [id, JSON.stringify({ id: 4242, account, repository_selection: 'selected' })],
);
await page.reload();
await page.waitForTimeout(1500);
check(
  (await panel.getByLabel('GitHub login').count()) === 0 &&
    (await panel.locator('#gha-label').inputValue()) ===
      'GitHub (jordan-example)',
  'the connect form asks no owner or credential',
);
await panel.screenshot({ path: `${out}/03-connect.png` });
await panel.getByRole('button', { name: 'Add connection' }).click();
await page.waitForTimeout(1500);
const rows = page.locator('.gh-connections li');
check(
  /key kept protected on this computer/.test(await rows.first().innerText()),
  'the new connection names the protected app key, not an environment variable',
);
await db.query(
  `update github_app_setups set status = 'connected',
     connection_id = (select id from github_connections where workspace_id = $2
       order by created_at desc limit 1) where id = $1 and status = 'installed'`,
  [id, ws],
);
await page.reload();
await page.waitForTimeout(1500);
check(
  /Connected through Creator Agent abc123/.test(await panel.innerText()) &&
    (await panel
      .getByRole('button', { name: 'Create the GitHub App' })
      .count()) === 0,
  'a connected setup says which app, with another app behind its own button',
);
await page
  .locator('.gh-connections')
  .screenshot({ path: `${out}/04-connected.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.reload();
await page.waitForTimeout(1500);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check(!overflow, 'no sideways scroll at phone width');
await panel.screenshot({ path: `${out}/05-phone.png` });
check(errors.length === 0, `no page errors (${errors.join('; ')})`);
await db.end();
await browser.close();
