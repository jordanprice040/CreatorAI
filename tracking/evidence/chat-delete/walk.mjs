// Chat delete and the prefill fixes (ADR-0063, PR #98 L-1/L-2): browser walk against a dev
// studio on a THROWAWAY database with at least one fixture workspace. Checks: a hand-off from
// Chat fills Sources once (gone after "Reset"/revisit and in another workspace); a failed first
// send is retried into the same conversation, not a new empty one; rename; delete asks first,
// "Keep it" keeps it, and "Delete conversation" removes it from the list. No model is called.
// Usage: node tracking/evidence/chat-delete/walk.mjs <login-code> [base-url]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , code, base = 'http://127.0.0.1:5183'] = process.argv;
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
const p = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('#chat-title', { timeout: 20000 });
const ws = new URL(p.url()).hash.match(/ws=([0-9a-f-]{36})/)?.[1];
log('workspace', ws);
const count = () => p.$$eval('.chat-convo', (c) => c.length);
async function send(text) {
  const before = await p.$$eval('.chat-turn', (t) => t.length);
  await p.fill('#chat-input', text);
  await p.keyboard.press('Enter');
  await p.waitForFunction(
    (n) => document.querySelectorAll('.chat-turn').length > n,
    before,
  );
}

// L-2: the first post fails once; the retry lands in the conversation already created.
const convosBefore = await count();
let failNext = true;
await p.route('**/api/workspaces/*/chats/*/messages', (route) => {
  if (failNext && route.request().method() === 'POST') {
    failNext = false;
    return route.fulfill({ status: 503, body: '{"error":"walk"}' });
  }
  return route.continue();
});
await p.fill('#chat-input', 'Look at https://example.org/frame-timing please');
await p.keyboard.press('Enter');
await p.waitForSelector('.chat .error');
log('L-2 failed send error', await p.textContent('.chat .error'));
await p.keyboard.press('Enter');
await p.waitForSelector('.chat-turn');
await p.waitForTimeout(400);
log(
  'L-2 conversations added by fail+retry (expect 1)',
  (await count()) - convosBefore,
);
await p.unroute('**/api/workspaces/*/chats/*/messages');

// L-1: the card fills the fetch form once.
await p.click('.chat-actions button:has-text("Fill in the fetch form")');
await p.waitForSelector('input[type="url"]');
await p.waitForTimeout(400);
log('L-1 filled address', await p.$eval('input[type="url"]', (i) => i.value));
// "Reset fields" remounts the page: it must start empty, not refill from Chat.
await p.fill('input[type="url"]', 'https://example.org/typed-by-hand');
await p.click('.draft-page:not([hidden]) .page-reset');
await p.click('button:has-text("Reset these fields")');
await p.waitForTimeout(500);
log(
  'L-1 address after Reset (expect empty)',
  await p.$eval('.draft-page:not([hidden]) input[type="url"]', (i) => i.value),
);
// Fill again from Chat, then open Sources in another workspace: it starts empty there.
await p.click('.page-nav a:has-text("Chat")');
await p.waitForSelector('.chat-turn');
await p.click('.chat-actions button:has-text("Fill in the fetch form")');
await p.waitForTimeout(400);
log(
  'L-1 refilled address',
  await p.$eval('.draft-page:not([hidden]) input[type="url"]', (i) => i.value),
);
const other = await p.evaluate(async () => {
  const s = await (await fetch('/api/auth/session')).json();
  const r = await fetch('/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': s.csrf_token,
    },
    body: JSON.stringify({ name: 'Walk B', record_mode: 'fixture' }),
  });
  return (await r.json()).id;
});
const sourcesHash = new URL(p.url()).hash;
await p.goto(`${base}/${sourcesHash.replace(ws, other)}`);
await p.waitForSelector('.draft-page:not([hidden]) input[type="url"]');
await p.waitForTimeout(600);
log(
  'L-1 other workspace address (expect empty)',
  await p.$eval('.draft-page:not([hidden]) input[type="url"]', (i) => i.value),
);
await p.goto(`${base}/${sourcesHash}`);
await p.waitForTimeout(600);

// Rename, then delete with a confirm step.
await p.click('.page-nav a:has-text("Chat")');
await p.waitForSelector('.chat-convo');
await p.click('.chat-convo');
await p.waitForSelector('.chat-turn');
await p.click('.chat-head button:has-text("Rename")');
await p.fill('#chat-title-input', 'Frame timing');
await p.click('.chat-head button:has-text("Save")');
await p.waitForSelector('.chat-head h3:has-text("Frame timing")');
await send('The demo went well today.');
const n0 = await count();
await p.click('.chat-head button:has-text("Delete")');
await p.waitForSelector('.chat-confirm');
log('delete confirm text', await p.textContent('.chat-confirm p'));
await p.screenshot({ path: join(shots, 'delete-confirm-dark.png') });
log(
  'L-4 focus on confirm (expect Keep it)',
  await p.evaluate(() => document.activeElement?.textContent),
);
await p.click('.chat-confirm button:has-text("Keep it")');
log(
  'L-4 focus after Keep it (expect Delete)',
  await p.evaluate(() => document.activeElement?.textContent),
);
await p.waitForSelector('.chat-head h3:has-text("Frame timing")');
log('Keep it keeps (count unchanged)', (await count()) === n0);
await p.click('.chat-head button:has-text("Delete")');
await p.click('.chat-confirm button:has-text("Delete conversation")');
await p.waitForFunction(
  (n) => document.querySelectorAll('.chat-convo').length < n,
  n0,
);
log('after delete: conversations', (await count()) - n0);
log(
  'after delete: open conversation cleared',
  (await p.$('.chat-head')) === null,
);
log('after delete: address', new URL(p.url()).hash);
log(
  'L-4 focus after delete (expect the message box)',
  await p.evaluate(() => document.activeElement?.id),
);
// L-3: a conversation deleted elsewhere (here: straight through the API) while it is open.
await send('Deleted from another tab');
const goneId = new URL(p.url()).hash.match(/[?&]id=([0-9a-f-]{36})/)?.[1];
log('L-3 open conversation', [new URL(p.url()).hash, goneId]);
const deleteElsewhere = (id) =>
  p.evaluate(
    async ([w, id]) => {
      const s = await (await fetch('/api/auth/session')).json();
      await fetch(`/api/workspaces/${w}/chats/${id}/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': s.csrf_token,
        },
        body: '{}',
      });
    },
    [new URL(p.url()).hash.match(/ws=([0-9a-f-]{36})/)[1], id],
  );
await deleteElsewhere(goneId);
await p.click('.page-nav a:has-text("Sources")');
await p.waitForTimeout(300);
await p.click('.page-nav a:has-text("Chat")');
await p.waitForSelector('.chat .error');
log('L-3 notice', await p.textContent('.chat .error'));
const beforeRetry = await count();
await send('Next message after the delete');
log(
  'L-3 next send starts a new conversation (expect +1)',
  (await count()) - beforeRetry,
);
// L-A: deleted elsewhere while the person stays on Chat and sends.
await deleteElsewhere(
  new URL(p.url()).hash.match(/[?&]id=([0-9a-f-]{36})/)?.[1],
);
await p.fill('#chat-input', 'Sent without leaving Chat');
await p.keyboard.press('Enter');
await p.waitForSelector('.chat .error:has-text("was deleted")');
log('L-A notice after a failed send', await p.textContent('.chat .error'));
log('L-A draft kept', await p.$eval('#chat-input', (i) => i.value));
const beforeResend = await count();
await p.keyboard.press('Enter');
await p.waitForSelector('.chat-turn');
await p.waitForTimeout(400);
log(
  'L-A resend starts a new conversation (expect +1)',
  (await count()) - beforeResend,
);
await p.screenshot({ path: join(shots, 'after-delete-dark.png') });
// Phone width: the confirm wraps without overflow.
await p.setViewportSize({ width: 390, height: 844 });
await send('Another note to delete');
await p.click('.chat-head button:has-text("Delete")');
await p.waitForSelector('.chat-confirm');
log(
  'phone: horizontal overflow',
  await p.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  ),
);
await p.screenshot({ path: join(shots, 'delete-confirm-phone.png') });
log('page errors (expect only the forced 503 and the L-3/L-A 404s)', errors);
await browser.close();
await writeFile(join(here, 'walk.json'), JSON.stringify(out, null, 2) + '\n');
