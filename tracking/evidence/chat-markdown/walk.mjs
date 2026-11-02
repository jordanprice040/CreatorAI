// Chat Markdown browser walk, against ./serve.mjs (throwaway database, fake `claude`, no real
// model). Turns chat answers on the same way ../chat-answers/walk.mjs does, asks once, then
// checks the answer renders as Markdown (headings, bold, lists, a table, code, a quote, links)
// with no HTML from the answer turned into elements and no unsafe link kept; and that the
// theme button sits in the sidebar foot above "Schema 1.0", not in the top bar. Screenshots
// in dark, light, a narrow window and phone width.
// Usage: node tracking/evidence/chat-markdown/walk.mjs [base-url]
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
  p.on('dialog', (d) => {
    errors.push(`dialog: ${d.message()}`);
    void d.dismiss();
  });
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
  return { p, errors };
}
const shape = (p) =>
  p.$eval('.chat-model-completed .md', (md) => ({
    blocks: [...md.children].map((c) => c.tagName.toLowerCase()),
    headings: [...md.querySelectorAll('h4,h5,h6')].map((h) => h.textContent),
    bold: [...md.querySelectorAll('strong')].map((b) => b.textContent),
    nestedList: md.querySelectorAll('li ul').length,
    tableCells: [...md.querySelectorAll('td')].map((t) => t.textContent),
    code: [...md.querySelectorAll('code')].map((c) => c.textContent),
    links: [...md.querySelectorAll('a')].map((a) => [
      a.textContent,
      a.getAttribute('href'),
      a.getAttribute('target'),
      a.getAttribute('rel'),
    ]),
    answerElements: md.querySelectorAll('script,img,iframe,[onerror]').length,
    rawHtmlShownAsText: md.textContent.includes('<img src=x onerror=alert(1)>'),
    rawMarksLeft: /\*\*|###/.test(md.textContent),
  }));
const themeSpot = (p) =>
  p.evaluate(() => {
    const b = document.querySelector('.theme-button');
    const foot = document.querySelector('.sidebar-foot');
    return {
      inSidebarFoot: Boolean(b && foot?.contains(b)),
      inTopbar: Boolean(document.querySelector('.topbar .theme-button')),
      aboveSchema:
        b?.nextElementSibling?.textContent?.startsWith('Schema 1.0') ?? false,
      topbarHeight: document.querySelector('.topbar')?.getBoundingClientRect()
        .height,
    };
  });

{
  const { p, errors } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
    'dark',
  );
  const chatUrl = p.url();
  await p.goto(chatUrl.replace(/#\/chat[^?]*/, '#/connections/models'));
  await p.waitForSelector('#chat-answers-title');
  await p.waitForSelector('.chat-problems', { timeout: 10000 });
  await p.click('text=Allow my private text on this connection');
  await p.waitForSelector('text=Accept these caps', { timeout: 10000 });
  await p.click('text=Accept these caps');
  await p.waitForFunction(
    () => !document.querySelector('.chat-problems'),
    null,
    {
      timeout: 15000,
    },
  );
  await p.check('.chat-answers-card input[type=checkbox] >> nth=0');
  await p.click('text=Save chat answers');
  await p.waitForSelector('.chat-answers-card [role=status]');
  await p.goto(chatUrl);
  await p.waitForSelector('#chat-input');
  await p.fill('#chat-input', 'Explain Creator Agent to me and how to use it');
  await p.keyboard.press('Enter');
  await p.waitForSelector('.chat-model-completed .md', { timeout: 20000 });
  log('dark: answer shape', await shape(p));
  log('dark: theme button', await themeSpot(p));
  await p.locator('.chat-model-completed').screenshot({
    path: join(shots, 'answer-dark.png'),
  });
  await p.screenshot({ path: join(shots, 'chat-dark.png') });
  await p.$eval('.chat-model-completed pre.md-code', (e) =>
    e.scrollIntoView({ block: 'center' }),
  );
  await p.screenshot({ path: join(shots, 'answer-end-dark.png') });
  // The toggle still works from its new place.
  await p.click('.theme-button');
  log(
    'dark: theme after click',
    await p.evaluate(() => document.documentElement.dataset.theme),
  );
  log('dark: page errors', errors);
}
{
  const { p, errors } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
    'light',
  );
  await p.click('.chat-convo >> nth=0');
  await p.waitForSelector('.chat-model-completed .md');
  await p.locator('.chat-model-completed').screenshot({
    path: join(shots, 'answer-light.png'),
  });
  await p.screenshot({ path: join(shots, 'chat-light.png') });
  log('light: page errors', errors);
}
{
  // A window that is not full screen, like the one in Jordan's screenshot.
  const { p, errors } = await signedIn(
    { viewport: { width: 1195, height: 780 }, colorScheme: 'dark' },
    'dark',
  );
  log('narrow window: theme button', await themeSpot(p));
  await p.screenshot({ path: join(shots, 'window-1195-dark.png') });
  log('narrow window: page errors', errors);
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
  await p.waitForSelector('.chat-model-completed .md');
  log(
    'phone: horizontal overflow',
    await p.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  );
  await p.screenshot({ path: join(shots, 'chat-phone.png'), fullPage: true });
  await p.click('.menu-button');
  await p.waitForTimeout(400);
  log('phone: theme button in open menu', await themeSpot(p));
  await p.screenshot({ path: join(shots, 'menu-phone.png') });
  log('phone: page errors', errors);
}
await browser.close();
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2));
