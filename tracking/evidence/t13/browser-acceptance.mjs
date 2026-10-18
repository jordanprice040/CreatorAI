// T13 browser walkthrough: headless Chromium against `vite preview`, the API and the separate
// preview origin, seeded by double-harness.mjs (or by a real WSL2 run with the same seed file).
// Usage:
//   CREATOR_DEV_LOGIN_CODE=... node tracking/evidence/t13/browser-acceptance.mjs <playwright module> <chromium>
// Reads browser-seed.json, writes screenshots and browser-acceptance.json next to this file.
// Every step asserts on what the page shows or the server returns; a failure stops the run.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , pwPath, chromiumPath] = process.argv;
const { chromium } = await import(pwPath);
const out = dirname(fileURLToPath(import.meta.url));
const seed = JSON.parse(readFileSync(join(out, 'browser-seed.json'), 'utf8'));
const BASE = process.env.T13_BASE ?? 'http://127.0.0.1:5173';
const PREVIEW = process.env.T13_PREVIEW ?? 'http://127.0.0.1:4320';
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!CODE) throw new Error('missing CREATOR_DEV_LOGIN_CODE');
const sha = (b) => createHash('sha256').update(b).digest('hex');

const steps = [];
const problems = [];
const browser = await chromium.launch({ executablePath: chromiumPath });
const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const watch = (p, label) => {
  p.on('pageerror', (e) => problems.push(`${label} pageerror: ${e.message}`));
  p.on('console', (m) => {
    // Refusals are expected in this walkthrough; anything else is a problem.
    if (m.type() === 'error' && !/\b(403|409|410|429)\b/.test(m.text())) problems.push(`${label} console: ${m.text()}`);
  });
};
watch(page, 'studio');
const main = page.locator('main');
const gallery = (id = '') => `${BASE}/#/gallery?ws=${seed.ws}${id ? `&id=${id}` : ''}`;
async function shot(p, name) {
  await p.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  return `${name}.png`;
}
async function step(name, fn) {
  const started = Date.now();
  try {
    const observed = await fn();
    steps.push({ step: name, result: 'pass', ms: Date.now() - started, ...observed });
    console.log(`PASS ${name}`);
  } catch (e) {
    steps.push({ step: name, result: 'fail', error: String(e?.message ?? e) });
    console.log(`FAIL ${name}: ${e?.message ?? e}`);
    await shot(page, `fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
    throw e;
  }
}
const expectText = (loc, text, timeout = 10000) => loc.getByText(text, { exact: false }).first().waitFor({ timeout });
const summaries = async () => {
  const r = await page.request.get(`${BASE}/api/workspaces/${seed.ws}/artifacts`);
  if (!r.ok()) throw new Error(`artifact list ${r.status()}`);
  return r.json();
};

let previewUrl = '';
let preview = null;
try {
  await step('sign in and list both versions: the revision is current, the original superseded', async () => {
    await page.goto(`${BASE}/#login=${CODE}`);
    await page.getByRole('heading', { name: 'Monitor' }).waitFor();
    await page.goto(gallery());
    await page.getByRole('heading', { name: 'Gallery' }).waitFor();
    const list = main.getByRole('list', { name: 'Artifacts' });
    await expectText(list, 'current');
    const items = await list.locator('li').allInnerTexts();
    if (items.length !== 2) throw new Error(`expected 2 artifacts, saw ${items.length}`);
    if (!/superseded/.test(items[0]) || !/current/.test(items[1])) throw new Error(`labels ${items}`);
    return { list: items, screenshot: await shot(page, '01-gallery') };
  });

  await step('revision detail: integrity, availability labels, test-double notice, manifest and tests', async () => {
    await page.goto(gallery(seed.second));
    await expectText(main, 'Integrity checked');
    await expectText(main, 'Not isolation evidence');
    const avail = await main.getByRole('list', { name: 'Availability' }).innerText();
    for (const label of ['Source archive', 'Runnable demo', 'Native installer'])
      if (!avail.includes(label)) throw new Error(`missing ${label}`);
    if (!/Native installer\s*unavailable/i.test(avail)) throw new Error(`installer not unavailable: ${avail}`);
    const tests = await main.locator('table.tests').first().innerText();
    if (!/A3/.test(tests) || !/passed \(succeeded\)/.test(tests)) throw new Error(`tests table ${tests}`);
    await expectText(main, 'Revision of');
    return { availability: avail.split('\n').filter(Boolean), screenshot: await shot(page, '02-revision-detail') };
  });

  await step('compare: the revision adds A3 from the accepted feedback, earlier tests still pass', async () => {
    const box = main.locator('.compare-artifacts');
    await expectText(box, 'recorded revision');
    await expectText(box, 'From feedback');
    const text = await box.innerText();
    if (!/A3\s*not defined\s*passed/.test(text)) throw new Error(`A3 row missing: ${text}`);
    if (!/src\/main\.py \(changed\)/.test(text)) throw new Error('changed file not listed');
    await box.scrollIntoViewIfNeeded();
    return { compare: text.split('\n').slice(0, 3), screenshot: await shot(page, '03-compare') };
  });

  await step('download the exact archive and match its hash to the manifest', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      main.getByRole('link', { name: 'Download source archive' }).click(),
    ]);
    const bytes = readFileSync(await download.path());
    const detail = await (await page.request.get(`${BASE}/api/workspaces/${seed.ws}/artifacts/${seed.second}`)).json();
    if (sha(bytes) !== detail.manifest.package.sha256) throw new Error('downloaded bytes differ from the manifest');
    return { file: download.suggestedFilename(), bytes: bytes.length, sha256: sha(bytes) };
  });

  await step('stale version: a download naming another manifest hash is refused', async () => {
    const all = await summaries();
    const first = all.find((a) => a.id === seed.first);
    const r = await page.request.get(
      `${BASE}/api/workspaces/${seed.ws}/artifacts/${seed.second}/download?sha256=${first.manifest_sha256}`,
    );
    if (r.status() !== 409) throw new Error(`expected 409, got ${r.status()}`);
    return { status: r.status(), code: (await r.json()).error.code };
  });

  await step('start a private preview: ready only after the readiness check, one-time link', async () => {
    await page.getByRole('button', { name: 'Start private preview' }).click();
    const link = main.getByRole('link', { name: 'Open the private preview' });
    await link.waitFor({ timeout: 120000 });
    previewUrl = await link.getAttribute('href');
    if (!previewUrl?.startsWith(`${PREVIEW}/preview/`)) throw new Error(`preview url ${previewUrl}`);
    await expectText(main, 'ready');
    return { preview_origin: new URL(previewUrl).origin, screenshot: await shot(page, '04-preview-ready') };
  });

  await step('open the preview on its own origin and run the exact package with arguments', async () => {
    preview = await context.newPage();
    watch(preview, 'preview');
    await preview.goto(previewUrl);
    if (new URL(preview.url()).search) throw new Error('ticket left in the address');
    await preview.getByRole('heading', { name: 'Private preview' }).waitFor();
    if (seed.backend !== 'wsl2-bwrap-systemd') await expectText(preview, 'Not isolation evidence');
    const csp = (await preview.request.get(preview.url())).headers()['content-security-policy'] ?? '';
    if (!/default-src 'none'|script-src 'self'/.test(csp)) throw new Error(`csp ${csp}`);
    await preview.getByLabel('Arguments, one per line').fill('--plain');
    await preview.getByRole('button', { name: 'Run in isolated worker' }).click();
    await preview.locator('#meta').getByText('Exit 0').waitFor({ timeout: 60000 });
    const output = await preview.locator('#out').innerText();
    const meta = await preview.locator('#meta').innerText();
    return { output, meta, csp, screenshot: await shot(preview, '05-preview-run') };
  });

  await step('the one-time ticket cannot be reused from another browser', async () => {
    const other = await browser.newContext();
    const p = await other.newPage();
    const r = await p.goto(previewUrl);
    const status = r?.status();
    const text = await p.locator('main').innerText();
    await other.close();
    if (status !== 403) throw new Error(`reused ticket answered ${status}: ${text}`);
    return { status, page: text.replace(/\s+/g, ' ').trim() };
  });

  await step('a cross-origin run request is refused', async () => {
    const r = await page.request.post(`${new URL(previewUrl).origin}${new URL(previewUrl).pathname}/run`, {
      headers: { Origin: BASE, 'Content-Type': 'application/json' },
      data: { args: [], stdin: '' },
    });
    if (r.ok()) throw new Error('cross-origin run accepted');
    return { status: r.status() };
  });

  await step('revoke access in the studio; the open preview tab is then refused', async () => {
    await page.bringToFront();
    await page.reload();
    await expectText(main, '1/10 runs');
    await main.getByRole('button', { name: 'Revoke access' }).click();
    await expectText(main, 'Preview revoked.');
    await expectText(main, 'revoked');
    await preview.bringToFront();
    await preview.getByRole('button', { name: 'Run in isolated worker' }).click();
    await preview.locator('#out.error').waitFor({ timeout: 10000 });
    const refused = await preview.locator('#out').innerText();
    if (!/Refused/.test(refused)) throw new Error(`after revoke: ${refused}`);
    const reload = await preview.reload();
    if (reload?.status() !== 403) throw new Error(`reload after revoke ${reload?.status()}`);
    await shot(preview, '06-preview-revoked');
    return { run_after_revoke: refused, reload_status: reload.status(), screenshot: await shot(page, '07-studio-revoked') };
  });

  await step('submit feedback on this exact version and accept it', async () => {
    await page.bringToFront();
    await page.getByLabel('Kind').selectOption('question');
    await page.getByLabel('What should change, and why?').fill('Browser check: should --plain also number nothing on empty input?');
    await page.getByRole('button', { name: 'Submit feedback' }).click();
    await expectText(main, 'Feedback recorded against this manifest.');
    const row = main.locator('.feedback li', { hasText: 'Browser check' });
    await row.getByRole('button', { name: 'Accept' }).click();
    await row.locator('.badge', { hasText: 'accepted' }).waitFor();
    return { row: (await row.innerText()).trim(), screenshot: await shot(page, '08-feedback') };
  });

  await step('the superseded original stays downloadable with its own hash', async () => {
    await page.goto(gallery(seed.first));
    await expectText(main, 'Integrity checked');
    const box = main.locator('.feedback');
    await expectText(box, 'revised');
    const all = await summaries();
    const first = all.find((a) => a.id === seed.first);
    const r = await page.request.get(
      `${BASE}/api/workspaces/${seed.ws}/artifacts/${seed.first}/download?sha256=${first.manifest_sha256}`,
    );
    if (r.status() !== 200) throw new Error(`original download ${r.status()}`);
    return { status: r.status(), sha256: r.headers()['x-content-sha256'], screenshot: await shot(page, '09-original') };
  });

  await step('narrow screen: the gallery fits a 390px phone width', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(gallery(seed.second));
    await expectText(main, 'Integrity checked');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(page, '10-mobile-gallery');
    if (overflow > 0) throw new Error(`horizontal overflow ${overflow}px`);
    return { horizontal_overflow_px: overflow };
  });
} finally {
  writeFileSync(
    join(out, 'browser-acceptance.json'),
    JSON.stringify({ base: BASE, preview_origin: PREVIEW, seed, steps, console_problems: problems }, null, 2) + '\n',
  );
  await browser.close();
}
if (problems.length) {
  console.log('Console problems:', problems);
  process.exitCode = 1;
}
