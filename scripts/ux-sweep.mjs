// Final UX pass (docs/FINAL_UX_PASS_PLAN_2026-11-14.md, step 2): screenshots and checks of every
// tab of a running studio. Read-only: it signs in with the development code, opens each tab by
// its address, and never presses a button that saves anything (the view-mode switch is a
// per-person preference, which it puts back at the end). Point it at a throwaway or fixture studio, never the installed app.
//
//   node scripts/ux-sweep.mjs --base http://127.0.0.1:5183 --code <dev login code> \
//     --workspace "Fixture selection and spec demonstration" --out .ux-sweep/<name> [--quick]
//
// Needs Playwright with a Chromium (not a repo dependency; the cloud container and the
// coding tools provide one) and axe-core (a dev dependency). For each shot it records the page
// height, horizontal overflow, axe-core WCAG 2.2 A/AA violations, console errors, failed API
// requests and visible controls smaller than 24×24 px (WCAG 2.5.8), in results.json, and a
// summary in summary.md.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(' ')
    .split(/\s*--/)
    .filter(Boolean)
    .map((a) => {
      const [k, ...v] = a.split(' ');
      return [k, v.join(' ') || true];
    }),
);
const base = args.base ?? 'http://127.0.0.1:5183';
const out = args.out ?? '.ux-sweep/latest';
if (!args.code || !args.workspace) {
  console.error(
    'Usage: --base <url> --code <dev login code> --workspace <name> --out <dir> [--quick]',
  );
  process.exit(2);
}
mkdirSync(out, { recursive: true });

// The page map, read from the web source so the sweep always covers every tab.
const pagesCode = ts.transpileModule(
  readFileSync('apps/web/src/pages.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const pagesMod = {};
new Function('exports', pagesCode)(pagesMod);
const tabs = pagesMod.PAGES.flatMap((p) =>
  p.sections.map((s) => ({
    page: p.key,
    pageLabel: p.label,
    slug: s.slug,
    label: s.label,
  })),
);

// Dark Standard at four widths; Advanced and light at the widest only. --quick: 1440 only.
const WIDTHS = args.quick ? [1440] : [1440, 1024, 768, 390];
const shots = [];
for (const t of tabs) {
  for (const w of WIDTHS)
    shots.push({ ...t, width: w, mode: 'standard', theme: 'dark' });
  shots.push({ ...t, width: 1440, mode: 'advanced', theme: 'dark' });
  shots.push({ ...t, width: 1440, mode: 'standard', theme: 'light' });
}

const browser = await chromium.launch();
const results = [];
async function context(theme) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('creator-agent.theme', t);
    } catch {}
  }, theme);
  const login = await ctx.request.post(`${base}/api/auth/dev-login`, {
    data: { code: args.code },
  });
  if (!login.ok()) throw new Error(`Sign-in failed: ${login.status()}`);
  return ctx;
}
async function workspaceId(ctx) {
  const res = await ctx.request.get(`${base}/api/workspaces`);
  const list = await res.json();
  const ws = list.find((w) => w.name === args.workspace);
  if (!ws) throw new Error(`No workspace named ${args.workspace}`);
  return ws.id;
}
async function setMode(page, mode) {
  const radio = page
    .getByRole('radio', {
      name: mode === 'standard' ? /^Standard/ : /^Advanced/,
    })
    .first();
  if ((await radio.count()) && !(await radio.isChecked())) {
    await radio.check();
    await page.waitForTimeout(400);
  }
}

const ctxs = { dark: await context('dark'), light: await context('light') };
const ws = await workspaceId(ctxs.dark);
// The view mode is saved per person on the server; note it now and put it back at the end, so
// a walk running at the same time is left as it was (only during the sweep does it switch).
const viewMode = await (
  await ctxs.dark.request.get(`${base}/api/me/view-mode`)
).json();
for (const s of shots) {
  const page = await ctxs[s.theme].newPage();
  await page.setViewportSize({ width: s.width, height: 900 });
  const consoleErrors = [];
  const failed = [];
  page.on(
    'console',
    (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)),
  );
  page.on('pageerror', (e) =>
    consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`),
  );
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 400)
      failed.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  const url = `${base}/#/${s.page}/${s.slug}?ws=${ws}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await setMode(page, s.mode);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const name = `${s.page}-${s.slug}-${s.mode}-${s.theme}-${s.width}`;
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [];
    for (const el of document.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab], summary',
    )) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden') continue;
      // A checkbox or radio with a clickable label passes 2.5.8 through its label.
      if (
        el.tagName === 'INPUT' &&
        (el.type === 'checkbox' || el.type === 'radio') &&
        (el.closest('label') ||
          (el.id &&
            document.querySelector(`label[for="${CSS.escape(el.id)}"]`)))
      )
        continue;
      // Inline links inside running text are exempt from 2.5.8.
      if (el.tagName === 'A' && style.display === 'inline') continue;
      // So are the Standard view's amounts (P-9), which open to their exact value in place.
      if (el.matches('button.money')) continue;
      if (r.width < 24 || r.height < 24)
        small.push(
          `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}`,
        );
    }
    // The tab's outline (inventory): headings, folds and buttons, in page order.
    const main = document.querySelector('main') ?? document.body;
    const outline = [...main.querySelectorAll('h2, h3, h4, summary, button')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}: ${(el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 80)}`,
      );
    return {
      outline,
      height: doc.scrollHeight,
      overflowX:
        doc.scrollWidth > doc.clientWidth + 1
          ? doc.scrollWidth - doc.clientWidth
          : 0,
      h1: document.title,
      small: small.slice(0, 40),
      smallCount: small.length,
    };
  });
  let axe = [];
  if (s.width === 1440 || s.width === 390) {
    await page.addScriptTag({ content: AXE });
    const r = await page.evaluate(async () =>
      // eslint-disable-next-line no-undef
      axe.run(document, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      }),
    );
    axe = r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }));
  }
  results.push({ ...s, name, ...metrics, axe, consoleErrors, failed });
  await page.close();
  process.stdout.write('.');
}
try {
  const session = await (
    await ctxs.dark.request.get(`${base}/api/auth/session`)
  ).json();
  const now = await (
    await ctxs.dark.request.get(`${base}/api/me/view-mode`)
  ).json();
  if (viewMode.version > 0 && now.view_mode !== viewMode.view_mode)
    await ctxs.dark.request.post(`${base}/api/me/view-mode`, {
      headers: { 'X-CSRF-Token': session.csrf_token },
      data: { expected_version: now.version, view_mode: viewMode.view_mode },
    });
} catch (e) {
  console.error(`\nCould not put the view mode back: ${e}`);
}
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));

const lines = [
  `# UX sweep: ${args.workspace}`,
  '',
  `${results.length} shots, ${new Date().toISOString()}, ${base}.`,
  '',
  '| Shot | Height | Overflow | Axe (serious+) | Small targets | Console | Failed API |',
  '| --- | --- | --- | --- | --- | --- | --- |',
];
for (const r of results) {
  const serious = r.axe.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  lines.push(
    `| ${r.name} | ${r.height} | ${r.overflowX || ''} | ${serious.map((v) => `${v.id}×${v.nodes}`).join(', ')} | ${r.smallCount || ''} | ${r.consoleErrors.length || ''} | ${[...new Set(r.failed)].join(', ')} |`,
  );
}
writeFileSync(join(out, 'summary.md'), lines.join('\n') + '\n');
console.log(`\nWrote ${out}/results.json and summary.md`);
