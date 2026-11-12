// PR #129 review N-4: the owner-action buttons, checked in the real pages for each member role
// (owner, editor, viewer), not only in the pure helpers. Throwaway database, review ports,
// fixture provider only, $0, no model call. Start ../owner-actions/stack.mjs first, then:
//   node tracking/evidence/member-roles/walk.mjs <database-url> <out-dir>
// Seeds `seed-discovery` through the real CLI and API, adds one ChatGPT plan connection whose
// quota is marked exhausted with SQL, and one open budget. Then, for each role, it sets the
// signed-in member's role with SQL (test seam: development sign-in has one member) and counts
// the buttons on Models, Budgets, Library, Evidence and Runs. For each hidden button it also
// sends the action to the server as that role and expects a refusal, so the page and the
// server agree. Nothing is changed by an owner action: the owner's buttons are only counted.
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const pg = createRequire(
  new URL('../../../packages/db/package.json', import.meta.url),
)('pg');
const WEB = 'http://127.0.0.1:5183';
const CODE = 'walk-login-code-0123456789abcdefghij';
const [dbUrl, out = '.'] = process.argv.slice(2);
if (!dbUrl || !/walk|throwaway/.test(dbUrl))
  throw new Error('Use a throwaway database whose name contains "walk".');
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};

const dir = await mkdtemp(join(tmpdir(), 'member-roles-'));
const cenv = {
  ...process.env,
  CREATOR_API_URL: 'http://127.0.0.1:4330',
  CREATOR_SESSION_FILE: join(dir, 'session.json'),
};
const cli = async (...args) =>
  JSON.parse(
    (
      await promisify(execFile)(
        process.execPath,
        ['apps/cli/dist/main.js', ...args],
        { env: cenv },
      )
    ).stdout,
  );
await cli('login', CODE);
const seed = await cli('seed-discovery');
const ws = seed.workspace?.id ?? seed.workspace;
console.log('workspace', ws);

const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE }),
});
const session = await login.json();
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const headers = { Cookie: cookie };
const write = {
  ...headers,
  'Content-Type': 'application/json',
  'X-CSRF-Token': session.csrf_token,
};
const get = async (path) =>
  (await fetch(`${WEB}/api/${path}`, { headers })).json();
const post = async (path, body) => {
  const r = await fetch(`${WEB}/api/${path}`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const base = `workspaces/${ws}`;

for (let i = 0; i < 60; i++) {
  const wfs = await get(`${base}/workflows`);
  if (wfs.every((w) => w.finished_at)) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const discovery = (await get(`${base}/workflows`)).find(
  (w) => w.role === 'r02_discovery',
);
const settings = JSON.parse(
  await readFile('config/connections/chatgpt-plan.json', 'utf8'),
);
const conn = (
  await post(`${base}/plan-connections`, {
    label: 'Walk ChatGPT plan',
    settings,
  })
).body;
const pool = new pg.Pool({ connectionString: dbUrl });
await pool.query(
  `update plan_connections set quota = jsonb_build_object('state', 'exhausted', 'reason_code', 'usage_limit_reached', 'observed_at', $2::text) where id = $1`,
  [conn.id, new Date().toISOString()],
);
const budget = (
  await post(`${base}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Walk budget kept open',
    cap_nano_usd: '5000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  })
).body;
const problem = (await get(`${base}/entities?kind=problem&status=active`))[0];
let claim = null;
let supportRow = null;
for (const c of await get(`${base}/entities?kind=claim`)) {
  const row = (await get(`${base}/claims/${c.id}/evidence`)).rows?.find(
    (r) => !r.support.retracted_at && r.counted,
  );
  if (row) {
    claim = c;
    supportRow = row;
    break;
  }
}
check(
  Boolean(conn.id && budget.id && problem && claim && discovery),
  'seeded connection, budget, problem, supported claim, discovery',
);
const actor = session.actor_id ?? session.actor?.id;
const member = await pool.query(
  'select actor_id from workspace_members where workspace_id = $1 and role = $2',
  [ws, 'owner'],
);
const me = actor ?? member.rows[0]?.actor_id;
const setRole = (role) =>
  pool.query(
    'update workspace_members set role = $3 where workspace_id = $1 and actor_id = $2',
    [ws, me, role],
  );

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
});
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const count = (label) =>
  page.getByRole('button', { name: label, exact: true }).count();
// Each page loads its data after mounting; wait for a marker that is there for every role.
async function open(hash, marker) {
  await page.goto('about:blank');
  await page.goto(`${WEB}/#/${hash}`);
  await page
    .getByText(marker)
    .locator('visible=true')
    .first()
    .waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);
}
const refused = (r) => r.status >= 400 && r.status < 500 && r.status !== 404;

// Expected buttons per role (true: shown). The server enforces the same rules.
const EXPECT = {
  owner: {
    reset: true,
    close: true,
    archive: true,
    retract: true,
    packet: true,
  },
  editor: {
    reset: false,
    close: false,
    archive: true,
    retract: true,
    packet: true,
  },
  viewer: {
    reset: false,
    close: false,
    archive: false,
    retract: false,
    packet: true,
  },
};
for (const role of ['owner', 'editor', 'viewer']) {
  await setRole(role);
  const want = EXPECT[role];
  const ws_ = (await get('workspaces')).find?.((w) => w.id === ws);
  check(
    !ws_ || ws_.role === role,
    `${role}: the server reports the role ${ws_?.role ?? '(not listed)'}`,
  );

  await open(`models?ws=${ws}`, 'Models and connections');
  check(
    (await count('Usage has reset: allow requests again')) > 0 === want.reset,
    `${role}: Models "Usage has reset" ${want.reset ? 'shown' : 'hidden'}`,
  );

  await open(`budgets?ws=${ws}`, 'Walk budget kept open');
  const card = page.locator('article.decision', {
    hasText: 'Walk budget kept open',
  });
  check(
    (await card.getByRole('button', { name: 'Close this budget…' }).count()) >
      0 ===
      want.close,
    `${role}: Budgets "Close this budget…" ${want.close ? 'shown' : 'hidden'}`,
  );
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(out, `${role}-budgets.png`) });

  await open(`catalog?ws=${ws}&id=${problem.id}`, 'Find mentions of this id');
  check(
    (await count('Archive…')) > 0 === want.archive,
    `${role}: Library "Archive…" ${want.archive ? 'shown' : 'hidden'}`,
  );

  await open(
    `evidence?ws=${ws}&id=claim:${claim.id}`,
    claim.title.slice(0, 30),
  );
  check(
    (await count('Retract…')) > 0 === want.retract,
    `${role}: Evidence "Retract…" ${want.retract ? 'shown' : 'hidden'}`,
  );

  await open(`runs?ws=${ws}&id=${discovery.id}`, 'Show the evidence packet');
  check(
    (await count('Show the evidence packet')) > 0 === want.packet,
    `${role}: Runs "Show the evidence packet" ${want.packet ? 'shown' : 'hidden'}`,
  );

  // A hidden button's action is refused by the server as this role (nothing changes).
  if (!want.reset) {
    const c = await get(`${base}/plan-connections/${conn.id}`);
    const r = await post(`${base}/plan-connections/${conn.id}/quota-recheck`, {
      expected_version: (c.connection ?? c).version,
    });
    check(
      refused(r),
      `${role}: server refuses the quota reset (${r.status} ${r.body?.error?.code ?? ''})`,
    );
  }
  if (!want.close) {
    const e = await get(`${base}/budgets/${budget.id}`);
    const r = await post(`${base}/budgets/${budget.id}/close`, {
      expected_version: e.version,
      reason: 'Walk: must be refused.',
    });
    check(
      refused(r),
      `${role}: server refuses closing the budget (${r.status} ${r.body?.error?.code ?? ''})`,
    );
  }
  if (!want.archive) {
    const e = await get(`${base}/entities/${problem.id}`);
    const r = await post(`${base}/entities/${problem.id}/archive`, {
      expected_version: e.entity.version,
      reason: 'Walk: must be refused.',
    });
    check(
      refused(r),
      `${role}: server refuses archiving (${r.status} ${r.body?.error?.code ?? ''})`,
    );
  }
  if (!want.retract) {
    const r = await post(
      `${base}/claim-support/${supportRow.support.id}/retract`,
      { reason: 'Walk: must be refused.' },
    );
    check(
      refused(r),
      `${role}: server refuses retracting (${r.status} ${r.body?.error?.code ?? ''})`,
    );
  }
}
await setRole('owner');
const after = await get(`${base}/budgets/${budget.id}`);
const ent = await get(`${base}/entities/${problem.id}`);
const ev = await get(`${base}/claims/${claim.id}/evidence`);
check(
  after.status !== 'closed' &&
    ent.entity.status === 'active' &&
    ev.rows.some(
      (r) => r.support.id === supportRow.support.id && !r.support.retracted_at,
    ),
  'nothing was changed by the refused actions',
);
check(
  errors.length === 0,
  `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`,
);
await browser.close();
await pool.end();
