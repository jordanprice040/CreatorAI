// N2 notification toasts (ADR-0130), checked in the real studio. Throwaway database, review
// ports, fixture provider only, $0, no model call. Start ../owner-actions/stack.mjs first, then
// (from the repo root):
//   node tracking/evidence/notification-toasts/walk.mjs <database-url> <out-dir>
// Opens the studio, then starts an autopilot through the API (the fixture stops it at a tie):
// one toast, the bell, Open landing on the autopilot's card. Then Send test, two windows racing
// for one toast, a hidden window getting no late toast (12d), the history page, Settings, and
// phone width. Nothing ever calls the browser's Notification API.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = await mkdtemp(join(tmpdir(), 'notification-toasts-'));
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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
// Count any use of the browser's own notifications (there must be none).
await ctx.addInitScript(() => {
  window.__webNotifications = 0;
  window.Notification = class {
    constructor() {
      window.__webNotifications++;
    }
    static requestPermission() {
      window.__webNotifications++;
      return Promise.resolve('denied');
    }
  };
});
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
};
const page = await ctx.newPage();
watch(page);
await page.goto(`${WEB}/#/chat/conversations?ws=${ws}`);
const bell = page.locator('summary.bell-summary');
await bell.waitFor();
check(true, 'the bell is in the top bar');
// Let the first poll record what was already waiting (nothing should be shown late).
await sleep(2000);

// 1. An autopilot stops while the window is visible: one toast, linking to its card.
const ap = await startOne(config, 'Walk run A');
const toast = page.locator('.toasts .toast');
await toast.first().waitFor({ timeout: 40_000 });
const text = await toast.first().innerText();
check(
  /Autopilot stopped/.test(text),
  `a toast names the stop ("${text.split('\n')[0]}")`,
);
check((await toast.count()) === 1, 'one toast for one stop');
await page.screenshot({ path: `${out}/01-toast.png` });
const rows = await get('notifications?unread=1');
const stop = rows.items.find((n) => n.subject_id === ap.id);
check(stop?.interrupted_via === 'toast', 'the row was claimed for the toast');
check(
  /^Notifications, \d+ unread$/.test(
    (await bell.getAttribute('aria-label')) ?? '',
  ),
  'the bell counts unread',
);
await toast.first().getByRole('button', { name: 'Open' }).click();
await page.waitForFunction(
  (id) =>
    location.hash.startsWith('#/autopilot/run') && location.hash.includes(id),
  ap.id,
);
await page.locator(`#autopilot-card-${ap.id}`).waitFor({ timeout: 15000 });
check(true, "Open lands on the stopped autopilot's card");
check((await toast.count()) === 0, 'the toast closes when opened');
check(
  (await get('notifications')).items.find((n) => n.subject_id === ap.id)
    ?.read_at !== null,
  'opening marks it read',
);
check(
  (await page
    .getByText("You'll be notified when an autopilot stops")
    .count()) === 1,
  'the Autopilot page says where stop alerts are set',
);

// 2. Settings › Notifications and Send test.
await page.goto(`${WEB}/#/settings/notifications?ws=${ws}`);
await page.getByRole('heading', { name: 'Notifications', level: 2 }).waitFor();
await page.screenshot({ path: `${out}/02-settings.png`, fullPage: true });
await page.getByRole('button', { name: 'Send test' }).click();
await page
  .locator('.toasts .toast', { hasText: 'Test notification' })
  .waitFor({ timeout: 5000 });
check(true, 'Send test shows a toast at once');

// 3. The bell panel.
await bell.click();
await page.locator('.bell-panel .notification-row').first().waitFor();
await page.screenshot({ path: `${out}/03-bell.png` });
check(
  (await page.locator('.bell-panel .notification-row').count()) >= 2,
  'the bell lists the stop and the test',
);
await page.getByRole('button', { name: 'View all' }).click();
await page.getByRole('heading', { name: 'Notifications', level: 2 }).waitFor();
check(
  page.url().includes('#/monitor/notifications'),
  'View all opens Monitor › Notifications',
);
await page
  .locator('main .notification-list .notification-row')
  .first()
  .waitFor();
await page.screenshot({ path: `${out}/04-history.png`, fullPage: true });

// 4. Two visible windows race for one row: exactly one shows it (check 6).
const other = await ctx.newPage();
watch(other);
await other.goto(`${WEB}/#/chat/conversations?ws=${ws}`);
await other.locator('summary.bell-summary').waitFor();
await sleep(2500);
await sleep(10_500); // past the test button's ten-second repeat window
// Count every toast each window adds from now on (an info toast leaves after 8 s).
const counter = () => {
  window.__toastsAdded = 0;
  new MutationObserver((ms) => {
    for (const m of ms)
      for (const n of m.addedNodes)
        if (
          n instanceof Element &&
          (n.matches('.toast') || n.querySelector('.toast'))
        )
          window.__toastsAdded += n.matches('.toast')
            ? 1
            : n.querySelectorAll('.toast').length;
  }).observe(document.body, { childList: true, subtree: true });
};
await page.evaluate(counter);
await other.evaluate(counter);
const raced = await post('notifications/test', {});
await sleep(17_000); // one full poll in each window
const shown =
  (await page.evaluate(() => window.__toastsAdded)) +
  (await other.evaluate(() => window.__toastsAdded));
check(shown === 1, `two windows, one toast (${shown})`);
check(
  (await get('notifications')).items.find((n) => n.id === raced.id)
    ?.interrupted_via === 'toast',
  'the raced row was claimed once, for a toast',
);
await other.close();

// 5. 12d: a hidden window gets no late toast when shown again; the row stays in the bell.
const hide = (hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => h,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (h ? 'hidden' : 'visible'),
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
await page.evaluate(() =>
  document.querySelectorAll('.toast-close').forEach((b) => b.click()),
);
await hide(true);
await sleep(10_500);
const late = await post('notifications/test', {});
await sleep(1000);
await hide(false);
await sleep(17_000);
check(
  (await page.locator('.toasts .toast').count()) === 0,
  'no catch-up toast for an item that arrived while hidden',
);
const lateRow = (await get('notifications')).items.find(
  (n) => n.id === late.id,
);
check(
  lateRow?.interrupt_state === 'pending' && lateRow.read_at === null,
  'it waits in the bell, unclaimed (it expires after ten minutes)',
);

// 6. Phone width, and no browser notifications anywhere.
await page.setViewportSize({ width: 390, height: 800 });
await page.goto(`${WEB}/#/settings/notifications?ws=${ws}`);
await page.getByRole('heading', { name: 'Notifications', level: 2 }).waitFor();
await page.locator('summary.bell-summary').click();
await page.locator('.bell-panel').waitFor();
await page.screenshot({ path: `${out}/05-phone.png` });
const wide = await page.evaluate(() => document.documentElement.scrollWidth);
check(wide <= 390, `no sideways scroll at 390 px (${wide})`);
check(
  (await page.evaluate(() => window.__webNotifications)) === 0,
  'the browser Notification API is never used',
);
check(
  errors.length === 0,
  `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`,
);
await browser.close();
