// Studio chat (ADR-0055): browser walk against a running dev studio on a THROWAWAY database
// seeded with `pnpm cli seed-selection` (fixture records only). Checks that the studio opens
// on Chat, that a conversation is saved and named from its first message, that each kind of
// message gets its rule-based reply and cards, that a card fills the Sources fetch form and
// the Discover theme without submitting them, that an earlier answer is marked out of date,
// search, rename, and a reload keeping the conversation. Screenshots in dark, light and
// phone width. No model is called by any step.
// Usage: node tracking/evidence/chat/walk.mjs <login-code> [base-url]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , code, base = 'http://127.0.0.1:5173'] = process.argv;
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright',
);
if (!code) throw new Error('login code required');
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
const studioReplies = (p) =>
  p.$$eval('.chat-studio', (d) =>
    d.map((x) => ({
      text: x.querySelector('p:not(.chat-meta)')?.textContent,
      cards: [...x.querySelectorAll('.chat-actions button')].map(
        (b) => b.textContent,
      ),
    })),
  );
async function send(p, text) {
  const before = await p.$$eval('.chat-turn', (t) => t.length);
  await p.fill('#chat-input', text);
  await p.keyboard.press('Enter');
  await p.waitForFunction(
    (n) => document.querySelectorAll('.chat-turn').length > n,
    before,
  );
}

// Dark, desktop width: the full flow.
{
  const { p, errors } = await signedIn(
    { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
    'dark',
  );
  log('dark: studio opens on', new URL(p.url()).hash);
  log(
    'dark: sidebar pages',
    await p.$$eval('.page-nav a > span:first-child', (a) =>
      a.map((x) => x.textContent),
    ),
  );
  log('dark: tab row on Chat', await p.$$eval('.page-tabs', (n) => n.length));
  log("dark: what's next on Chat", await p.textContent('.next-step'));
  await p.screenshot({ path: join(shots, 'empty-dark.png') });

  await send(p, "What's next?");
  log('dark: address keeps the conversation', new URL(p.url()).hash);
  await send(p, 'Why is it blocked?');
  await send(p, "What's waiting for me?");
  await send(p, 'Look at https://example.org/frame-timing please');
  await send(p, 'Save this idea: a practice timer for frame-perfect inputs');
  await send(p, 'Start a discovery about rural clinic no-shows');
  await send(p, 'The demo went well today.');
  await send(p, "what's next");
  log('dark: replies', await studioReplies(p));
  log('dark: title', await p.textContent('.chat-head h3'));
  await p.screenshot({
    path: join(shots, 'conversation-dark.png'),
    fullPage: true,
  });

  // A card fills the Sources fetch form and opens it; nothing is fetched.
  const fetches = [];
  p.on('request', (r) => r.method() === 'POST' && fetches.push(r.url()));
  await p.click('.chat-actions button:has-text("Fill in the fetch form")');
  await p.waitForSelector(
    '#evidence-title, [aria-labelledby="evidence-title"], .page-tabs',
  );
  await p.waitForTimeout(500);
  log('dark: fetch card opens', new URL(p.url()).hash.split('?')[0]);
  log(
    'dark: fetch form address',
    await p.$eval('input[type="url"]', (i) => i.value).catch(() => 'not found'),
  );
  log('dark: POSTs after the card (expect none)', fetches);
  await p.screenshot({ path: join(shots, 'fetch-filled-dark.png') });

  // Back to Chat (sidebar), then the idea card fills Discover's theme.
  await p.click('.page-nav a:has-text("Chat")');
  await p.waitForSelector('.chat-turn');
  await p.click('.chat-actions button:has-text("Use as a theme in Discover")');
  await p.waitForTimeout(800);
  log('dark: idea card opens', new URL(p.url()).hash.split('?')[0]);
  log(
    'dark: Discover theme',
    await p.$eval('#b-theme', (i) => i.value).catch(() => 'not found'),
  );
  log('dark: POSTs after both cards (expect none)', fetches);
  await p.screenshot({ path: join(shots, 'theme-filled-dark.png') });

  // Search, rename, reload.
  await p.click('.page-nav a:has-text("Chat")');
  await p.waitForSelector('.chat-turn');
  await p.fill('#chat-q', 'FRAME-PERFECT');
  await p.press('#chat-q', 'Enter');
  await p.waitForTimeout(500);
  log(
    'dark: search FRAME-PERFECT',
    await p.$$eval('.chat-convo strong', (s) => s.map((x) => x.textContent)),
  );
  await p.fill('#chat-q', 'nothing-like-this');
  await p.press('#chat-q', 'Enter');
  await p.waitForTimeout(500);
  log('dark: search miss', await p.textContent('.chat-list p.small'));
  await p.fill('#chat-q', '');
  await p.click('.chat-head button:has-text("Rename")');
  await p.fill('#chat-title-input', 'Timer ideas');
  await p.click('.chat-head button:has-text("Save")');
  await p.waitForSelector('.chat-head h3:has-text("Timer ideas")');
  await p.reload();
  await p.waitForSelector('.chat-turn');
  log('dark: after reload title', await p.textContent('.chat-head h3'));
  log(
    'dark: after reload turns',
    await p.$$eval('.chat-turn', (t) => t.length),
  );
  log('dark: page errors', errors);
}

// Light theme and phone width: screenshots only, plus layout checks.
for (const [name, viewport, theme] of [
  ['light', { width: 1280, height: 900 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
]) {
  const { p, errors } = await signedIn({ viewport, colorScheme: theme }, theme);
  await p.click('.chat-convo');
  await p.waitForSelector('.chat-turn');
  log(
    `${name}: horizontal overflow`,
    await p.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  );
  await p.screenshot({ path: join(shots, `conversation-${name}.png`) });
  log(`${name}: page errors`, errors);
}

await browser.close();
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2) + '\n');
