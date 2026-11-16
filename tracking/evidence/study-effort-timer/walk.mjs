// The study effort timer (ADR-0122, F13), checked in the real studio. Throwaway database, review
// ports, synthetic fixture study only, $0, no model call. Start ../owner-actions/stack.mjs first,
// then (from the repo root):
//   node tracking/evidence/study-effort-timer/walk.mjs <database-url> <out-dir>
// Creates a fixture workspace and the synthetic three-arm study through the API, then in the
// browser opens the assisted attempt, opens "Record human intervention", types, waits, saves,
// and reads the step back through the API.
import { createRequire } from 'node:module';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const [dbUrl, out = '.'] = process.argv.slice(2);
if (!dbUrl || !/walk|throwaway/.test(dbUrl))
  throw new Error('Use a throwaway database whose name contains "walk".');
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};

const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = {
  Cookie: cookie,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrf_token,
};
const post = async (path, body) => {
  const r = await fetch(`${WEB}/api/${path}`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
};
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers: { Cookie: cookie } })).json();
const ws = (
  await post('workspaces', { name: 'Timer walk', record_mode: 'fixture' })
).id;
const seed = await post(`workspaces/${ws}/studies/seed`, {});
const b = seed.attempts.find((a) => a.condition === 'human_in_loop');

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
  deviceScaleFactor: 2,
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${WEB}/#/settings/study?ws=${ws}`);
await page.getByRole('heading', { name: 'Study runner' }).waitFor();
await page
  .getByRole('button', { name: /human in loop · assigned/ })
  .first()
  .click();
await page.getByText('Record human intervention').click();
const box = page.locator('.study-effort');
await box.getByText('Timing this step').waitFor();
check(true, 'opening the intervention form starts the step timer');
check(
  /synthetic study, so it times the operator/.test(await box.innerText()),
  'the timer says a synthetic study times the operator, not a participant',
);
const form = page.locator('form').filter({ hasText: 'Intervention type' });
for (const label of [
  'Reason',
  'Trigger',
  'Stage',
  'Information shown',
  'Human response',
  'Resulting change',
])
  await form.getByLabel(label, { exact: true }).fill(`Walk ${label}`);
await form.locator('textarea').first().pressSequentially('abc', { delay: 400 });
await page.waitForTimeout(1500);
const live = await box.innerText();
check(/active [1-9]/.test(live), `active time counts while editing (${live})`);
await page.screenshot({ path: join(out, '01-timing-step.png') });
await form.getByRole('button', { name: 'Save intervention' }).click();
await page.getByText('measured step time saved').waitFor();
const summary = page.locator('.study-effort-summary');
await summary.waitFor();
check(
  /1 timed step/.test(await summary.innerText()),
  `the attempt shows its timed step (${await summary.innerText()})`,
);
await page.screenshot({ path: join(out, '02-saved.png') });
// Review M-1: the form stays open, so the next intervention is timed from the save.
await box.getByText('Timing this step').waitFor();
check(
  true,
  'after a save the next step starts timing while the form stays open',
);
await form.locator('textarea').first().pressSequentially('d', { delay: 200 });
await form.getByRole('button', { name: 'Save intervention' }).click();
await page.waitForFunction(() =>
  /2 timed steps/.test(
    document.querySelector('.study-effort-summary')?.textContent ?? '',
  ),
);
check(true, 'a second intervention in a row is timed (2 timed steps)');
await box.getByText('Timing this step').waitFor();
await page.screenshot({ path: join(out, '03-second-step.png') });
const steps = await get(`workspaces/${ws}/study-attempts/${b.id}/effort-steps`);
const m = steps[0]?.measured;
check(
  steps.length === 3 &&
    steps.filter((s) => s.measured).length === 2 &&
    m &&
    m.active_ms > 0 &&
    m.active_ms + m.wait_ms + m.idle_ms + m.away_ms <= m.wall_ms + 5000,
  `the API returns the measured step within its studio time (${JSON.stringify(m)})`,
);
const exported = await get(`workspaces/${ws}/studies/${seed.study.id}/export`);
const att = exported.attempts.find((a) => a.id === b.id);
check(
  att.measured_effort.subject === 'synthetic_operator_not_participant',
  'the export labels the timing synthetic operator data',
);
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
