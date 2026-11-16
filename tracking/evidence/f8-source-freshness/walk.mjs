// F8 (ADR-0126) walk: seeds a fixture workspace on a throwaway studio (web 5183), opens Decide,
// presses Recheck sources and screenshots. Run from the repo root with the studio's dev login code.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire('/home/user/CreatorAI/package.json');
const { chromium } = require('playwright');
const API = 'http://127.0.0.1:5183/api';
const CODE = 'f8-shot-code-1234567890abcdefghijklmnop';
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
const login = await ctx.request.post(`${API}/auth/dev-login`, {
  data: { code: CODE },
});
const csrf = (await login.json()).csrf_token;
const call = async (path, body) => {
  const r =
    body === undefined
      ? await ctx.request.get(`${API}/${path}`)
      : await ctx.request.post(`${API}/${path}`, {
          data: body,
          headers: { 'X-CSRF-Token': csrf },
        });
  const j = await r.json();
  if (!r.ok()) throw new Error(path + ' ' + JSON.stringify(j));
  return j;
};
const ws = await call('workspaces', {
  name: 'Clinic access (fixture)',
  record_mode: 'fixture',
});
const w = `workspaces/${ws.id}`;
const run = await call(`${w}/entities`, {
  kind: 'run',
  title: 'Evidence gathering',
  body: {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  },
});
await call(`${w}/runs`, {
  run: { id: run.id, version: 1 },
  autonomy_mode: 'human_in_loop',
  stage_gates: null,
  initial_grants: [],
});
await call(`${w}/grants`, {
  run_id: run.id,
  action_types: ['source.fetch'],
  target_kind: null,
  max_amount_nano_usd: null,
  allow_irreversible: false,
  allow_external_effects: false,
  data_classes: ['public'],
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  rationale: 'Fixture pages.',
});
const fetchPage = (url) =>
  call(`${w}/runs/${run.id}/source-fetches`, {
    url,
    task_id: null,
    logical_operation_id: randomUUID(),
    justification: 'Fixture.',
  });
const report = await fetchPage(
  'https://health.fixture.test/reports/clinic-access-2025',
);
const staffing = await fetchPage(
  'https://health.fixture.test/reports/staffing-brief',
);
const wire = await fetchPage('https://wire.fixture.test/stories/clinic-waits');
const problem = await call(`${w}/entities`, {
  kind: 'problem',
  title: 'Rural patients wait weeks for a first appointment',
  body: {
    statement: 'Rural patients wait weeks for a first clinic appointment.',
    affected_group: 'Rural patients',
    uncertainty: 'Fixture.',
  },
});
const passage = async (sid, needle) =>
  (await call(`${w}/sources/${sid}`)).passages.find((p) =>
    p.excerpt?.includes(needle),
  ).id;
const claim = async (statement, sid, needle, quote) => {
  const c = await call(`${w}/entities`, {
    kind: 'claim',
    title: statement,
    body: { statement, basis: 'observation', uncertainty: 'Fixture.' },
  });
  await call(`${w}/claims/${c.id}/support`, {
    claim_version: 1,
    rationale: 'Assessed (fixture).',
    evidence: 'passage',
    passage_id: await passage(sid, needle),
    stance: 'supports',
    support_type: 'observation',
    quote,
  });
  await call(`${w}/links`, {
    relation: 'supports',
    from: { id: c.id, version: 1 },
    to: { id: problem.id, version: 1 },
    rationale: 'Evidence.',
  });
};
await claim(
  'Rural first-appointment waits were 41 days in 2025.',
  report.source_id,
  '41 days',
  'was 41 days, up from 29 days in 2022',
);
await claim(
  'Urban clinics waited 12 days in both years.',
  report.source_id,
  'Urban clinics',
  'median wait of 12 days in both years',
);
await claim(
  '18 percent of rural nursing posts were vacant in 2025.',
  staffing.source_id,
  '18 percent',
  '18 percent of nursing posts vacant in 2025',
);
await claim(
  'Clinic managers blamed staff vacancies.',
  wire.source_id,
  'Clinic managers',
  'staff vacancies were the main cause',
);
const p = await ctx.newPage();
await p.goto(
  `http://127.0.0.1:5183/#/projects/decide?ws=${ws.id}&id=${problem.id}`,
);
await p.waitForTimeout(2500);
const ev = p.locator('h3', { hasText: 'Evidence behind the problem' });
await ev.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -80));
await p.screenshot({ path: '/tmp/claude-0/f8/before.png' });
await p.getByRole('button', { name: 'Recheck sources' }).click();
await p.waitForTimeout(3000);
await p.evaluate(() =>
  document
    .querySelectorAll('ul.claims details')
    .forEach((d) => (d.open = true)),
);
await p.waitForTimeout(300);
await ev.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -80));
await p.screenshot({ path: '/tmp/claude-0/f8/after.png', fullPage: false });
const el = p.locator('ul.claims');
await el.screenshot({ path: '/tmp/claude-0/f8/claims-open.png' });
console.log(await p.locator('.sf-result').innerText());
await p.setViewportSize({ width: 390, height: 900 });
await p.waitForTimeout(500);
await ev.scrollIntoViewIfNeeded();
await p.screenshot({ path: '/tmp/claude-0/f8/phone.png' });
await b.close();
