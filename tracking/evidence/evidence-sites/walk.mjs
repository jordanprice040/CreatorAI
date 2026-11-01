// Browser walk for ADR-0056 (evidence websites in Settings) and the Models "Change caps"
// form, against a throwaway database on the review ports. Usage:
//   node walk.mjs <login-code> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, out = '.'] = process.argv.slice(2);
const WEB = 'http://127.0.0.1:5183';
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = {
  'Content-Type': 'application/json',
  Cookie: cookie,
  'X-CSRF-Token': session.csrf_token,
};
const ws = await (
  await fetch(`${WEB}/api/workspaces`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify({ name: 'Walk studio (real)', record_mode: 'real' }),
  })
).json();
console.log('workspace', ws.id, ws.record_mode);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(WEB);
await page.waitForTimeout(1500);
const shot = (n) =>
  page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
const nav = async (label) => {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.waitForTimeout(1000);
};
// Pick the real workspace if a picker is shown.
const picker = page.locator('select#ws');
console.log('workspace picker:', await picker.getAttribute('title'));
await shot('00-home');
await page.getByText('Models and connections', { exact: true }).first().click();
await page.waitForTimeout(1500);
await shot('01-models');
const add = page.getByRole('button', { name: 'Add a ChatGPT plan connection' });
if (await add.count()) {
  await add.click();
  await page.waitForTimeout(1500);
}
await page.getByRole('button', { name: 'Change caps' }).click();
await page.getByLabel(/Requests per run/).fill('24');
await page.getByLabel(/Model requests a day/).fill('301');
await page.getByRole('button', { name: 'Save new caps' }).click();
await page.waitForTimeout(500);
await shot('02-caps-out-of-range');
await page.getByLabel(/Model requests a day/).fill('60');
await page.waitForTimeout(300);
await shot('03-caps-review');
await page.getByRole('button', { name: 'Save new caps' }).click();
await page.waitForTimeout(2500);
await shot('04-caps-saved');
console.log(
  'caps line:',
  await page.locator('dt:has-text("Caps") + dd').first().innerText(),
);

await page
  .locator('nav')
  .getByText('Settings', { exact: true })
  .first()
  .click();
await page.waitForTimeout(1500);
await page
  .getByRole('heading', { name: 'Evidence websites' })
  .scrollIntoViewIfNeeded();
await shot('05-settings-evidence');
await page.getByRole('button', { name: 'Change evidence websites' }).click();
await page.getByLabel('Any public website').check();
await page
  .locator('#sites-list')
  .fill(
    'www.speedrun.com\nhttps://tasvideos.org/Movies\n*.nih.gov\n192.168.1.1',
  );
await page.waitForTimeout(300);
await shot('06-sites-invalid');
await page
  .locator('#sites-list')
  .fill('www.speedrun.com\nhttps://tasvideos.org/Movies\n*.nih.gov');
await page
  .locator('#sites-reason')
  .fill('Walk: wider sources for the timing pilot.');
await page
  .locator('.sites-form')
  .getByRole('button', { name: 'Review change' })
  .click();
await page.waitForTimeout(300);
await shot('07-sites-confirm');
await page.getByRole('button', { name: 'Allow any public website' }).click();
await page.waitForTimeout(2000);
await shot('08-sites-saved');
const api = await (
  await fetch(`${WEB}/api/workspaces/${ws.id}/evidence-sites`, {
    headers: { Cookie: cookie },
  })
).json();
console.log(
  'api view:',
  JSON.stringify({
    source: api.source,
    version: api.version,
    mode: api.mode,
    hosts: api.hosts,
    history: api.history.length,
  }),
);
await browser.close();
