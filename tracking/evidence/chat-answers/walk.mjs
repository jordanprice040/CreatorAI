// ADR-0057 browser walk: chat answers from a connected plan, against serve.mjs (throwaway
// database, ports 5183/4330/4340, a FAKE `claude` behind a fixture Claude Code connection; no
// real model). Checks: answers are off by default and Chat says so; the owner allows private
// text on the connection, re-accepts its caps and turns chat answers on in Models and
// connections; an earlier note gets an "Ask" button and a labelled answer with a "What was
// sent" panel; a new note is answered automatically; a rule question keeps its rule reply and
// is not sent automatically. Screenshots in dark, light and phone width.
// Usage: node tracking/evidence/chat-answers/walk.mjs [base-url]
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

{
  const { p, errors, posts } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
    'dark',
  );
  log('off: intro', await p.textContent('.chat > p.small'));
  await send(p, 'Which of my ideas should I build first?');
  await p.waitForTimeout(500);
  log('off: turns', await turns(p));
  log(
    'off: answer requests sent',
    posts.filter((x) => x.endsWith('/answer')).length,
  );
  const chatUrl = p.url();

  // Owner turns it on in Models and connections.
  await p.goto(chatUrl.replace(/#\/chat[^?]*/, '#/connections/models'));
  await p.waitForSelector('#chat-answers-title');
  await p.waitForSelector('.chat-problems', { timeout: 10000 });
  log(
    'models: problems before',
    await p.$$eval('.chat-problems li', (l) => l.map((x) => x.textContent)),
  );
  await p.screenshot({
    path: join(shots, 'models-card-before-dark.png'),
    fullPage: false,
  });
  await p.click('text=Allow my private text on this connection');
  await p.waitForSelector('text=Accept these caps', { timeout: 10000 });
  await p.click('text=Accept these caps');
  await p.waitForFunction(
    () => !document.querySelector('.chat-problems'),
    null,
    { timeout: 15000 },
  );
  log(
    'models: problems after allow + accept',
    await p.$$eval('.chat-problems li', (l) => l.length),
  );
  await p.check('.chat-answers-card input[type=checkbox] >> nth=0');
  log(
    'models: selects',
    await p.$$eval('.chat-answers-card select', (s) =>
      s.map((x) => [...x.options].map((o) => o.textContent)),
    ),
  );
  await p.click('text=Save chat answers');
  await p.waitForSelector('.chat-answers-card [role=status]');
  log('models: saved', await p.textContent('.chat-answers-card [role=status]'));
  await p
    .locator('.chat-answers-card')
    .screenshot({ path: join(shots, 'models-card-on-dark.png') });

  // Back in Chat: the earlier note can be asked; a new note is answered automatically.
  await p.goto(chatUrl);
  await p.waitForSelector('.chat-turn');
  await p.waitForSelector(
    '.chat-actions button:has-text("Ask claude-sonnet-5-5")',
  );
  log('on: intro', await p.textContent('.chat > p.small'));
  log('on: turns before ask', await turns(p));
  await p.click('.chat-actions button:has-text("Ask claude-sonnet-5-5")');
  await p.waitForSelector('.chat-model-completed', { timeout: 20000 });
  await send(p, 'Is a terminal app OK for people who are not programmers?');
  await p.waitForFunction(
    () => document.querySelectorAll('.chat-model-completed').length >= 2,
    null,
    { timeout: 20000 },
  );
  await send(p, "What's next?");
  await p.waitForTimeout(800);
  log('on: turns', await turns(p));
  await p.click('.chat-sent summary >> nth=0');
  log(
    'on: what was sent (first 300 chars)',
    (await p.textContent('.chat-sent pre >> nth=0'))?.slice(0, 300),
  );
  log(
    'on: answer requests sent',
    posts.filter((x) => x.endsWith('/answer')).length,
  );
  await p.screenshot({
    path: join(shots, 'chat-answers-dark.png'),
    fullPage: true,
  });
  log('dark: page errors', errors);
}
{
  const { p, errors } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
    'light',
  );
  await p.click('.chat-convo >> nth=0');
  await p.waitForSelector('.chat-model-completed');
  await p.screenshot({
    path: join(shots, 'chat-answers-light.png'),
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
  log(
    'phone: horizontal overflow',
    await p.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  );
  await p.screenshot({
    path: join(shots, 'chat-answers-phone.png'),
    fullPage: true,
  });
  log('phone: page errors', errors);
}
await browser.close();
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2));
