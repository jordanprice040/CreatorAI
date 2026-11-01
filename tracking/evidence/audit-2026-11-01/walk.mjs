import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , code] = process.argv;
const base = 'http://127.0.0.1:5183';
const WS = 'c2b797a1-be2d-4973-8aec-fa18805b72e9';
const tabs = {
  chat: ['conversations'],
  projects: [
    'path',
    'discover',
    'decide',
    'specs',
    'build',
    'try',
    'sell',
    'campaigns',
    'maintain',
  ],
  sources: ['claims', 'library', 'search'],
  monitor: ['overview', 'approvals', 'runs', 'activity', 'budgets', 'workers'],
  models: ['models', 'github', 'devices'],
  settings: ['general', 'study'],
};
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', {
  timeout: 20000,
  state: 'attached',
});
const out = {};
for (const [page, ts] of Object.entries(tabs))
  for (const t of ts) {
    const before = errors.length;
    await p.goto(`${base}/#/${page}/${t}?ws=${WS}`);
    await p.waitForTimeout(2500);
    const info = await p.evaluate(() => ({
      h1: [...document.querySelectorAll('main h2')].filter(
        (s) => s.offsetParent,
      )[0]?.textContent,
      next: [...document.querySelectorAll('.next-step')]
        .filter((s) => s.offsetParent)
        .map((s) => s.textContent.trim())
        .join(' || '),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      selects: [...document.querySelectorAll('main select')]
        .filter((s) => s.offsetParent)
        .map((s) => ({
          id: s.id || s.getAttribute('aria-label'),
          selected: s.selectedOptions[0]?.textContent,
          options: [...s.options].map((o) => o.textContent).slice(0, 8),
          maxLen: Math.max(
            0,
            ...[...s.options].map((o) => o.textContent.length),
          ),
        })),
      disabledButtons: [...document.querySelectorAll('main button[disabled]')]
        .filter((s) => s.offsetParent)
        .map(
          (x) =>
            (x.textContent || '').trim() + (x.title ? ` [${x.title}]` : ''),
        )
        .slice(0, 10),
      cli: (
        [...document.querySelectorAll('main section')]
          .filter((s) => s.offsetParent)
          .map((s) => s.innerText)
          .join(' ')
          .match(/[^.]*command line[^.]*\./g) || []
      ).slice(0, 5),
    }));
    info.errors = errors.slice(before);
    out[`${page}/${t}`] = info;
    await p.screenshot({ path: `./screens/${page}-${t}.png`, fullPage: false });
  }
writeFileSync('./walk-raw.json', JSON.stringify(out, null, 1));
await b.close();
