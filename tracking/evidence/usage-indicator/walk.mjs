import { chromium } from 'playwright';
const b = await chromium.launch();
for (const theme of ['dark', 'light']) {
  const p = await b.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: theme });
  await p.goto('http://127.0.0.1:5173/#login=walk-login-code-0123456789abcdefghijkl');
  await p.waitForTimeout(1500);
  await p.goto(`http://127.0.0.1:5173/#/overview?ws=${process.argv[2]}`);
  await p.waitForSelector('.usage-summary');
  await p.waitForTimeout(800);
  console.log(theme, await p.textContent('.usage-summary'));
  await p.click('.usage-summary');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `/tmp/walk/usage-${theme}.png` });
  await p.keyboard.press('Escape');
  console.log('open after Escape:', await p.$eval('details.usage', (d) => d.open));
}
const m = await b.newPage({ viewport: { width: 390, height: 800 } });
await m.goto('http://127.0.0.1:5173/#login=walk-login-code-0123456789abcdefghijkl');
await m.waitForTimeout(1500);
await m.goto(`http://127.0.0.1:5173/#/overview?ws=${process.argv[2]}`);
await m.waitForSelector('.usage-summary'); await m.waitForTimeout(800);
await m.click('.usage-summary'); await m.waitForTimeout(300);
await m.screenshot({ path: '/tmp/walk/usage-mobile.png' });
await b.close();
