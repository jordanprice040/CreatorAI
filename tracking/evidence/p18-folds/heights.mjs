// P18 walk: page heights and screenshots on a throwaway DB. Usage: node walk.mjs <label>
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const label = process.argv[2] ?? 'run';
const web = 'http://127.0.0.1:5183';
const out = process.env.OUT ?? new URL('./screens', import.meta.url).pathname;
const CODE = process.env.WALK_CODE;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
await page.goto(web);
await page.evaluate(async () => {
  await fetch('/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: CODE }) });
});
const ws = await page.evaluate(async () => (await (await fetch('/api/workspaces')).json()));
const results = [];
const targets = [
  ['decide', 'projects/decide'], ['specs', 'projects/specs'], ['proposals', 'projects/proposals'], ['approvals', 'monitor/approvals'],
];
for (const w of ws) {
  for (const [name, path] of targets) {
    await page.goto(`${web}/#/${path}?ws=${w.id}`);
    await page.waitForTimeout(2500);
    const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, ...[...document.querySelectorAll('main, .panel')].map(e => e.scrollHeight)));
    results.push({ ws: w.name, page: name, height: h });
    if (process.env.SHOTS && /selection|discovery/.test(w.name))
      await page.screenshot({ path: `${out}/${label}-${name}-${w.name.split(' ')[1]}.png`, fullPage: true });
  }
}
console.log(JSON.stringify({ label, results }, null, 1));
await browser.close();
