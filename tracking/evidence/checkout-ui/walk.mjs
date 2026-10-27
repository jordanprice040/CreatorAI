// Checkout screen: browser walk in fixture mode (runbook step 3).
// Starts the real API and the built web app on a throwaway database, seeds a fixture
// connection and offer, then drives headless Chromium through the Payments page's
// "Checkout (test mode)" section as the owner: the simulated buyer pays, and the owner delivers
// the queued processor events spoiled, correctly, twice and out of order. Nothing here is
// real money and no processor, provider or GitHub call is made.
// Usage (after `pnpm build` on an EMPTY throwaway database, never the installed app's):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=<32+ chars> \
//     node tracking/evidence/checkout-ui/walk.mjs [playwright module] [chromium path]
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview as vitePreview } from 'vite';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '../../../apps/api/dist/index.js';
import { verifiedRelease } from '../../../tests/dist/payments-harness.js';

const [, , pwPath = 'playwright', chromiumPath] = process.argv;
const pw = await import(pwPath);
const { chromium } = pw.chromium ? pw : pw.default;
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!CODE || !process.env.CREATOR_DATABASE_URL) throw new Error('missing env');

const env = { ...process.env, CREATOR_WORKER: 'off', CREATOR_PAYMENTS_HOOK: 'whsec_walk_fixture_0123456789' };
const api = createApi(env, {});
const { config, store } = api;
api.server.listen(config.api_port, config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts' });
const BASE = `http://${config.host}:${config.web_port}`;
const API = `http://${config.host}:${config.api_port}/api`;

const login = await fetch(`${API}/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const csrf = (await login.json()).csrf_token;
const post = async (path, body) => {
  const r = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrf },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json;
};
const ws = (await post('workspaces', { name: 'Checkout walk (fixture)', record_mode: 'fixture' })).id;
const w = `workspaces/${ws}`;
const conn = await post(`${w}/payment-connections`, {
  label: 'Simulated processor', processor: 'fixture', mode: 'fixture',
  account_id: 'acct_fixture0001', secret_key_env: null, webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
});
await post(`${w}/payment-connections/${conn.id}/verify`, {});
const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg');
const pool = new pg.Pool({ connectionString: process.env.CREATOR_DATABASE_URL, max: 2 });
const release = await verifiedRelease(store, pool, ws, { actorId: DEFAULT_OWNER_ACTOR_ID });
await post(`${w}/payment-offers`, {
  connection_id: conn.id, artifact_id: release.artifact_id, manifest_sha256: release.manifest_sha256,
  label: 'Fixture app', price_nano_usd: String(2500n * 10_000_000n),
});

const steps = [];
const problems = [];
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
const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
// The seeded release is the minimal row from tests/dist/payments-harness.js (a labelled test
// seam), which the Gallery's artifact list contract rejects; the offer already exists.
await page.route(/\/api\/workspaces\/[^/]+\/artifacts$/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
);
const detail = () => page.locator('section.test-checkout');
const access = (text) => detail().getByRole('status').filter({ hasText: text }).waitFor();
const event = (name) => detail().locator('ul[aria-label="Processor events"] > li', { hasText: name });
const deliver = (name) => event(name).getByRole('button', { name: /^Deliver( again)?$/ }).click();

await step('sign in and open Payments in the dark theme; checkout section is there', async () => {
  await page.goto(BASE);
  await page.getByLabel('Login code').fill(CODE);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');
  await page.goto(`${BASE}/#/payments?ws=${ws}`);
  await page.getByRole('heading', { name: 'Checkout (test mode)' }).waitFor();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(theme === 'dark', `theme ${theme}`);
});
await step('open a checkout: the simulated checkout page appears with the price', async () => {
  await page.locator('#co-buyer').fill('walk-buyer-a');
  await page.getByRole('button', { name: 'Open checkout' }).click();
  await detail().getByText('Simulated checkout page · test only').waitFor();
  await detail().getByRole('button', { name: 'Pay 25.00 sim' }).waitFor();
  await access('No access yet');
  await page.screenshot({ path: join(shots, '01-checkout-page.png'), fullPage: true });
});
await step('leaving without paying charges nothing', async () => {
  await detail().getByRole('button', { name: 'Leave without paying' }).click();
  await detail().getByText('The buyer left without paying.').waitFor();
});
await step('paying queues an event but grants nothing yet', async () => {
  await detail().getByRole('button', { name: 'Pay 25.00 sim' }).click();
  await event('Payment succeeded').waitFor();
  await detail().getByText('1 not applied yet.').waitFor();
  await access('No access yet');
});
await step('a delivery with the wrong secret is refused and records nothing', async () => {
  await event('Payment succeeded').getByRole('button', { name: 'Deliver spoiled' }).click();
  await event('Payment succeeded').getByText(/wrong secret: refused .*nothing recorded/).waitFor();
  await event('Payment succeeded').locator('select').selectOption('expired');
  await event('Payment succeeded').getByRole('button', { name: 'Deliver spoiled' }).click();
  await event('Payment succeeded').getByText(/old timestamp: refused .*nothing recorded/).waitFor();
  await access('No access yet');
});
await step('a correct delivery grants access and books revenue', async () => {
  await deliver('Payment succeeded');
  await event('Payment succeeded').getByText('signed correctly: applied').waitFor();
  await access('Has access');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('dl.facts dt')].find((e) => e.textContent === 'Revenue')?.nextElementSibling?.textContent === '25.00 sim',
  );
  await page.screenshot({ path: join(shots, '02-access-granted.png'), fullPage: true });
});
await step('delivering the same event again is ignored as a duplicate', async () => {
  await deliver('Payment succeeded');
  await event('Payment succeeded').getByText('signed correctly: already applied, ignored').waitFor();
  await access('Has access');
});
await step('a dispute pauses access; losing it revokes for good', async () => {
  await detail().getByRole('button', { name: 'Buyer disputes the charge' }).click();
  await deliver('Dispute opened');
  await access('Access paused while a dispute is open');
  await detail().getByRole('button', { name: 'You lose the dispute' }).click();
  await deliver('Dispute closed');
  await access('Access revoked for good');
  assert(!(await detail().getByRole('button', { name: 'Refund in full' }).count()), 'refund offered after a lost dispute');
});
await step('out of order: a refund delivered before its payment still ends revoked', async () => {
  await page.locator('#co-buyer').fill('walk-buyer-b');
  await page.getByRole('button', { name: 'Open checkout' }).click();
  await detail().getByRole('heading', { name: /walk-buyer-b/ }).waitFor();
  await detail().getByRole('button', { name: 'Pay 25.00 sim' }).click();
  await detail().getByRole('button', { name: 'Refund in full' }).click();
  await deliver('Refund issued');
  await access('Access revoked for good');
  await deliver('Payment succeeded');
  await event('Payment succeeded').getByText(/signed correctly/).waitFor();
  await access('Access revoked for good');
  await page.screenshot({ path: join(shots, '03-out-of-order.png'), fullPage: true });
});
await step('recent checkouts list both, and the first can be continued', async () => {
  const rows = page.locator('ul[aria-label="Recent checkouts"] > li');
  assert((await rows.count()) === 2, `rows ${await rows.count()}`);
  await rows.filter({ hasText: 'walk-buyer-a' }).getByRole('button', { name: 'Continue' }).click();
  await detail().getByRole('heading', { name: /walk-buyer-a/ }).waitFor();
  await access('Access revoked for good');
});
await step('phone width: no horizontal scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(shots, '04-phone.png'), fullPage: true });
  assert(over <= 0, `horizontal overflow ${over}px`);
});

await browser.close();
await pool.end();
await api.close();
await new Promise((r) => web.httpServer.close(r));
const ok = steps.every((s) => s.ok) && problems.length === 0;
await writeFile(join(here, 'walk.json'), JSON.stringify({ when: new Date().toISOString(), ok, steps, problems }, null, 2) + '\n');
console.log(JSON.stringify({ ok, failed: steps.filter((s) => !s.ok), problems }, null, 2));
process.exit(ok ? 0 : 1);
