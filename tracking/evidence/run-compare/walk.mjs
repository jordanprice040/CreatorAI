// Compare two runs (F7, ADR-0120), checked in the real studio. Throwaway database, review
// ports, fixture provider only, $0, no model call. Start ../owner-actions/stack.mjs first, then
// (from the repo root):
//   node tracking/evidence/run-compare/walk.mjs <database-url> <out-dir>
// Seeds `seed-discovery` through the real CLI and API and starts two autopilots through the API,
// on two runs whose approvals cover them, with different request limits (the fixture rates every
// option the same, so both stop at a tie). Then in the browser: the Compare runs tab, the label,
// the cautions, the table and both columns, the address keeping the pair, Swap, and phone width.
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

const dir = await mkdtemp(join(tmpdir(), 'run-compare-'));
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
/** A new run whose approvals cover the autopilot, and the autopilot on it, once stopped. */
async function startOne(cfg, title) {
  const policy = {
    ...autopilotRoutinePolicy(cfg, '100000000000'),
    rationale: 'Walk autopilot policy.',
  };
  const entity = await post(`${base}/entities`, {
    kind: 'run',
    title,
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
    config: cfg,
    summary_seen: autopilotSummary(cfg),
  });
  await wait(
    async () => (await get(`${base}/autopilots/${ap.id}`)).state === 'finished',
  );
  return ap;
}

const first = await startOne(config, 'Walk run A');
const second = await startOne(
  { ...config, limits: { ...config.limits, max_calls: 60 } },
  'Walk run B',
);
const api = await get(`${base}/run-comparison?a=${first.id}&b=${second.id}`);
check(
  api.label === 'A comparison of two runs, not a study result.',
  'the answer carries its label',
);
check(api.same_problem === true, 'both worked on the same problem');

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
await page.goto(`${WEB}/#/autopilot/run?ws=${ws}`);
await page.getByRole('heading', { name: 'Autopilot', level: 2 }).waitFor();
const tab = page.getByRole('link', { name: 'Compare runs' });
check((await tab.count()) > 0, 'the Autopilot page has a Compare runs tab');
await tab.first().click();
await page
  .getByRole('heading', { name: 'Compare two runs', level: 2 })
  .waitFor();
const table = page.locator('table.run-compare-table');
await table.waitFor({ timeout: 15000 });
check(
  (await page.locator('.run-compare-label').textContent())?.includes(
    'A comparison of two runs, not a study result.',
  ),
  'the page shows the label',
);
check(
  page.url().includes(`id=${first.id}%2C${second.id}`) ||
    page.url().includes(`id=${first.id},${second.id}`) ||
    (await page.getByRole('combobox', { name: 'Left' }).inputValue()) ===
      first.id,
  'the two latest finished autopilots open, older on the left',
);
const caution = await page.locator('.run-compare-cautions').textContent();
check(
  /different request limits \(80 and 60\)/.test(caution ?? ''),
  'the cautions name the different request limits',
);
const reqRow = table.locator('tr', { hasText: 'Requests' });
check(
  (await reqRow.locator('td').nth(0).textContent())?.endsWith('of 80') &&
    (await reqRow.locator('td').nth(1).textContent())?.endsWith('of 60'),
  'the Requests row shows each limit in its column',
);
check(
  (
    await table.locator('tr', { hasText: 'Where it stopped' }).textContent()
  )?.includes('select'),
  'both columns show the stop at the choice',
);
await page.screenshot({ path: `${out}/01-compare-runs.png`, fullPage: true });
await page.getByRole('button', { name: 'Swap' }).click();
await page.waitForTimeout(800);
check(
  (await page.getByRole('combobox', { name: 'Left' }).inputValue()) ===
    second.id,
  'Swap puts the right one on the left',
);
check(
  page.url().includes(second.id) &&
    page.url().indexOf(second.id) < page.url().indexOf(first.id),
  'the address keeps the pair',
);
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(500);
const wide = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check(!wide, 'no sideways page scroll at phone width');
await page.screenshot({ path: `${out}/02-phone.png`, fullPage: true });
check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
await browser.close();
