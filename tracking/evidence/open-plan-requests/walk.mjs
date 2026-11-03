// ADR-0064 walk (2026-11-03), on a throwaway database and the review ports, $0, no model call.
// Usage: node walk.mjs <login-code> <database-url> <out-dir>
// A fixture workspace gets a Claude Code connection (no sign-in) and three plan requests
// inserted with SQL (test seam): one in flight past its stale point, one in flight that started
// a minute ago and one with an unknown outcome. Models and connections lists all three; the
// recent one cannot be closed yet. The old in-flight one is closed in the app.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pg = require('pg');
const WEB = 'http://127.0.0.1:5183';
const [code, dbUrl, out = '.'] = process.argv.slice(2);
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const write = {
  'Content-Type': 'application/json',
  Cookie: cookie,
  'X-CSRF-Token': session.csrf_token,
};
const post = async (path, body) => {
  const r = await fetch(`${WEB}/api/${path}`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${JSON.stringify(j)}`);
  return j;
};
const ws = await post('workspaces', {
  name: 'Open plan requests walk',
  record_mode: 'fixture',
});
const settings = JSON.parse(
  readFileSync(
    new URL('../../../config/connections/claude-code.json', import.meta.url),
    'utf8',
  ),
);
const conn = await post(`workspaces/${ws.id}/plan-connections`, {
  label: 'Claude plan',
  settings,
});
const pool = new pg.Pool({ connectionString: dbUrl });
const ids = {};
for (const [key, state, age, purpose] of [
  ['old', 'in_flight', '2 hours', 'chat'],
  ['recent', 'in_flight', '1 minute', 'qualification'],
  ['unknown', 'unknown', '3 hours', 'verification'],
]) {
  const { rows } = await pool.query(
    `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose, model_id,
       data_class, state, reason_code, created_by, started_at, finished_at)
     values (gen_random_uuid(), $1, gen_random_uuid(), 'responses', $2, 'claude-sonnet-5-5',
       'synthetic', $3, $4, $5, now() - $6::interval,
       case when $3 = 'unknown' then now() - $6::interval + interval '5 minutes' end)
     returning id`,
    [
      conn.id,
      purpose,
      state,
      state === 'unknown' ? 'timeout' : null,
      session.actor_id,
      age,
    ],
  );
  ids[key] = rows[0].id;
}
await pool.end();

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const log = [];
await page.goto(`${WEB}/#/models?ws=${ws.id}`);
const section = page.locator('.open-requests');
await section.waitFor();
log.push(`items: ${await section.locator('li').count()}`);
const item = (text) => section.locator('li', { hasText: text });
log.push(
  `close buttons: ${await section.locator('summary').count()} (expected 2: old in-flight and unknown)`,
);
log.push(
  `recent: ${(await item('Qualification question').locator('p.small').first().textContent()).trim()}`,
);
log.push(
  `recent can be closed: ${await item('Qualification question').locator('summary').count()}`,
);
await section.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}/01-open-requests.png`, fullPage: true });
const old = item('Chat answer');
await old.locator('summary').click();
await old
  .getByLabel('Note (what you checked)')
  .fill('The app was closed while it was asking.');
await page.screenshot({ path: `${out}/02-close-form.png`, fullPage: true });
await old.getByRole('button', { name: 'Close this request' }).click();
await page.waitForFunction(
  () => document.querySelectorAll('.open-requests li').length === 2,
);
log.push(
  `after closing the old in-flight one: ${await section.locator('li').count()} left`,
);
await page.screenshot({ path: `${out}/03-after-close.png`, fullPage: true });
const rows = await (
  await fetch(
    `${WEB}/api/workspaces/${ws.id}/plan-connections/${conn.id}/requests`,
    { headers: { Cookie: cookie } },
  )
).json();
const closed = rows.find((r) => r.id === ids.old);
log.push(`old request: ${closed.state} ${closed.reason_code}`);
console.log(log.join('\n'));
await browser.close();
