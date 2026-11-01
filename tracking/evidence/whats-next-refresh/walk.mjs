// What's-next line and refresh (step 9 audit items 3 and 6): browser walk against a dev
// studio on a THROWAWAY database seeded with `pnpm cli seed-selection` (fixture records only).
// Checks that pages outside Projects show the short path summary and Projects the full line,
// that a page hidden while records change shows them when it comes back, and that the line
// reads again right after an action instead of on the next 15 s tick.
// Usage: node tracking/evidence/whats-next-refresh/walk.mjs <login-code> [base-url]
// The second seed runs through the CLI, so CREATOR_API_URL and CREATOR_SESSION_FILE must
// point at the same throwaway studio.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , code, base = 'http://127.0.0.1:5183'] = process.argv;
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright',
);
if (!code) throw new Error('login code required');
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const out = [];
const log = (k, v) => {
  out.push({ check: k, result: v });
  console.log(k, JSON.stringify(v));
};

const browser = await chromium.launch();
const p = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', {
  timeout: 15000,
  state: 'attached',
});
const ws = new URLSearchParams(p.url().split('?')[1] ?? '').get('ws');
const go = async (hash, selector) => {
  await p.click(`.page-nav a[href*="#/${hash.split('/')[0]}"]`);
  if (hash.includes('/'))
    await p.click(`.page-tabs a[href*="#/${hash}"]`).catch(() => {});
  if (selector) await p.waitForSelector(selector);
  await p.waitForTimeout(800);
};
const line = async () =>
  await p
    .$eval('.next-step', (e) => ({
      style: e.classList.contains('next-short') ? 'short' : 'full',
      text: e.textContent?.trim(),
    }))
    .catch(() => null);

// 1. Where the line is full and where it is a short summary.
for (const [hash, sel] of [
  ['projects/path', '.path-stages'],
  ['projects/decide', '#cmp-title'],
  ['chat/conversations', null],
  ['monitor/overview', null],
  ['connections/models', null],
  ['settings/general', null],
]) {
  await go(hash, sel);
  log(`line on ${hash}`, await line());
  await p.screenshot({ path: join(shots, `${hash.replace('/', '-')}.png`) });
}

// 2. A page hidden while records change shows them when it is shown again.
await go('projects/decide', '#cmp-title');
const options = () =>
  p.$$eval('#cmp-problem option', (o) => o.map((x) => x.textContent));
const before = (await options()).length;
await go('settings/general');
// A problem recorded in this workspace through the CLI while Decide is hidden.
execFileSync(
  'node',
  [
    'apps/cli/dist/main.js',
    'create',
    ws,
    'problem',
    'Walk: problem added while Decide was hidden',
    JSON.stringify({
      statement: 'Synthetic walk problem, recorded while Decide was hidden.',
      affected_group: 'Synthetic walk group',
      uncertainty: 'Synthetic; not research.',
    }),
  ],
  { stdio: 'ignore' },
);
const t0 = Date.now();
await go('projects/decide', '#cmp-title');
await p.waitForTimeout(1500);
const after = (await options()).length;
log('Decide problem options before/after a problem added while hidden', {
  before,
  after,
  ms: Date.now() - t0,
});

// 3. The line reads again right after an action (no 15 s wait): freezing a spec raises an
// approval, so the pending-decision note should appear within a couple of seconds.
await go('projects/specs', null);
await p.waitForTimeout(1000);
const visible = '.draft-page:not([hidden])';
const specButton = await p.$(`${visible} ul.entities button.text`);
if (specButton) await specButton.click();
const freeze = await p
  .waitForSelector(`${visible} button:has-text("Freeze this version")`, {
    timeout: 8000,
  })
  .catch(() => null);
if (freeze) {
  await p.fill(`${visible} #frz-why`, 'Walk: synthetic fixture spec, ready.');
  const lineBefore = await line();
  const t1 = Date.now();
  await freeze.click();
  let changed = null;
  for (let i = 0; i < 20; i++) {
    await p.waitForTimeout(250);
    const now = await line();
    if (JSON.stringify(now) !== JSON.stringify(lineBefore)) {
      changed = { ms: Date.now() - t1, now };
      break;
    }
  }
  log('line after Freeze', { before: lineBefore, changed });
  await p.screenshot({ path: join(shots, 'after-freeze.png') });
} else log('line after Freeze', 'no freeze form found');

log('page errors', errors);
await writeFile(join(here, 'walk.json'), JSON.stringify({ ws, out }, null, 2));
await browser.close();
