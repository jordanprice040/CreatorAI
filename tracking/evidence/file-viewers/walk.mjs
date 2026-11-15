// ADR-0106 browser walk: the inert file viewers. On a throwaway database (ports 5183/4330/4340,
// never the dev studio's or the installed app's), uploads the samples from make-samples.py
// through Sources › Files, opens each, and checks what it shows: PDF pages with selectable
// text, Word pages in a sandboxed frame, spreadsheet sheets, slides, the ZIP listing, coloured
// code, SVG drawn as a picture, UTF-16 text, the JSON mismatch flag. It records every request
// the page makes: nothing may go anywhere but the studio, and no dialog may open (the samples
// carry scripts, an outside link and an outside picture). Review L-5: the SVG's picture URL and a
// slide picture's URL are also opened as their own pages, as "Open image in new tab" would, and
// must not run as the studio or read its API. Also a compression bomb refused, PDF pages giving
// back their canvases after scrolling, 390 px width and console errors.
// Usage (after `pnpm build`, with a loopback test server whose role may CREATE DATABASE):
//   python3 tracking/evidence/file-viewers/make-samples.py /tmp/fv-samples
//   CREATOR_TEST_DATABASE_URL=postgres://... node tracking/evidence/file-viewers/walk.mjs /tmp/fv-samples
import { once } from 'node:events';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { preview as vitePreview } from 'vite';
import {
  createApi,
  DEFAULT_OWNER_ACTOR_ID,
} from '../../../apps/api/dist/index.js';
import { RunbookStore } from '../../../packages/db/dist/index.js';
import { freshDatabase } from '../../../tests/dist/pg-harness.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const samples = resolve(process.argv[2] ?? join(tmpdir(), 'fv-samples'));
const shots = join(here, 'screens');
await mkdir(shots, { recursive: true });
const CODE = 'walk-login-code-0123456789abcdefghijklmnop';
const cleanups = [];
const t = {
  after: (f) => cleanups.push(f),
  skip: (m) => {
    throw new Error(m);
  },
};
const log = [];
const step = (s) => {
  log.push(s);
  console.log(s);
};
const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };

const db = await freshDatabase(t);
const store = new RunbookStore(db.pool);
await store.ensureActor({
  id: DEFAULT_OWNER_ACTOR_ID,
  kind: 'human',
  display_name: 'Owner',
});
const ws = await store.createWorkspace(owner, {
  name: 'Files walk',
  record_mode: 'fixture',
});
step(`throwaway database with workspace ${ws.id.slice(0, 8)}`);

const env = {
  CREATOR_DATABASE_URL: db.url,
  CREATOR_DEV_LOGIN_CODE: CODE,
  CREATOR_WORKER: 'off',
  CREATOR_API_PORT: '4330',
  CREATOR_WEB_PORT: '5183',
  CREATOR_PREVIEW_PORT: '4340',
};
Object.assign(process.env, env);
const api = createApi(env);
api.server.listen(api.config.api_port, api.config.host);
await once(api.server, 'listening');
await api.ready();
const web = await vitePreview({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
});
const BASE = `http://${api.config.host}:${api.config.web_port}`;
const browser = await chromium.launch();
let page;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  page = await ctx.newPage();
  const errors = [];
  const outside = [];
  const dialogs = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  // Requests made while a viewer's picture is opened as its own page (review L-5) are kept
  // apart: that page is the file's own document, and what matters there is its origin.
  let probing = null;
  ctx.on('request', (r) => {
    const u = r.url();
    if (probing) probing.push(u);
    else if (
      !u.startsWith(BASE) &&
      !u.startsWith('data:') &&
      !u.startsWith('blob:')
    )
      outside.push(u);
  });
  /** Opens a viewer-made picture URL as its own page, as "Open image in new tab" would. */
  const openAsPage = async (url) => {
    probing = [];
    const tab = await ctx.newPage();
    tab.on('dialog', (d) => void d.dismiss());
    let result;
    try {
      await tab.goto(url, { timeout: 5000 }).catch((e) => e);
      await tab.waitForTimeout(800);
      result = {
        origin: await tab.evaluate(() => location.origin).catch(() => 'none'),
        title: await tab.title().catch(() => ''),
        type: await tab.evaluate(() => document.contentType).catch(() => ''),
        api: probing.filter((u) => u.startsWith(`${BASE}/api/`)).length,
      };
    } finally {
      await tab.close();
      probing = null;
    }
    // On the studio's origin only a raster picture is acceptable: it has nothing to run.
    if (
      result.title.startsWith(`RAN ${BASE}`) ||
      (result.origin === BASE &&
        !/^image\/(png|jpeg|gif|webp)$/.test(result.type))
    )
      throw new Error(
        `a viewer URL opened as a studio page: ${JSON.stringify(result)}`,
      );
    if (/ \| 2\d\d/.test(result.title))
      throw new Error(`a file's script read the studio API: ${result.title}`);
    return result;
  };
  const login = await page.request.post(`${BASE}/api/auth/dev-login`, {
    data: { code: CODE },
  });
  if (!login.ok()) throw new Error(`login ${login.status()}`);
  const shot = async (name, target = page) => {
    await target.screenshot({
      path: join(shots, `${name}.png`),
      ...(target === page ? { fullPage: false } : {}),
    });
    step(`screenshot ${name}.png`);
  };

  // Live check follow-up 5: an empty workspace's Discover (kept mounted afterwards) logged
  // duplicate-key errors for repeated "Invalid UUID" lines.
  await page.goto(`${BASE}/#/projects/discover?ws=${ws.id}`);
  await page.getByRole('heading', { name: 'Discover' }).first().waitFor();
  await page.waitForTimeout(1500);
  step(`empty workspace Discover: ${errors.length} console errors`);
  await page.goto(`${BASE}/#/sources/files?ws=${ws.id}`);
  await page.getByRole('button', { name: 'Add files' }).waitFor();
  const names = (await readdir(samples)).sort();
  await page
    .locator('section.files input[type=file]')
    .first()
    .setInputFiles(names.map((n) => join(samples, n)));
  await page.waitForFunction(
    (n) => document.querySelectorAll('.file-list li').length >= n,
    names.length,
    { timeout: 60_000 },
  );
  step(`uploaded ${names.length} samples through Add files`);
  await page
    .getByRole('button', { name: 'Clear finished' })
    .click({ timeout: 3000 })
    .catch(() => {});
  const kinds = await page
    .locator('.file-list li')
    .evaluateAll((li) =>
      li.map(
        (l) =>
          `${l.querySelector('.file-open')?.textContent}: ${l.querySelector('.small')?.textContent?.split(' · ')[0]}`,
      ),
    );
  step(`kinds: ${kinds.sort().join('; ')}`);

  const open = async (name) => {
    await page.getByRole('button', { name, exact: true }).click();
    await page.locator('#file-detail-title', { hasText: name }).waitFor();
  };
  const detail = () => page.locator('article.file-detail');

  await open('two-pages.pdf');
  await page.locator('.pdf-page canvas').first().waitFor();
  await page
    .locator('.pdf-page .textLayer span', { hasText: 'Selectable text' })
    .waitFor();
  step(
    `PDF: ${await page
      .locator('.pdf-bar')
      .innerText()
      .then((s) =>
        s.replace(/\s+/g, ' '),
      )}; text layer has “Selectable text on page one.”`,
  );
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForTimeout(400);
  step(`PDF zoom in: ${await page.locator('.pdf-zoom').innerText()}`);
  await shot('01-pdf', detail());

  await open('script.pdf');
  await page.locator('.pdf-page canvas').first().waitFor();
  await page.waitForTimeout(800);
  step('PDF with an OpenAction script: drawn, no dialog');

  await open('report.docx');
  await page.locator('iframe.file-frame').waitFor();
  const frame = page.frameLocator('iframe.file-frame');
  await frame.getByText('Clinic reminder pilot').first().waitFor();
  const sandbox = await page
    .locator('iframe.file-frame')
    .getAttribute('sandbox');
  step(
    `Word: pages in an iframe with sandbox="${sandbox}"; ${await frame.locator('section.docx').count()} pages; picture ${await frame.locator('img').count()}`,
  );
  await shot('02-docx', detail());

  await open('outside-links.docx');
  await frame.getByText('An outside link (must not open)').waitFor();
  const linkTags = await frame.locator('a').count();
  step(`Word with an outside link and picture: ${linkTags} <a> elements left`);
  await page.getByLabel('Fit width').uncheck();
  await page.waitForTimeout(300);
  await shot('02b-docx-actual-size', detail());
  await page.getByLabel('Fit width').check();
  await page.getByRole('button', { name: 'Full width' }).click();
  await page.waitForTimeout(300);
  await shot('02c-docx-full-width', detail());
  await page.getByRole('button', { name: 'Show the list' }).click();

  await open('slots.xlsx');
  await page.locator('.sheet-grid table').waitFor();
  step(
    `Excel: tabs ${await page.locator('.sheet-tabs [role=tab]').allInnerTexts()}; first row ${await page
      .locator('.sheet-grid tbody tr')
      .first()
      .innerText()
      .then((s) => s.replace(/\s+/g, ' '))}`,
  );
  step(
    `Excel row 2 (formula saved without a value): ${await page
      .locator('.sheet-grid tbody tr')
      .nth(1)
      .innerText()
      .then((s) => s.replace(/\s+/g, ' '))}`,
  );
  await shot('03-xlsx', detail());
  await page.getByRole('tab', { name: 'Notes' }).click();
  step(
    `Excel Notes sheet: ${await page
      .locator('.sheet-grid')
      .innerText()
      .then((s) => s.replace(/\s+/g, ' '))}`,
  );

  await open('pilot.pptx');
  await page.locator('.slide-card').first().waitFor();
  step(
    `PowerPoint: ${await page.locator('.slide-card').count()} slides; titles ${await page
      .locator('.slide-card h4')
      .allInnerTexts()
      .then((a) =>
        a.map((s) => s.replace(/\s+/g, ' ')).join(' | '),
      )}; pictures ${await page.locator('.slide-card img').count()}`,
  );
  await shot('04-pptx', detail());
  const slideSrc = await page
    .locator('.slide-card img')
    .first()
    .getAttribute('src');
  const slidePage = await openAsPage(slideSrc);
  step(
    `slide picture opened as its own page: ${slidePage.type} (a raster picture, nothing to run)`,
  );

  await open('bomb.pptx');
  await page
    .getByText('This file expands to more than the studio opens in the page')
    .waitFor();
  step('bomb.pptx (100 MiB part in a small file): refused before it is opened');

  await open('many-pages.pdf');
  await page.locator('.pdf-page canvas').first().waitFor();
  await page.waitForTimeout(500);
  const scroller = page.locator('.pdf-scroll');
  for (let i = 0; i < 40; i++) {
    await scroller.evaluate((el) => el.scrollBy(0, el.clientHeight));
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(800);
  const held = await page
    .locator('.pdf-page canvas')
    .evaluateAll((cs) => cs.filter((c) => c.width > 0).length);
  const pages = await page.locator('.pdf-page').count();
  step(
    `PDF of ${pages} pages scrolled to the end: ${held} canvases still hold pixels`,
  );
  if (held > 20) throw new Error('PDF pages scrolled past kept their canvases');

  await open('bundle.zip');
  await page.locator('.archive-view table').waitFor();
  step(`ZIP: ${await page.locator('.archive-view > p').first().innerText()}`);
  await shot('05-zip', detail());

  await open('analysis.py');
  await page.locator('.code-body .hljs-keyword').first().waitFor();
  step(
    `Python: ${await page.locator('.code-bar .small').innerText()}; ${await page.locator('.code-body [class^=hljs-]').count()} coloured spans`,
  );
  await shot('06-python', detail());

  await open('page.html');
  await page.locator('.code-body .hljs-tag').first().waitFor();
  step(`HTML: ${await page.locator('.code-bar .small').innerText()}`);
  await shot('07-html', detail());

  await open('logo.svg');
  await page.locator('.svg-view img').waitFor();
  const drawn = await page
    .locator('.svg-view img')
    .evaluate((i) => i.complete && i.naturalWidth > 0);
  step(`SVG drawn as a picture: ${drawn}`);
  const svgSrc = await page.locator('.svg-view img').getAttribute('src');
  if (!svgSrc?.startsWith('data:image/svg+xml'))
    throw new Error(
      `the SVG picture is not a data: URL: ${svgSrc?.slice(0, 40)}`,
    );
  const asPage = await openAsPage(svgSrc);
  step(
    `SVG picture opened as its own page: origin ${asPage.origin}, ${asPage.type || 'nothing shown'}, title "${asPage.title}", ${asPage.api} studio API requests`,
  );
  await shot('08-svg', detail());
  await page.getByLabel('Show SVG source').check();
  await page.locator('.code-body .hljs-tag').first().waitFor();
  step('SVG source shown in colour');

  await open('utf16.txt');
  await page.locator('pre.file-text', { hasText: '日本語' }).waitFor();
  step('UTF-16 text shown as text');

  await open('broken.json');
  await page
    .getByText('the name’s extension does not match the contents')
    .waitFor();
  step('broken.json: shown as text, extension mismatch flagged');

  await page.setViewportSize({ width: 390, height: 844 });
  await open('slots.xlsx');
  await page.locator('.sheet-grid table').waitFor();
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step(`phone width horizontal overflow with a spreadsheet open: ${wide}`);
  await page.locator('.sheet-view').scrollIntoViewIfNeeded();
  await shot('09-phone-xlsx');
  await open('two-pages.pdf');
  await page.locator('.pdf-page canvas').first().waitFor();
  const wide2 = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  step(`phone width horizontal overflow with a PDF open: ${wide2}`);
  await page.locator('.pdf-view').scrollIntoViewIfNeeded();
  await shot('10-phone-pdf');

  step(
    `requests outside the studio: ${outside.length}${outside.length ? ` (${outside.join(' | ')})` : ''}`,
  );
  step(
    `dialogs: ${dialogs.length}${dialogs.length ? ` (${dialogs.join(' | ')})` : ''}`,
  );
  step(
    `console errors: ${errors.length}${errors.length ? ` (${errors.join(' | ')})` : ''}`,
  );
  if (outside.length || dialogs.length)
    throw new Error('a viewer was not inert');
} catch (e) {
  await page?.screenshot({
    path: join(tmpdir(), 'file-viewers-walk-failure.png'),
    fullPage: true,
  });
  throw e;
} finally {
  await writeFile(
    join(here, 'walk.json'),
    `${JSON.stringify({ when: new Date().toISOString(), steps: log }, null, 2)}\n`,
  );
  await browser.close();
  await new Promise((r) => web.httpServer.close(r));
  await api.close();
  for (const f of cleanups.reverse()) await f();
}
