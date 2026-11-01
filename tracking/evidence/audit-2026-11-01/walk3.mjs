import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , code] = process.argv;
const base = 'http://127.0.0.1:5183',
  WS = 'c2b797a1-be2d-4973-8aec-fa18805b72e9';
const s = JSON.parse(readFileSync(process.env.CREATOR_SESSION_FILE, 'utf8'));
const h = {
  cookie: 'creator_session=' + s.token,
  'x-csrf-token': s.csrf,
  'content-type': 'application/json',
};
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', {
  timeout: 20000,
  state: 'attached',
});
const count = async (sel) => p.$$eval(sel + ' option', (o) => o.length);
for (const [tab, sel] of [
  ['decide', '#cmp-problem'],
  ['specs', '#sel-problem'],
]) {
  await p.goto(`${base}/#/projects/${tab}?ws=${WS}`);
  await p.waitForTimeout(2500);
  const before = await count(sel);
  const body = (
    await (
      await fetch(
        `http://127.0.0.1:4330/api/workspaces/${WS}/entities?kind=problem`,
        { headers: h },
      )
    ).json()
  )[0].body;
  await fetch(`http://127.0.0.1:4330/api/workspaces/${WS}/entities`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      kind: 'problem',
      title: 'Newest problem added while page hidden ' + tab,
      body,
    }),
  });
  await p.click('nav[aria-label="Pages"] >> text=Chat');
  await p.waitForTimeout(1500);
  await p.goto(`${base}/#/projects/${tab}?ws=${WS}`);
  await p.waitForTimeout(2500);
  const after = await count(sel);
  await p.waitForTimeout(16000);
  const later = await count(sel);
  console.log(
    tab,
    'options before',
    before,
    'after return',
    after,
    'after 16s',
    later,
    'selected:',
    await p.$eval(sel, (s) => s.selectedOptions[0]?.textContent),
  );
}
await b.close();
