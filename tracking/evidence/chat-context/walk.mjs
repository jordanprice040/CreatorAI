// ADR-0070 browser walk: chat context, against chat-context/serve.mjs (throwaway database,
// ports 5183/4330/4340, a FAKE `claude`; no real model). Checks: a broad request in Automatic
// is answered with General context and no snapshot; a request naming "my ideas" sends the
// snapshot and says why; an explicit General makes "What's next?" a question for the model;
// Selected records shows removable chips and the answer lists exactly the picked record.
// Screenshots in dark, light and phone width.
// Usage: node tracking/evidence/chat-context/walk.mjs [base-url]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , base = 'http://127.0.0.1:5183'] = process.argv;
const code = 'walk-login-code-0123456789abcdefghijkl';
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright',
);
const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const out = [];
const log = (k, v) => {
  out.push({ check: k, result: v });
  console.log(k, JSON.stringify(v));
};
const browser = await chromium.launch();
async function signedIn(opts, theme) {
  const p = await browser.newPage(opts);
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const posts = [];
  p.on(
    'request',
    (r) => r.method() === 'POST' && posts.push(new URL(r.url()).pathname),
  );
  await p.goto(`${base}/#login=${code}`);
  await p.waitForSelector('nav[aria-label="Pages"]', {
    timeout: 15000,
    state: 'attached',
  });
  await p.evaluate(
    (t) => localStorage.setItem('creator-agent.theme', t),
    theme,
  );
  await p.reload();
  await p.waitForSelector('#chat-title');
  return { p, errors, posts };
}
async function send(p, text) {
  const before = await p.$$eval('.chat-turn', (t) => t.length);
  await p.fill('#chat-input', text);
  await p.keyboard.press('Enter');
  await p.waitForFunction(
    (n) => document.querySelectorAll('.chat-turn').length > n,
    before,
  );
}
const turns = (p) =>
  p.$$eval('.chat-turn', (ts) =>
    ts.map((t) => ({
      you: t.querySelector('.chat-you .chat-text')?.textContent,
      model: [...t.querySelectorAll('.chat-model')].map((m) => ({
        meta: m.querySelector('.chat-meta')?.textContent,
        text:
          m.querySelector('.chat-text')?.textContent ??
          m.querySelector('p:not(.chat-meta)')?.textContent,
      })),
      ask: [...t.querySelectorAll('.chat-actions button')]
        .map((b) => b.textContent)
        .filter((x) => x?.startsWith('Ask')),
    })),
  );
const sentInfo = (p) =>
  p.$$eval('.chat-sent', (ds) =>
    ds.map((d) => ({
      summary: d.querySelector('p.small')?.textContent,
      records: [...d.querySelectorAll('li')].map((l) => l.textContent),
      snapshot: (d.querySelector('pre')?.textContent ?? '').includes(
        '<studio_snapshot>',
      ),
      selected: (d.querySelector('pre')?.textContent ?? '').includes(
        '<selected_records>',
      ),
    })),
  );
const answered = (p, n) =>
  p.waitForFunction(
    (k) => document.querySelectorAll('.chat-model-completed').length >= k,
    n,
    { timeout: 20000 },
  );
{
  const { p, errors, posts } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
    'dark',
  );
  log('intro', await p.textContent('.chat > p.small'));
  log(
    'context options',
    await p.$$eval('.chat-context select option', (o) =>
      o.map((x) => x.textContent),
    ),
  );
  await send(p, 'Brainstorm three names for a neighbourhood bakery.');
  await answered(p, 1);
  await send(p, 'Which of my ideas is the easiest first build?');
  await answered(p, 2);
  await p.selectOption('.chat-context select', 'general');
  log('general hint', await p.textContent('.chat-context .small'));
  await send(p, "What's next?");
  await answered(p, 3);
  await p.selectOption('.chat-context select', 'selected');
  await p.waitForSelector('.chat-context details summary');
  await p.click('.chat-context details summary');
  await p.click('.chat-pick-list button >> nth=0');
  await p.click('.chat-pick-list button >> nth=0');
  log(
    'chips after two picks',
    await p.$$eval('.chat-chips li', (l) => l.map((x) => x.textContent)),
  );
  await p.click('.chat-chips li button >> nth=1');
  log(
    'chips after remove',
    await p.$$eval('.chat-chips li', (l) => l.map((x) => x.textContent)),
  );
  await p.screenshot({ path: join(shots, 'composer-selected-dark.png') });
  await send(p, 'What is the riskiest assumption here?');
  await answered(p, 4);
  for (const d of await p.$$('.chat-sent summary')) await d.click();
  log('turns', await turns(p));
  log('what was sent', await sentInfo(p));
  log(
    'context tags on your messages',
    await p.$$eval('.chat-you .chat-meta', (m) =>
      m.map((x) => x.textContent?.split(' · ').slice(2).join(' · ') || ''),
    ),
  );
  log(
    'answer requests sent',
    posts.filter((x) => x.endsWith('/answer')).length,
  );
  await p.screenshot({
    path: join(shots, 'chat-context-dark.png'),
    fullPage: true,
  });
  // PR #139 re-review L-A: picks survive the first message of a new conversation.
  await p.click('text=New conversation');
  await p.waitForFunction(
    () => document.querySelectorAll('.chat-turn').length === 0,
  );
  await p.selectOption('.chat-context select', 'selected');
  await p.waitForSelector('.chat-context details summary');
  await p.$eval('.chat-context details', (d) => {
    d.open = true;
  });
  await p.click('.chat-pick-list button >> nth=0');
  await send(p, 'First question in a new conversation');
  await answered(p, 1);
  log(
    'new conversation: chips after first send',
    await p.$$eval('.chat-chips li', (l) => l.map((x) => x.textContent)),
  );
  log('dark: page errors', errors);
}
{
  const { p, errors } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
    'light',
  );
  await p.click('.chat-convo >> nth=0');
  await p.waitForSelector('.chat-model-completed');
  await p.selectOption('.chat-context select', 'selected');
  await p.screenshot({
    path: join(shots, 'chat-context-light.png'),
    fullPage: true,
  });
  log('light: page errors', errors);
}
{
  const { p, errors } = await signedIn(
    {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      colorScheme: 'dark',
    },
    'dark',
  );
  await p.click('.chat-convo >> nth=0');
  await p.waitForSelector('.chat-model-completed');
  await p.selectOption('.chat-context select', 'selected');
  await p.waitForSelector('.chat-context details summary');
  await p.click('.chat-context details summary');
  log(
    'phone: horizontal overflow',
    await p.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  );
  await p.screenshot({
    path: join(shots, 'chat-context-phone.png'),
    fullPage: true,
  });
  log('phone: page errors', errors);
}
await browser.close();
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2));
