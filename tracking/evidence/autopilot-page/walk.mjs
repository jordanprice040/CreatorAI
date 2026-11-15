// The Autopilot page (November 15, Jordan's request), checked in the real studio. Throwaway
// database, review ports, fixture provider only, $0, no model call. Start
// ../owner-actions/stack.mjs first, then (from the repo root):
//   node tracking/evidence/autopilot-page/walk.mjs <database-url> <out-dir>
// Seeds `seed-discovery` through the real CLI and API and starts an autopilot through the API
// on a run whose approvals cover it (the fixture rates every option the same, so it stops at a
// tie and waits for the person). Then in the browser: the nav entry and its count, the waiting
// card with Continue, the start form, the levels and settings on the same page, Discover's
// Run it for me opening the page, Continue from the page, and phone width.
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

const dir = await mkdtemp(join(tmpdir(), 'autopilot-page-'));
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
// Review 1 of #213, H-1: a second autopilot whose end time passes while the page is open.
const shortEnd = Date.now() + 75_000;
const short = await startOne(
  {
    ...config,
    limits: { ...config.limits, ends_at: new Date(shortEnd).toISOString() },
  },
  'Walk short autopilot run',
);
const ap = await startOne(config, 'Walk autopilot run');
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
await page.goto(`${WEB}/#/chat/conversations?ws=${ws}`);
const nav = page.getByRole('navigation', { name: 'Pages' });
await nav.getByRole('link', { name: /Autopilot/ }).waitFor({ timeout: 15000 });
const labels = (await nav.getByRole('link').allTextContents()).map((t) =>
  // Leave out a count or an activity dot's text after the name.
  t.replace(/(\d|:).*$/, '').trim(),
);
console.log('nav', labels.join(' | '));
check(
  labels.indexOf('Autopilot') === labels.indexOf('Projects') + 1,
  'Autopilot is in the left nav just below Projects',
);
const navLink = nav.getByRole('link', { name: /Autopilot/ });
await page.waitForFunction(
  () =>
    !!document.querySelector(
      'nav[aria-label="Pages"] a[href*="#/autopilot"] .nav-count',
    ),
  null,
  { timeout: 30000 },
);
check(
  (await navLink.locator('.nav-count').textContent())?.startsWith('2'),
  'its count shows the two autopilots waiting for you',
);
await navLink.click();
await page.getByRole('heading', { name: 'Autopilot', level: 2 }).waitFor();
const waitingCards = page.locator(
  'section[aria-labelledby="autopilot-now-title"] article.card.waiting',
);
await waitingCards.nth(1).waitFor({ timeout: 15000 });
const heads = await waitingCards.locator('p').first().allTextContents();
check(
  (await waitingCards.count()) === 2 &&
    (await waitingCards
      .filter({ hasText: 'Walk short autopilot run' })
      .count()) === 1 &&
    (await waitingCards.filter({ hasText: /can continue until/ }).count()) ===
      2,
  'two waiting cards, each naming its run and until when it can continue',
);
console.log('card heads', heads.length);
// The short one's end time passes with the page open: it moves to Earlier autopilots, and
// the nav count drops, without reloading.
await page.waitForTimeout(Math.max(0, shortEnd - Date.now()) + 40_000);
check(
  (await waitingCards.count()) === 1 &&
    (await waitingCards
      .filter({ hasText: 'Walk short autopilot run' })
      .count()) === 0,
  'after its end time the short autopilot leaves Working or waiting',
);
const earlierFold = page.locator('section[aria-label="Earlier autopilots"]');
check(
  (await earlierFold
    .locator('article.card', { hasText: 'Its end time has passed' })
    .filter({ hasText: 'Ended: its end time passed' })
    .count()) === 1,
  'it is under Earlier autopilots, headed Ended: its end time passed, with no Continue',
);
check(
  (await earlierFold
    .getByRole('button', { name: /Continue the autopilot|Allow/ })
    .count()) === 0,
  'Earlier autopilots offer no Continue or Allow',
);
check(
  (await navLink.locator('.nav-count').textContent())?.startsWith('1'),
  'the nav count drops to 1',
);
check(
  page.url().includes('#/autopilot/run'),
  'the page has its own address (#/autopilot/run)',
);
const now = page.locator('section[aria-labelledby="autopilot-now-title"]');
const cont = now.getByRole('button', {
  name: /Continue the autopilot from/,
});
await cont.first().waitFor({ timeout: 15000 });
check(
  (await now.locator('article.card.waiting').count()) === 1,
  'the stopped autopilot is first, under Working or waiting for you, marked as waiting',
);
check(
  (await now
    .getByRole('button', { name: /Allow “Break ties” and continue/ })
    .count()) === 1,
  'its card offers Allow and continue too',
);
check(
  (await now.locator('.next-after-stop').count()) === 1,
  'its card says what to do next',
);
const order = await page.evaluate(() =>
  [
    'autopilot-now-title',
    'autopilot-title',
    'automation-title',
    'autopilot-settings-title',
  ].map((id) => {
    const e = document.getElementById(id);
    return e ? e.getBoundingClientRect().top + window.scrollY : -1;
  }),
);
check(
  order.every((y, i) => y > 0 && (i === 0 || y > order[i - 1])),
  'the page holds, in order: working or waiting, start, how much is automated, settings',
);
check(
  (await page.getByRole('button', { name: 'Start the autopilot' }).count()) ===
    1,
  'the start form is on the page',
);
check(
  (await page.getByText('When the autopilot would stop').count()) === 1,
  'the settings panel is on the page',
);
await page.screenshot({ path: join(out, '01-autopilot-page.png') });
await page
  .locator('#automation-title')
  .evaluate((e) => e.scrollIntoView({ block: 'start' }));
await page.screenshot({ path: join(out, '02-levels-and-settings.png') });

// Discover no longer holds the autopilot; its Run it for me choice opens this page.
await page.goto(`${WEB}/#/projects/discover?ws=${ws}`);
const choice = page.getByRole('button', { name: /^Run it for me/ });
await choice.waitFor({ timeout: 15000 });
check(
  (await page.locator('#discover-panel-autopilot').count()) === 0 &&
    (await page.locator('#discover-panel-automation').count()) === 0,
  'Discover has no autopilot or automation panel any more',
);
await choice.click();
await page.getByRole('heading', { name: 'Autopilot', level: 2 }).waitFor();
check(
  page.url().includes('#/autopilot/run'),
  "Discover's Run it for me opens the Autopilot page",
);

// Continue from the page: the fixture tie stops it again, as the honest outcome.
const before = await get(`${base}/autopilots/${ap.id}`);
await page
  .locator('section[aria-labelledby="autopilot-now-title"]')
  .getByRole('button', { name: /Continue the autopilot from/ })
  .first()
  .click();
await wait(async () => {
  const a = await get(`${base}/autopilots/${ap.id}`);
  return a.state === 'finished' && a.version > before.version;
});
check(
  true,
  'Continue on the page continued the autopilot (it stopped at the tie again)',
);

// A link to one autopilot opens its card, here inside the folded Earlier autopilots.
await page.goto(`${WEB}/#/autopilot/run?ws=${ws}&id=${short.id}`);
const linked = page.locator(`#autopilot-card-${short.id}`);
await linked.waitFor({ state: 'visible', timeout: 15000 });
check(
  await linked.isVisible(),
  'a link with the autopilot id (#/autopilot/run?ws=…&id=…) opens its card',
);

// Phone width.
await page.setViewportSize({ width: 390, height: 900 });
await page.waitForTimeout(500);
const wide = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth + 1,
);
check(!wide, 'no horizontal scroll at phone width');
await page.screenshot({ path: join(out, '03-phone.png') });
check(errors.length === 0, `no console errors (${errors.join(' | ')})`);
await browser.close();
