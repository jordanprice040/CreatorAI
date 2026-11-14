// 390 px check of Decide's "Which options can advance" section and one-step form: axe-core
// (WCAG 2.2 AA tags) on the section, horizontal overflow, and a screenshot.
// Usage: WALK_WS=… LOGIN_CODE=… node narrow.cjs   (run before walk.cjs so the form shows)
const { chromium } = require('playwright');
const path = require('node:path');
const axe = require.resolve('axe-core/axe.min.js');
const WEB = process.env.WALK_WEB ?? 'http://127.0.0.1:5183';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  await p.goto(WEB);
  await p.evaluate(async (code) => {
    await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  }, process.env.LOGIN_CODE);
  const list = await p.evaluate(async () => (await fetch('/api/workspaces')).json());
  const want = (process.env.WALK_WS ?? 'discovery demonstration').toLowerCase();
  const ws = list
    .filter((w) => w.name.toLowerCase().includes(want))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0].id;
  await p.goto(`${WEB}/#/projects/decide?ws=${ws}`);
  await p.reload();
  await p.waitForTimeout(4500);
  await p.addScriptTag({ path: axe });
  const r = await p.evaluate(async () => {
    const res = await window.axe.run('section.advance', {
      runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
    });
    return {
      violations: res.violations.map((v) => [v.id, v.nodes.length]),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      form: !!document.querySelector('form.gate-batch'),
    };
  });
  console.log('NARROW', JSON.stringify(r));
  await p.locator('section.advance').screenshot({
    path: path.join(__dirname, 'screens', 'advance-390.png'),
  });
  await b.close();
})();
