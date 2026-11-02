// Activity dots browser walk, against serve.mjs (throwaway database, ports 5183/4330/4340, a
// FAKE `claude` behind a fixture Claude Code connection; no real model). Checks: a fresh studio
// shows no dots; an approval asked for while the person is in Chat puts a dot on Monitor and on
// its Approvals tab, which clears when Approvals is opened; a Chat reply that comes back while
// the person is on another page puts a dot on Chat, which clears when Chat is opened; nothing
// comes back after a reload; switching to a never-opened workspace shows no dots (review M-1);
// two windows do not undo each other's clearing (review L-1). Screenshots in dark and light.
// Usage: CREATOR_DATABASE_URL=… node tracking/evidence/activity-dots/walk.mjs <ws> <run> [base]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OWNER_ACTOR_ID } from '../../../apps/api/dist/index.js';
import { ConnectionStore } from '../../../packages/db/dist/index.js';

const [, , wsId, runId, base = 'http://127.0.0.1:5183'] = process.argv;
if (!wsId || !runId) throw new Error('workspace and run ids required');
const code = 'walk-login-code-0123456789abcdefghijkl';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright',
);
const pg = createRequire(
  new URL('../../../packages/db/package.json', import.meta.url),
)('pg');
const url = process.env.CREATOR_DATABASE_URL;
if (!url || !/throwaway|walk/.test(url))
  throw new Error('Use a throwaway database whose name contains "walk".');
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const out = [];
const log = (k, v) => {
  out.push({ check: k, result: v });
  console.log(k, JSON.stringify(v));
};

const pool = new pg.Pool({ connectionString: url });
const store = new ConnectionStore(pool);
const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 860 },
  colorScheme: 'dark',
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', { timeout: 15000 });
await p.evaluate(() => localStorage.setItem('creator-agent.theme', 'dark'));
await p.goto(`${base}/#/chat/conversations?ws=${wsId}`);
await p.reload();
await p.waitForSelector('#chat-title');

/** Every activity dot on screen: where it sits and what it says. */
const dots = () =>
  p.$$eval('.activity-dot', (ds) =>
    ds.map((d) => ({
      where: d.closest('nav')?.getAttribute('aria-label'),
      on: d.closest('a')?.childNodes[0]?.textContent,
      says: d.getAttribute('title'),
    })),
  );
const navLink = (label) =>
  p.locator('nav[aria-label="Pages"] a', { hasText: label });

await p.waitForTimeout(1500);
log('fresh studio: dots', await dots());

// An approval is asked for while the person is in Chat (written straight to the throwaway
// database, standing in for an agent). The next 15-second read shows it.
await store.requestDecision(owner, wsId, runId, {
  kind: 'clarification',
  reason: 'material_assumption',
  task_id: null,
  question: 'Which practice mode should the timer start with?',
  evidence_refs: [],
  uncertainty: 'Two modes were discussed.',
  consequence_if_wrong: 'The first build practises the wrong thing.',
  options: [
    { id: 'rhythm', label: 'Rhythm', consequence: 'Starts with rhythm.' },
    { id: 'combo', label: 'Combo', consequence: 'Starts with combos.' },
  ],
  recommendation: null,
  recommendation_reason: null,
  blocked_work: [],
  unblocked_work: [],
  action: null,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});
await p.waitForSelector(
  'nav[aria-label="Pages"] .activity-dot[title*="approval"]',
  { timeout: 25000 },
);
log('approval asked while in Chat: dots', await dots());
await p.screenshot({ path: join(shots, 'sidebar-approval-dot-dark.png') });

await navLink('Monitor').click();
await p.waitForSelector('.page-tabs');
await p.waitForTimeout(300);
log('Monitor opened (Overview tab): dots', await dots());
await p.screenshot({ path: join(shots, 'monitor-tab-dot-dark.png') });
log(
  'Monitor opened: sidebar Monitor dot hidden',
  !(await dots()).some((d) => d.where === 'Pages' && d.on === 'Monitor'),
);
await p.locator('.page-tabs a', { hasText: 'Approvals' }).click();
await p.waitForTimeout(800);
log('Approvals opened: dots', await dots());

// A Chat reply that comes back while the person is elsewhere. The fake answers at once, so the
// walk holds the answer response for 4 s to give time to leave Chat.
await p.route('**/answer', async (route) => {
  const response = await route.fetch();
  await new Promise((r) => setTimeout(r, 4000));
  await route.fulfill({ response });
});
await navLink('Chat').click();
await p.waitForSelector('#chat-title');
await p.fill(
  '#chat-input',
  'Thinking about a practice timer for rhythm games.',
);
await p.keyboard.press('Enter');
await p.waitForSelector('.chat-turn');
await p.waitForTimeout(500);
await navLink('Projects').click();
await p.waitForTimeout(500);
log('left Chat before the reply: dots', await dots());
await p.waitForSelector(
  'nav[aria-label="Pages"] .activity-dot[title*="answer or error"]',
  { timeout: 20000 },
);
log('reply came back while on Projects: dots', await dots());
await p.screenshot({ path: join(shots, 'sidebar-chat-dot-dark.png') });
await navLink('Chat').click();
await p.waitForSelector('.chat-model-completed', { timeout: 10000 });
log('Chat opened: dots', await dots());
await p.unroute('**/answer');

// A reply that comes back while Chat is open is seen already.
await p.fill('#chat-input', 'Also considering a metronome mode later.');
await p.keyboard.press('Enter');
await p.waitForFunction(
  () => document.querySelectorAll('.chat-model-completed').length >= 2,
  null,
  { timeout: 20000 },
);
await p.waitForTimeout(500);
log('reply while in Chat: dots', await dots());

// Reload: what was seen stays seen.
await p.reload();
await p.waitForSelector('#chat-title');
await p.waitForTimeout(2500);
log('after reload: dots', await dots());

// Light theme: a second approval, seen from Projects.
await p.evaluate(() => localStorage.setItem('creator-agent.theme', 'light'));
await p.reload();
await navLink('Projects').click();
await store.requestDecision(owner, wsId, runId, {
  kind: 'clarification',
  reason: 'material_assumption',
  task_id: null,
  question: 'Should the timer keep a history of sessions?',
  evidence_refs: [],
  uncertainty: 'Unclear whether history is wanted.',
  consequence_if_wrong: 'Extra work or a missing feature.',
  options: [
    { id: 'yes', label: 'Keep history', consequence: 'Sessions are saved.' },
    { id: 'no', label: 'No history', consequence: 'Nothing is saved.' },
  ],
  recommendation: null,
  recommendation_reason: null,
  blocked_work: [],
  unblocked_work: [],
  action: null,
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
});
await p.waitForSelector(
  'nav[aria-label="Pages"] .activity-dot[title*="approval"]',
  { timeout: 25000 },
);
await navLink('Monitor').click();
await p.waitForSelector('.page-tabs');
await p.waitForTimeout(300);
log('light: Monitor opened: dots', await dots());
await p.screenshot({ path: join(shots, 'monitor-tab-dot-light.png') });

// Review M-1: switching to a workspace never opened here shows no dots, also after a reload.
const ask = (question) =>
  store.requestDecision(owner, wsId, runId, {
    kind: 'clarification',
    reason: 'material_assumption',
    task_id: null,
    question,
    evidence_refs: [],
    uncertainty: 'Walk check.',
    consequence_if_wrong: 'None; synthetic.',
    options: [
      { id: 'a', label: 'A', consequence: 'A.' },
      { id: 'b', label: 'B', consequence: 'B.' },
    ],
    recommendation: null,
    recommendation_reason: null,
    blocked_work: [],
    unblocked_work: [],
    action: null,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
const other = await store.createWorkspace(owner, {
  name: 'Empty walk workspace',
  record_mode: 'fixture',
});
await p.locator('.page-tabs a', { hasText: 'Approvals' }).click();
await p.waitForTimeout(800);
await p.evaluate(
  (id) => (location.hash = `#/monitor/overview?ws=${id}`),
  other.id,
);
await p.waitForTimeout(3000);
log('switched to a never-opened empty workspace: dots', await dots());
log(
  'switched: stored seen for the new workspace',
  await p.evaluate(
    (id) => JSON.parse(localStorage.getItem('creator.activity-seen'))[id],
    other.id,
  ),
);
await p.reload();
await p.waitForSelector('nav[aria-label="Pages"]');
await p.waitForTimeout(2500);
log('new workspace after reload: dots', await dots());

// Review L-1: two windows. An approval shows in both; clearing it in one clears the other,
// and the other's later writes do not bring it back.
await p.goto(`${base}/#/chat/conversations?ws=${wsId}`);
await p.waitForSelector('#chat-title');
const q = await ctx.newPage();
await q.setViewportSize({ width: 1280, height: 860 });
await q.goto(`${base}/#/projects/path?ws=${wsId}`);
await q.waitForSelector('nav[aria-label="Pages"]');
await p.waitForTimeout(1500);
await ask('Two windows: which one clears it?');
const approvalDot = 'nav[aria-label="Pages"] .activity-dot[title*="approval"]';
await p.waitForSelector(approvalDot, { timeout: 25000 });
await q.waitForSelector(approvalDot, { timeout: 25000 });
log('two windows: both show the approval dot', true);
await navLink('Monitor').click();
await p.locator('.page-tabs a', { hasText: 'Approvals' }).click();
await p.waitForTimeout(800);
await navLink('Chat').click();
await q.waitForSelector(approvalDot, { state: 'detached', timeout: 5000 });
log('two windows: cleared in one, gone in the other', true);
// The second window takes in another tab (Sources visit → its own write), then the first reloads.
await q.locator('nav[aria-label="Pages"] a', { hasText: 'Monitor' }).click();
await q.waitForTimeout(800);
await q.locator('.page-tabs a', { hasText: 'Runs' }).click();
await q.waitForTimeout(800);
await p.reload();
await p.waitForSelector('#chat-title');
await p.waitForTimeout(2500);
log('two windows: first window after reload: dots', await dots());
await q.close();

log('console errors', errors);
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2) + '\n');
await browser.close();
await pool.end();
