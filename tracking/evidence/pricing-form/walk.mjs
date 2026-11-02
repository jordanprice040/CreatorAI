// Browser walk for "Add this pricing" and "Record a charge" on Monitor › Budgets (audit item
// 4, piece 5), against a throwaway database on the review ports. No provider is called and
// nothing real is spent:
// - a new real workspace adds the bundled documented GPT-6 Astra price (a record only);
// - in a `seed-discovery` fixture workspace, the walk turns the newest settled fixture call
//   into an unknown outcome straight in the throwaway database (psql, below: the same
//   balance moves the broker's crash recovery makes), then records its charge in the form.
// Usage: node walk.mjs <login-code> <out-dir> <psql-url> <fixture-workspace-id>
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, out = '.', pg, fixtureWs] = process.argv.slice(2);
const WEB = 'http://127.0.0.1:5183';
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = {
  'Content-Type': 'application/json',
  Cookie: cookie,
  'X-CSRF-Token': session.csrf_token,
};
const sql = (q) =>
  execFileSync('psql', [pg, '-At', '-c', q], { encoding: 'utf8' }).trim();

const ws = await (
  await fetch(`${WEB}/api/workspaces`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify({ name: 'Pricing walk (real)', record_mode: 'real' }),
  })
).json();
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));

// 1. Real workspace: add the bundled documented price.
await page.goto(`${WEB}/#/monitor/budgets?ws=${ws.id}`);
await page.waitForTimeout(2000);
const offers = page.locator('.pricing-offers');
console.log('offer:', await offers.innerText());
await offers.screenshot({ path: `${out}/01-documented-offer.png` });
await page.getByRole('button', { name: 'Add this pricing' }).click();
await page.waitForTimeout(1500);
const listed = page.locator('li', { hasText: 'openai/gpt-6-astra' });
console.log('listed:', await listed.allInnerTexts());
console.log('offer left:', await page.locator('.pricing-offers').count());
console.log('errors:', await page.locator('[role=alert]').allInnerTexts());
await listed
  .locator('xpath=../..')
  .screenshot({ path: `${out}/02-pricing-added.png` });

// 2. Fixture workspace: a copy of the newest fixture call is stored as an unknown outcome
// (walk only; the database refuses settled -> unknown, so a new attempt row is inserted and
// its exposure held, as the broker's crash recovery would), then its charge is recorded.
const r = sql(`begin;
  with src as (select * from budget_reservations where workspace_id = '${fixtureWs}'
    and status = 'settled' order by created_at desc limit 1),
  ins as (insert into budget_reservations (id, workspace_id, fixture, envelope_id, run_id,
      task_id, logical_operation_id, attempt, request_hash, action_type, provider, model_id,
      pricing_snapshot_id, admission_id, decision_id, status, reason_code, explanation,
      reserved_nano, exposure, created_by, created_at, finished_at)
    select gen_random_uuid(), workspace_id, fixture, envelope_id, run_id, task_id,
      gen_random_uuid(), 1, request_hash, action_type, provider, model_id,
      pricing_snapshot_id, admission_id, decision_id, 'unknown', 'worker_lost',
      'Walk: an unknown outcome made in the throwaway database.', reserved_nano, exposure,
      created_by, now(), now() from src returning id, envelope_id, reserved_nano),
  env as (update budget_envelopes e set unknown_nano = e.unknown_nano + ins.reserved_nano,
      version = e.version + 1 from ins where e.id = ins.envelope_id)
  select id from ins;
  commit;`)
  .split('\n')
  .find((l) => /^[0-9a-f-]{36}$/.test(l));
console.log(
  'reserved:',
  sql(`select reserved_nano from budget_reservations where id = '${r}'`),
);
await page.goto(`${WEB}/#/monitor/budgets?ws=${fixtureWs}`);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Record a charge…' }).first().click();
const form = page.getByRole('form', { name: 'Record a charge' });
await form.getByRole('button', { name: 'Record this charge' }).click();
await page.waitForTimeout(300);
console.log('empty save:', await form.locator('.error').allInnerTexts());
await form.screenshot({ path: `${out}/03-charge-empty.png` });
await form.getByLabel('Input tokens (not cached)').fill('1,200');
await form.getByLabel('Output tokens').fill('300');
await form
  .getByLabel('Where you found it')
  .fill('Walk: typed usage for a fixture call.');
await page.waitForTimeout(200);
console.log('preview:', await form.getByRole('status').allInnerTexts());
await form.screenshot({ path: `${out}/04-charge-filled.png` });
await form.getByRole('button', { name: 'Record this charge' }).click();
await page.waitForTimeout(2000);
console.log('form gone:', (await form.count()) === 0);
console.log(
  'stored:',
  sql(
    `select r.status, r.incurred_nano, u.source, r.result ->> 'evidence', u.usage from budget_reservations r join usage_records u on u.reservation_id = r.id where r.id = '${r}'`,
  ),
);
console.log(
  'unknown left:',
  sql(
    `select count(*) from budget_reservations where workspace_id = '${fixtureWs}' and status = 'unknown'`,
  ),
);
console.log('errors:', await page.locator('[role=alert]').allInnerTexts());
await page.screenshot({ path: `${out}/05-after-charge.png` });
await browser.close();
