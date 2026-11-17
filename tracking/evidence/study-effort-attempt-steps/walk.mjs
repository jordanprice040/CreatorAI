// ADR-0129: the study effort timer on the human-only attempt and the finish, checked in the real
// studio. Throwaway database, review ports, synthetic fixture study only, $0, no model call.
// Start ../owner-actions/stack.mjs first, then (from the repo root):
//   node tracking/evidence/study-effort-attempt-steps/walk.mjs <database-url> <out-dir>
// Opens the human-only attempt (timing starts), types and saves an entry (the step ends, the
// next starts), submits (the finish ends the last step), opens the assisted attempt (timing
// starts without opening the intervention form), and reads steps and the export back.
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
const post = async (path, body) => {
  const r = await fetch(`${WEB}/api/${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrf_token,
    },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
};
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers: { Cookie: cookie } })).json();
const ws = (
  await post('workspaces', { name: 'Timer walk 2', record_mode: 'fixture' })
).id;
const seed = await post(`workspaces/${ws}/studies/seed`, {});
const b = seed.attempts.find((a) => a.condition === 'human_in_loop');
const c = seed.attempts.find((a) => a.condition === 'human_only');

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
  .getByRole('button', { name: /human only · assigned/ })
  .first()
  .click();
const box = page.locator('.study-effort');
await box.getByText('Timing this step').waitFor();
check(true, 'opening the human-only attempt starts the step timer');
check(
  /each saved entry ends one/.test(await box.innerText()) &&
    /synthetic study, so it times the operator/.test(await box.innerText()),
  'the timer explains its steps and says a synthetic study times the operator',
);
const editor = page.getByLabel('Your document or code');
await editor.pressSequentially('A checklist', { delay: 150 });
await page.waitForTimeout(1200);
const live = await box.innerText();
check(/active [1-9]/.test(live), `typing an entry counts as active (${live})`);
await page.screenshot({ path: join(out, '01-human-only-timing.png') });
await page.getByRole('button', { name: 'Save entry' }).click();
await page.getByText('with the measured step time').waitFor();
await page.waitForFunction(() =>
  /1 timed step/.test(
    document.querySelector('.study-effort-summary')?.textContent ?? '',
  ),
);
await box.getByText('Timing this step').waitFor();
check(true, 'saving the entry ends the step and the next one starts');
await page.screenshot({ path: join(out, '02-entry-saved.png') });
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Submit saved work' }).click();
await page.getByText('Submission recorded with the measured time').waitFor();
check(true, 'submitting ends the last step with its measured time');
const cSteps = await get(`workspaces/${ws}/study-attempts/${c.id}/effort-steps`);
check(
  cSteps.length === 2 &&
    cSteps.map((s) => s.measured?.ended_by).join() === 'entry,finish' &&
    cSteps.every(
      (s) =>
        s.measured.active_ms +
          s.measured.wait_ms +
          s.measured.idle_ms +
          s.measured.away_ms <=
        s.measured.wall_ms + 5000,
    ),
  `the API returns an entry step and a finish step within their studio time (${JSON.stringify(cSteps.map((s) => s.measured))})`,
);

// Assisted: timing starts with the attempt, not only at the intervention form.
await page.getByRole('button', { name: 'Refresh outcomes' }).click();
await page
  .getByRole('button', { name: /human in loop · assigned/ })
  .first()
  .click();
await box.getByText('Timing this step').waitFor();
check(
  /saved intervention or entry ends one/.test(await box.innerText()),
  'opening the assisted attempt starts timing before the intervention form opens',
);
await page.screenshot({ path: join(out, '03-assisted-timing.png') });
await page.getByRole('button', { name: 'Stop attempt…' }).click();
await page.getByRole('button', { name: 'Stop attempt', exact: true }).click();
await page.waitForFunction(
  () =>
    !document.querySelector('.study-effort') &&
    /human in loop · cancelled/.test(document.body.textContent ?? ''),
);
const bSteps = await get(`workspaces/${ws}/study-attempts/${b.id}/effort-steps`);
check(
  bSteps.length === 1 && bSteps[0].measured?.ended_by === 'finish',
  'stopping the assisted attempt ends its step as the finish',
);
const exported = await get(`workspaces/${ws}/studies/${seed.study.id}/export`);
const att = exported.attempts.find((a) => a.id === c.id);
check(
  att.measured_effort.subject === 'synthetic_operator_not_participant' &&
    att.measured_effort.complete === true &&
    att.measured_effort.by_end.entry.steps === 1 &&
    att.measured_effort.by_end.finish.steps === 1,
  'the export shows the human-only attempt completely timed, labelled synthetic operator data',
);
check(
  exported.attempts.find((a) => a.condition === 'autonomous').measured_effort
    .condition_timed === false,
  'the export says the autonomous condition is not timed',
);
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
