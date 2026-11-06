// P09 (ADR-0077) browser walk in fixture mode: "Why this response" on Decide and the Proposals
// tab. Seeds a fixture clinic discovery on a throwaway database (the test harness, fixture
// adapter, no model or network call), scores it, records a selection that recommends the
// existing tool, then drives headless Chromium as the owner: read the explanation, start a
// proposal from the records, save it, fill the core sections, save version 2, preview, review
// and download the Markdown. Nothing here is a live provider call.
// Usage (after `pnpm build`, with a loopback test server whose role may CREATE DATABASE):
//   CREATOR_TEST_DATABASE_URL=postgres://... node tracking/evidence/proposals-ui/walk.mjs
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview as vitePreview } from 'vite';
import { createRequire } from 'node:module';
import {
  createApi,
  DEFAULT_OWNER_ACTOR_ID,
} from '../../../apps/api/dist/index.js';
import { FixtureAdapter } from '../../../packages/broker/dist/index.js';
import {
  DISCOVERY_SCENARIOS,
  fixtureHumilityReview,
  fixtureScorecards,
} from '../../../packages/domain/dist/index.js';
import {
  discoverySetup,
  owner,
} from '../../../tests/dist/discovery-harness.js';

// Playwright comes from the machine (NODE_PATH) or the path given as the first argument.
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

const s = await discoverySetup(t, new FixtureAdapter());
const scenario = DISCOVERY_SCENARIOS.find((x) => x.key === 'software');
const { detail, runId, seeded } = await s.discover(scenario);
const problem = detail.workflow.result.discovery.catalog_records.problem;
const evidence = seeded.evidence.map((e) => ({ id: e.claim_id, version: 1 }));
const first = await s.store.selectionReport(owner, s.ws.id, problem.id);
const alts = first.suitability.candidates.map((c) => c.alternative);
for (const card of fixtureScorecards(alts, evidence))
  await s.store.recordScorecard(owner, s.ws.id, card);
const build = alts.find((a) => a.kind === 'build');
await s.store.createEntity(owner, s.ws.id, {
  kind: 'humility_review',
  title: 'Humility review: no-show flags',
  body: fixtureHumilityReview(
    { id: build.id, version: build.version },
    evidence,
  ),
});
const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
const req = {
  problem: { id: report.problem.id, version: report.problem.version },
  report_hash: report.report_hash,
  dispositions: report.suitability.candidates.map((c) => {
    const alternative = {
      id: c.alternative.id,
      version: c.alternative.version,
    };
    const k = c.alternative.kind;
    if (k === 'use_existing')
      return {
        alternative,
        disposition: 'recommend_alternative',
        reasons: ['Highest suitability; reminders can be turned on now.'],
        reverse_if: 'Reminders are already configured at every clinic.',
      };
    if (k === 'build' || k === 'hybrid')
      return {
        alternative,
        disposition: 'research_further',
        reasons: ['Not preferable to the existing tool yet.'],
        reverse_if: 'Prediction quality is shown on clinic data.',
      };
    if (k === 'human_led')
      return {
        alternative,
        disposition: 'defer',
        reasons: ['No coordinator time this quarter.'],
        reverse_if: 'A coordinator is funded.',
      };
    return {
      alternative,
      disposition: 'reject',
      reasons: ['Lower suitability.'],
      reverse_if: 'It proves distinct.',
    };
  }),
  override_reason:
    'The reminder tool fits better now; the build waits for evidence (walk).',
  rationale: 'Recommend the existing reminder tool; no new software now.',
  shortlist_size: 3,
  data_class: 'synthetic',
};
let out = await s.store.select(owner, s.ws.id, runId, req);
if (out.status === 'needs_human') {
  const d = await s.store.getDecision(
    owner,
    s.ws.id,
    out.admission.decision_id,
  );
  await s.store.answerDecision(owner, s.ws.id, d.id, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Approved (walk).',
    coverage_hash: d.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: null,
    interruption: null,
  });
  out = await s.store.select(owner, s.ws.id, runId, req);
}
if (out.status !== 'recorded') throw new Error(out.admission.explanation);
step(
  `seeded fixture problem ${problem.id.slice(0, 8)}, selection ${out.selection.id.slice(0, 8)} recommends the existing tool`,
);

const env = {
  CREATOR_DATABASE_URL: s.db.url,
  CREATOR_DEV_LOGIN_CODE: CODE,
  CREATOR_WORKER: 'off',
  CREATOR_API_PORT: '4330',
  CREATOR_WEB_PORT: '5183',
  CREATOR_PREVIEW_PORT: '4340',
};
Object.assign(process.env, env);
const api = createApi(env);
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
  const login = await page.request.post(`${BASE}/api/auth/dev-login`, {
    data: { code: CODE },
  });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'owner');
  const shot = async (name) => {
    await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
    step(`screenshot ${name}.png`);
  };

  await page.goto(`${BASE}/#/projects/decide?ws=${s.ws.id}&id=${problem.id}`);
  const why = page.getByRole('region', { name: 'Why this response' });
  await why.waitFor();
  await why
    .getByText('The recorded selection advances an existing tool')
    .waitFor();
  await why.locator('summary').first().click();
  await why.scrollIntoViewIfNeeded();
  await why.screenshot({ path: join(shots, '01-why-this-response.png') });
  step(
    'Decide shows "Why this response" with the software routes and what would make them preferable',
  );

  await why.getByRole('button', { name: 'Write a proposal' }).click();
  await page.getByRole('heading', { name: 'Proposals', level: 2 }).waitFor();
  await page.getByRole('button', { name: 'Start a proposal' }).click();
  await page
    .getByRole('heading', { name: 'New proposal (not saved yet)' })
    .waitFor();
  await shot('02-new-draft');
  await page.getByRole('button', { name: 'Save proposal' }).click();
  await page.getByRole('button', { name: 'Save as version 2' }).waitFor();
  await page.getByText('Not complete yet').waitFor();
  step('saved version 1 (drafted from records; core sections marked unknown)');

  for (const [label, text] of [
    [
      'Objectives',
      'Cut unused first-appointment slots by a quarter within two months.',
    ],
    [
      'Methods and step-by-step procedure',
      '1. Turn on reminders at each clinic.\n2. Send a reminder 48 hours before each first visit.\n3. Log replies.',
    ],
    [
      'Testing and evaluation criteria',
      'Compare unused slots for four weeks before and after.',
    ],
    [
      'Ethics and risks',
      'Reminders use existing contact consent; staff keep every booking decision.',
    ],
    ['Next tasks', '- Confirm reminder settings with each clinic.'],
  ]) {
    const fs = page.locator('fieldset.proposal-section', {
      has: page.locator('legend', { hasText: label }),
    });
    await fs.getByRole('combobox').selectOption('written');
    await fs.getByRole('textbox').fill(text);
  }
  await page
    .getByPlaceholder('e.g. Answered review feedback on costs')
    .fill('Filled the core sections');
  await page.getByRole('button', { name: 'Save as version 2' }).click();
  await page.getByText('Ready for review').waitFor();
  await shot('03-version-2-ready');
  step('saved version 2: checks say "Ready for review"');

  await page.getByRole('button', { name: 'Preview' }).click();
  await page.getByRole('heading', { name: 'References', level: 3 }).waitFor();
  await shot('04-preview');
  await page.getByRole('button', { name: 'Edit view' }).click();

  const form = page.locator('form.proposal-review-form');
  await form.getByLabel('Needs revision').check();
  await form
    .getByRole('combobox', { name: 'Feasible as described' })
    .selectOption('concern');
  await form
    .getByRole('textbox')
    .fill('Add a cost range for the reminder service.');
  await form.getByRole('button', { name: 'Save review' }).click();
  await page.locator('.proposal-reviews li', { hasText: 'Revise' }).waitFor();
  await shot('05-review');
  step('review saved against version 2');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Download Markdown/ }).click(),
  ]);
  const md = join(here, 'screens', download.suggestedFilename());
  await download.saveAs(md);
  step(`downloaded ${download.suggestedFilename()}`);
  await page.getByRole('button', { name: /Save v2 to Files/ }).click();
  await page.getByText(/Saved to Files as/).waitFor();
  step('saved the v2 export to Files');

  // Narrow screen: no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step(`phone width horizontal overflow: ${wide}`);
  await shot('06-phone');
} catch (e) {
  await page?.screenshot({ path: join(shots, 'failure.png'), fullPage: true });
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
