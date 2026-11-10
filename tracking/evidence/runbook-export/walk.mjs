// P16 (ADR-0080) browser walk in fixture mode: export a runbook from a frozen spec on Build and
// from a non-code proposal on Proposals. Seeds a fixture clinic discovery on a throwaway
// database (the test harness, fixture adapter, no model or network call), records a selection
// that builds one option and recommends another, writes and freezes the synthetic word-tally
// spec and saves a proposal, then drives headless Chromium as the owner. Each downloaded
// archive is unpacked and checked with validateRunbook. Nothing here is a live provider call.
// Usage (after `pnpm build`, with a loopback test server whose role may CREATE DATABASE):
//   CREATOR_TEST_DATABASE_URL=postgres://... node tracking/evidence/runbook-export/walk.mjs
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  RUNBOOK_FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  readZip,
  validateRunbook,
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
// The commit the walked code was built from; "+changes" when the tree was not clean.
const git = (...a) =>
  execFileSync('git', a, { cwd: here, encoding: 'utf8' }).trim();
const commit = `${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--', ':/apps', ':/packages') ? '+changes' : ''}`;
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
const tool = alts.find((a) => a.kind === 'use_existing');
await s.store.createEntity(owner, s.ws.id, {
  kind: 'humility_review',
  title: 'Humility review: no-show flags',
  body: fixtureHumilityReview(
    { id: build.id, version: build.version },
    evidence,
  ),
});
const approve = async (decisionId) => {
  const d = await s.store.getDecision(owner, s.ws.id, decisionId);
  await s.store.answerDecision(owner, s.ws.id, decisionId, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Approved (walk).',
    coverage_hash: d.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: null,
    interruption: null,
  });
};
const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
const req = {
  problem: { id: report.problem.id, version: report.problem.version },
  report_hash: report.report_hash,
  dispositions: fixtureDispositions(report),
  override_reason:
    'Reminders are recommended too; no coordinator is funded this quarter (walk).',
  rationale: 'Build the tool; turn on reminders meanwhile (walk).',
  shortlist_size: 3,
  data_class: 'synthetic',
};
let out = await s.store.select(owner, s.ws.id, runId, req);
if (out.status === 'needs_human') {
  await approve(out.admission.decision_id);
  out = await s.store.select(owner, s.ws.id, runId, req);
}
if (out.status !== 'recorded') throw new Error(out.admission.explanation);
const spec = await s.store.createSpec(owner, s.ws.id, {
  selection_id: out.selection.id,
  alternative: { id: build.id, version: build.version },
  title: 'Word tally (synthetic)',
  content: RUNBOOK_FIXTURE_SPEC,
});
const freezeReq = {
  spec: { id: spec.spec.id, version: 1 },
  justification: 'Freeze for the runbook walk.',
  data_class: 'synthetic',
};
let frozen = await s.store.freezeSpec(owner, s.ws.id, runId, freezeReq);
if (frozen.status === 'needs_human') {
  await approve(frozen.admission.decision_id);
  frozen = await s.store.freezeSpec(owner, s.ws.id, runId, freezeReq);
}
if (frozen.status !== 'frozen') throw new Error(frozen.admission.explanation);
const draft = await s.store.proposalDraft(owner, s.ws.id, tool.id);
const proposal = await s.store.createProposal(owner, s.ws.id, {
  title: draft.title,
  body: draft.body,
});
step(
  `seeded a frozen synthetic spec ${spec.spec.id.slice(0, 8)} and a non-code proposal ${proposal.proposal.id.slice(0, 8)}`,
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
/** Downloads through the panel's link and checks the archive from its bytes alone. */
const downloadAndCheck = async (panel, kind) => {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('link', { name: /^Download .*-runbook-v1\.zip$/ }).click(),
  ]);
  const file = join(shots, download.suggestedFilename());
  await download.saveAs(file);
  const files = readZip(await readFile(file));
  const problems = validateRunbook(files);
  if (problems.length) throw new Error(problems.join(' '));
  const manifest = JSON.parse(
    files.find((f) => f.path === 'manifest.json').content.toString('utf8'),
  );
  if (manifest.kind !== kind) throw new Error(`expected a ${kind} runbook`);
  step(
    `downloaded ${download.suggestedFilename()}: ${files.length} files, ${manifest.prompts.length} prompts, validates from its bytes alone (bundle hash ${manifest.bundle_hash.slice(0, 12)})`,
  );
  return manifest;
};
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    acceptDownloads: true,
  });
  page = await ctx.newPage();
  const login = await page.request.post(`${BASE}/api/auth/dev-login`, {
    data: { code: CODE },
  });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'owner');
  const shot = async (name, target = page) => {
    await target.screenshot({ path: join(shots, `${name}.png`) });
    step(`screenshot ${name}.png`);
  };

  await page.goto(`${BASE}/#/projects/build?ws=${s.ws.id}`);
  await page.getByRole('heading', { name: 'Build and package' }).waitFor();
  const row = page.locator('ul.rows > li', {
    hasText: 'Word tally (synthetic)',
  });
  await row.getByText('frozen').first().waitFor();
  await row
    .getByRole('button', { name: 'Export a runbook for another model' })
    .click();
  const panel = row.getByRole('group', { name: 'Runbook' });
  await panel.getByText(/6 ordered prompts and \d+ files/).waitFor();
  await panel.getByText(/from the frozen requirements/).waitFor();
  await panel
    .getByText(/2 held-out test cases left out for you to run/)
    .waitFor();
  await row.scrollIntoViewIfNeeded();
  await shot('01-build-spec-runbook', row);
  step(
    'Build shows the runbook panel under the frozen spec, with what is left out',
  );
  const m = await downloadAndCheck(panel, 'software');
  if (!m.freeze || m.withheld.held_out_cases !== 2)
    throw new Error(
      'the software runbook should be frozen with 2 cases withheld',
    );
  await panel.getByRole('button', { name: 'Save to Files' }).click();
  await panel
    .getByText(/Saved to Files as word-tally-synthetic-runbook-v1\.zip/)
    .waitFor();
  await panel.getByRole('button', { name: 'Save to Files' }).click();
  await panel.getByText(/Files already has this runbook/).waitFor();
  step('saved to Files once; a second save keeps the one copy');

  await page.goto(`${BASE}/#/projects/proposals?ws=${s.ws.id}`);
  await page.getByRole('heading', { name: 'Proposals', level: 2 }).waitFor();
  await page
    .getByRole('button', { name: new RegExp(draft.title.slice(0, 20)) })
    .first()
    .click();
  const prop = page.locator('section.proposal');
  await prop
    .getByRole('button', { name: 'Export a runbook for another model' })
    .click();
  const panel2 = prop.getByRole('group', { name: 'Runbook' });
  await panel2
    .getByText(/for a plan people carry out, not a software build/)
    .waitFor();
  await panel2.getByText(/still unknown/).waitFor();
  await panel2.scrollIntoViewIfNeeded();
  await shot('02-proposal-action-runbook', panel2);
  step(
    'Proposals shows the action runbook panel and names the unknown sections',
  );
  await downloadAndCheck(panel2, 'action');

  // Narrow screen: no horizontal scroll with the panel open.
  await page.setViewportSize({ width: 390, height: 844 });
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step(`phone width horizontal overflow: ${wide}`);
  await panel2.scrollIntoViewIfNeeded();
  await shot('03-phone');
  if (wide) throw new Error('the page scrolls sideways at phone width');

  // A draft version after the frozen one: the panel still offers the frozen version.
  await page.setViewportSize({ width: 1280, height: 900 });
  const content = structuredClone(RUNBOOK_FIXTURE_SPEC);
  content.scope.push('Print a usage line with --help');
  await s.store.reviseSpec(owner, s.ws.id, spec.spec.id, {
    expected_version: 1,
    title: 'Word tally (synthetic)',
    content,
    reason: 'Help text requested (walk).',
  });
  await page.goto(`${BASE}/#/projects/build?ws=${s.ws.id}`);
  await page.reload();
  await page.getByRole('heading', { name: 'Build and package' }).waitFor();
  const row2 = page.locator('ul.rows > li', {
    hasText: 'Word tally (synthetic)',
  });
  await row2
    .getByRole('button', { name: 'Export a runbook for another model' })
    .click();
  const panel3 = row2.getByRole('group', { name: 'Runbook' });
  await panel3
    .getByText('v2 is not frozen; v1 is the frozen version.')
    .waitFor();
  await panel3.getByText(/from requirements that are not frozen/).waitFor();
  await panel3.getByRole('button', { name: 'Use v1 instead' }).click();
  await panel3.getByText(/from the frozen requirements/).waitFor();
  await panel3
    .getByRole('link', { name: /^Download .*-runbook-v1\.zip$/ })
    .waitFor();
  await row2.scrollIntoViewIfNeeded();
  await shot('04-frozen-version-offered', row2);
  step('with a v2 draft, the panel offers and exports the frozen v1');
} catch (e) {
  await page?.screenshot({ path: join(shots, 'failure.png'), fullPage: true });
  throw e;
} finally {
  await writeFile(
    join(here, 'walk.json'),
    `${JSON.stringify({ when: new Date().toISOString(), commit, steps: log }, null, 2)}\n`,
  );
  await browser.close();
  await new Promise((r) => web.httpServer.close(r));
  await api.close();
  for (const f of cleanups.reverse()) await f();
}
