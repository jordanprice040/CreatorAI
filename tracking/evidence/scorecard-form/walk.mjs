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
const csrf = (await login.json()).csrf_token;

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
// The date is the owner's: it starts empty (review L-3).
await page.locator('#sc-alt-0-on').fill('2026-11-01');
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
// L-3: a new "checked" row starts with no date.
await page.getByRole('button', { name: 'Add one you checked' }).click();
console.log(
  'new checked-on date:',
  JSON.stringify(await page.locator('#sc-alt-1-on').inputValue()),
);

// H-1: switching the rubric on a build/hybrid option renders that rubric (no crash).
let crashed = false;
page.on('pageerror', () => (crashed = true));
await page.locator('#sc-rubric').selectOption('opportunity');
await page.waitForTimeout(500);
console.log(
  'after rubric switch: crashed',
  crashed,
  'legends',
  (await form.locator('legend').allInnerTexts()).slice(0, 2),
);
await form.screenshot({ path: `${out}/06-opportunity-rubric.png` });
await page.locator('#sc-rubric').selectOption('suitability');
await page.waitForTimeout(300);

// L-1: a human card under another label (as the CLI could write) is offered, not duplicated.
const api = (path, init = {}) =>
  fetch(`${WEB}/api/workspaces/${wsId}/${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': csrf,
    },
  }).then((r) => r.json());
const cards = await api('entities?kind=scorecard&status=active');
const mine = cards[0];
await api('scorecards', {
  method: 'POST',
  body: JSON.stringify({
    title: 'Card under another label',
    body: { ...mine.body, reviewer: { kind: 'human', label: 'Jordan (CLI)' } },
  }),
});
// M-1: the option moves to v2, so the saved card rates an older version.
const altId = mine.body.subject.id;
const alt =
  (await api(`entities/${altId}`)).entity ?? (await api(`entities/${altId}`));
await api(`entities/${altId}/revisions`, {
  method: 'POST',
  body: JSON.stringify({
    expected_version: alt.version,
    title: alt.title,
    body: { ...alt.body, rationale: `${alt.body.rationale} (walk: revised)` },
    reason: 'Walk: move the option to v2',
    corrects_version: null,
  }),
});
await page.reload();
await page.waitForTimeout(2500);
const opts2 = await page.locator('#sc-option option').allInnerTexts();
await page
  .locator('#sc-option')
  .selectOption({ index: opts2.findIndex((o) => /, v2\)/.test(o)) });
await page.waitForTimeout(500);
console.log(
  'older-card notice:',
  await form.locator('.notice[role=status]').first().innerText(),
);
console.log(
  'checked radios:',
  await form.locator('[role=radiogroup] input:checked').count(),
);
console.log(
  'ethics/confidence:',
  await page.locator('#sc-ethics').inputValue(),
  await page.locator('#sc-confidence').inputValue(),
);
console.log(
  'other-label notice:',
  await form
    .locator('div.notice')
    .innerText()
    .catch(() => 'none'),
);
await page.locator('#sc-reason').fill('Option changed');
await page.getByRole('button', { name: 'Save revised scorecard' }).click();
await page.waitForTimeout(500);
console.log(
  'reason-only save:',
  await form.locator('p[role=alert]').first().innerText(),
);
await form.screenshot({ path: `${out}/07-revise-older-version.png` });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await form.screenshot({ path: `${out}/05-score-phone.png` });
await browser.close();
