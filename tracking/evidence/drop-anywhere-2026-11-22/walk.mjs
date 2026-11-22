// Drop anywhere (ADR-0072) browser walk against dev servers on 5183/4330/4340 with a THROWAWAY database and a
// `pnpm cli seed-selection` workspace. Uses Chromium's real drag input (CDP Input.dispatchDragEvent with a
// real file), so the browser hit-tests every step the way it does for a file dragged in from the desktop:
//  1. A drag that enters at the left edge, moves over an embedded sandboxed frame and drops there uploads
//     the file (tray says "Added"), keeps the overlay up over the frame, and does not navigate the page.
//     With the overlay's old `pointer-events: none` the frame takes the drop and nothing uploads.
//  2. A cancelled drag (no dragleave or drop reaches the page) leaves the overlay up; the next mouse move
//     hides it, so it cannot keep blocking clicks. The same for Escape.
// It cannot prove the installed app's WebView2 drag on Windows, which needs a real drag there.
// Usage: node tracking/evidence/drop-anywhere-2026-11-22/walk.mjs <login-code> [base-url]
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [, , code, base = 'http://127.0.0.1:5183'] = process.argv;
if (!code) throw new Error('login code required');
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE ?? 'playwright',
);
const dir = await mkdtemp(join(tmpdir(), 'drop-walk-'));
const file = join(dir, 'dropped-note.txt');
await writeFile(file, `hello drop ${Date.now()}\n`);
const log = (k, v) => console.log(k, JSON.stringify(v));
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', {
  timeout: 20000,
  state: 'attached',
});
await p.waitForTimeout(1500);
// A sandboxed srcdoc frame like the studio's inert HTML viewer, placed on the right of the page.
await p.evaluate(() => {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', '');
  f.srcdoc = '<p>embedded preview</p>';
  f.style.cssText =
    'position:fixed;right:40px;top:200px;width:500px;height:400px;z-index:10;background:#fff';
  f.id = 'walk-frame';
  document.body.append(f);
});
const cdp = await p.context().newCDPSession(p);
const data = { items: [], files: [file], dragOperationsMask: 1 };
const drag = (type, x, y) =>
  cdp.send('Input.dispatchDragEvent', { type, x, y, data });
const overlay = () => p.locator('.file-drop-overlay').count();
const topAt = (x, y) =>
  p.evaluate(
    ([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? e.id || e.className || e.tagName : null;
    },
    [x, y],
  );
const url0 = p.url();

// 1. Enter at the left edge, move over the frame, drop over the frame.
await drag('dragEnter', 5, 450);
await drag('dragOver', 5, 450);
await drag('dragOver', 300, 450);
await drag('dragOver', 1100, 400);
await drag('dragOver', 1110, 400);
log('1 overlay up while over the frame', (await overlay()) === 1);
log('1 top element over the frame', await topAt(1110, 400));
await drag('drop', 1110, 400);
await p
  .waitForSelector('.transfer.state-done, .transfer.state-failed', {
    timeout: 15000,
  })
  .catch(() => {});
log(
  '1 tray',
  await p
    .locator('.transfer-tray')
    .textContent()
    .catch(() => null),
);
log('1 overlay gone after drop', (await overlay()) === 0);
log('1 page not navigated', p.url() === url0);

// 2. A cancelled drag, then a mouse move.
await drag('dragEnter', 5, 450);
await drag('dragOver', 300, 450);
await drag('dragCancel', 300, 450);
log('2 overlay still up after cancel', (await overlay()) === 1);
await p.mouse.move(320, 460);
log('2 overlay gone after mouse move', (await overlay()) === 0);
log('2 top element after mouse move', await topAt(300, 450));

// 2b. A cancelled drag, then Escape.
await drag('dragEnter', 5, 450);
await drag('dragOver', 300, 450);
await drag('dragCancel', 300, 450);
log('2b overlay still up after cancel', (await overlay()) === 1);
await p.keyboard.press('Escape');
log('2b overlay gone after Escape', (await overlay()) === 0);

log('page errors', errors);
await browser.close();
