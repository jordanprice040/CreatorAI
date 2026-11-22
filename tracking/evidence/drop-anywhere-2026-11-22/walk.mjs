// Drop anywhere (ADR-0072) browser walk against dev servers on 5183/4330/4340 with a THROWAWAY database and a
// `pnpm cli seed-selection` workspace. Dispatches dragenter/dragover/dragleave/drop with a real DataTransfer
// holding one small text file: the overlay shows, survives moving onto itself, hides when the drag leaves the
// window, and a drop on the overlay uploads the file (tray says "Added") without navigating the page.
// Synthetic events prove the page's handlers and upload path; they cannot prove the native drag of the
// installed app's WebView2, which needs a real drag on Windows.
// Usage: node tracking/evidence/drop-anywhere-2026-11-22/walk.mjs <login-code> [base-url]
import { createRequire } from 'node:module';
const [, , code, base = 'http://127.0.0.1:5183'] = process.argv;
if (!code) throw new Error('login code required');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${base}/#login=${code}`);
await p.waitForSelector('nav[aria-label="Pages"]', { timeout: 20000, state: 'attached' });
await p.waitForTimeout(1500);
const url0 = p.url();
const dt = await p.evaluateHandle(() => {
  const d = new DataTransfer();
  d.items.add(new File(['hello drop ' + Date.now()], 'dropped-note.txt', { type: 'text/plain' }));
  return d;
});
await p.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
await p.dispatchEvent('main', 'dragover', { dataTransfer: dt });
await p.dispatchEvent('.file-drop-overlay', 'dragenter', { dataTransfer: dt });
await p.dispatchEvent('main', 'dragleave', { dataTransfer: dt });
console.log('overlay still shown after moving onto it:', await p.locator('.file-drop-overlay').count());
await p.dispatchEvent('.file-drop-overlay', 'dragleave', { dataTransfer: dt });
console.log('overlay hidden after leaving window:', (await p.locator('.file-drop-overlay').count()) === 0);
await p.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
await p.dispatchEvent('.file-drop-overlay', 'dragenter', { dataTransfer: dt });
await p.dispatchEvent('main', 'dragleave', { dataTransfer: dt });
const overlay = await p.locator('.file-drop-overlay').textContent().catch(() => null);
console.log('overlay:', overlay);
await p.dispatchEvent('.file-drop-overlay', 'drop', { dataTransfer: dt });
await p.waitForSelector('.transfer.state-done, .transfer.state-failed', { timeout: 15000 }).catch(() => {});
console.log('tray:', await p.locator('.transfer-tray').textContent().catch(() => null));
console.log('overlay gone:', (await p.locator('.file-drop-overlay').count()) === 0, 'url same:', p.url() === url0);
console.log('errors', errors);
await browser.close();
