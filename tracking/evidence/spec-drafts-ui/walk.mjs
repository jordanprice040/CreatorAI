// ADR-0107 (B2): Build › Write a spec › Draft it with a model, browser walk in fixture mode.
// Starts the real API (with its fixture discovery worker) and the built web app on a throwaway database (reviewer ports
// 4330/5183/4340), with a loopback stand-in for the ChatGPT plan that answers the spec draft
// instructions with a canned draft, edge case or explanation. Seeds the fixture selection with
// the CLI, archives its seeded spec so the option can be written again, and records a
// spec-cases-v1 qualification for the stand-in model directly in the database (no live
// qualification ran). Walks: no route before qualifying, the draft and its checks, using it,
// an edge case, an explanation, saving with the drafted mark, and the phone width, with
// axe-core WCAG 2.2 A/AA on the spec form in each state.
// Usage (after `pnpm build:code`, `pnpm --filter @creator/web build`, on an EMPTY throwaway
// database, never the installed app's or the dev studio's):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=<32+ chars> \
//     node tracking/evidence/spec-drafts-ui/walk.mjs
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApi } from '../../../apps/api/dist/index.js';
import {
  MemoryVault,
  PlanConnectionService,
} from '../../../packages/broker/dist/index.js';
import { canonicalHash } from '../../../packages/domain/dist/index.js';
import {
  CREDITS_OFF_STATEMENT,
  SPEC_DRAFT_INSTRUCTIONS,
} from '../../../packages/contracts/dist/index.js';
import { fakePlan } from '../../../tests/dist/plan-fakes.js';

const require = createRequire(import.meta.url);
const pg = createRequire(
  new URL('../../../packages/db/package.json', import.meta.url),
)('pg');
const { preview: vitePreview } = await import(
  createRequire(
    new URL('../../../apps/web/package.json', import.meta.url),
  ).resolve('vite')
);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../');
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!CODE || !process.env.CREATOR_DATABASE_URL) throw new Error('missing env');

const c = (stdin, stdout, exit_code = 0) => ({
  args: [],
  stdin,
  stdout,
  exit_code,
});
const SPEC = JSON.stringify({
  title: 'No-show risk flags',
  notes:
    'I assumed one appointment per line as "name count". Check the flag threshold of 2 with the front desk.',
  spec: {
    audience: 'Clinic front desk staff',
    problem_statement:
      'Front desks cannot see which booked patients are likely to miss their appointment.',
    user_flows: [
      {
        key: 'F1',
        name: 'Flag a day list',
        steps: ['Paste the day list', 'Read the flagged names'],
      },
    ],
    scope: [
      'Each input line is a name, one space and a whole number of past no-shows',
      'A line with 2 or more no-shows prints the name and " FLAG"',
      'Any other line shape prints "line N: invalid" and exits 1',
    ],
    non_goals: ['Sending reminders', 'Reading the booking system'],
    acceptance_checks: [
      {
        key: 'A1',
        flow: 'F1',
        statement: 'Flags patients with 2 or more past no-shows',
        measure: 'Exact output',
        method: 'automated_test',
        cases: [
          c('ann 2\n', 'ann FLAG\n'),
          c('bob 0\n', 'bob\n'),
          c('cy 1\ndee 3\n', 'cy\ndee FLAG\n'),
        ],
      },
      {
        key: 'A2',
        flow: 'F1',
        statement: 'Rejects lines that are not "name count"',
        measure: 'Output and exit code',
        method: 'automated_test',
        cases: [
          c('x\n', 'line 1: invalid\n', 1),
          c('ann two\n', 'line 1: invalid \n', 1),
          c('', ''),
        ],
      },
    ],
    risks: [
      {
        risk: 'A wrong flag could embarrass a patient',
        mitigation: 'Staff read flags as a prompt, not a verdict',
      },
    ],
    tasks: [
      {
        key: 'T1',
        title: 'Write the flagging tool',
        role: 'builder',
        file_scope: ['src'],
        depends_on: [],
        acceptance: ['A1', 'A2'],
        deliverable: 'src/main.py',
      },
    ],
  },
});
const EDGE = JSON.stringify({
  case: { args: [], stdin: 'eve 10\n', stdout: 'eve FLAG\n', exit_code: 0 },
  why: 'A two-digit count: the rule is 2 or more, so 10 is flagged; a program comparing text instead of numbers would miss it.',
});
const EXPLAIN = JSON.stringify({
  explanation:
    'Ann has 2 past no-shows, which meets the "2 or more" rule, so her line prints her name followed by " FLAG" and a newline.',
});
const fake = await fakePlan({
  respond: (body) => {
    if (body.instructions !== SPEC_DRAFT_INSTRUCTIONS) return 'ok';
    const input = String(body.input[0].content);
    return input.includes('<task>edge_case</task>')
      ? EDGE
      : input.includes('<task>explain_case</task>')
        ? EXPLAIN
        : SPEC;
  },
});
const tmp = mkdtempSync(join(tmpdir(), 'creator-b2-walk-'));
Object.assign(process.env, {
  CREATOR_API_PORT: '4330',
  CREATOR_WEB_PORT: '5183',
  CREATOR_PREVIEW_PORT: '4340',
});
const env = {
  ...process.env,
  CREATOR_WORKER: 'on',
  CREATOR_PRODUCTS_ROOT: join(tmp, 'products'),
};
const api = createApi(env, {
  planService: (store, { patchScorer }) =>
    new PlanConnectionService({
      store,
      vault: new MemoryVault(),
      fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
      openBrowser: () => {},
      callbackPort: 0,
      patchScorer,
    }),
});
const { config } = api;
api.server.listen(config.api_port, config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
  preview: {
    port: Number(config.web_port),
    strictPort: true,
    host: config.host,
  },
});
const BASE = `http://${config.host}:${config.web_port}`;
const API = `http://${config.host}:${config.api_port}/api`;

// The fixture selection, through the CLI (its own session file).
const cliEnv = {
  ...process.env,
  CREATOR_API_URL: `http://${config.host}:${config.api_port}`,
  CREATOR_SESSION_FILE: join(tmp, 'cli-session.json'),
};
const cli = async (...a) =>
  JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        ['apps/cli/dist/main.js', ...a],
        { env: cliEnv, maxBuffer: 1 << 26 },
      )
    ).stdout,
  );
await cli('login', CODE);
const seed = await cli('seed-selection');

const login = await fetch(`${API}/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const session = await login.json();
const call = async (method, path, body) => {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'X-CSRF-Token': session.csrf_token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(out)}`);
  return out;
};
const wsId = seed.workspace.id;
const base = `workspaces/${wsId}`;
// Archive the seeded spec so the option can be written again from the Build page.
const seeded = await call('GET', `${base}/entities/${seed.spec.id}`);
await call('POST', `${base}/entities/${seed.spec.id}/archive`, {
  expected_version: seeded.entity.version,
  reason: 'B2 walk: write the spec again with a model draft.',
});
// A fixture ChatGPT plan connection, signed in against the stand-in, model m verified.
const settings = JSON.parse(
  readFileSync(join(root, 'config/connections/chatgpt-plan.json'), 'utf8'),
);
let conn = await call('POST', `${base}/plan-connections`, {
  label: 'ChatGPT plan',
  settings,
});
const p = `${base}/plan-connections/${conn.id}`;
const signIn = await call('POST', `${p}/sign-in`, { open_browser: false });
if ((await fake.approve(signIn.authorization_url)) !== 200)
  throw new Error('sign-in refused');
const detail = async () => (await call('GET', p)).connection;
for (let i = 0; i < 100 && (await detail()).sign_in.state !== 'signed_in'; i++)
  await new Promise((r) => setTimeout(r, 50));
conn = await detail();
conn = await call('POST', `${p}/credits`, {
  expected_version: conn.version,
  statement: CREDITS_OFF_STATEMENT,
  checked_on: '2026-11-15',
});
conn = await detail();
conn = await call('POST', `${p}/accept-caps`, {
  expected_version: conn.version,
  settings_hash: conn.settings_hash,
});
conn = await detail();
const grant = await call('POST', `${p}/verification-grants`, {
  expected_version: conn.version,
  model_id: 'm',
  path: 'responses',
  expires_in_minutes: 5,
});
await call('POST', `${p}/verify`, { grant_id: grant.id, model_id: 'm' });

const steps = [];
const problems = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on(
  'console',
  (m) =>
    m.type() === 'error' &&
    !/Failed to load resource/.test(m.text()) &&
    problems.push(`console: ${m.text()}`),
);
const step = async (name, fn) => {
  console.log(`… ${name}`);
  try {
    steps.push({ name, ok: true, detail: (await fn()) ?? null });
  } catch (e) {
    steps.push({
      name,
      ok: false,
      error: String(e?.message ?? e).split('\n')[0],
    });
    await page
      .screenshot({
        path: join(shots, `failed-${steps.length}.png`),
        fullPage: true,
      })
      .catch(() => undefined);
  }
};
const assert = (ok, m) => {
  if (!ok) throw new Error(m);
};
const form = () => page.locator('form.spec-form');
const panel = () => page.locator('fieldset.spec-drafting');
const see = (where, text) => where.getByText(text).first().waitFor();
const axe = async () => {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    axe.run(document.querySelector('form.spec-form'), {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    }),
  );
  const v = r.violations.map(
    (x) => `${x.id} (${x.nodes.map((n) => n.target.join(' ')).join('; ')})`,
  );
  assert(v.length === 0, `axe: ${v.join(', ')}`);
  return 'axe: 0 violations';
};
const openForm = async () => {
  await page.goto(`${BASE}/#/build?ws=${wsId}`);
  await page.reload();
  await page.getByRole('button', { name: 'Write a spec' }).first().click();
  await form().waitFor();
};

await step(
  'sign in; before any model is qualified, the panel says how to get one',
  async () => {
    await page.goto(BASE);
    await page.getByLabel('Login code').fill(CODE);
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle');
    await openForm();
    await see(panel(), 'No model may draft specs yet.');
    await panel()
      .getByRole('button', { name: 'Open Models and connections' })
      .waitFor();
    assert(
      (await panel()
        .getByRole('button', { name: /Draft with/ })
        .count()) === 0,
      'draft offered',
    );
    await panel().screenshot({ path: join(shots, '01-no-route.png') });
    return axe();
  },
);
await step(
  'qualified on spec-cases-v1, Draft with m shows the draft beside the form, checked',
  async () => {
    const manifest = JSON.parse(
      readFileSync(
        join(root, 'config/connections/benchmarks/spec-cases-v1.json'),
        'utf8',
      ),
    );
    const db = new pg.Pool({
      connectionString: process.env.CREATOR_DATABASE_URL,
    });
    await db.query(
      `insert into plan_qualifications (id, connection_id, model_id, task_class, manifest, manifest_hash,
       min_held_out_cases, floor, state, development, held_out, created_by, decided_at)
     values ($1,$2,'m','specification',$3,$4,5,'{"numerator":1,"denominator":1}','qualified','{"passed":3,"total":3}','{"passed":5,"total":5}',$5,clock_timestamp())`,
      [
        randomUUID(),
        conn.id,
        manifest,
        canonicalHash(manifest),
        session.actor_id,
      ],
    );
    await db.end();
    await openForm();
    const sent = fake.responseRequests.length;
    await panel().getByRole('button', { name: 'Draft with m' }).click();
    await see(panel(), /m drafted 2 acceptance checks with 6 suggested cases/);
    assert(fake.responseRequests.length === sent + 1, 'one request');
    await see(panel(), 'Fixture connection');
    await see(panel(), /Look: A2 case 2's expected output|Line 1 of A2 case 2/);
    await see(panel(), 'The cases are yours to check.');
    await see(panel(), 'Drafting is for command-line programs only');
    assert(
      (await panel().getByRole('radio').count()) === 0,
      'product choice offered',
    );
    await panel()
      .getByText(/What the build will be checked against/)
      .click();
    await see(panel(), 'held out, only QA runs it');
    // Nothing went into the form yet.
    assert(
      (await form().locator('#sf-checks\\.0\\.statement').inputValue()) === '',
      'form changed before Use',
    );
    await panel().screenshot({ path: join(shots, '02-draft.png') });
    return axe();
  },
);
await step(
  'Use this draft fills the form; the held-out pick and case checks show by each case',
  async () => {
    await panel().getByRole('button', { name: 'Use this draft' }).click();
    await see(panel(), 'In the form below. Check every case.');
    assert(
      (await form().locator('#sf-checks\\.0\\.statement').inputValue()) ===
        'Flags patients with 2 or more past no-shows',
      'not filled',
    );
    await see(form(), /The studio held out 2 drafted cases at random/);
    await see(form(), /Look: Line 1 of A2 case 2/);
    await form()
      .locator('.sf-item')
      .filter({ has: page.locator('#sf-checks\\.0\\.statement') })
      .screenshot({ path: join(shots, '03-used.png') });
    return axe();
  },
);
await step(
  'Add an edge case suggests one for A1; Add puts it in the form',
  async () => {
    const a1 = form()
      .locator('.sf-item')
      .filter({ has: page.locator('#sf-checks\\.0\\.statement') });
    await a1.getByRole('button', { name: 'Add an edge case' }).click();
    await see(a1, /A two-digit count/);
    await see(a1, 'Work the expected result out yourself before adding it');
    await a1
      .locator('.model-draft')
      .screenshot({ path: join(shots, '04-edge-case.png') });
    const r = await axe();
    await a1.getByRole('button', { name: 'Add this case' }).click();
    await a1.getByText('Case 4', { exact: true }).waitFor();
    assert(
      (await form()
        .locator('#sf-checks\\.0\\.cases\\.3\\.stdin')
        .inputValue()) === 'eve 10\n',
      'edge case not added',
    );
    return r;
  },
);
await step('Explain this case answers beside the case', async () => {
  const c1 = form().locator('.sf-case').first();
  await c1.getByRole('button', { name: 'Explain this case' }).click();
  await see(c1, /Ann has 2 past no-shows/);
  await c1.screenshot({ path: join(shots, '05-explain.png') });
  // With the case in view, the check's Flow picker sits under the sticky top bar, and axe counts
  // a covered control as too small; bring the whole check into view first.
  await page.evaluate(() => window.scrollTo(0, 0));
  await form().locator('#sf-checks\\.0\\.flow').scrollIntoViewIfNeeded();
  const r = await axe();
  await c1.getByRole('button', { name: 'Dismiss' }).click();
  return r;
});
await step('phone width: no horizontal page scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const extra = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  await panel().screenshot({ path: join(shots, '07-phone.png') });
  assert(extra <= 0, `scrolls by ${extra}px`);
  const r = await axe();
  await page.setViewportSize({ width: 1280, height: 900 });
  return r;
});

await step(
  'Save spec records the drafts; the Build row says drafted by the model, checked by you',
  async () => {
    await form()
      .locator('#sf-maintenance\\.owner')
      .fill('Front desk lead')
      .catch(() => undefined);
    await see(form(), 'Model drafts');
    await form().getByRole('button', { name: 'Save spec' }).click();
    await page
      .getByText(
        /Drafted by m, checked by you; held-out cases picked at random by the studio\./,
      )
      .first()
      .waitFor();
    await page
      .getByText(/Drafted by m, checked by you/)
      .first()
      .locator('xpath=ancestor::li[1]')
      .screenshot({ path: join(shots, '06-saved-row.png') });
  },
);
await browser.close();
await new Promise((r) => web.httpServer.close(r));
await api.close();
await fake.close();
const result = {
  when: new Date().toISOString(),
  mode: 'fixture',
  stand_ins: [
    'loopback ChatGPT plan with canned draft replies',
    'spec-cases-v1 qualification recorded directly (no live qualification)',
  ],
  steps,
  problems,
};
await writeFile(
  join(here, 'walk.json'),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
process.exit(steps.every((s) => s.ok) && problems.length === 0 ? 0 : 1);
