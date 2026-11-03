// Browser walk for the two plan-backed chat rough edges (ADR-0057 follow-up), against
// tracking/evidence/chat-answers/serve.mjs (throwaway database, ports 5183/4330/4340, a FAKE
// `claude` behind a fixture Claude Code connection; no real model).
// 1. Models › Chat answers: what the owner set in the form (answers on, 7 a day, no snapshot)
//    stays after "Allow my private text on this connection" instead of snapping back to the
//    saved settings.
// 2. The top bar's usage button counts a chat answer within a few seconds, with no page change,
//    and the card's "N of M chat answers used" count is current when Models is shown again.
// Usage: node tracking/evidence/chat-rough-edges/walk.mjs [base-url] [out-name]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , base = 'http://127.0.0.1:5183', name = 'walk'] = process.argv;
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
const p = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'dark',
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('#chat-title', { timeout: 15000 });
const chatUrl = p.url();
const card = '.chat-answers-card';
const formState = () =>
  p.$$eval(`${card} input, ${card} select`, (els) =>
    els.map((e) => (e.type === 'checkbox' ? e.checked : e.value)),
  );

// 1. Form keeps the owner's choices after allowing private text.
await p.goto(chatUrl.replace(/#\/chat[^?]*/, '#/connections/models'));
await p.waitForSelector('.chat-problems', { timeout: 10000 });
await p.check(`${card} input[type=checkbox] >> nth=0`);
await p.uncheck(`${card} input[type=checkbox] >> nth=1`);
await p.fill(`${card} input[type=number]`, '7');
log(
  'form before allow [on, connection, model, snapshot, per day]',
  await formState(),
);
await p.click('text=Allow my private text on this connection');
await p.waitForFunction(
  () =>
    ![...document.querySelectorAll('.chat-problems li')].some((l) =>
      l.textContent?.includes('private text'),
    ),
  null,
  { timeout: 10000 },
);
log('form after allow', await formState());
await p
  .locator(card)
  .screenshot({ path: join(shots, `${name}-after-allow.png`) });
await p.click('text=Accept these caps');
await p.waitForFunction(() => !document.querySelector('.chat-problems'), null, {
  timeout: 15000,
});
log('form after accepting caps', await formState());
// Set the choices again if they were lost, so part 2 can run on either version.
await p.check(`${card} input[type=checkbox] >> nth=0`);
await p.uncheck(`${card} input[type=checkbox] >> nth=1`);
await p.fill(`${card} input[type=number]`, '7');
await p.click('text=Save chat answers');
await p.waitForSelector(`${card} [role=status]`);
log('saved', await p.textContent(`${card} [role=status]`));
const countText = () =>
  p.$eval(`${card} p.small`, (x) => x.textContent?.split('.')[0]);
log('card count before answers', await countText());

// 2. Usage button follows chat answers without a page change.
const pill = () => p.textContent('.usage-summary');
await p.goto(chatUrl);
await p.waitForSelector('#chat-input');
async function ask(text, n) {
  await p.fill('#chat-input', text);
  await p.keyboard.press('Enter');
  await p.waitForFunction(
    (k) => document.querySelectorAll('.chat-model-completed').length >= k,
    n,
    { timeout: 20000 },
  );
}
await ask('Which of my ideas should I build first?', 1);
await p.waitForTimeout(2000);
const before = await pill();
const hash = p.url();
log('usage button after first answer', before);
await ask('Is a terminal app OK for people who are not programmers?', 2);
const t0 = Date.now();
let after = before;
while (Date.now() - t0 < 5000 && after === before) {
  await p.waitForTimeout(250);
  after = await pill();
}
log('usage button after second answer (same page, no hash change)', {
  text: after,
  changed: after !== before,
  same_address: p.url() === hash,
  ms_after_answer: Date.now() - t0,
});
await p.screenshot({ path: join(shots, `${name}-usage-after-answer.png`) });

// The card's own count is current when Models is shown again (pages stay mounted).
await p.evaluate(
  (u) => {
    location.hash = new URL(u).hash;
  },
  chatUrl.replace(/#\/chat[^?]*/, '#/connections/models'),
);
await p.waitForSelector(card);
await p.waitForTimeout(1500);
log('card count after returning to Models', await countText());
log('page errors', errors);
await browser.close();
await writeFile(join(here, `${name}.json`), JSON.stringify(out, null, 2));
