import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:5183';
const mode = process.argv[2] ?? 'advanced';
const paths = [
  'chat/conversations', 'autopilot/run',
  'projects/path',
  'projects/discover',
  'projects/decide',
  'projects/proposals',
  'projects/specs',
  'projects/build',
  'projects/try',
  'projects/sell',
  'projects/campaigns',
  'projects/maintain',
  'sources/claims',
  'sources/library',
  'sources/files',
  'sources/search',
  'monitor/overview',
  'monitor/approvals',
  'monitor/runs',
  'monitor/activity',
  'monitor/budgets',
  'monitor/workers',
  'connections/models',
  'connections/github',
  'connections/devices',
  'settings/general',
  'settings/study',
];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const s = await (
  await ctx.request.post(`${base}/api/auth/dev-login`, {
    data: { code: process.env.CREATOR_DEV_LOGIN_CODE },
  })
).json();
await ctx.request
  .put(`${base}/api/me/view-mode`, {
    headers: { 'X-CSRF-Token': s.csrf_token },
    data: { mode },
  })
  .catch(() => {});
const list = await (await ctx.request.get(`${base}/api/workspaces`)).json();
const ws = list.find((w) => /selection/i.test(w.name)) ?? list[0];
const page = await ctx.newPage();
const out = [];
for (const p of paths) {
  await page.goto(`${base}/#/${p}?ws=${ws.id}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  if (process.env.OPEN) {
    await page.evaluate(() =>
      document.querySelectorAll('main details').forEach((d) => (d.open = true)),
    );
    await page.waitForTimeout(500);
  }
  const hits = await page.evaluate(() => {
    const vis = (w, c) =>
      parseFloat(w) > 0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
    const boxes = [];
    for (const el of document.querySelectorAll('main *, .topbar *')) {
      // The top bar's usage popover is closed but still measured; it is not shown.
      if (el.closest('.usage-panel')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const full = ['Top', 'Right', 'Bottom', 'Left'].every((sd) =>
        vis(cs[`border${sd}Width`], cs[`border${sd}Color`]),
      );
      const bg =
        !/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) &&
        parseFloat(cs.borderRadius) > 0;
      if (!full && !bg) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      boxes.push({ el, r });
    }
    const name = (el) =>
      `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} "${(el.textContent || '').trim().slice(0, 40)}"`;
    const res = [];
    for (const a of boxes)
      for (const b of boxes) {
        if (a === b || a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const hov =
          Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const vov =
          Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        const vgap = b.r.top - a.r.bottom;
        const hgap = b.r.left - a.r.right;
        if (hov > 4 && vgap >= -3 && vgap <= 2 && a.r.top < b.r.top)
          res.push(`V gap=${vgap.toFixed(1)} ${name(a.el)} / ${name(b.el)}`);
        else if (vov > 4 && hgap >= -3 && hgap <= 2 && a.r.left < b.r.left)
          res.push(`H gap=${hgap.toFixed(1)} ${name(a.el)} / ${name(b.el)}`);
      }
    return res;
  });
  out.push(`## ${p} (${hits.length})`, ...hits);
}
writeFileSync(
  `tracking/evidence/ui-polish-borders/sweep-${mode}${process.env.OPEN ? '-open' : ''}${process.env.TAG ?? ''}.txt`,
  out.join('\n'),
);
await browser.close();
