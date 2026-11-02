// Right-hand sidebar (ADR-0060): browser walk against a running dev studio on a THROWAWAY
// database seeded with `pnpm cli seed-selection` (fixture records only). Checks the three
// layouts (docked from 1500px, rail from 1100px, top-bar drawer below), that folding is
// remembered on a docked window, that the page and the sidebar do not overlap, that notes save
// as you type and survive a reload, and that a second window's save is never overwritten
// without asking, and that sign-out warns before it drops unsaved notes. Screenshots in dark
// and light. No model is called by any step.
// Usage: node tracking/evidence/right-sidebar/walk.mjs <login-code> [base-url]
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
const errors = [];
async function signedIn(ctx, width, theme = 'dark') {
  const p = await ctx.newPage();
  await p.setViewportSize({ width, height: 900 });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(`${base}/#login=${code}`);
  await p.waitForSelector('nav[aria-label="Pages"]', {
    timeout: 20000,
    state: 'attached',
  });
  await p.evaluate(
    (t) => localStorage.setItem('creator-agent.theme', t),
    theme,
  );
  await p.reload();
  await p.waitForSelector('nav[aria-label="Pages"]', { state: 'attached' });
  return p;
}
// Types into the notes and waits for the save request it causes to come back.
async function typeAndSave(page, text) {
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/notes') && r.request().method() === 'POST',
  );
  await page.fill('#aside-notes textarea', text);
  return (await saved).status();
}
const box = (p, sel) =>
  p.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
    };
  });

// 1. Wide window: docked open by default, next to the page without covering it.
const ctx = await browser.newContext({ colorScheme: 'dark' });
const p = await signedIn(ctx, 1600);
await p.waitForSelector('#right-sidebar');
log('1600: layout', await p.$eval('.shell', (s) => s.dataset.aside));
const mainBox = await box(p, '.column');
const asideBox = await box(p, '.right-aside');
log('1600: page and sidebar do not overlap', mainBox.right <= asideBox.left);
log('1600: sidebar width', asideBox.width);
await p.waitForSelector('#aside-activity .aside-h');
log(
  '1600: activity sections',
  await p.$$eval('#aside-activity .aside-h', (h) =>
    h.map((x) => x.textContent),
  ),
);
log(
  '1600: recent entries shown',
  await p.$$eval('#aside-activity ol.aside-list > li', (l) => l.length),
);
await p.screenshot({ path: join(shots, 'docked-dark-1600.png') });

// Notes save as you type and survive a reload.
await p.click('#aside-tab-notes');
const field = '#aside-notes textarea';
await p.waitForSelector(field);
log(
  'notes: save status',
  await typeAndSave(
    p,
    'Call the clinic about the no-show data.\nTry a 2-week pilot.',
  ),
);
log('notes: status after typing', await p.textContent('.notes-status'));
await p.screenshot({ path: join(shots, 'notes-dark-1600.png') });
await p.reload();
await p.waitForSelector(field);
log(
  'notes: tab remembered after reload',
  await p.getAttribute('#aside-tab-notes', 'aria-selected'),
);
log('notes: text after reload', await p.inputValue(field));

// Folding is remembered on a docked window; Ctrl+. unfolds.
await p.click('.aside-head .icon-button');
await p.waitForSelector('.aside-rail');
log(
  'fold: layout after folding',
  await p.$eval('.shell', (s) => s.dataset.aside),
);
await p.reload();
await p.waitForSelector('.aside-rail');
log(
  'fold: still folded after reload',
  (await p.$$eval('#right-sidebar', (x) => x.length)) === 0,
);
await p.screenshot({ path: join(shots, 'folded-dark-1600.png') });
await p.keyboard.press('Control+.');
await p.waitForSelector('#right-sidebar');
log('fold: Ctrl+. unfolds', await p.$eval('.shell', (s) => s.dataset.aside));

// 2. Another window saved first: the person chooses, nothing is lost silently.
// A second window of the same signed-in browser (same session, no new sign-in).
const q = await ctx.newPage();
await q.setViewportSize({ width: 1600, height: 900 });
q.on('pageerror', (e) => errors.push(String(e)));
await q.goto(base);
await q.waitForSelector('#right-sidebar');
await q.click('#aside-tab-notes');
await q.waitForSelector(field);
log('conflict: window A saves', await typeAndSave(p, 'Text from window A'));
log(
  'conflict: window B save refused',
  await typeAndSave(q, 'Text from window B'),
);
await q.waitForSelector('#aside-notes .notice', { timeout: 8000 });
log(
  'conflict: window B is asked',
  await q.textContent('#aside-notes .notice p'),
);
await q.screenshot({ path: join(shots, 'conflict-dark-1600.png') });
// Review M-2: text typed during the conflict survives folding and reopening the sidebar.
await q.fill(field, 'Text from window B, plus more typed during the conflict');
await q.click('.aside-head .icon-button');
await q.waitForSelector('.aside-rail');
await q.click('.aside-rail button[aria-label="Notes"]');
await q.waitForSelector('#aside-notes .notice');
log('conflict: text kept after fold and reopen', await q.inputValue(field));
const kept = q.waitForResponse(
  (r) => r.url().endsWith('/notes') && r.request().method() === 'POST',
);
await q.click('text=Keep what is here');
log('conflict: keep mine saves', (await kept).status());
await p.reload();
await p.waitForSelector(field);
log('conflict: window A after reload shows B', await p.inputValue(field));
// Review M-1: a long note (70,000 characters, over the old 64 KiB body limit) saves.
log('long note: save status', await typeAndSave(p, 'n'.repeat(70_000)));
await q.close();

// 3. Mid-size window: a rail; the panel slides over the page and Esc closes it.
await p.setViewportSize({ width: 1280, height: 900 });
await p.waitForSelector('.aside-rail');
log('1280: layout', await p.$eval('.shell', (s) => s.dataset.aside));
await p.screenshot({ path: join(shots, 'rail-dark-1280.png') });
await p.click('.aside-rail button[aria-label^="Activity"]');
await p.waitForSelector('.right-aside.overlay #right-sidebar');
await p.waitForTimeout(400); // let the slide-in finish
await p.screenshot({ path: join(shots, 'overlay-dark-1280.png') });
await p.keyboard.press('Escape');
log(
  '1280: Esc closes the overlay',
  (await p.$$('.right-aside.overlay')).length === 0,
);
await ctx.close();

// 4. Small window and phone, light theme: no rail, a top-bar button opens a drawer.
for (const width of [960, 390]) {
  const c = await browser.newContext({ colorScheme: 'light' });
  const s = await signedIn(c, width, 'light');
  log(`${width}: layout`, await s.$eval('.shell', (x) => x.dataset.aside));
  log(`${width}: no rail`, (await s.$$('.aside-rail')).length === 0);
  await s.click('button[aria-label="Open activity and notes"]');
  await s.waitForSelector('.right-aside.overlay #right-sidebar');
  await s.waitForTimeout(400); // let the slide-in finish
  const b = await box(s, '.right-aside.overlay');
  log(`${width}: drawer fits the window`, b.left >= 0 && b.right <= width);
  log(
    `${width}: no horizontal scroll`,
    await s.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await s.screenshot({ path: join(shots, `drawer-light-${width}.png`) });
  await c.close();
}
// Light docked, for the theme check.
{
  const c = await browser.newContext({ colorScheme: 'light' });
  const s = await signedIn(c, 1600, 'light');
  await s.waitForSelector('#aside-activity .aside-h');
  await s.screenshot({ path: join(shots, 'docked-light-1600.png') });
  await c.close();
}
// 5. Sign-out with unsaved notes (review L-E) and a copy left by someone else (review L-D).
{
  const c = await browser.newContext();
  const s = await signedIn(c, 1600);
  // A copy left behind by another person whose sign-out never reached the server.
  await s.evaluate(() =>
    sessionStorage.setItem(
      'creator.notes-draft.someone-else.ws',
      JSON.stringify({ text: 'left behind', base_version: 0 }),
    ),
  );
  await s.reload();
  await s.waitForSelector('nav[aria-label="Pages"]', { state: 'attached' });
  await s.waitForTimeout(500);
  log(
    "sign-in: other people's unsaved copies removed",
    await s.evaluate(
      () =>
        sessionStorage.getItem('creator.notes-draft.someone-else.ws') === null,
    ),
  );
  await s.click('#aside-tab-notes');
  // Block saves so the typed text stays unsaved; the blocked requests log load errors that are
  // expected here and are counted separately below.
  const errorsBefore = errors.length;
  await s.route('**/notes', (r) =>
    r.request().method() === 'POST' ? r.abort() : r.continue(),
  );
  await s.fill('#aside-notes textarea', 'not saved yet');
  const asked = [];
  s.once('dialog', (d) => {
    asked.push(d.message());
    void d.dismiss();
  });
  await s.click('.who button:has-text("Sign out")');
  await s.waitForTimeout(300);
  log('sign-out: warns about unsaved notes', asked);
  log(
    'sign-out: declining keeps the session and the text',
    (await s.$$('.who')).length === 1 &&
      (await s.inputValue('#aside-notes textarea')) === 'not saved yet',
  );
  s.once('dialog', (d) => void d.accept());
  await s.click('.who button:has-text("Sign out")');
  await s.waitForFunction(() => !document.querySelector('.who'));
  log(
    'sign-out: accepting signs out and clears the copy',
    await s.evaluate(
      () =>
        !Object.keys(sessionStorage).some((k) =>
          k.startsWith('creator.notes-draft.'),
        ),
    ),
  );
  const blocked = errors.splice(errorsBefore);
  log(
    'sign-out: only the blocked saves failed',
    blocked.every((e) => e.includes('net::ERR_FAILED')),
  );
  await c.close();
}
log('console and page errors', errors);
await browser.close();
await writeFile(join(here, 'walk.json'), `${JSON.stringify(out, null, 2)}\n`);
