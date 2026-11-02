// Full audit 2026-11-02: the Models "Change caps or allowed work" form on a new real workspace
// (a ChatGPT plan connection is added as a record only; nothing is signed in or sent), and the
// one-row top bar.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const WEB = 'http://127.0.0.1:5183';
// Usage: node walk.mjs <login-code> <out-dir>  (throwaway database, review ports, $0, no model call)
const [code, out = '.'] = process.argv.slice(2);
const login = await fetch(`${WEB}/api/auth/dev-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': session.csrf_token };
const ws = await (await fetch(`${WEB}/api/workspaces`, { method: 'POST', headers: write, body: JSON.stringify({ name: 'Allowed work walk (real)', record_mode: 'real' }) })).json();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`${WEB}/#/connections/models?ws=${ws.id}`);
await page.waitForTimeout(2000);
const bar = await page.locator('header.topbar').boundingBox();
console.log('topbar height', bar.height, 'status:', await page.locator('.conn').innerText(), '| title:', await page.locator('.conn').getAttribute('title'));
await page.getByRole('button', { name: 'Add a ChatGPT plan connection' }).click();
await page.waitForTimeout(2000);
console.log('allowed before:', await page.locator('dt:has-text("Allowed") + dd').innerText());
console.log('accept button:', await page.getByRole('button', { name: 'Accept these caps and allowed work' }).count());
await page.getByRole('button', { name: 'Change caps or allowed work' }).click();
await page.waitForTimeout(500);
const form = page.locator('form.caps-form');
await form.screenshot({ path: `${out}/01-form.png` });
// Untick all data -> error
for (const l of ['Synthetic (made-up) data', 'Public data']) await form.getByLabel(l).uncheck();
console.log('save disabled with no data?', await form.getByRole('button', { name: 'Save changes' }).isDisabled());
await form.getByRole('button', { name: 'Save changes' }).click();
console.log('errors:', await form.locator('.error').allInnerTexts());
await form.getByLabel('Public data').check();
await form.getByLabel('Approved private data').check();
await form.getByLabel('Builder role (patch_build)').check();
console.log('status:', await form.locator('[role=status]').innerText());
await form.screenshot({ path: `${out}/02-filled.png` });
await form.getByRole('button', { name: 'Save changes' }).click();
await page.waitForTimeout(1500);
console.log('form gone:', await page.locator('form.caps-form').count() === 0);
console.log('allowed after:', await page.locator('dt:has-text("Allowed") + dd').innerText());
console.log('caps:', await page.locator('dt:has-text("Caps") + dd').innerText());
console.log('alerts:', await page.locator('[role=alert]').allInnerTexts());
const conns = await (await fetch(`${WEB}/api/workspaces/${ws.id}/plan-connections`, { headers: write })).json();
console.log('stored:', JSON.stringify(conns[0].settings.allowed_data_classes), JSON.stringify(conns[0].settings.allowed_task_classes), 'accepted', conns[0].caps_accepted_at);
await page.screenshot({ path: `${out}/03-after.png` });
// Qualify form now offers patch_build
console.log('qualify options:', (await page.locator('select option').allInnerTexts()).filter(t=>/builder|t12/i.test(t)));
// PR #118 review L1: a member who is not the owner sees the connection's state but no actions.
// The workspace list is rewritten to say "editor" in this browser only (the server is unchanged
// and still refuses non-owners); there is one signed-in person in local development.
const editor = await ctx.newPage();
await editor.route('**/api/workspaces', async (route) => {
  const r = await route.fetch();
  const list = (await r.json()).map((w) => ({ ...w, role: 'editor' }));
  await route.fulfill({ response: r, json: list });
});
await editor.goto(`${WEB}/#/connections/models?ws=${ws.id}`);
await editor.waitForTimeout(2500);
console.log('editor note:', await editor.getByText('Only the workspace owner can').count());
console.log('editor buttons:', (await editor.locator('main button').allInnerTexts()).filter(Boolean));
console.log('editor allowed line:', await editor.locator('dt:has-text("Allowed") + dd').innerText());
await editor.screenshot({ path: `${out}/04-editor.png`, fullPage: true });
await browser.close();
