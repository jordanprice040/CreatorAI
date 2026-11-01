// Page map (step 9): browser walk against a running dev studio on a THROWAWAY database
// seeded with `pnpm cli seed-selection` (fixture records only). Checks that old addresses are
// rewritten to page and tab, that the sidebar shows five pages, that each page's tabs open
// their screens, and the Projects › Path tab; screenshots in dark, light and phone width.
// Usage: node tracking/evidence/page-map/walk.mjs <login-code> [base-url]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , code, base = 'http://127.0.0.1:5173'] = process.argv;
// Playwright from the machine's global install (not a repo dependency).
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
async function signedIn(opts) {
  const p = await browser.newPage(opts);
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(`${base}/#login=${code}`);
  await p.waitForSelector('nav[aria-label="Pages"]', {
    timeout: 15000,
    state: 'attached',
  });
  return { p, errors };
}

for (const theme of ['dark', 'light']) {
  const { p, errors } = await signedIn({
    viewport: { width: 1280, height: 900 },
    colorScheme: theme,
  });
  await p.evaluate(
    (t) => localStorage.setItem('creator-agent.theme', t),
    theme,
  );
  const ws = new URLSearchParams(p.url().split('?')[1] ?? '').get('ws');
  // Old address → new page and tab.
  await p.goto(`${base}/#/compare?ws=${ws}`);
  await p.reload();
  await p.waitForSelector('#cmp-title');
  log(`${theme}: legacy #/compare rewritten`, new URL(p.url()).hash);
  log(
    `${theme}: sidebar pages`,
    await p.$$eval('.page-nav a > span:first-child', (a) =>
      a.map((x) => x.textContent),
    ),
  );
  log(
    `${theme}: Projects tabs`,
    await p.$$eval('.page-tabs .tabs a', (a) => a.map((x) => x.textContent)),
  );
  log(`${theme}: crumbs`, await p.textContent('.crumbs'));
  await p.screenshot({ path: join(shots, `decide-${theme}.png`) });
  // The Path tab.
  await p.click('.page-tabs .tabs a:has-text("Path")');
  await p.waitForSelector('.path-stages');
  await p.waitForTimeout(500);
  log(
    `${theme}: path stages`,
    await p.$$eval('.path-stage', (li) =>
      li.map(
        (l) =>
          `${l.querySelector('strong')?.textContent}:${l.className.replace('path-stage stage-', '')}`,
      ),
    ),
  );
  log(`${theme}: what's next`, await p.textContent('.next-step'));
  await p.screenshot({
    path: join(shots, `path-${theme}.png`),
    fullPage: true,
  });
  // Launch: one tab, three sections.
  await p.click('.page-tabs .tabs a:has-text("Launch")');
  await p.waitForSelector('.page-tabs .subtabs');
  log(
    `${theme}: Launch sections`,
    await p.$$eval('.page-tabs .subtabs a', (a) => a.map((x) => x.textContent)),
  );
  await p.click('.page-tabs .subtabs a:has-text("Campaigns")');
  await p.waitForTimeout(300);
  log(`${theme}: Campaigns address`, new URL(p.url()).hash.split('?')[0]);
  // Every page opens and returns to the last tab used there.
  for (const page of [
    'Sources',
    'Monitor',
    'Models and connections',
    'Settings',
  ]) {
    await p.click(`.page-nav a:has-text("${page}")`);
    await p.waitForTimeout(400);
    log(`${theme}: ${page}`, {
      hash: new URL(p.url()).hash.split('?')[0],
      tabs: await p.$$eval('.page-tabs .tabs a', (a) =>
        a.map((x) => x.textContent),
      ),
    });
  }
  await p.click('.page-nav a:has-text("Monitor")');
  await p.click('.page-tabs .tabs a:has-text("Runs")');
  await p.click('.page-nav a:has-text("Projects")');
  await p.waitForTimeout(300);
  log(
    `${theme}: Projects reopens last tab`,
    new URL(p.url()).hash.split('?')[0],
  );
  await p.click('.page-nav a:has-text("Monitor")');
  await p.waitForTimeout(300);
  log(
    `${theme}: Monitor reopens last tab`,
    new URL(p.url()).hash.split('?')[0],
  );
  await p.screenshot({ path: join(shots, `monitor-runs-${theme}.png`) });
  // Back returns to the previous tab.
  await p.goBack();
  await p.waitForTimeout(300);
  log(`${theme}: Back`, new URL(p.url()).hash.split('?')[0]);
  log(`${theme}: page errors`, errors);
  await p.close();
}

const { p, errors } = await signedIn({ viewport: { width: 390, height: 820 } });
await p.click('.menu-button');
await p.waitForTimeout(300);
await p.screenshot({ path: join(shots, 'phone-menu.png') });
await p.click('.page-nav a:has-text("Projects")');
await p.waitForTimeout(500);
await p.screenshot({ path: join(shots, 'phone-projects.png'), fullPage: true });
log('phone: page errors', errors);
await browser.close();
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2) + '\n');
