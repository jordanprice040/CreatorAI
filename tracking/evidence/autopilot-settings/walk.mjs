// ADR-0100: autopilot settings and Allow and continue, checked in the real Discover page.
// Throwaway database, review ports, fixture provider only, $0, no model call. Start
// ../owner-actions/stack.mjs first, then (from the repo root):
//   node tracking/evidence/autopilot-settings/walk.mjs <database-url> <out-dir>
// Seeds `seed-discovery` through the real CLI and API, starts an autopilot through the API on a
// run whose approvals cover it (the fixture rates every option the same, so it stops at a tie),
// then in the browser: the settings panel, the stopped card's Allow and continue, Hands-off, and
// "Automate the rest" offering a new run.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  autopilotRoutinePolicy,
  autopilotSummary,
  routinePolicySummary,
} from '../../../packages/contracts/dist/index.js';
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

const dir = await mkdtemp(join(tmpdir(), 'autopilot-settings-'));
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
        { env: cenv },
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
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const headers = { Cookie: cookie };
const write = {
  ...headers,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrf_token,
};
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers })).json();
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
const base = `workspaces/${ws}`;
const wait = async (ok, ms = 60_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 500));
  }
};
await wait(async () =>
  (await get(`${base}/workflows`)).every((w) => w.finished_at),
);

const envelope = (await get(`${base}/budgets`)).find(
  (e) => e.status === 'active',
);
const pricing = (await get(`${base}/pricing`))[0];
const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
const problem = (await get(`${base}/entities?kind=problem&status=active`)).find(
  (p) => !p.archived_at,
);
const config = {
  resource_setup: {
    kind: 'api',
    envelope_id: envelope.id,
    pricing_snapshot_id: pricing.id,
  },
  data_class: 'synthetic',
  research: null,
  explore: {
    interests: [],
    target_groups: [],
    exclusions: [],
    only_hosts: [],
    excluded_hosts: [],
    max_candidates: 3,
    max_claims: 30,
    max_age_days: 3650,
    leave_out: [],
  },
  evidence_roles: ['problem', 'affected_users', 'workaround', 'existing_tool'],
  perspectives: [
    'software',
    'existing_tool',
    'process_change',
    'human_led',
    'hybrid',
  ],
  excluded: [],
  max_revisions: 1,
  limits: { max_calls: 80, ends_at: inHours(2) },
  // seed-discovery already recorded every problem the fixture explorer finds, so start at
  // assessment of one of them (the fixture rates every option the same: a tie).
  start: {
    stage: 'assess',
    problem: { id: problem.id, version: problem.version },
  },
};
const policy = {
  ...autopilotRoutinePolicy(config, '100000000000'),
  rationale: 'Walk autopilot policy.',
};
const entity = await post(`${base}/entities`, {
  kind: 'run',
  title: 'Walk autopilot run',
  body: {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  },
});
const run = await post(`${base}/runs`, {
  run: { id: entity.id, version: 1 },
  autonomy_mode: 'human_in_loop',
  stage_gates: null,
  initial_grants: [],
  routine_policy: { ...policy, summary_seen: routinePolicySummary(policy) },
});
const ap = await post(`${base}/runs/${run.run_id}/autopilots`, {
  config,
  summary_seen: autopilotSummary(config),
});
await wait(
  async () => (await get(`${base}/autopilots/${ap.id}`)).state === 'finished',
);
const stopped = await get(`${base}/autopilots/${ap.id}`);
console.log('autopilot', stopped.outcome, stopped.steps.at(-1).stop_kind);
check(
  stopped.steps.at(-1).stop_kind === 'tie',
  'the autopilot stopped at a tie',
);
check(
  stopped.next?.[0]?.kind === 'allow_and_continue',
  'the read offers Allow and continue first',
);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1000 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${WEB}/#/projects/discover?ws=${ws}`);
const allow = page.getByRole('button', {
  name: /Allow “Break ties” and continue/,
});
await allow.first().waitFor({ timeout: 15000 });
check(true, 'the stopped card shows Allow “Break ties” and continue');
await allow.first().scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, '01-stopped-card-allow.png') });
const panel = page.getByText('When the autopilot would stop');
await panel.first().scrollIntoViewIfNeeded();
check(
  (await page.getByText('Hands-off is off.').count()) > 0,
  'Hands-off starts off',
);
await page.screenshot({ path: join(out, '02-settings-panel-off.png') });

await allow.first().click();
await wait(
  async () =>
    (await get(`${base}/autopilots/${ap.id}`)).state === 'finished' &&
    (await get(`${base}/autopilots/${ap.id}`)).version > stopped.version,
);
const after = await get(`${base}/autopilots/${ap.id}`);
const settings = await get(`${base}/autopilot-settings`);
check(
  settings.values.break_ties === true && settings.version === 1,
  'Allow saved the setting (version 1)',
);
check(
  /fixed order/.test(after.explanation),
  'it continued and the fixed order could not separate the fixture tie',
);
await page.waitForTimeout(2000);
await page.getByRole('button', { name: 'Turn on Hands-off' }).click();
await page
  .getByText(/Hands-off is on/)
  .first()
  .waitFor({ timeout: 10000 });
const s2 = await get(`${base}/autopilot-settings`);
check(
  s2.values.choose_with_unknowns &&
    s2.values.next_candidate &&
    !s2.values.choose_model_ethics,
  'Hands-off turns on every fallback except the ethics switch',
);
await page
  .getByText('When the autopilot would stop')
  .first()
  .scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, '03-settings-panel-hands-off.png') });

// Automate the rest offers a new run.
await page.getByRole('radio', { name: 'Automate the rest' }).check();
const sel = page.locator('#am-run');
const options = await sel.locator('option').allTextContents();
check(
  options.includes('A new run, made for this autopilot'),
  'Automate the rest offers a new run',
);
await sel.selectOption('new');
await sel.scrollIntoViewIfNeeded();
check(
  (await page
    .getByRole('button', { name: /Automate the rest on a new run/ })
    .count()) === 1,
  'the button names the new run',
);
await page.screenshot({ path: join(out, '04-automate-rest-new-run.png') });
// Phone width: the settings panel fits.
await page.setViewportSize({ width: 390, height: 900 });
await page
  .getByText('When the autopilot would stop')
  .first()
  .scrollIntoViewIfNeeded();
const wide = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check(!wide, 'no horizontal scroll at phone width');
await page.screenshot({ path: join(out, '05-phone-settings.png') });
check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
await browser.close();
