// Usage: node measure.mjs <outdir> [mode]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire('/home/user/CreatorAI/package.json');
const ts = require('typescript');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:5183';
const out = process.argv[2];
const mode = process.argv[3] ?? 'standard';
const only = process.argv[4];
mkdirSync(out, { recursive: true });
const code = ts.transpileModule(
  readFileSync('/home/user/CreatorAI/apps/web/src/pages.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const m = {};
new Function('exports', code)(m);
let tabs = m.PAGES.flatMap((p) =>
  p.sections.map((s) => ({ page: p.key, slug: s.slug })),
);
if (only)
  tabs = tabs.filter((t) => only.split(',').includes(`${t.page}/${t.slug}`));
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('creator-agent.theme', 'dark');
  } catch {}
});
await ctx.request.post(`${base}/api/auth/dev-login`, {
  data: { code: process.env.CREATOR_DEV_LOGIN_CODE },
});
const list = await (await ctx.request.get(`${base}/api/workspaces`)).json();
const ws = (list.find((w) => /selection/i.test(w.name)) ?? list[0]).id;
const vm = await (await ctx.request.get(`${base}/api/me/view-mode`)).json();

async function setMode(m) {
  const page = await ctx.newPage();
  await page.goto(`${base}/#/chat/conversations?ws=${ws}`, {
    waitUntil: 'networkidle',
  });
  const radio = page
    .getByRole('radio', { name: m === 'standard' ? /^Standard/ : /^Advanced/ })
    .first();
  if ((await radio.count()) && !(await radio.isChecked())) {
    await radio.check();
    await page.waitForTimeout(800);
  }
  await page.close();
}
await setMode(mode);
const rows = [];
for (const t of tabs) {
  const page = await ctx.newPage();
  await page.goto(`${base}/#/${t.page}/${t.slug}?ws=${ws}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const vis = (el) => {
      const b = el.getBoundingClientRect();
      return (
        b.width > 0 &&
        b.height > 0 &&
        getComputedStyle(el).visibility !== 'hidden'
      );
    };
    const words = (main.innerText || '').split(/\s+/).filter(Boolean).length;
    const blocks = [...main.querySelectorAll('p, li, .notice, .small, dd, div')]
      .filter(
        (el) =>
          vis(el) &&
          [...el.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 30,
          ),
      )
      .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
      .filter((s) => s.length > 160);
    return {
      words,
      height: document.documentElement.scrollHeight,
      blocks: [...new Set(blocks)],
    };
  });
  await page.screenshot({
    path: join(out, `${t.page}-${t.slug}.png`),
    fullPage: true,
  });
  rows.push({ ...t, ...r });
  await page.close();
}
await setMode('standard');
writeFileSync(join(out, 'measure.json'), JSON.stringify(rows, null, 1));
console.log(
  rows
    .map(
      (r) =>
        `${r.page}/${r.slug}\twords=${r.words}\th=${r.height}\tlong=${r.blocks.length}`,
    )
    .join('\n'),
);
console.log(
  'total words',
  rows.reduce((a, r) => a + r.words, 0),
);
await browser.close();
