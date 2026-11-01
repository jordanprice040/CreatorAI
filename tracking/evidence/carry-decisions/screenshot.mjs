import { chromium } from 'playwright';
const [ws, problem, out] = process.argv.slice(2);
const b = await chromium.launch();
for (const theme of ['dark']) {
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: theme });
await p.goto('http://127.0.0.1:5173/#login=walk-login-code-0123456789abcdefghijkl');
await p.waitForTimeout(1500);
await p.goto(`http://127.0.0.1:5173/#/compare?ws=${ws}&id=${problem}`);
await p.waitForSelector('form.decide fieldset.flagged');
await p.waitForTimeout(800);
await p.locator('form.decide fieldset.flagged').scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -120));
await p.waitForTimeout(200);
await p.screenshot({ path: `${out}/flagged-${theme}.png` });
console.log(theme, (await p.textContent('form.decide fieldset.flagged .carry-flag'))?.trim());
}
await b.close();
