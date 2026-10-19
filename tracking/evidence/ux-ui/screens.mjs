// Captures every studio view at desktop and phone width against the harness in this folder.
// Usage: CREATOR_DEV_LOGIN_CODE=... node tracking/evidence/ux-ui/screens.mjs <playwright module> <chromium> <before|after>
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , pwPath, chromiumPath, label] = process.argv;
const { chromium } = await import(pwPath);
const here = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(here, 'seed.json'), 'utf8'));
const BASE = process.env.UX_BASE ?? 'http://127.0.0.1:5173';
const VIEWS = ['overview', 'submit', 'catalog', 'compare', 'evidence', 'decisions', 'runs', 'budgets', 'scores', 'search', 'activity', 'studies', 'gallery', 'desktop', 'operations'];
const out = join(here, 'screens', label);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: chromiumPath });
for (const [size, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(`${BASE}/#login=${process.env.CREATOR_DEV_LOGIN_CODE}`);
  await page.waitForSelector('nav[aria-label]', { state: 'attached' });
  for (const v of VIEWS) {
    await page.goto(`${BASE}/#/${v}?ws=${seed.ws}`);
    await page.waitForTimeout(900);
    const views = size === 'desktop' || ['overview', 'decisions', 'gallery'].includes(v);
    if (views) await page.screenshot({ path: join(out, `${size}-${v}.png`), fullPage: size === 'desktop' });
  }
  await context.close();
}
await browser.close();
