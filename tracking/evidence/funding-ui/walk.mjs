// Funding and reinvestment screen: browser walk in fixture mode (runbook step 2).
// Starts the real API (fixture payment processor through the createApi test seam) and the
// built web app on a throwaway database, seeds a fixture offer and checkout, settles the sale once the policy is on,
// then drives headless Chromium through the Payments page as the owner. Nothing here is real
// money and no processor, provider or GitHub call is made.
// Usage (after `pnpm build` on an EMPTY throwaway database, never the installed app's):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=<32+ chars> \
//     node tracking/evidence/funding-ui/walk.mjs [playwright module] [chromium path]
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview as vitePreview } from 'vite';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '../../../apps/api/dist/index.js';
import { FixtureProcessor } from '../../../packages/broker/dist/index.js';
import { verifiedRelease } from '../../../tests/dist/payments-harness.js';

const [, , pwPath = 'playwright', chromiumPath] = process.argv;
const pw = await import(pwPath);
const { chromium } = pw.chromium ? pw : pw.default;
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!CODE || !process.env.CREATOR_DATABASE_URL) throw new Error('missing env');

const processors = new Map();
const env = { ...process.env, CREATOR_WORKER: 'off', CREATOR_PAYMENTS_HOOK: 'whsec_walk_fixture_0123456789' };
const api = createApi(env, {
  paymentFixture: (conn) => {
    const p = processors.get(conn.id) ?? new FixtureProcessor(conn.body.account_id);
    processors.set(conn.id, p);
    return p;
  },
});
const { config, store } = api;
api.server.listen(config.api_port, config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts' });
const BASE = `http://${config.host}:${config.web_port}`;
const API = `http://${config.host}:${config.api_port}/api`;

// Seed through the API as the owner.
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
const ws = (await post('workspaces', { name: 'Funding walk (fixture)', record_mode: 'fixture' })).id;
const w = `workspaces/${ws}`;
const conn = await post(`${w}/payment-connections`, {
  label: 'Simulated processor', processor: 'fixture', mode: 'fixture',
  account_id: 'acct_fixture0001', secret_key_env: null, webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
});
await post(`${w}/payment-connections/${conn.id}/verify`, {});
const pg = createRequire(new URL('../../../packages/db/package.json', import.meta.url))('pg');
const pool = new pg.Pool({ connectionString: process.env.CREATOR_DATABASE_URL, max: 2 });
const release = await verifiedRelease(store, pool, ws, { actorId: DEFAULT_OWNER_ACTOR_ID });
const offer = await post(`${w}/payment-offers`, {
  connection_id: conn.id, artifact_id: release.artifact_id, manifest_sha256: release.manifest_sha256,
  label: 'Fixture app', price_nano_usd: String(10_000n * 10_000_000n),
});
const checkout = await post(`${w}/payment-checkouts`, {
  offer_id: offer.id, customer_ref: 'cust-walk',
  success_url: `${API}/payments/return`, cancel_url: `${API}/payments/return`,
});
// The sale settles after the walk sets the policy: a tranche takes its waiting period from the
// policy in force when it settles (30 days when none exists).
const settleSale = async () => {
  const fx = processors.get(conn.id);
  const pi = fx.pay(checkout.processor_session_id);
  fx.settle(pi);
  await post(`${w}/payments/${conn.id}/reconcile`, { payment_id: pi });
};

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
// seam), which the Gallery's artifact list contract rejects. The Payments page uses that list
// only for the offer picker, so the walk answers it with an empty list.
await page.route(/\/api\/workspaces\/[^/]+\/artifacts$/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
);
const funding = () => page.locator('h3#funding');
// Notices appear before the reloaded figures, so checks wait for the text instead of sampling.
const see = (text) => page.getByText(text).first().waitFor();
const open = (summary) => page.locator('summary', { hasText: summary }).click();
const factIs = async (dt, start) => {
  await page.waitForFunction(
    ([dt, start]) =>
      [...document.querySelectorAll('dl.facts dt')]
        .find((e) => e.textContent.includes(dt))
        ?.nextElementSibling?.textContent.startsWith(start),
    [dt, start],
  );
};
const factOf = (dt) => page.locator('dl.facts dt', { hasText: dt }).first().locator('xpath=following-sibling::dd[1]');

await step('sign in and open Payments in the dark theme', async () => {
  await page.goto(BASE);
  await page.getByLabel('Login code').fill(CODE);
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle');
  await page.goto(`${BASE}/#/payments?ws=${ws}`);
  await funding().waitFor();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  assert(theme === 'dark', `theme ${theme}`);
  await page.screenshot({ path: join(shots, '01-before.png'), fullPage: true });
});
await step('reinvesting starts off and nothing can become budget', async () => {
  await see('Off. No policy is set');
  assert((await factOf('Could become budget now').innerText()).includes('reinvesting is off'), 'binding');
  await see('Turn reinvesting on in the policy above');
});
await step('record owner funding: review, then confirm; balances update once', async () => {
  await open('Record money you put in');
  await page.locator('#of-amount').fill('40');
  await page.locator('#of-evidence').fill('Walk: simulated seed');
  await page.getByRole('button', { name: 'Review' }).click();
  await see('Record 40.00 sim as money you put in?');
  await page.getByRole('button', { name: 'Yes, record it' }).click();
  await page.getByText('40.00 sim recorded as your own funding.').waitFor();
  await factIs('Your own funding', '40.00 sim');
});
await step('add a funding source and record its balance; it counts toward usable cash', async () => {
  await open('Add a funding source');
  await page.locator('#rl-label').fill('Business checking');
  await page.getByRole('button', { name: 'Add funding source' }).click();
  await page.getByText('Business checking added.').waitFor();
  await see('no balance recorded yet');
  await page.getByRole('button', { name: 'Record balance…' }).click();
  await page.locator('input[id^="ra-"]').first().fill('60');
  await page.getByLabel('Where you checked').fill('Walk: simulated statement');
  await page.getByRole('button', { name: 'Record balance', exact: true }).click();
  await page.getByText('60.00 sim recorded; it counts for 24 hours.').waitFor();
  await factIs('Usable cash', '60.00 sim');
});
await step('add and close a commitment; usable cash drops then recovers', async () => {
  await open('Add a commitment');
  await page.locator('#cm-label').fill('Hosting bill');
  await page.locator('#cm-amount').fill('15');
  await page.getByRole('button', { name: 'Add commitment' }).click();
  await page.getByText('Hosting bill added').waitFor();
  await factIs('Usable cash', '45.00 sim');
  await page.getByRole('button', { name: 'Close…' }).click();
  await page.getByRole('button', { name: 'Close for good' }).click();
  await page.getByText('Hosting bill closed.').waitFor();
  await factIs('Usable cash', '60.00 sim');
  await see('Closed (1)');
});
await step('turning reinvesting on asks first and says what it allows', async () => {
  await open('Set a policy');
  await page.getByLabel(/On: allow earnings/).check();
  await page.locator('#rp-share').fill('50');
  await page.locator('#rp-hold').fill('0');
  await page.locator('#rp-cap').fill('20');
  await page.locator('#rp-days').fill('30');
  await page.locator('#rp-reserve').fill('5');
  await page.locator('#rp-why').fill('Walk: fixture policy');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await see('Turn reinvesting on? Up to 50%');
  await page.screenshot({ path: join(shots, '02-policy-confirm.png'), fullPage: true });
  await page.getByRole('button', { name: 'Yes, save and turn on' }).click();
  await page.getByText('Policy version 1 saved; reinvesting is on.').waitFor();
});
let capacityText = '';
await step('capacity reflects the settled sale and every bound', async () => {
  await settleSale();
  await page.reload();
  await funding().waitFor();
  await page.waitForFunction(() => {
    const dt = [...document.querySelectorAll('dl.facts dt')].find((e) => e.textContent.includes('Could become budget now'));
    return dt && !dt.nextElementSibling.textContent.startsWith('0.00');
  });
  capacityText = await factOf('Could become budget now').innerText();
  assert(!capacityText.startsWith('0.00'), capacityText);
  await see(/Earnings from settled sales \(1\)/);
  return capacityText;
});
await step('turning earnings into a budget refuses an over-limit amount, then asks before creating', async () => {
  await open('Turn earnings into a budget');
  await page.locator('#ra-amount').fill('9999');
  await see(/That is more than the/);
  assert(await page.getByRole('button', { name: 'Review' }).isDisabled(), 'review enabled');
  await page.locator('#ra-amount').fill('10');
  await page.getByRole('button', { name: 'Review' }).click();
  await see(/Create a budget of 10.00 sim/);
  await page.getByRole('button', { name: 'Yes, create the budget' }).click();
  await page.getByText('Created a budget of 10.00 sim from earnings.').waitFor();
  await page.locator('ul.rows li', { hasText: 'own budget' }).first().waitFor();
  await page.screenshot({ path: join(shots, '03-after.png'), fullPage: true });
});
await step('the portfolio target is unavailable without a portfolio policy', async () => {
  await open('Turn earnings into a budget');
  const disabled = await page.locator('#ra-target option[value="portfolio"]').isDisabled();
  assert(disabled, 'portfolio option enabled');
  await open('Turn earnings into a budget');
});
await step('raising limits on a policy that is already on asks first', async () => {
  await open('Change the policy');
  await page.locator('#rp-share').fill('60');
  await page.locator('#rp-why').fill('Walk: raise share');
  await page.getByRole('button', { name: 'Save policy' }).click();
  await see('Allow more to be reinvested? Up to 60%');
  await page.getByRole('button', { name: 'Yes, save these limits' }).click();
  await see('Policy version 2 saved; reinvesting is on.');
});
// Viewer pass: the page is served the workspace list with this workspace's role rewritten
// to viewer, so it shows what a viewer's page renders. The server's refusals for editors and
// viewers are covered by tests/src/funding-api.test.ts.
await step('a viewer sees the figures but no funding controls', async () => {
  await page.route(/\/api\/workspaces$/, async (r) => {
    if (r.request().method() !== 'GET') return r.continue();
    const res = await r.fetch();
    const list = (await res.json()).map((x) => (x.id === ws ? { ...x, role: 'viewer' } : x));
    await r.fulfill({ response: res, json: list });
  });
  await page.reload();
  await funding().waitFor();
  await see('Only the workspace owner can record funding or change reinvesting.');
  await see('Could become budget now');
  for (const control of ['Record money you put in', 'Change the policy', 'Add a funding source', 'Add a commitment', 'Turn earnings into a budget'])
    assert((await page.locator('summary', { hasText: control }).count()) === 0, `viewer sees ${control}`);
  for (const button of ['Record balance…', 'Mark unavailable…', 'Close…'])
    assert((await page.getByRole('button', { name: button }).count()) === 0, `viewer sees ${button}`);
  await page.screenshot({ path: join(shots, '05-viewer.png'), fullPage: true });
  await page.unroute(/\/api\/workspaces$/);
});
await step('phone width: no horizontal page scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await funding().waitFor();
  const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(shots, '04-phone.png'), fullPage: true });
  assert(extra <= 0, `scrolls by ${extra}px`);
});

await browser.close();
await new Promise((r) => web.httpServer.close(r));
await api.close();
await pool.end();
const result = { when: new Date().toISOString(), mode: 'fixture', steps, problems };
await writeFile(join(here, 'walk.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
process.exit(steps.every((s) => s.ok) && problems.length === 0 ? 0 : 1);
