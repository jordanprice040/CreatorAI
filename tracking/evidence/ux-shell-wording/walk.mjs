// Final UX pass, Shell and wording area (P-8, P-9, P-14, P-15, section 6 Budgets folds): a
// Playwright walk of a throwaway fixture studio. Run from the repo root against a studio on
// 5183 seeded with `pnpm cli seed-selection` (never the dev studio or the installed app):
//   node tracking/evidence/ux-shell-wording/walk.mjs <dev login code>
// It creates one extra fixture workspace with no runs (for P-14), switches the view mode for
// its checks and puts the person's choice back at the end.
import { createRequire } from 'node:module';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('playwright');
const base = process.env.WALK_BASE ?? 'http://127.0.0.1:5183';
const out = 'tracking/evidence/ux-shell-wording';
const code = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const login = await ctx.request.post(`${base}/api/auth/dev-login`, {
  data: { code },
});
const session = await login.json();
const before = await (await ctx.request.get(`${base}/api/me/view-mode`)).json();
const list = await (await ctx.request.get(`${base}/api/workspaces`)).json();
const sel = list.find(
  (w) => w.name === 'Fixture selection and spec demonstration',
);
let empty = list.find((w) => w.name === 'Shell walk, no runs');
if (!empty)
  empty = await (
    await ctx.request.post(`${base}/api/workspaces`, {
      headers: { 'X-CSRF-Token': session.csrf_token },
      data: { name: 'Shell walk, no runs', record_mode: 'fixture' },
    })
  ).json();
const page = await ctx.newPage();
const log = [];
const check = (ok, what) => {
  log.push(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
async function go(ws, path, mode) {
  const url = `${base}/#/${path}?ws=${ws.id}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  const radio = page
    .getByRole('radio', {
      name: mode === 'standard' ? /^Standard/ : /^Advanced/,
    })
    .first();
  if ((await radio.count()) && !(await radio.isChecked())) {
    await radio.check();
    await page.waitForTimeout(500);
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
}
const main = () => page.locator('main');
const shot = (name) =>
  page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

// P-9: Budgets in Standard, cents with the exact amount on click and keyboard.
await go(sel, 'monitor/budgets', 'standard');
await shot('01-budgets-standard');
const amount = main().locator('button.money').first();
check(
  (await amount.count()) > 0,
  'Budgets shows rounded amounts as buttons in Standard',
);
const shown = (await amount.textContent()) ?? '';
check(
  /^-?<?\d+\.\d{2}( sim)?$|^-?<?\$\d+\.\d{2}$/.test(shown),
  `rounded text is cents: "${shown}"`,
);
await amount.click();
const exact = (await amount.textContent()) ?? '';
check(
  exact !== shown && /\d\.\d{3,}/.test(exact),
  `click shows the exact amount: "${exact}"`,
);
await amount.focus();
await page.keyboard.press('Enter');
check(
  (await amount.textContent()) === shown,
  'Enter on the focused amount goes back to cents',
);
const pricingFold = main().locator('details.routine', {
  has: page.locator('summary', { hasText: 'Pricing snapshots' }),
});
check(
  (await pricingFold.count()) === 1,
  'Pricing snapshots sit in a fold in Standard',
);
// Review 1 of #197, L-1: the fold is closed on page load, not only present.
check(
  (await pricingFold.evaluate((d) => d.open)) === false,
  'Pricing snapshots are folded (closed) on load once pricing exists',
);
const calls =
  (await main()
    .locator('h3', { hasText: 'Recent calls' })
    .locator('xpath=..')
    .innerText()) ?? '';
check(
  !/\bmodel · generate\b|\bsettled\b/.test(calls),
  'Recent calls (Standard) reads actions and states as words (L-3)',
);
check(
  (await main()
    .locator('details.routine summary', { hasText: 'Try a fixture call' })
    .count()) === 1,
  'Try a fixture call is folded in Standard',
);
await go(sel, 'monitor/budgets', 'advanced');
await shot('02-budgets-advanced');
check(
  (await main().locator('button.money').count()) === 0,
  'Advanced shows exact amounts as plain text',
);
check(
  (await main().locator('details.routine').count()) === 0,
  'Advanced shows pricing and the fixture call open',
);

// P-8: Activity in Standard and Advanced.
await go(sel, 'monitor/activity', 'standard');
await shot('03-activity-standard');
const act = (await main().innerText()) ?? '';
check(!/\bv\d+\b/.test(act), 'Activity (Standard) shows no v1/v2 suffixes');
check(!/event #\d+/.test(act), 'Activity (Standard) shows no event numbers');
check(
  !/\b[0-9a-f]{8}\b/.test(act.replace(/\d{1,2}:\d{2}/g, '')),
  'Activity (Standard) shows no short ids',
);
check(
  !/\b[a-z]+_[a-z]+\b/.test(act),
  'Activity (Standard) shows no snake_case codes',
);
await go(sel, 'monitor/activity', 'advanced');
await shot('04-activity-advanced');
const actAdv = (await main().innerText()) ?? '';
check(
  /event #\d+/.test(actAdv) && /\bv1\b/.test(actAdv),
  'Activity (Advanced) keeps event numbers and versions',
);

// P-8: Decide and Approvals without hashes or run ids in Standard.
await go(sel, 'projects/decide', 'standard');
await shot('05-decide-standard');
const decide = (await main().innerText()) ?? '';
check(
  !/binds report [0-9a-f]{12}/.test(decide) && !/bound to report/.test(decide),
  'Decide (Standard) names no report hash',
);
await go(sel, 'monitor/approvals', 'standard');
await shot('06-approvals-standard');
const appr = (await main().innerText()) ?? '';
check(
  !/run [0-9a-f]{8}\b/.test(appr) && !/\bV1\b/.test(appr),
  'Approvals (Standard) shows no run ids or V1',
);

// P-14 and P-15: Sources in a workspace with no runs; the Next banner on Sources and Chat.
await go(empty, 'sources/claims', 'standard');
await shot('07-sources-no-run');
const notice = main().locator('.notice', {
  hasText: 'First, register a run for fetching',
});
check(
  (await notice.count()) === 1,
  'Sources puts "register a run" before Fetch',
);
const noticeBox = await notice.boundingBox();
const fetchBox = await main().locator('form.fetch-row').boundingBox();
check(
  !!noticeBox && !!fetchBox && noticeBox.y < fetchBox.y,
  'the register step sits above the Fetch row',
);
check(
  await main().getByText('Fetch needs a run first (above).').isVisible(),
  'the disabled reason is shown beside Fetch',
);
check(
  await main()
    .getByRole('button', { name: /Search the web/ })
    .isVisible(),
  'Sources links to Discover › Search the web',
);
const banner = page.locator('aside.next-step');
check(
  (await banner.count()) === 1 &&
    /^(Next|Blocked|All clear):/.test((await banner.innerText()).trim()),
  `Sources shows the Next banner: "${(await banner.innerText()).trim().slice(0, 80)}"`,
);
await go(sel, 'chat/chat', 'standard');
await shot('08-chat-banner');
const chatBanner = (await page.locator('aside.next-step').innerText()).trim();
check(
  /^(Next|Blocked|All clear):/.test(chatBanner) &&
    !/Main path:/.test(chatBanner),
  `Chat shows the Next banner: "${chatBanner.slice(0, 80)}"`,
);

// Review 1 of #197, L-5: the Sources link opens Discover at Search the web, focused.
await go(empty, 'sources/claims', 'standard');
await main()
  .getByRole('button', { name: /Search the web/ })
  .click();
await page.waitForTimeout(1200);
const focused = await page.evaluate(() => document.activeElement?.id ?? '');
const heading = page.locator('main #web-title:visible');
const hBox = await heading.boundingBox();
check(
  focused === 'web-title' && !!hBox && hBox.y >= -5 && hBox.y < 900,
  `Sources' Search the web link lands on that section (focus: "${focused}")`,
);
await shot('09-search-the-web');

// Put the person's view mode back.
await ctx.request.post(`${base}/api/me/view-mode`, {
  headers: { 'X-CSRF-Token': session.csrf_token },
  data: {
    expected_version: (
      await (await ctx.request.get(`${base}/api/me/view-mode`)).json()
    ).version,
    view_mode: before.view_mode,
  },
});
await browser.close();
console.log(log.join('\n'));
