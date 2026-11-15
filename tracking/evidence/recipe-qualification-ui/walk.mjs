// ADR-0105 (B1): Models › Qualify building, browser walk in fixture mode. Starts the real API
// and the built web app on a throwaway database, with a loopback stand-in for the ChatGPT plan
// (tests/dist/plan-fakes.js) whose roles answer with the benchmark's reference solution, and the
// test-double executor for the qualification harness (not isolation evidence). Walks: what
// blocks a start before both roles qualify, the confirm packet, a run to qualified with its
// attempts and pass bars, and the phone width, with axe-core WCAG 2.2 A/AA on each state.
// Usage (after `pnpm build` and `pnpm --filter @creator/web build`, on an EMPTY throwaway
// database, never the installed app's or the dev studio's):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=<32+ chars> \
//     node tracking/evidence/recipe-qualification-ui/walk.mjs
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApi } from '../../../apps/api/dist/index.js';
import { MemoryVault, PlanConnectionService } from '../../../packages/broker/dist/index.js';
import { BUILD_ROLE_PROMPTS, canonicalHash } from '../../../packages/domain/dist/index.js';
import { CREDITS_OFF_STATEMENT } from '../../../packages/contracts/dist/index.js';
import { fakePlan } from '../../../tests/dist/plan-fakes.js';
import { TestDoubleExecutor } from '../../../tests/dist/artifact-double.js';

const require = createRequire(import.meta.url);
// pg and vite resolve from the packages that depend on them.
const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg');
const { preview: vitePreview } = await import(
  createRequire(new URL('../../../apps/web/package.json', import.meta.url)).resolve('vite')
);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../');
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!CODE || !process.env.CREATOR_DATABASE_URL) throw new Error('missing env');

function files(dir) {
  return readdirSync(dir)
    .flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]))
    .sort();
}
const refDir = join(root, 'config/recipe-benchmarks/p15-small-signup-v5/reference');
const reference = files(refDir).map((f) => ({
  path: relative(refDir, f).split('\\').join('/'),
  content: readFileSync(f, 'utf8'),
}));
const fake = await fakePlan({
  respond: (body) => {
    const input = body.input[0].content;
    if (body.instructions === BUILD_ROLE_PROMPTS.builder) {
      const p = JSON.parse(input);
      return JSON.stringify({
        summary: 'Reference solution',
        blocker: null,
        submission: {
          expected_commit: p.candidate,
          changes: reference.map((f) => ({
            path: f.path,
            before_hash: p.files.find((x) => x.path === f.path)?.hash ?? null,
            content: f.content,
          })),
        },
      });
    }
    if (body.instructions === BUILD_ROLE_PROMPTS.reviewer) {
      const p = JSON.parse(input);
      return JSON.stringify({
        candidate: p.candidate,
        spec_hash: p.spec_hash,
        task_hash: p.task_hash,
        verdict: 'approve',
        findings: [],
      });
    }
    return 'ok';
  },
});
const tmp = mkdtempSync(join(tmpdir(), 'creator-b1-walk-'));
// Reviewer ports (never the dev studio's or the installed app's); the web proxy reads them too.
Object.assign(process.env, {
  CREATOR_API_PORT: '4330',
  CREATOR_WEB_PORT: '5183',
  CREATOR_PREVIEW_PORT: '4340',
});
const env = {
  ...process.env,
  CREATOR_WORKER: 'off',
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
  recipeExecutor: (products) => new TestDoubleExecutor(products),
});
const { config } = api;
api.server.listen(config.api_port, config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
  preview: { port: Number(config.web_port), strictPort: true, host: config.host },
});
const BASE = `http://${config.host}:${config.web_port}`;
const API = `http://${config.host}:${config.api_port}/api`;

const login = await fetch(`${API}/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const session = await login.json();
const csrf = session.csrf_token;
const call = async (method, path, body) => {
  const r = await fetch(`${API}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(`${method} ${path}: ${JSON.stringify(out)}`);
  return out;
};
// Setup through the API, as the Models page does it: a fixture ChatGPT plan connection, signed
// in against the stand-in, credits off, caps accepted and model m verified.
const ws = await call('POST', 'workspaces', { name: 'Build qualification walk (fixture)', record_mode: 'fixture' });
const base = `workspaces/${ws.id}`;
const settings = JSON.parse(readFileSync(join(root, 'config/connections/chatgpt-plan.json'), 'utf8'));
let conn = await call('POST', `${base}/plan-connections`, { label: 'ChatGPT plan', settings });
const p = `${base}/plan-connections/${conn.id}`;
const signIn = await call('POST', `${p}/sign-in`, { open_browser: false });
if ((await fake.approve(signIn.authorization_url)) !== 200) throw new Error('sign-in refused');
const detail = async () => (await call('GET', p)).connection;
for (let i = 0; i < 100 && (await detail()).sign_in.state !== 'signed_in'; i++) await new Promise((r) => setTimeout(r, 50));
conn = await detail();
conn = await call('POST', `${p}/credits`, { expected_version: conn.version, statement: CREDITS_OFF_STATEMENT, checked_on: '2026-11-14' });
conn = await detail();
conn = await call('POST', `${p}/accept-caps`, { expected_version: conn.version, settings_hash: conn.settings_hash });
conn = await detail();
const grant = await call('POST', `${p}/verification-grants`, { expected_version: conn.version, model_id: 'm', path: 'responses', expires_in_minutes: 5 });
await call('POST', `${p}/verify`, { grant_id: grant.id, model_id: 'm' });

const steps = [];
const problems = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
const step = async (name, fn) => {
  console.log(`… ${name}`);
  try {
    steps.push({ name, ok: true, detail: (await fn()) ?? null });
  } catch (e) {
    steps.push({ name, ok: false, error: String(e?.message ?? e).split('\n')[0] });
    await page.screenshot({ path: join(shots, `failed-${steps.length}.png`), fullPage: true }).catch(() => undefined);
  }
};
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const section = () => page.locator('fieldset', { has: page.getByText('Qualify building', { exact: true }) });
const see = (text) => section().getByText(text).first().waitFor();
const axe = async () => {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () =>
    // eslint-disable-next-line no-undef
    axe.run(
      // Only this section: the rest of Models is covered by scripts/ux-sweep.mjs.
      [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent === 'Qualify building'),
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } },
    ),
  );
  const v = r.violations.map((x) => `${x.id} (${x.nodes.map((n) => n.target.join(" ")).join("; ")})`);
  assert(v.length === 0, `axe: ${v.join(', ')}`);
  return 'axe: 0 violations';
};
const shot = (name) => section().screenshot({ path: join(shots, name) });

await step('sign in and open the connection on Models', async () => {
  await page.goto(BASE);
  await page.getByLabel('Login code').fill(CODE);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');
  await page.goto(`${BASE}/#/models?ws=${ws.id}`);
  await page.locator('#models-title').waitFor();
  await section().waitFor();
  await section().scrollIntoViewIfNeeded();
});
await step('before both roles qualify, the section says what blocks a start', async () => {
  await section().getByLabel('Benchmark').selectOption('p15-small-signup-v5');
  await see("m isn't qualified as the builder yet: qualify it with t12-builder-v1 above.");
  await see("m isn't qualified as the reviewer yet: qualify it with t12-reviewer-v2 above.");
  assert((await section().getByRole('button', { name: /Qualify building/ }).count()) === 0, 'start offered');
  await shot('01-blocked.png');
  return axe();
});
await step('with both roles qualified, the confirm packet states the bound before anything is sent', async () => {
  const db = new pg.Pool({ connectionString: process.env.CREATOR_DATABASE_URL });
  for (const [task, prompt] of [['patch_build', BUILD_ROLE_PROMPTS.builder], ['independent_review', BUILD_ROLE_PROMPTS.reviewer]]) {
    const manifest = { cases: [{ input: [{ role: 'system', text: prompt }] }] };
    await db.query(
      `insert into plan_qualifications (id, connection_id, model_id, task_class, manifest, manifest_hash,
         min_held_out_cases, floor, state, development, held_out, created_by, decided_at)
       values ($1,$2,'m',$3,$4,$5,3,'{"numerator":1,"denominator":1}','qualified','{"passed":1,"total":1}','{"passed":3,"total":3}',$6,clock_timestamp())`,
      [randomUUID(), conn.id, task, manifest, canonicalHash(manifest), session.actor_id],
    );
  }
  await db.end();
  await page.reload();
  await section().waitFor();
  await section().getByLabel('Benchmark').selectOption('p15-small-signup-v5');
  const sent = fake.responseRequests.length;
  await section().getByRole('button', { name: 'Qualify building (up to 24 plan requests)' }).click();
  await see('3 builds of the frozen benchmark');
  await see('This is a fixture connection');
  assert(fake.responseRequests.length === sent, 'something was sent before confirming');
  await section().scrollIntoViewIfNeeded();
  await shot('02-confirm.png');
  return axe();
});
await step('Start runs three builds to qualified, and each attempt shows its bars', async () => {
  const sent = fake.responseRequests.length;
  await section().getByRole('button', { name: 'Start 3 builds' }).click();
  await section().getByText(/p15-small-signup-v5 on m: qualified · 3 of 3 attempts passed/).first().waitFor({ timeout: 60000 });
  assert(fake.responseRequests.length - sent === 6, `requests ${fake.responseRequests.length - sent}`);
  await section().getByRole('button', { name: 'Show attempts' }).click();
  await see('Attempt 3: passed · 2 of 4 requests · 0 repair rounds');
  await see('Passed: The exported package passed all 10 frozen cases again in the worker.');
  await section().scrollIntoViewIfNeeded();
  await shot('03-qualified.png');
  return axe();
});
await step('phone width: no horizontal page scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await section().waitFor();
  await section().scrollIntoViewIfNeeded();
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot('04-phone.png');
  assert(extra <= 0, `scrolls by ${extra}px`);
  return axe();
});

await browser.close();
await new Promise((r) => web.httpServer.close(r));
await api.close();
await fake.close();
const result = {
  when: new Date().toISOString(),
  mode: 'fixture',
  stand_ins: ['loopback ChatGPT plan', 'test-double executor (not isolation evidence)'],
  steps,
  problems,
};
await writeFile(join(here, 'walk.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(steps.every((s) => s.ok) && problems.length === 0 ? 0 : 1);
