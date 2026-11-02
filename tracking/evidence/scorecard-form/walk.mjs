// Browser walk for the Decide page "Score an option" form (audit item 4, piece 1), against a
// throwaway database on the review ports with `pnpm cli seed-discovery` loaded. Usage:
//   node walk.mjs <login-code> <workspace-id> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, wsId, out = '.'] = process.argv.slice(2);
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
await page.goto(`${WEB}/#/projects/decide?ws=${wsId}`);
await page.waitForTimeout(1500);
const shot = (n, full = true) =>
  page.screenshot({ path: `${out}/${n}.png`, fullPage: full });
await page.waitForTimeout(1500);
const form = page.locator('form.score-form');
await form.scrollIntoViewIfNeeded();
await form.screenshot({ path: `${out}/01-score-empty.png` });
const opts = await page.locator('#sc-option option').allInnerTexts();
console.log('options:', opts);
// The software option (build or hybrid) gets both rubrics.
const soft = opts.findIndex((o) => /\((build|hybrid),/.test(o));
await page.locator('#sc-option').selectOption({ index: soft });
await page.waitForTimeout(500);
console.log(
  'rubrics:',
  await page.locator('#sc-rubric option').allInnerTexts(),
);
await page.getByRole('button', { name: 'Save scorecard' }).click();
await page.waitForTimeout(500);
console.log('alert:', await form.locator('[role=alert]').first().innerText());
await form.screenshot({ path: `${out}/02-score-needs-a-look.png` });
// Fill it the way an owner would: one Unknown, the rest rated with a claim each.
const groups = form.locator('fieldset');
const n = await page.locator('form.score-form [role=radiogroup]').count();
for (let i = 0; i < n; i++) {
  const g = page.locator('form.score-form [role=radiogroup]').nth(i);
  const label = await g.getAttribute('aria-label');
  if (label === 'Software influence rating') {
    await g.getByLabel('3').check();
    continue;
  }
  if (i === 0) await g.getByLabel('Unknown').check();
  else await g.getByLabel(String(2 + (i % 3))).check();
}
const fs = await groups.count();
for (let i = 0; i < fs; i++) {
  const f = groups.nth(i);
  const det = f.locator('details');
  const radio = f.locator('[role=radiogroup] input:checked');
  if ((await det.count()) && (await radio.count())) {
    const v = await f
      .locator('[role=radiogroup] label:has(input:checked)')
      .innerText();
    if (v !== 'Unknown') {
      await det.locator('summary').click();
      await det.locator('input[type=checkbox]').first().check();
    }
  }
  for (const t of await f.locator('textarea').all())
    if (!(await t.inputValue()))
      await t.fill('Walk: reason from the linked claims.');
}
await page.locator('#sc-ethics').selectOption('clear');
await page.locator('#sc-access').selectOption('clear');
for (const k of [
  'current_workaround',
  'contrary_evidence',
  'measurable_outcome',
  'validation_plan',
  'maintenance',
])
  if (!(await page.locator(`#sc-check-${k}`).inputValue()))
    await page.locator(`#sc-check-${k}`).fill('unknown');
await page.getByRole('button', { name: 'Add one you checked' }).click();
await page.locator('#sc-alt-0').fill('Paper reminder list');
await page.locator('#sc-confidence').selectOption('medium');
console.log(
  'target users prefilled:',
  await page.locator('#sc-check-target_users').inputValue(),
);
await page.getByRole('button', { name: 'Save scorecard' }).click();
await page.waitForTimeout(2500);
console.log('status:', await form.locator('[role=status]').first().innerText());
await form.screenshot({ path: `${out}/03-score-saved.png` });
const card = page.locator('article.alt').filter({ hasText: /\d+ scorecards/ });
console.log(
  'reviews lines:',
  await page.locator('article.alt dt:has-text("Reviews") + dd').allInnerTexts(),
);
console.log(
  'suitability lines:',
  await page
    .locator('article.alt dt:has-text("Suitability") + dd')
    .allInnerTexts(),
);
await page
  .locator('.compare-grid')
  .screenshot({ path: `${out}/04-compare-after.png` });
// The same option and rubric now opens as a revision of the saved card.
console.log(
  'revise button:',
  await page.getByRole('button', { name: 'Save revised scorecard' }).count(),
);
await page.getByRole('button', { name: 'Save revised scorecard' }).click();
await page.waitForTimeout(400);
console.log(
  'revise alert:',
  await form
    .locator('#sc-reason-error')
    .innerText()
    .catch(() => 'none'),
);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await form.screenshot({ path: `${out}/05-score-phone.png` });
await browser.close();
