// Browser walk for the humility review form (audit item 4, piece 3) on Build (a spec version)
// and Decide (an option), against a throwaway database on the review ports with one
// `pnpm cli seed-selection` workspace (fixture records, $0). Usage:
//   node walk.mjs <login-code> <workspace-id> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, ws, out = '.'] = process.argv.slice(2);
const WEB = 'http://127.0.0.1:5183';
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const form = page.locator('form.humility-form');
const fill = (id, v) => page.locator(`[id="hf-${id}"]`).fill(v);

await page.goto(`${WEB}/#/projects/build?ws=${ws}`);
await page.waitForTimeout(2500);
console.log(
  'spec rows:',
  await page.locator('h3:has-text("Specs") ~ ul.rows li .small').allInnerTexts(),
);
await page
  .getByRole('button', { name: /^(Add a humility review|Review again)$/ })
  .first()
  .click();
await page.waitForTimeout(400);
console.log('heading:', await form.locator('h3').innerText());
console.log('started from earlier:', /Started from/.test(await form.innerText()));
console.log('preview:', await form.locator('[role=status]').first().innerText());
// Change the recommendation: the preview says it no longer admits a build.
await page.locator('[id="hf-disposition"]').selectOption('hybrid');
console.log('preview after hybrid:', await form.locator('[role=status]').first().innerText());
await form.screenshot({ path: `${out}/01-build-review-hybrid.png` });
await page.locator('[id="hf-disposition"]').selectOption('build');
await fill('rationale', 'Walk: software fits the flagged-slot need; staff keep the decision.');
await page.getByRole('button', { name: 'Save humility review' }).click();
await page.waitForTimeout(2500);
console.log(
  'after save:',
  await page.locator('h3:has-text("Specs") ~ ul.rows li .small').allInnerTexts(),
);

// Decide: an empty review on the software option names every judgment still to make.
await page.goto(`${WEB}/#/projects/decide?ws=${ws}`);
await page.waitForTimeout(2500);
const buttons = page.getByRole('button', {
  name: /^(Add a humility review|Review again|Review v\d+)/,
});
console.log('decide buttons:', await buttons.allInnerTexts());
await buttons.last().click();
await page.waitForTimeout(400);
console.log('decide heading:', await form.locator('h3').innerText());
await page.getByRole('button', { name: 'Save humility review' }).click();
await page.waitForTimeout(400);
console.log('decide alert:', await form.locator('p[role=alert]').first().innerText().catch(() => 'none'));
await form.screenshot({ path: `${out}/02-decide-review.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await form.screenshot({ path: `${out}/03-review-phone.png` });
await browser.close();
