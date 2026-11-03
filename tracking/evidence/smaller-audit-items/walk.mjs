// Smaller audit items (2026-11-03): Budgets reconcile evidence line, Build spec row separator,
// Models Chat answers card heading, and the Claude Code sign-in box for owner vs non-owner.
// Setup (throwaway database, review ports, $0, no model call):
// 1. CREATOR_DATABASE_URL=<throwaway db> pnpm db:migrate
// 2. CREATOR_DATABASE_URL=<throwaway db> CREATOR_API_PORT=4330 CREATOR_WEB_PORT=5183 \
//    CREATOR_PREVIEW_PORT=4340 CREATOR_DEV_LOGIN_CODE=<32+ chars> node scripts/dev.mjs
// 3. CLI (CREATOR_API_URL=http://127.0.0.1:4330): login <code>; seed-selection
// 4. node tracking/evidence/smaller-audit-items/walk.mjs <login code> <seed-selection ws id> [out]
// The fixture has no unknown call to reconcile, so the Budgets step adds reconcile_evidence to
// the first listed call in this browser only; the server side is covered by broker.test.ts.
// The non-owner view likewise rewrites the workspace role in this browser only.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const WEB = 'http://127.0.0.1:5183';
const [code, seeded, out = 'tracking/evidence/smaller-audit-items'] =
  process.argv.slice(2);
if (!code || !seeded)
  throw new Error('usage: walk.mjs <login code> <workspace id> [out dir]');
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
const real = await (
  await fetch(`${WEB}/api/workspaces`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify({ name: 'Claude Code walk (real)', record_mode: 'real' }),
  })
).json();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

// Build: the seeded spec's revised version is not frozen, so Revise and Freeze both show.
await page.goto(`${WEB}/#/projects/build?ws=${seeded}`);
await page.waitForTimeout(3000);
const freeze = page.getByRole('button', { name: 'Freeze it under Scores and specs' });
const row = page.locator('li', { has: freeze }).first();
await row.scrollIntoViewIfNeeded();
console.log('spec row:', JSON.stringify(await row.innerText()));
await row.screenshot({ path: `${out}/01-spec-row.png` });

// Budgets: evidence line (injected client-side; see the header).
await page.route('**/reservations', async (route) => {
  const r = await route.fetch();
  const list = await r.json();
  if (list[0]) list[0].reconcile_evidence = 'Provider usage page for Nov 2: no request at 14:05.';
  await route.fulfill({ response: r, json: list });
});
await page.goto(`${WEB}/#/monitor/budgets?ws=${seeded}`);
await page.waitForTimeout(3000);
const ev = page.locator('.reconcile-evidence').first();
console.log('evidence lines:', await page.locator('.reconcile-evidence').count());
if (await ev.count()) {
  const li = page.locator('li', { has: ev }).first();
  await li.scrollIntoViewIfNeeded();
  console.log('evidence row:', JSON.stringify(await li.innerText()));
  await li.screenshot({ path: `${out}/02-budgets-evidence.png` });
}
await page.unroute('**/reservations');

// Models: Chat answers card, and a Claude Code connection added as a record only.
await page.goto(`${WEB}/#/connections/models?ws=${real.id}`);
await page.waitForTimeout(2500);
const card = page.locator('section.chat-answers-card');
const cardBox = await card.boundingBox();
const headBox = await card.locator('h3').boundingBox();
console.log('chat answers heading offset from card top:', Math.round(headBox.y - cardBox.y));
await card.screenshot({ path: `${out}/03-chat-answers-card.png` });
await page.getByRole('button', { name: 'Add Claude Code on this computer' }).click();
await page.waitForTimeout(2500);
console.log('owner sign-in box:', await page.getByText('Sign in to Claude Code yourself').count());
console.log('owner Check button:', await page.getByRole('button', { name: 'Check Claude Code' }).count());

const editor = await ctx.newPage();
await editor.route('**/api/workspaces', async (route) => {
  const r = await route.fetch();
  const list = (await r.json()).map((w) => ({ ...w, role: 'editor' }));
  await route.fulfill({ response: r, json: list });
});
await editor.goto(`${WEB}/#/connections/models?ws=${real.id}`);
await editor.waitForTimeout(2500);
console.log('editor sign-in box:', await editor.getByText('Sign in to Claude Code yourself').count());
console.log('editor Check button:', await editor.getByRole('button', { name: 'Check Claude Code' }).count());
console.log('editor owner note:', await editor.getByText('Only the workspace owner can').count());
await editor.screenshot({ path: `${out}/04-editor-models.png`, fullPage: true });
await browser.close();
