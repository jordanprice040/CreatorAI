// P18 re-reviews R2-1 and R4-1: which proposal the open/closed section choices belong to.
// Uses a fresh `pnpm cli seed-selection` workspace (WALK_WS) on the throwaway database.
const { chromium } = require('playwright');
const WEB = process.env.WALK_WEB ?? 'http://127.0.0.1:5183';
const WS = process.env.WALK_WS;
const log = (...a) => console.log(...a);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => log('PAGEERROR', e.message));
  await p.goto(WEB);
  await p.evaluate(async (code) => {
    await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  }, process.env.WALK_CODE);
  const opens = () =>
    p.evaluate(() =>
      [...document.querySelectorAll('details.proposal-fold')].map(
        (d) => d.open,
      ),
    );
  const names = async () =>
    (await opens()).map((o, i) => (o ? i : -1)).filter((i) => i >= 0);
  // Setup: record a selection that also recommends the human-led option, so two options can
  // get proposals.
  await p.goto(`${WEB}/#/projects/decide?ws=${WS}`);
  await p.waitForTimeout(4500);
  const human = p.locator('details.decide-option', { hasText: 'Human-led' });
  await human.locator('summary').click();
  await human.locator('select').selectOption('recommend_alternative');
  await human
    .locator('input[id^="why-"]')
    .fill('Walk: recommend it so a second proposal can be written.');
  await p
    .locator('#dec-override')
    .fill('Walk: advance the human-led option for a proposal test.');
  await p
    .locator('#dec-rationale')
    .fill('Walk: two recommended options (throwaway database).');
  await p.locator('form.decide button[type=submit]').click();
  await p.waitForTimeout(2500);
  log(
    'SETUP selection',
    (await p.locator('form.decide [aria-live]').textContent()).slice(0, 120),
  );
  if (
    await p.getByRole('button', { name: 'I approved it: submit again' }).count()
  ) {
    // The run asks a person first: approve that one selection, as the owner would on Approvals.
    log(
      'SETUP approve',
      await p.evaluate(async (ws) => {
        const s = await (await fetch('/api/auth/session')).json();
        const ds = await (
          await fetch(`/api/workspaces/${ws}/decisions?status=pending`)
        ).json();
        const d = ds.find((x) => /selection|select/i.test(x.question)) ?? ds[0];
        const r = await fetch(
          `/api/workspaces/${ws}/decisions/${d.id}/answer`,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': s.csrf_token,
            },
            body: JSON.stringify({
              choice: 'approve_once',
              option_id: null,
              rationale: 'Walk approval (throwaway database).',
              coverage_hash: d.coverage.coverage_hash,
              standing_expires_at: null,
              time_spent_ms: 0,
              interruption: null,
            }),
          },
        );
        return `${r.status} ${d.question}`.slice(0, 120);
      }, WS),
    );
    await p
      .getByRole('button', { name: 'I approved it: submit again' })
      .click();
    await p.waitForTimeout(2500);
    log(
      'SETUP selection again',
      (await p.locator('form.decide [aria-live]').textContent()).slice(0, 120),
    );
  }
  // Proposal A: start, open sections 1 and 2, save.
  await p.goto(`${WEB}/#/projects/proposals?ws=${WS}`);
  await p.waitForTimeout(3500);
  log(
    'READY options',
    await p.getByRole('button', { name: 'Start a proposal' }).count(),
  );
  await p.getByRole('button', { name: 'Start a proposal' }).first().click();
  await p.waitForTimeout(2000);
  await p.locator('details.proposal-fold > summary').nth(1).click();
  log('A draft open sections', await names());
  await p.getByRole('button', { name: 'Save proposal' }).click();
  await p.waitForTimeout(3000);
  log('A after first save (should match the draft)', await names());
  const aId = await p.evaluate(() =>
    new URLSearchParams(location.hash.split('?')[1]).get('id'),
  );
  const pickA = async () => {
    await p.goto(`${WEB}/#/projects/proposals?ws=${WS}&id=${aId}`);
    await p.waitForTimeout(2500);
  };
  // R4-1: open sections in an unsaved draft for B, then pick the saved A: A starts afresh.
  await p.getByRole('button', { name: 'Start a proposal' }).first().click();
  await p.waitForTimeout(2000);
  await p.locator('details.proposal-fold > summary').nth(1).click();
  await p.locator('details.proposal-fold > summary').nth(7).click();
  log('R4-1 unsaved B draft open sections', await names());
  await pickA();
  log('R4-1 A picked after the draft (A default only)', await names());
  // R2-1: with A open, start B's draft, open sections, save: the draft's choices stay.
  await p.getByRole('button', { name: 'Start a proposal' }).first().click();
  await p.waitForTimeout(2000);
  await p.locator('details.proposal-fold > summary').nth(1).click();
  await p.locator('details.proposal-fold > summary').nth(5).click();
  log('R2-1 B draft open sections', await names());
  await p.getByRole('button', { name: 'Save proposal' }).click();
  await p.waitForTimeout(3000);
  log('R2-1 B after first save (same as draft)', await names());
  await pickA();
  log('R-2 A picked after B (A default only)', await names());
  await b.close();
})();
