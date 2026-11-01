// Browser walk for carried decisions: run against `pnpm dev` with a seed-selection
// workspace after one scorecard was revised. Usage: node walk.mjs <workspace> <problem> <out-dir>
import { chromium } from 'playwright';
const [ws, problem, out] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto('http://127.0.0.1:5173/#login=walk-login-code-0123456789abcdefghijkl');
await p.waitForTimeout(1500);
await p.goto(`http://127.0.0.1:5173/#/compare?ws=${ws}&id=${problem}`);
await p.waitForSelector('form.decide');
await p.waitForTimeout(800);
const state = async () => ({
  notice: (await p.textContent('form.decide [role=status]'))?.trim(),
  flagged: await p.$$eval('form.decide fieldset.flagged legend', (l) => l.map((x) => x.textContent)),
  dispositions: await p.$$eval('form.decide fieldset select', (l) => l.map((x) => x.value)),
  submitDisabled: await p.$eval('form.decide button[type=submit]', (x) => x.disabled),
  cards: await p.$$eval('.alt .kind.flag', (l) => l.map((x) => x.textContent)),
});
console.log('before review', JSON.stringify(await state(), null, 1));
await p.locator('form.decide').screenshot({ path: `${out}/flagged.png` });
for (const btn of await p.$$('form.decide button:has-text("Keep my decision")')) await btn.click();
await p.waitForTimeout(200);
console.log('after keep', JSON.stringify(await state(), null, 1));
await p.click('form.decide button[type=submit]');
await p.waitForTimeout(1500);
console.log('outcome', (await p.textContent('form.decide [aria-live]'))?.trim());
const decision = await p.$('form.decide button:has-text("Open the decision")');
console.log('needs approval:', !!decision);
await b.close();
