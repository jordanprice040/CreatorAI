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
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
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
  await page
    .locator('h3:has-text("Specs") ~ ul.rows li .small')
    .allInnerTexts(),
);
await page
  .getByRole('button', { name: /^(Add a humility review|Review again)$/ })
  .first()
  .click();
await page.waitForTimeout(400);
console.log('heading:', await form.locator('h3').innerText());
console.log(
  'notice:',
  (await form.locator('p.small').first().innerText()).replace(/\s+/g, ' '),
);
// Carried judgments are blank (review M-1): an unedited save is refused field by field.
await page.getByRole('button', { name: 'Save humility review' }).click();
await page.waitForTimeout(300);
console.log(
  'unedited save:',
  await form.locator('p[role=alert]').first().innerText(),
);
console.log('earlier shown:', await form.locator('.earlier').allInnerTexts());
// Pick every judgment again: viable yes for every option, no ethics issue, build.
for (const g of await form.locator('[role=radiogroup]').all())
  await g.getByLabel('Yes').check();
await page.locator('[id="hf-ethical.status"]').selectOption('none_identified');
await page.locator('[id="hf-disposition"]').selectOption('build');
console.log(
  'preview:',
  await form.locator('[role=status]').first().innerText(),
);
// Change the recommendation: the preview says it no longer admits a build.
await page.locator('[id="hf-disposition"]').selectOption('hybrid');
console.log(
  'preview after hybrid:',
  await form.locator('[role=status]').first().innerText(),
);
await form.screenshot({ path: `${out}/01-build-review-hybrid.png` });
await page.locator('[id="hf-disposition"]').selectOption('build');
await fill(
  'rationale',
  'Walk: software fits the flagged-slot need; staff keep the decision.',
);
await page.getByRole('button', { name: 'Save humility review' }).click();
await page.waitForTimeout(2500);
console.log(
  'after save:',
  await page
    .locator('h3:has-text("Specs") ~ ul.rows li .small')
    .allInnerTexts(),
);

// Decide: "Review again" carries the text but every judgment must be picked again.
await page.goto(`${WEB}/#/projects/decide?ws=${ws}`);
await page.waitForTimeout(2500);
const buttons = page.getByRole('button', {
  name: /^(Add a humility review|Review again|Review v\d+)/,
});
console.log('decide buttons:', await buttons.allInnerTexts());
// Review again on an option with an earlier review (review N-1: not whichever card is last).
await page
  .getByRole('button', { name: /^(Review again|Review v\d+)/ })
  .first()
  .click();
await page.waitForTimeout(400);
console.log('decide heading:', await form.locator('h3').innerText());
// Carried claims that are not in this page's list can be unticked (review L-1).
const carried = form.locator('fieldset fieldset', {
  hasText: 'From the earlier review',
});
console.log('carried claim lists:', await carried.count());
if (await carried.count()) {
  await carried.first().getByRole('checkbox').first().click();
  console.log('after untick:', await carried.count());
}
await page.getByRole('button', { name: 'Save humility review' }).click();
await page.waitForTimeout(400);
console.log(
  'decide alert:',
  await form
    .locator('p[role=alert]')
    .first()
    .innerText()
    .catch(() => 'none'),
);
await form.screenshot({ path: `${out}/02-decide-review.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await form.screenshot({ path: `${out}/03-review-phone.png` });
await browser.close();
