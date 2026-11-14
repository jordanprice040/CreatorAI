// UX pass P-3/P-4 walk: Decide's "Which options can advance", the one-step ethics and access
// confirmation (shared and own reasons) and the owner's approval where they record a selection,
// on a throwaway database seeded with `pnpm cli seed-selection` (reviewer ports 5183/4330/4340).
// Usage: LOGIN_CODE=… node walk.cjs. Prints observations; writes screens/.
const { chromium } = require('playwright');
const path = require('node:path');
const WEB = process.env.WALK_WEB ?? 'http://127.0.0.1:5183';
const CODE = process.env.LOGIN_CODE;
const shot = (n) => path.join(__dirname, 'screens', n);
const log = (k, v) => console.log(k, JSON.stringify(v));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  await p.goto(WEB);
  await p.evaluate(async (code) => {
    await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  }, CODE);
  const list = await p.evaluate(async () =>
    (await fetch('/api/workspaces')).json(),
  );
  const want = (process.env.WALK_WS ?? 'selection').toLowerCase();
  // The newest workspace with that name (an older one may share it).
  const ws = list
    .filter((w) => w.name.toLowerCase().includes(want))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0].id;
  const go = async (route) => {
    await p.goto(`${WEB}/#/${route}?ws=${ws}`);
    await p.reload();
    await p.waitForTimeout(4500);
  };
  await go('projects/decide');
  const advance = () =>
    p.evaluate(() => {
      const s = document.querySelector('section.advance');
      if (!s) return null;
      return {
        outlook: [...s.querySelectorAll('.advance-list > li')].map((li) =>
          li.textContent.replace(/\s+/g, ' ').trim(),
        ),
        form: [...s.querySelectorAll('.gate-batch-options > li')].map(
          (li) => ({
            text: li.querySelector('label').textContent.replace(/\s+/g, ' '),
            ticked: li.querySelector('input[type=checkbox]').checked,
          }),
        ),
        shared: [...s.querySelectorAll('input[id^=shared-]')].map((i) => i.id),
        status: s.querySelector('[role=status]')?.textContent ?? null,
        button: s.querySelector('.gate-batch button[type=submit]')?.textContent,
      };
    });
  const before = await advance();
  log('ADVANCE before', before);
  await p.locator('section.advance').screenshot({ path: shot('advance-before.png') });
  if (before?.form.length) {
    // Tick every option, give the first its own access reason, shared reasons for the rest.
    const boxes = p.locator('.gate-batch-options input[type=checkbox]');
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check();
    const own = p.locator('.gate-batch-options button.text').first();
    await own.click();
    const ownInputs = p.locator('.own-reasons input');
    const ownIds = await ownInputs.evaluateAll((xs) => xs.map((x) => x.id));
    const accessOwn = ownIds.find((id) => id.endsWith('-access')) ?? ownIds[0];
    await p.fill(`#${accessOwn}`, 'Runs on the shared lab server, where installs are allowed.');
    for (const id of (await advance()).shared)
      await p.fill(`#${id}`, `Shared ${id.slice(7)} reason: public synthetic data, no people affected.`);
    log('ADVANCE filled', await advance());
    await p.locator('section.advance').screenshot({ path: shot('advance-filled.png') });
    await p.locator('.gate-batch button[type=submit]').click();
    await p.waitForTimeout(3000);
    log('ADVANCE after', await advance());
    await p.locator('section.advance').screenshot({ path: shot('advance-after.png') });
    const events = await p.evaluate(async (ws) => {
      const r = await fetch(`/api/workspaces/${ws}/history?limit=50`);
      return r.ok ? r.status : r.status;
    }, ws);
    log('history status', events);
  }
  // Standard folds assumptions and history.
  log(
    'FOLDS',
    await p.evaluate(() =>
      [...document.querySelectorAll('details.routine > summary')].map(
        (s) => s.textContent,
      ),
    ),
  );
  await p.screenshot({ path: shot('decide-standard.png'), fullPage: true });
  log('ERRORS', errors);
  await b.close();
})();
