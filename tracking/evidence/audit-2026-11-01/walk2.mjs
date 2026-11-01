import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , code] = process.argv;
const base = 'http://127.0.0.1:5183';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', {
  timeout: 20000,
  state: 'attached',
});
const LIN = '1b3ef217-c4de-41c7-9b2d-1b4824a3f94d',
  SEL = 'c2b797a1-be2d-4973-8aec-fa18805b72e9';
const vis = (sel) =>
  p.evaluate(
    (s) =>
      [...document.querySelectorAll(s)]
        .filter((x) => x.offsetParent)
        .map((x) => x.innerText.trim())
        .join(' || ')
        .slice(0, 600),
    sel,
  );
for (const t of ['path', 'try']) {
  await p.goto(`${base}/#/projects/${t}?ws=${LIN}`);
  await p.waitForTimeout(2500);
  console.log('LIN', t, 'next:', await vis('.next-step'));
  await p.screenshot({ path: `./screens/lineage-${t}.png` });
}
console.log('LIN try main:', (await vis('main section')).slice(0, 600));
// chat
await p.goto(`${base}/#/chat/conversations?ws=${SEL}`);
await p.waitForTimeout(2000);
for (const q of [
  'What is Creator Agent and how do I use it?',
  'why is the build blocked?',
  "what's next",
  'Compare the three options for the clinic problem',
  'https://example.com/article',
  'save this idea: a metronome for speedrunners',
  'start a discovery about rhythm game practice tools',
]) {
  await p.fill('#chat-input', q);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1500);
  const r = await p.$$eval('.chat-studio', (d) => {
    const x = d[d.length - 1];
    return x ? x.innerText.replace(/\s+/g, ' ').slice(0, 260) : '';
  });
  console.log('Q:', q, '\n  A:', r);
}
await p.screenshot({ path: './screens/chat-test.png', fullPage: true });
await b.close();
