// P-1/P-10 UI walk on the throwaway studio (test-double executor). Steps run in order;
// each prints what Build says. Usage: node walk.mjs <workspace id> <step...>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:5183';
const out = process.env.WALK_OUT ?? '.verification/p1-walk';
const [ws, ...steps] = process.argv.slice(2);
(await import('node:fs')).mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${base}/api/auth/dev-login`, { data: { code: process.env.CREATOR_DEV_LOGIN_CODE } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
const go = async (p) => { await page.goto(`${base}/#/${p}?ws=${ws}`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); };
const click = async (name, n = 0) => { const b = page.getByRole('button', { name }).nth(n); await b.scrollIntoViewIfNeeded(); await b.click(); await page.waitForTimeout(1500); await page.waitForLoadState('networkidle'); };
const show = async (label) => { const t = await page.locator('main').innerText(); console.log(`--- ${label}\n${t.slice(0, 5000)}`); };
let i = 0;
for (const s of steps) {
  const [kind, arg, n] = s.split('::');
  if (kind === 'go') await go(arg);
  if (kind === 'click') await click(new RegExp(arg), Number(n ?? 0));
  if (kind === 'fill') { const [label, value] = arg.split('='); await page.getByLabel(new RegExp(label)).first().fill(value); }
  if (kind === 'wait') await page.waitForTimeout(Number(arg));
  if (kind === 'until') { await page.getByText(new RegExp(arg)).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(500); }
  if (kind === 'show') await show(arg ?? s);
  if (kind === 'shot') await page.screenshot({ path: `${out}/${arg}.png`, fullPage: true });
  if (kind === 'buttons') console.log('BUTTONS', (await page.locator('main button').allInnerTexts()).join(' | '));
  if (kind === 'select') console.log('SELECT', arg, await page.locator(`#${arg}`).inputValue(), (await page.locator(`#${arg} option:checked`).innerText()));
  i++;
}
await browser.close();
