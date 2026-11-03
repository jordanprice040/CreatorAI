// "Explore for me" (ADR-0065), walked on a throwaway database and the review ports, fixture
// provider only, $0, no plan or paid call. Start ../owner-actions/stack.mjs first, then:
//   node tracking/evidence/explore-for-me/walk.mjs <out-dir>
// Seeds `seed-discovery` through the real CLI (claims, sources, budget, pricing), then uses the
// app: Discover › Explore for me with no theme, the shortlist, "Use as a brief", the filled brief
// form with the cited claims attached, starting discovery from that brief, Chat's "explore for
// me" reply, and the page at phone width.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const [out = '.'] = process.argv.slice(2);
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};

const dir = await mkdtemp(join(tmpdir(), 'explore-walk-'));
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
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const session = await login.json();
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers: { Cookie: cookie } })).json();
const post = async (path, body) =>
  (
    await fetch(`${WEB}/api/${path}`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf_token,
      },
      body: JSON.stringify(body),
    })
  ).json();
const base = `workspaces/${ws}`;
for (let i = 0; i < 60; i++) {
  const wfs = await get(`${base}/workflows`);
  if (wfs.every((w) => w.finished_at)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const before = (await get(`${base}/workflows`)).length;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (file) => page.screenshot({ path: join(out, file), fullPage: false });

// 1. Discover: Explore for me, with nothing typed.
await page.goto(`${WEB}/#/projects/discover?ws=${ws}`);
const go = page.getByRole('button', { name: 'Explore for me', exact: true });
await go.waitFor({ timeout: 15000 });
await page.locator('.explore').scrollIntoViewIfNeeded();
await page.getByText('Narrow it (optional)').click();
await page.getByLabel('Topics to leave out').fill('weather');
await shot('01-explore-form.png');
check(await go.isEnabled(), 'Explore: the button is enabled with no theme');
await go.click();
const list = page.locator('.shortlist');
await list.waitFor({ timeout: 30000 });
await list.scrollIntoViewIfNeeded();
await shot('02-all-duplicates.png');
// The seeded discoveries already wrote these problems into the catalog, so every pick is a
// duplicate and the honest answer is "no candidate".
let wfs = await get(`${base}/workflows`);
let ex = wfs.find((w) => w.role === 'r01_exploration');
check(wfs.length === before + 1 && ex?.state === 'succeeded', `Explore: one exploration workflow, ${ex?.state}`);
check(
  ex?.result?.exploration?.outcome === 'no_candidates' &&
    ex.result.exploration.candidates.every((c) => c.disposition === 'duplicate'),
  'Explore: every pick already in the catalog is marked duplicate; outcome no_candidates',
);
check(
  (await page.getByRole('button', { name: 'Use as a brief' }).count()) === 0,
  'Explore: no "Use as a brief" on duplicates',
);
// Archive the catalog (test seam through the API, as the Library's Archive does), then explore again.
for (const kind of ['problem', 'idea', 'alternative', 'search_brief'])
  for (const e of await get(`${base}/entities?kind=${kind}&status=active`))
    await post(`${base}/entities/${e.id}/archive`, {
      expected_version: e.version,
      reason: 'Walk: clear the catalog.',
    });
await page.getByRole('button', { name: 'Explore for me', exact: true }).click();
await page.locator('.shortlist .card.candidate').first().waitFor({ timeout: 30000 });
await page.locator('.shortlist').scrollIntoViewIfNeeded();
await shot('03-shortlist.png');
const cards = await page.locator('.shortlist .card.candidate').count();
check(cards >= 1, `Explore: second shortlist shows ${cards} candidate(s)`);
wfs = await get(`${base}/workflows`);
ex = wfs.filter((w) => w.role === 'r01_exploration').sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
check(ex?.result?.exploration?.outcome === 'candidates', 'Explore: server outcome is candidates');

// 2. Use the first candidate as a brief: the form below fills and its claims are attached.
await page.getByRole('button', { name: 'Use as a brief' }).first().click();
await page.getByText('Filled from an Explore for me pick').waitFor({ timeout: 10000 });
const theme = await page.locator('#b-theme').inputValue();
const card0 = ex.result.exploration.candidates.find((c) => c.disposition === 'candidate');
check(theme === card0.title, `Brief: theme is the pick's title ("${theme.slice(0, 50)}")`);
const briefs = await get(`${base}/entities?kind=search_brief&status=active`);
check(briefs.length === 1 && briefs[0].title === theme, 'Brief: one active search brief, made from the pick');
await page.getByText('Filled from an Explore for me pick').scrollIntoViewIfNeeded();
await shot('04-brief-filled.png');

// 3. Starting discovery from the unedited pick reuses that brief (no second brief).
const start = page.getByRole('button', { name: /Save brief and start discovery/ });
await start.scrollIntoViewIfNeeded();
await start.click();
await page.waitForURL(/#\/monitor/, { timeout: 20000 }).catch(() => {});
const after = await get(`${base}/entities?kind=search_brief&status=active`);
check(after.length === briefs.length, 'Discovery: started from the same brief, none added');
const disc = (await get(`${base}/workflows`)).find(
  (w) => w.role === 'r02_discovery' && w.subject.id === briefs.find((b) => b.title === theme)?.id,
);
check(Boolean(disc), 'Discovery: a discovery workflow runs on the explored brief');
await shot('05-discovery-started.png');

// 4. Chat: "Explore for me" is a request to explore, not a theme called "me".
await page.goto(`${WEB}/#/chat/conversations?ws=${ws}`);
const box = page.getByRole('textbox').first();
await box.waitFor({ timeout: 10000 });
await box.fill('Explore for me');
await box.press('Enter');
const reply = page.getByRole('button', { name: 'Open Explore for me' });
await reply.waitFor({ timeout: 10000 });
check(true, 'Chat: reply offers "Open Explore for me"');
await shot('06-chat.png');

// 5. Phone width: the shortlist fits.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${WEB}/#/projects/discover?ws=${ws}`);
await page.locator('.shortlist').waitFor({ timeout: 15000 });
await page.locator('.shortlist').scrollIntoViewIfNeeded();
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);
check(!overflow, 'Phone width: no horizontal overflow on Discover');
await shot('07-phone-shortlist.png');

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
