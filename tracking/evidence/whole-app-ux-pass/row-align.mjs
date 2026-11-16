// Whole-app UX pass (November 15): reports controls in one flex row whose vertical centres
// differ by more than 3 px. Run from the repo root against a throwaway studio on 5183:
//   CREATOR_DEV_LOGIN_CODE=<code> WS=<id> [OPEN=1] node tracking/evidence/whole-app-ux-pass/row-align.mjs <page/tab> ...
// WS=<workspace id> names the workspace to open.
// Finds controls in one row (flex row parents) whose vertical centres differ by >3px.
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const { chromium } = require('playwright');
const ws = process.env.WS;
const tabs = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: Number(process.env.W || 1440), height: 900 },
});
await ctx.request.post('http://127.0.0.1:5183/api/auth/dev-login', {
  data: { code: process.env.CREATOR_DEV_LOGIN_CODE },
});
const p = await ctx.newPage();
for (const t of tabs) {
  await p.goto(`http://127.0.0.1:5183/#/${t}?ws=${ws}`);
  await p.waitForTimeout(1800);
  if (process.env.OPEN)
    await p.evaluate(() =>
      document.querySelectorAll('main details').forEach((d) => (d.open = true)),
    );
  await p.waitForTimeout(200);
  const out = await p.evaluate(() => {
    const res = [];
    const ctl =
      'button, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, label, a.button';
    for (const par of document.querySelectorAll('main *')) {
      const cs = getComputedStyle(par);
      if (
        !(cs.display.includes('flex') && cs.flexDirection === 'row') ||
        par.offsetParent === null
      )
        continue;
      const kids = [...par.children].filter(
        (k) =>
          k.matches(ctl) &&
          k.offsetParent !== null &&
          k.getBoundingClientRect().height > 0,
      );
      if (kids.length < 2) continue;
      // group by line (top within 30px)
      const rects = kids.map((k) => ({ k, r: k.getBoundingClientRect() }));
      for (const a of rects)
        for (const c of rects) {
          if (a === c || (a.k.tagName === 'LABEL' && c.k.tagName === 'LABEL'))
            continue;
          const ov =
            Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top);
          if (ov <= 0) continue;
          const d = Math.abs(
            (a.r.top + a.r.bottom) / 2 - (c.r.top + c.r.bottom) / 2,
          );
          if (d > 3 && a.r.x < c.r.x)
            res.push(
              `${par.className || par.tagName}: "${a.k.textContent.trim().slice(0, 18) || a.k.tagName}" vs "${c.k.textContent.trim().slice(0, 18) || c.k.tagName}" off ${d.toFixed(1)}px (mt ${getComputedStyle(a.k).marginTop}/${getComputedStyle(c.k).marginTop})`,
            );
        }
    }
    return [...new Set(res)];
  });
  if (out.length) console.log(t + '\n  ' + out.join('\n  '));
}
await b.close();
