// Opens the pages with record and run pickers and records each picker's groups, options
// and selected value; screenshots Decide and Monitor › Runs.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const { chromium } = createRequire('/home/user/CreatorAI/package.json')(
  'playwright',
);
const [, , code, WS, outDir] = process.argv;
const base = 'http://127.0.0.1:5183';
const tabs = [
  'projects/decide',
  'projects/specs',
  'projects/discover',
  'projects/build',
  'monitor/runs',
  'monitor/budgets',
  'monitor/approvals',
  'sources/claims',
  'sources/library',
  'models/github',
];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', {
  timeout: 20000,
  state: 'attached',
});
const out = {};
for (const t of tabs) {
  await p.goto(`${base}/#/${t}?ws=${WS}`);
  await p.waitForTimeout(3000);
  out[t] = await p.evaluate(() =>
    [...document.querySelectorAll('main select')]
      .filter((s) => s.offsetParent)
      .map((s) => ({
        id: s.id || s.getAttribute('aria-label'),
        selected: s.selectedOptions[0]?.textContent,
        options: [...s.options].map(
          (o) =>
            (o.parentElement.tagName === 'OPTGROUP'
              ? `[${o.parentElement.label}] `
              : '') + o.textContent,
        ),
      }))
      .filter((s) =>
        /problem|run|subject|claim|review|brun|benv/i.test(s.id ?? ''),
      ),
  );
  // A native dropdown doesn't render in a screenshot, so open each picker as a list box.
  const shots = {
    'projects/decide': '#cmp-problem',
    'monitor/runs': '#wsubject',
    'projects/discover': '#b-run',
  };
  if (shots[t]) {
    const el = p.locator(shots[t]);
    await el.evaluate((s) => {
      s.size = Math.min(12, s.options.length + 4);
      s.style.height = 'auto';
    });
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({
      path: `${outDir}/${t.replace('/', '-')}-picker.png`,
    });
  }
}
out.errors = errors;
writeFileSync(`${outDir}/walk.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await b.close();
