// UX/UI redesign browser acceptance: headless Chromium against `vite preview` and the API
// started by harness.mjs (fixture workspace, test-double artifacts). Every step asserts on what
// the page shows; a failure is recorded and the run exits non-zero.
// Usage (harness running, same env):
//   CREATOR_DATABASE_URL=... CREATOR_DEV_LOGIN_CODE=... \
//     node tracking/evidence/ux-ui/browser-acceptance.mjs <playwright module> <chromium>
// Two synthetic worker rows (labelled "Synthetic ...") are inserted into the harness database
// so the worker and Operations states can be observed; nothing outside that database changes.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , pwPath, chromiumPath] = process.argv;
const { chromium } = await import(pwPath);
const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, 'seed.json'), 'utf8'));
const BASE = process.env.UX_BASE ?? 'http://127.0.0.1:5173';
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
const DB = process.env.CREATOR_DATABASE_URL;
if (!CODE || !DB) throw new Error('missing CREATOR_DEV_LOGIN_CODE or CREATOR_DATABASE_URL');
const OWNER = '00000000-0000-4000-8000-000000000001';
const VIEWS = ['overview', 'submit', 'compare', 'catalog', 'evidence', 'scores', 'search', 'decisions', 'runs', 'budgets', 'activity', 'gallery', 'studies', 'desktop', 'operations'];
const shots = join(here, 'screens', 'checks');

const steps = [];
const problems = [];
async function step(name, fn) {
  console.log(`… ${name}`);
  try {
    const detail = await fn();
    steps.push({ name, ok: true, ...(detail ? { detail } : {}) });
  } catch (e) {
    steps.push({ name, ok: false, error: String(e?.message ?? e).split('\n')[0] });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const url = (view, extra = '') => `${BASE}/#/${view}?ws=${seed.ws}${extra}`;

const psql = (sql) => execFileSync('psql', [DB, '-qtAc', sql], { encoding: 'utf8' });
const owner = OWNER;
for (const [label, lease] of [
  ['Synthetic worker online', `now() + interval '2 hours'`],
  ['Synthetic worker gone quiet', `now() - interval '5 minutes'`],
]) {
  psql(`insert into desktop_devices (id, kind, owner_id, workspace_id, label, capabilities, token_hash, state, expires_at, last_seen_at, lease_expires_at)
        values ('${randomUUID()}', 'worker', '${owner}', '${seed.ws}', '${label}', '["artifact.verify"]', '${randomBytes(32).toString('hex')}', 'active', now() + interval '1 day', now() - interval '1 minute', ${lease})`);
}

const browser = await chromium.launch({ executablePath: chromiumPath });
const watch = (page) => {
  page.setDefaultTimeout(8000);
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/\b(401|500|503)\b|Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`);
  });
};
const noPageScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// 1. Fresh install, light OS theme: dark before the app script runs, and after load.
const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
const page = await fresh.newPage();
watch(page);
await step('fresh load with a light OS theme paints dark before the app runs', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  await page.route(/\/assets\/.*\.js$/, async (route) => {
    await gate;
    await route.continue().catch(() => undefined);
  });
  let before;
  try {
    // Module scripts block DOMContentLoaded, so wait only for the response and the stylesheet.
    await page.goto(BASE, { waitUntil: 'commit' });
    await page.waitForFunction(() => document.body && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)');
    before = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      bg: getComputedStyle(document.body).backgroundColor,
      root: document.getElementById('root').childElementCount,
    }));
  } finally {
    release();
  }
  assert(before.root === 0, 'app had already rendered');
  assert(before.theme === 'dark', `theme ${before.theme}`);
  assert(before.bg === 'rgb(20, 19, 18)', `background ${before.bg}`);
  return before;
});
await step('signed-out page offers the sign-in form in the dark theme', async () => {
  await page.getByLabel('Login code').waitFor();
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'not dark');
  await page.screenshot({ path: join(shots, '02-sign-in.png') });
});

// 2. Keyboard: the skip link is the first stop and moves focus to the content.
await step('first Tab reaches a visible skip link; Enter moves focus to main', async () => {
  await page.keyboard.press('Tab');
  const skip = await page.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    return { text: a.textContent, left: r.left, outline: getComputedStyle(a).outlineStyle };
  });
  assert(skip.text === 'Skip to content' && skip.left >= 0, JSON.stringify(skip));
  const hash = await page.evaluate(() => location.hash);
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => ({ id: document.activeElement.id, hash: location.hash }));
  assert(after.id === 'content' && after.hash === hash, JSON.stringify(after));
  return skip;
});

// 3. Real sign-in through the form, then the session shows in the top bar.
await step('sign in through the form; session and fixture mode are shown', async () => {
  await page.getByLabel('Login code').fill(CODE);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.locator('.who').getByText('Sign out').waitFor();
  await page.goto(url('overview'));
  await page.getByRole('note').getByText('Fixture mode.').waitFor();
  const conn = await page.locator('.conn').textContent();
  assert(/fixture provider only/.test(conn), conn);
  await page.screenshot({ path: join(shots, '03-monitor.png'), fullPage: true });
});

// 4. Every view is reachable from the grouped navigation, with page state in the crumbs.
await step('every view opens from the grouped navigation with aria-current and title', async () => {
  const groups = await page.locator('.nav-group h2').allTextContents();
  assert(groups.join('|') === 'Studio|Evidence|Oversight|Build and study|System', groups.join('|'));
  for (const v of VIEWS) {
    await page.locator(`nav a[href^="#/${v}?"]`).click();
    await page.waitForFunction((v) => location.hash.startsWith(`#/${v}?`), v).catch(async () => {
      throw new Error(`${v}: hash ${await page.evaluate(() => location.hash)}`);
    });
    const cur = await page.locator('nav a[aria-current="page"]').getAttribute('href');
    assert(cur.startsWith(`#/${v}?`), `${v}: current ${cur}`);
    const crumb = await page.locator('.crumbs strong').textContent();
    assert((await page.title()).startsWith(`${crumb} · `), `${v}: title ${await page.title()}`);
    assert(!(await page.locator('main .error-box').count()), `${v}: error shown`);
  }
  return { views: VIEWS.length, groups };
});

// 4b. Leaving a view before its data loads: the late load must not pull the user back.
await step('a slow Runs load finishing after leaving for Budgets does not navigate back', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const slow = /\/api\/workspaces\/[^/]+\/workflows$/;
  await page.route(slow, async (r) => {
    await gate;
    await r.continue().catch(() => undefined);
  });
  try {
    await page.goto(url('overview'));
    await page.locator('nav a[href^="#/runs?"]').click();
    await page.locator('nav a[href^="#/budgets?"]').click();
    await page.waitForFunction(() => location.hash.startsWith('#/budgets?'));
  } finally {
    release();
  }
  await page.waitForTimeout(1500);
  await page.unroute(slow);
  const hash = await page.evaluate(() => location.hash);
  assert(hash === `#/budgets?ws=${seed.ws}`, hash);
});

// 5. Deep link to a record survives a reload.
await step('catalog record deep link reopens the same record after reload', async () => {
  await page.goto(url('catalog'));
  await page.locator('main .rows button.text, main .records li button.text').first().click();
  await page.locator('#rec-title').waitFor();
  const title = await page.locator('#rec-title').textContent();
  const hash = await page.evaluate(() => location.hash);
  assert(/[?&]id=/.test(hash), hash);
  await page.reload();
  await page.locator('#rec-title').waitFor();
  assert((await page.locator('#rec-title').textContent()) === title, 'different record after reload');
  assert((await page.evaluate(() => location.hash)) === hash, 'hash changed');
  return { hash: hash.replace(seed.ws, '<ws>'), title };
});

// 6. Evidence: a source shows its passages with locators; contrary/uncertain states keep words.
await step('evidence source opens with passage locators and retrieval status', async () => {
  await page.goto(url('evidence'));
  await page.getByRole('button', { name: 'Regional Clinic Access Report 2025' }).click();
  await page.getByRole('heading', { name: /^Source: Regional Clinic Access Report 2025/ }).waitFor();
  const text = await page.locator('main').textContent();
  assert(/¶\d+ · \d+–\d+/.test(text), 'no paragraph locator');
  assert(/inaccessible/.test(text), 'inaccessible source state not shown');
  await page.screenshot({ path: join(shots, '04-evidence-source.png'), fullPage: true });
});

// 7. One real oversight interaction: revoke a standing policy on the fixture workspace.
await step('revoking a standing policy removes it from the list', async () => {
  await page.goto(url('decisions'));
  const revoke = page.getByRole('button', { name: 'Revoke' });
  await revoke.first().waitFor();
  const before = await revoke.count();
  await revoke.first().click();
  await page.waitForFunction((n) => document.querySelectorAll('main button').length && [...document.querySelectorAll('main button')].filter((b) => b.textContent === 'Revoke').length === n - 1, before);
  return { before, after: before - 1 };
});

// 8. Budget figures with exact precision and simulated-unit labels.
await step('budget view shows charged, reserved, unknown and simulated units', async () => {
  await page.goto(url('budgets'));
  await page.getByText('Unknown outcome (held)').waitFor();
  const text = await page.locator('main').textContent();
  assert(/0\.543460 sim/.test(text), 'charged amount missing');
  assert(/simulated units/.test(text), 'simulated-unit notice missing');
});

// 9. Gallery: integrity and the not-isolation-evidence warning remain.
await step('gallery keeps integrity and not-isolation-evidence labels', async () => {
  await page.goto(url('gallery', `&id=${seed.second}`));
  await page.getByText('Not isolation evidence.').first().waitFor();
  await page.getByText(/Integrity checked/).waitFor();
  await page.getByRole('button', { name: 'Start private preview' }).waitFor();
});

// 10. Worker states in words, on the desktop view and the Operations view.
await step('an unreachable worker shows its actual state on Desktop and Operations', async () => {
  await page.goto(url('desktop'));
  const quiet = page.locator('article', { hasText: 'Synthetic worker gone quiet' });
  await quiet.locator('.badge').getByText('unreachable: not reporting').first().waitFor();
  await page.locator('article', { hasText: 'Synthetic worker online' }).locator('.badge').getByText('online').first().waitFor();
  await page.screenshot({ path: join(shots, '05-desktop-workers.png'), fullPage: true });
  await page.goto(url('operations'));
  await page.getByText('unreachable (stopped reporting)').first().waitFor();
  await page.screenshot({ path: join(shots, '06-operations.png'), fullPage: true });
});

// 11. Error and retry state from a failed request.
await step('a failing request shows an error with Try again, and retry recovers', async () => {
  let fail = true;
  await page.route(/\/api\/workspaces\/[^/]+\/overview$/, (r) =>
    fail ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"X","message":"Synthetic failure for the UI check"}}' }) : r.continue(),
  );
  await page.goto(url('overview'));
  await page.getByRole('alert').getByText('Synthetic failure for the UI check').waitFor();
  await page.screenshot({ path: join(shots, '07-error-state.png') });
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByText('decisions waiting for you').waitFor();
  await page.unroute(/\/api\/workspaces\/[^/]+\/overview$/);
});

// 12. Theme choice persists across reload; dark returns when chosen again.
await step('theme toggle saves light, survives reload, and returns to dark', async () => {
  await page.getByRole('button', { name: 'Use light theme' }).click();
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'not light');
  await page.reload();
  await page.getByRole('button', { name: 'Use dark theme' }).waitFor();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(bg === 'rgb(244, 243, 238)', bg);
  await page.getByText('decisions waiting for you').waitFor();
  await page.screenshot({ path: join(shots, '08-light-theme.png') });
  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await page.reload();
  assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'not dark after reload');
});

// 13. Contrast of the token pairs used for text, in both themes.
await step('text tokens meet 4.5:1 on every surface in both themes', async () => {
  const results = {};
  for (const theme of ['dark', 'light']) {
    results[theme] = await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      const css = getComputedStyle(document.documentElement);
      const rgb = (v) => {
        const c = document.createElement('canvas').getContext('2d');
        c.fillStyle = css.getPropertyValue(v).trim();
        c.fillRect(0, 0, 1, 1);
        return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lum = ([r, g, b]) => {
        const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const fg = ['--text', '--text-2', '--text-3', '--accent', '--ok', '--warn', '--danger', '--info', '--muted'];
      const bg = ['--canvas', '--surface-sidebar', '--surface', '--surface-raised', '--surface-hover'];
      const low = [];
      let min = 99;
      for (const f of fg) for (const b of bg) {
        const r = ratio(f, b);
        min = Math.min(min, r);
        if (r < 4.5) low.push(`${f} on ${b}: ${r.toFixed(2)}`);
      }
      const button = ratio('--text-on-accent', '--accent-bg');
      if (button < 4.5) low.push(`--text-on-accent on --accent-bg: ${button.toFixed(2)}`);
      return { min: Number(min.toFixed(2)), button: Number(button.toFixed(2)), low };
    }, theme);
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  assert(!results.dark.low.length && !results.light.low.length, JSON.stringify(results));
  return results;
});

// 14. Keyboard focus is visible on navigation and buttons.
await step('focused controls draw a visible focus outline', async () => {
  await page.goto(url('overview'));
  await page.locator('nav a').first().focus();
  await page.keyboard.press('Tab');
  const o = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement);
    return { tag: document.activeElement.tagName, style: s.outlineStyle, width: s.outlineWidth };
  });
  assert(o.style === 'solid' && o.width === '2px', JSON.stringify(o));
  return o;
});

// 15. Long names: a real workspace with a very long name; no page-wide horizontal scroll.
const longName = 'Synthetic long-name workspace ' + 'with-an-unbroken-identifier-'.repeat(6) + 'end';
await step('a long workspace name and long ids cause no page-wide horizontal scroll', async () => {
  await page.goto(url('overview'));
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.locator('#nwname').fill(longName);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction((n) => [...document.querySelectorAll('#ws option')].some((o) => o.selected && o.textContent.startsWith(n.slice(0, 30))), longName);
  await page.getByText('Nothing needs you right now.').waitFor();
  const over = [];
  for (const v of VIEWS) {
    await page.goto(url(v));
    await page.waitForTimeout(400);
    const d = await noPageScroll(page);
    if (d > 0) over.push(`${v}:${d}`);
  }
  assert(!over.length, over.join(', '));
});

await fresh.close();

// 16. Phone width: menu disclosure, no horizontal scroll on any view, same actions.
const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' });
const phone = await phoneCtx.newPage();
watch(phone);
await phone.goto(`${BASE}/#login=${CODE}`);
await phone.locator('.menu-button').waitFor();
await step('phone: menu opens the navigation, Escape or the backdrop closes it, a link navigates and closes', async () => {
  await phone.goto(url('overview'));
  const menu = phone.getByRole('button', { name: 'Open navigation' });
  await menu.click();
  assert((await phone.locator('.menu-button').getAttribute('aria-expanded')) === 'true', 'not expanded');
  await phone.locator('nav a[href^="#/budgets?"]').waitFor({ state: 'visible' });
  await phone.screenshot({ path: join(shots, '09-phone-menu.png') });
  await phone.keyboard.press('Escape');
  await phone.locator('nav a[href^="#/budgets?"]').waitFor({ state: 'hidden' });
  await phone.getByRole('button', { name: 'Open navigation' }).click();
  await phone.locator('.scrim').click({ position: { x: 370, y: 400 } });
  await phone.locator('nav a[href^="#/budgets?"]').waitFor({ state: 'hidden' });
  await phone.getByRole('button', { name: 'Open navigation' }).click();
  await phone.locator('nav a[href^="#/budgets?"]').click();
  await phone.waitForFunction(() => location.hash.startsWith('#/budgets?'));
  await phone.locator('nav a[href^="#/budgets?"]').waitFor({ state: 'hidden' });
  assert((await phone.locator('.crumbs strong').textContent()) === 'Budgets', 'crumb');
});
await step('phone: no view scrolls the whole page sideways', async () => {
  const over = [];
  for (const v of VIEWS) {
    await phone.goto(url(v));
    await phone.waitForTimeout(500);
    const d = await noPageScroll(phone);
    if (d > 0) over.push(`${v}:${d}`);
  }
  await phone.goto(url('gallery', `&id=${seed.second}`));
  await phone.getByText('Not isolation evidence.').first().waitFor();
  await phone.screenshot({ path: join(shots, '10-phone-gallery.png'), fullPage: true });
  assert(!over.length, over.join(', '));
});
await step('phone: the same oversight controls are present (Stop run, Revoke, Refresh)', async () => {
  await phone.goto(url('decisions'));
  await phone.getByRole('button', { name: 'Stop run' }).first().waitFor();
  await phone.getByRole('button', { name: 'Revoke' }).first().waitFor();
  await phone.getByRole('button', { name: 'Refresh' }).first().waitFor();
});
await step('reduced motion: transitions collapse to near zero', async () => {
  const d = await phone.evaluate(() => getComputedStyle(document.querySelector('.secondary')).transitionDuration);
  assert(d.split(',').every((x) => parseFloat(x) <= 0.00002), d);
  return { transitionDuration: d };
});
await phoneCtx.close();

// 17. API unavailable: the real state is shown with a retry, not a success.
const downCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const down = await downCtx.newPage();
watch(down);
await step('API unavailable shows the down state and a Check connection button', async () => {
  await down.route('**/api/health', (r) => r.abort());
  await down.goto(BASE);
  await down.locator('.conn-down').getByText(/API unavailable/).waitFor();
  await down.getByRole('button', { name: 'Check connection' }).waitFor();
  await down.screenshot({ path: join(shots, '11-api-unavailable.png') });
});
await downCtx.close();
await browser.close();

const failed = steps.filter((s) => !s.ok);
const result = { at: new Date().toISOString(), base: BASE, seed: { ws: '<fixture workspace>', backend: seed.backend }, passed: steps.length - failed.length, failed: failed.length, problems, steps };
writeFileSync(join(here, 'browser-acceptance.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`${result.passed} passed, ${result.failed} failed, ${problems.length} page problems`);
for (const s of failed) console.log(`FAIL ${s.name}: ${s.error}`);
for (const p of problems) console.log(`PROBLEM ${p}`);
process.exit(failed.length || problems.length ? 1 : 0);
