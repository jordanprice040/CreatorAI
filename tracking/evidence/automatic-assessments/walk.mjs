// P08 automatic assessments (ADR-0074), walked on a throwaway database and the review ports,
// fixture provider only, $0, no plan or paid call. Start ../owner-actions/stack.mjs first, then:
//   node tracking/evidence/automatic-assessments/walk.mjs <out-dir>
// Seeds `seed-discovery` through the real CLI, then on Compare: Assess automatically, the
// per-card explanation (review M-2), Edit with a reason, Assess again, and Edit on the newer
// assessment, which moves the person's card on to replace it (review M-3).
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const [out = '.'] = process.argv.slice(2);
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const dir = await mkdtemp(join(tmpdir(), 'assess-walk-'));
const cenv = {
  ...process.env,
  CREATOR_API_URL: 'http://127.0.0.1:4330',
  CREATOR_SESSION_FILE: join(dir, 'session.json'),
};
const cli = async (...args) =>
  JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        ['apps/cli/dist/main.js', ...args],
        { env: cenv, maxBuffer: 1 << 26 },
      )
    ).stdout,
  );
await cli('login', CODE);
const seed = await cli('seed-discovery');
const ws = seed.workspace?.id ?? seed.workspace;
console.log('workspace', ws);
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers: { Cookie: cookie } })).json();
const base = `workspaces/${ws}`;
for (let i = 0; i < 60; i++) {
  const wfs = await get(`${base}/workflows`);
  if (wfs.every((w) => w.finished_at)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const assessed = async (n) => {
  for (let i = 0; i < 60; i++) {
    const wfs = (await get(`${base}/workflows`)).filter(
      (w) => w.role === 'r08_assessment',
    );
    if (wfs.length === n && wfs.every((w) => w.finished_at)) return wfs;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return [];
};

await page.goto(`${WEB}/#/projects/decide?ws=${ws}`);
const section = page.locator('section.assess');
await section.waitFor({ timeout: 20000 });
await section.scrollIntoViewIfNeeded();
await section.getByText('Model access').click();
await page.locator('#as-route').selectOption('api');
await page.waitForFunction(
  () => !document.querySelector('section.assess button.primary')?.disabled,
  null,
  { timeout: 20000 },
);
await page.screenshot({ path: join(out, '01-assess-form.png') });
await section.getByRole('button', { name: 'Assess automatically' }).click();
let wfs = await assessed(1);
check(
  wfs.length === 1 && wfs[0].state === 'succeeded',
  `Assess: one assessment workflow, ${wfs[0]?.state}`,
);
await page.reload();
const lines = page.locator('.assess-lines').first();
await lines.waitFor({ timeout: 20000 });
await lines.scrollIntoViewIfNeeded();
check(
  /Automatic assessment/.test(await lines.innerText()),
  'Compare: the option shows its automatic assessment',
);
// M-2: the explanation opens from each system card.
const why = lines.locator('details.assess-why').first();
await why.locator('summary').click();
const text = await why.innerText();
check(/of 5|unknown/.test(text), 'Why: per-criterion ratings shown');
check(/Cites:/.test(text), 'Why: cited claims named');
check(
  /Confidence:/.test(text) && /Uncertainty/.test(text),
  'Why: confidence and uncertainty',
);
check(
  /Fixture rules/.test(text) && /workflow/.test(text),
  'Why: provenance line',
);
await why.screenshot({ path: join(out, '02-why-these-ratings.png') });

// The person picks the gates (an assessment never fills them) and says why.
const fill = async (why) => {
  for (const g of ['ethics', 'access']) {
    await page.locator(`#sc-${g}`).selectOption('clear');
    await page.locator(`#sc-${g}-note`).fill('Checked with the group (walk).');
  }
  await page.locator('#sc-reason').fill(why);
};
// Edit with a reason: the person's own card replaces the system card.
await lines.getByRole('button', { name: 'Edit' }).first().click();
const form = page.locator('form.score-form');
await form.waitFor();
await fill('I know this group (walk).');
await form.getByRole('button', { name: /Save/ }).click();
await page.waitForTimeout(1500);
const saved = await form.innerText();
check(
  /Your edit is saved as your own scorecard/.test(saved),
  'Edit: saved as the person’s card, original kept',
);
await form.screenshot({ path: join(out, '03-edit-saved.png') });
await page.reload();
await lines.waitFor();
check(
  /replaced by a person’s edit/.test(await lines.innerText()),
  'Compare: the system card is marked replaced',
);
check(
  /’s edit of the automatic assessment/.test(await lines.innerText()),
  'Compare: the edit names its author',
);

// Assess again, then Edit on the newer card (M-3).
await section.scrollIntoViewIfNeeded();
await section.getByText('Model access').click();
await page.locator('#as-route').selectOption('api');
await page.waitForFunction(
  () => !document.querySelector('section.assess button.primary')?.disabled,
  null,
  { timeout: 20000 },
);
await section.getByRole('button', { name: 'Assess again' }).click();
wfs = await assessed(2);
check(
  wfs.length === 2 && wfs.every((w) => w.state === 'succeeded'),
  'Assess again: second workflow succeeded',
);
await page.reload();
await lines.waitFor();
const before = await lines.innerText();
const editsBefore = await lines.getByRole('button', { name: 'Edit' }).count();
check(
  !/replaced by a person’s edit/.test(before),
  'Compare: the newer assessment counts until edited',
);
await lines.getByRole('button', { name: 'Edit' }).first().click();
await form.waitFor();
await fill('Still know this group (walk).');
await form.getByRole('button', { name: /Save/ }).click();
await page.waitForTimeout(1500);
check(
  /now replaces the newer automatic assessment/.test(await form.innerText()),
  'Edit again: the person’s card moves on to the newer assessment',
);
await page.reload();
await lines.waitFor();
const after = await lines.innerText();
check(
  /replaced by a person’s edit/.test(after),
  'Compare: the newer assessment is marked replaced',
);
check(
  (await lines.getByRole('button', { name: 'Edit' }).count()) ===
    editsBefore - 1,
  'Compare: no Edit on the replaced assessment (the other rubric keeps its own)',
);
await lines.screenshot({ path: join(out, '04-after-second-edit.png') });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
check(
  await page.evaluate(() => document.documentElement.scrollWidth <= 391),
  'Phone width: no horizontal overflow on Compare',
);
check(
  errors.length === 0,
  `no page errors${errors.length ? `: ${errors[0]}` : ''}`,
);
await browser.close();
