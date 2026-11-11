// Review M-1/L-1/N-2 walk: a recorded selection that needs no override reason (every option
// deferred, reason empty), so in Standard the override field really is folded. Then type into
// it and clear it from the keyboard and check focus and value; Proposals' review marks and the
// optional-sections group after closing it by hand.
// Usage: WALK_WS=<fresh `cli seed-selection` workspace id> WALK_PROPOSAL_WS=<workspace with a saved
// proposal> LOGIN_CODE=<dev code> node walk-override.cjs
const { chromium } = require('playwright');
const path = require('node:path');
const WEB = process.env.WALK_WEB ?? 'http://127.0.0.1:5183';
const WS = process.env.WALK_WS;
const CODE = process.env.LOGIN_CODE;
const shot = (n) => path.join(__dirname, 'screens', n);
const log = (k, v) => console.log(k, JSON.stringify(v));
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(WEB);
  await p.evaluate(async (code) => {
    await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  }, CODE);
  const setMode = (mode) =>
    p.evaluate(async (mode) => {
      const s = await (await fetch('/api/auth/session')).json();
      const cur = await (await fetch('/api/me/view-mode')).json();
      return (
        await fetch('/api/me/view-mode', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': s.csrf_token,
          },
          body: JSON.stringify({
            view_mode: mode,
            expected_version: cur.version,
          }),
        })
      ).status;
    }, mode);
  const go = async (route) => {
    await p.goto(`${WEB}/#/${route}?ws=${WS}`);
    await p.reload();
    await p.waitForTimeout(4500);
  };
  const clickAll = async (name) => {
    // Each click re-renders the form, so look again after every one.
    for (let i = 0; i < 20; i++) {
      const btn = p.getByRole('button', { name }).first();
      if (!(await btn.count())) return;
      await btn.click();
      await p.waitForTimeout(150);
    }
  };

  // Setup in Advanced: defer every option, empty override, record (approving once if asked).
  log('SETUP advanced', await setMode('advanced'));
  await go('projects/decide');
  await p
    .locator('form.decide')
    .getByRole('button', { name: 'Expand all' })
    .click();
  for (const s of await p.locator('form.decide select[id^="dis-"]').all())
    await s.selectOption('defer');
  await clickAll('Keep these reasons');
  await p.fill('#dec-override', '');
  await p.fill(
    '#dec-rationale',
    'Walk: defer every option so no override reason is needed (throwaway database).',
  );
  await p.locator('form.decide button[type=submit]').click();
  await p.waitForTimeout(2500);
  if (
    await p.getByRole('button', { name: 'I approved it: submit again' }).count()
  ) {
    log(
      'SETUP approve',
      await p.evaluate(async (ws) => {
        const s = await (await fetch('/api/auth/session')).json();
        const ds = await (
          await fetch(`/api/workspaces/${ws}/decisions?status=pending`)
        ).json();
        const d = ds[0];
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
        return r.status;
      }, WS),
    );
    await p
      .getByRole('button', { name: 'I approved it: submit again' })
      .click();
    await p.waitForTimeout(2500);
  }
  log(
    'SETUP selection',
    (await p.locator('form.decide [aria-live]').textContent()).slice(0, 100),
  );

  // Standard: the override reason is folded on load.
  log('MODE standard', await setMode('standard'));
  await go('projects/decide');
  const state = () =>
    p.evaluate(() => {
      const ov = document.querySelector('#dec-override');
      const fold = ov.closest('details.routine');
      return {
        fold: fold ? fold.querySelector('summary').textContent : null,
        foldOpen: fold ? fold.open : null,
        active: document.activeElement?.id || document.activeElement?.tagName,
        value: ov.value,
      };
    });
  log('LOADED', await state());
  await p.locator('#dec-override').evaluate((el) => {
    el.closest('details').open = true;
  });
  await p.locator('#dec-override').focus();
  await p.keyboard.type('because');
  await p.waitForTimeout(200);
  log('TYPED because', await state());
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Backspace');
  await p.keyboard.type('new reason');
  await p.waitForTimeout(200);
  log('CLEARED and TYPED new reason', await state());
  await p.keyboard.press('Control+A');
  await p.keyboard.press('Backspace');
  await p.waitForTimeout(200);
  log('CLEARED', await state());
  await p
    .locator('#dec-override')
    .evaluate((el) => el.closest('form').scrollIntoView());
  await p
    .locator('form.decide')
    .screenshot({ path: shot('decide-override-folded.png') });

  // Proposals: the deferred workspace has none, so use one with a saved proposal (the first
  // walk's workspace, WALK_PROPOSAL_WS) and open its first proposal.
  await p.goto(
    `${WEB}/#/projects/proposals?ws=${process.env.WALK_PROPOSAL_WS}`,
  );
  await p.reload();
  await p.waitForTimeout(4500);
  await p.locator('ul.rows button.text').first().click();
  await p.waitForTimeout(2500);
  log(
    'REVIEW marks',
    await p.evaluate(() => {
      const f = document.querySelector('.proposal-review-form');
      if (!f) return null;
      return {
        marksVisible: [...f.querySelectorAll('select')].filter(
          (s) => s.offsetParent !== null,
        ).length,
        marksInFold: !!f.querySelector('details.routine select'),
      };
    }),
  );
  const form = p.locator('form.proposal-form');
  const group = form.locator('details.routine', {
    has: p.locator('.proposal-fold'),
  });
  const expand = form.getByRole('button', { name: 'Expand all' });
  await expand.click();
  await p.waitForTimeout(200);
  log('EXPAND ALL group open', await group.evaluate((d) => d.open));
  await group.locator('> summary').click();
  await p.waitForTimeout(200);
  log('GROUP closed by hand', {
    open: await group.evaluate((d) => d.open),
    expandDisabled: await expand.isDisabled(),
  });
  await expand.click();
  await p.waitForTimeout(200);
  log('EXPAND ALL again', await group.evaluate((d) => d.open));
  log(
    'ORDER before Save',
    await form.evaluate((f) =>
      [
        ...f.querySelectorAll(
          'details.routine > summary, .what-happens h4, .actions button.primary',
        ),
      ]
        .slice(-3)
        .map((e) => e.textContent.trim().slice(0, 40)),
    ),
  );
  log('ERRORS', errors);
  await b.close();
})();
