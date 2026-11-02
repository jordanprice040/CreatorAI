// Browser walk for "Qualify a model for a task" on Models (audit item 4, piece 4), against a
// throwaway database on the review ports. No model is ever called: the walk marks one model
// as verified straight in the throwaway database (psql, see the call below), starts a
// qualification (a record only, $0) and stops before Run. Usage:
//   node walk.mjs <login-code> <out-dir> <psql-url>
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, out = '.', pg] = process.argv.slice(2);
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
    body: JSON.stringify({ name: 'Qualify walk (real)', record_mode: 'real' }),
  })
).json();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${WEB}/#/connections/models?ws=${ws.id}`);
await page.waitForTimeout(2000);
await page
  .getByRole('button', { name: 'Add a ChatGPT plan connection' })
  .click();
await page.waitForTimeout(1500);
const fs = page.locator('fieldset:has(legend:has-text("Qualify a model"))');
console.log('before verify:', await fs.locator('p.small').innerText());
const conns = await (
  await fetch(`${WEB}/api/workspaces/${ws.id}/plan-connections`, {
    headers: write,
  })
).json();
execFileSync('psql', [
  pg,
  '-c',
  `insert into plan_model_access (connection_id, model_id, path, access, request_id)
   values ('${conns[0].id}', 'walk-model', 'responses', 'verified', '${randomUUID()}')`,
]);
await page.reload();
await page.waitForTimeout(2500);
console.log(
  'benchmarks:',
  await fs.locator('select').nth(1).locator('option').allInnerTexts(),
);
await fs.locator('select').nth(1).selectOption({ index: 1 });
await page.waitForTimeout(300);
console.log('cost line:', await fs.locator('p.small').innerText());
await fs.screenshot({ path: `${out}/01-qualify-form.png` });
await fs.getByRole('button', { name: 'Start qualification' }).click();
await page.waitForTimeout(2000);
console.log(
  'error:',
  await page.locator('[role=alert], .error').allInnerTexts(),
);
console.log('started row:', await fs.locator('[role=group]').allInnerTexts());
await fs.screenshot({ path: `${out}/02-qualification-started.png` });
await browser.close();
