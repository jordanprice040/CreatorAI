// UX pass P-3 walk: record a selection on Decide; when the run asks the owner's approval, it is
// answered in place ("Approve once and record the selection") and the selection is recorded,
// without opening Monitor › Approvals. Run after walk.cjs on the same workspace (gates confirmed).
// Usage: WALK_WS=… LOGIN_CODE=… node walk-approve.cjs
const { chromium } = require('playwright');
const path = require('node:path');
const WEB = process.env.WALK_WEB ?? 'http://127.0.0.1:5183';
const shot = (n) => path.join(__dirname, 'screens', n);
const log = (k, v) => console.log(k, JSON.stringify(v));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const calls = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    if (r.request().method() === 'POST')
      calls.push(`${r.status()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')}`);
  });
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
  // The newest workspace with that name (an older one may share it).
  const ws = list
    .filter((w) => w.name.toLowerCase().includes(want))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0].id;
  await p.goto(`${WEB}/#/projects/decide?ws=${ws}`);
  await p.reload();
  await p.waitForTimeout(4500);
  const form = p.locator('form.decide');
  // Open every option and decide: the first that can advance is recommended or validated, the
  // rest deferred.
  await form.getByRole('button', { name: /Expand all/i }).first().click().catch(() => {});
  const selects = form.locator('select[id^=dis-]');
  const n = await selects.count();
  let advanced = false;
  for (let i = 0; i < n; i++) {
    const s = selects.nth(i);
    const id = (await s.getAttribute('id')).slice(4);
    const open = await s.locator('option:not([disabled])').evaluateAll((o) => o.map((x) => x.value));
    const pick =
      !advanced && open.includes('proceed_to_validation') ? 'proceed_to_validation' : 'defer';
    if (pick !== 'defer') advanced = true;
    await s.selectOption(pick);
    await p.fill(`#why-${id}`, pick === 'defer' ? 'Not now; others come first.' : 'Cheapest to test first.');
    await p.fill(`#rev-${id}`, 'A pilot shows the slots are not reused.');
  }
  await p.fill('#dec-rationale', 'Validate the cheapest option first; defer the rest.');
  calls.length = 0;
  await form.getByRole('button', { name: /Record this selection/ }).click();
  await p.waitForTimeout(3000);
  const inline = p.locator('section.inline-approval');
  log('INLINE shown', await inline.count());
  if (await inline.count()) {
    log('INLINE text', (await inline.textContent()).replace(/\s+/g, ' ').slice(0, 600));
    log('reason prefilled', await inline.locator('textarea').inputValue());
    log(
      'worth asking offered',
      await inline.locator('select[id^=inline-int-]').count(),
    );
    await inline.locator('select[id^=inline-int-]').selectOption('unnecessary');
    log(
      'outside live region',
      await inline.evaluate((e) => !e.closest('[aria-live]')),
    );
    await inline.screenshot({ path: shot('inline-approval.png') });
    await inline.getByRole('button', { name: /Approve once and record the selection/ }).click();
    await p.waitForTimeout(4000);
  }
  log(
    'RESULT',
    await p.evaluate(() =>
      [...document.querySelectorAll('form.decide [aria-live] .notice, form.decide [aria-live] .error')].map((x) =>
        x.textContent.replace(/\s+/g, ' '),
      ),
    ),
  );
  log('POSTS', calls);
  log('URL still Decide', p.url().includes('projects/decide'));
  log('ERRORS', errors);
  await b.close();
})();
