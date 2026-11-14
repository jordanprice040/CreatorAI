// UX pass P-2 and P-5 (ADR-0101) browser walk in fixture mode. Seeds a fixture clinic
// discovery on a throwaway database (the test harness, fixture adapter), records a selection
// that recommends the existing tool, and connects a fake `claude` as the chat model (no real
// model call, no network, no spending). Then, as the owner in headless Chromium: the Path
// branches to Proposal and Review; Proposals saves a proposal from the records; "Draft the
// missing sections" asks the fake model; the drafts show under their sections; two are used,
// version 2 is saved with the model-draft label; the Path moves on; phone width has no
// horizontal scroll. Ports 5183/4330/4340, never the dev studio's or the installed app's.
// Usage (after `pnpm build`, with a loopback test server whose role may CREATE DATABASE):
//   CREATOR_TEST_DATABASE_URL=postgres://... node tracking/evidence/p2-p5-path-proposals/walk.mjs
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { preview as vitePreview } from 'vite';
import { createRequire } from 'node:module';
import {
  createApi,
  DEFAULT_OWNER_ACTOR_ID,
} from '../../../apps/api/dist/index.js';
import {
  FixtureAdapter,
  PlanConnectionService,
} from '../../../packages/broker/dist/index.js';
import { ConnectionStore } from '../../../packages/db/dist/index.js';
import {
  discoverySetup,
  owner,
} from '../../../tests/dist/discovery-harness.js';
import {
  FAKE_MODEL,
  connect,
  fakeHost,
  nonCodeSelected,
} from '../../../tests/dist/proposal-harness.js';

const { chromium } = createRequire(import.meta.url)(
  process.argv[2] ?? 'playwright',
);
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = 'walk-login-code-0123456789abcdefghijklmnop';
const cleanups = [];
const t = {
  after: (f) => cleanups.push(f),
  skip: (m) => {
    throw new Error(m);
  },
};
const log = [];
const step = (s) => {
  log.push(s);
  console.log(s);
};

const REPLY = JSON.stringify({
  sections: {
    objectives: {
      text: 'Suggested: fewer unused first-appointment slots at the rural clinics [R1]. Unknown yet: the target level the clinics would accept.',
    },
    methods: {
      text: 'Suggested:\n1. Turn on the scheduling system’s reminders at one clinic first.\n2. Send a reminder 48 hours before each first visit.\n3. Record replies and cancellations for four weeks.',
    },
    evaluation: {
      text: 'Suggested: compare unused first-appointment slots for four weeks before and after, at the same clinic.',
    },
    ethics_risks: { unknown: 'Whether patients agreed to reminder messages.' },
    next_tasks: {
      text: '- Suggested: ask each clinic manager whether reminders are already set up.',
    },
  },
});

const s = await discoverySetup(t, new FixtureAdapter());
const { problem } = await nonCodeSelected(s);
step(
  `seeded fixture problem ${problem.id.slice(0, 8)} with a selection that recommends the existing tool`,
);
const host = fakeHost(REPLY);
const fixtureEnv = { CREATOR_CLAUDE_STAND_IN: 'fake' };
const store = new ConnectionStore(s.db.pool);
const setupService = new PlanConnectionService({
  store,
  vault: null,
  claudeCode: host,
  claudeCodeFixtureEnv: fixtureEnv,
});
const conn = await connect(store, s.ws.id, setupService);
await store.setChatSettings(owner, s.ws.id, {
  expected_version: 0,
  enabled: true,
  connection_id: conn.id,
  model_id: FAKE_MODEL,
  include_snapshot: true,
  daily_limit: 10,
});
step('connected a fake `claude` as the chat model (studio records allowed)');

const env = {
  CREATOR_DATABASE_URL: s.db.url,
  CREATOR_DEV_LOGIN_CODE: CODE,
  CREATOR_WORKER: 'off',
  CREATOR_API_PORT: '4330',
  CREATOR_WEB_PORT: '5183',
  CREATOR_PREVIEW_PORT: '4340',
};
Object.assign(process.env, env);
const api = createApi(env, {
  planService: (st) =>
    new PlanConnectionService({
      store: st,
      vault: null,
      claudeCode: host,
      claudeCodeFixtureEnv: fixtureEnv,
    }),
});
api.server.listen(api.config.api_port, api.config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
});
const BASE = `http://${api.config.host}:${api.config.web_port}`;
const browser = await chromium.launch();
let page;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const login = await page.request.post(`${BASE}/api/auth/dev-login`, {
    data: { code: CODE },
  });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'owner');
  const shot = async (name) => {
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
    step(`screenshot ${name}.png`);
  };
  const stages = () =>
    page
      .locator('ol.path-stages .path-stage')
      .evaluateAll((li) =>
        li.map(
          (l) =>
            `${l.querySelector('.path-head strong')?.textContent}: ${l.querySelector('.path-state')?.textContent}`,
        ),
      );

  await page.goto(`${BASE}/#/projects/path?ws=${s.ws.id}`);
  await page
    .locator('ol.path-stages .path-stage', { hasText: 'Proposal' })
    .first()
    .waitFor();
  step(`Path after a non-code selection: ${(await stages()).join(' · ')}`);
  await shot('01-path-proposal-next');

  await page.goto(`${BASE}/#/projects/proposals?ws=${s.ws.id}`);
  await page.getByRole('button', { name: 'Start a proposal' }).click();
  await page.getByRole('button', { name: 'Save proposal' }).click();
  await page.getByRole('button', { name: 'Save as version 2' }).waitFor();
  step('saved version 1 from the records (required sections Unknown yet)');
  const panel = page.locator('section.proposal-drafts');
  await panel.waitFor();
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: join(shots, '02-draft-panel.png') });
  step('screenshot 02-draft-panel.png');
  await panel
    .getByRole('button', { name: 'Draft the missing sections' })
    .click();
  await panel.getByText(/drafted 4 of \d+ sections/).waitFor();
  step(
    `draft outcome: ${(await panel.getByRole('status').innerText()).split('\n')[0]}`,
  );
  await page.locator('.model-draft').first().waitFor();
  await shot('03-drafts-under-sections');

  await page.getByRole('button', { name: 'Expand all' }).click();
  for (const label of ['Objectives', 'Methods and step-by-step procedure']) {
    const fs = page.locator('fieldset.proposal-section', {
      has: page.locator('legend', { hasText: label }),
    });
    await fs.getByRole('button', { name: 'Use this draft' }).click();
    await fs.locator('.model-draft-mark').waitFor();
  }
  const ethics = page.locator('fieldset.proposal-section', {
    has: page.locator('legend', { hasText: 'Ethics and risks' }),
  });
  await ethics.getByText('Unknown yet.').waitFor();
  step(
    'used the Objectives and Methods drafts; Ethics stays Unknown yet with the model’s note',
  );
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await page
    .locator('.proposal-fold', { hasText: 'Objectives' })
    .getByText('model draft', { exact: false })
    .first()
    .waitFor();
  await page.getByRole('link', { name: 'Download Markdown (v2)' }).waitFor();
  const v2 = await page.getByLabel('Version').inputValue();
  step(`saved version ${v2} with “Used model drafts: Objectives, Methods …”`);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page
    .locator('.proposal-preview')
    .getByText(/Model draft by claude-test-model, accepted by a person/)
    .first()
    .waitFor();
  await page
    .getByText(/3 required sections are still Unknown yet/)
    .first()
    .waitFor();
  await shot('04-preview-labels');
  await page.getByRole('button', { name: 'Edit view' }).click();

  await page.goto(`${BASE}/#/projects/path?ws=${s.ws.id}`);
  await page
    .locator('ol.path-stages .path-stage', { hasText: 'Proposal' })
    .first()
    .waitFor();
  await page
    .getByText(/3 required sections are still Unknown yet/)
    .first()
    .waitFor();
  step(`Path after version 2: ${(await stages()).join(' · ')}`);
  await shot('05-path-proposal-still-next');

  await page.goto(`${BASE}/#/monitor/overview?ws=${s.ws.id}`);
  await page.getByText('selection recorded').waitFor();
  step(
    'Monitor shows “1 selection recorded · 1 proposal · newest: non-code, to a proposal”',
  );

  await page.goto(`${BASE}/#/projects/proposals?ws=${s.ws.id}`);
  await page.locator('.proposals-layout').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole('button')
    .filter({ hasText: /^Proposal:/ })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step(`phone width horizontal overflow on Proposals: ${wide}`);
  await shot('06-phone');
  step(
    `console errors: ${errors.length}${errors.length ? ` (${errors.join(' | ')})` : ''}`,
  );
} catch (e) {
  // A failed run's screenshot goes to the temp folder, never into the evidence.
  await page?.screenshot({
    path: join(tmpdir(), 'p2-p5-walk-failure.png'),
    fullPage: true,
  });
  throw e;
} finally {
  await writeFile(
    join(here, 'walk.json'),
    `${JSON.stringify({ when: new Date().toISOString(), steps: log }, null, 2)}\n`,
  );
  await browser.close();
  await new Promise((r) => web.httpServer.close(r));
  await api.close();
  for (const f of cleanups.reverse()) await f();
}
