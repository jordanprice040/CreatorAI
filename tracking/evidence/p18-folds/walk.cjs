// P18 browser walk on a throwaway database (seeded with pnpm cli seed-lineage, seed-research,
// seed-discovery, seed-selection). Prints observations; screenshots go to ./screens.
const { chromium } = require('playwright');
const path = require('node:path');
const WEB = process.env.WALK_WEB ?? 'http://127.0.0.1:5183';
const CODE = process.env.WALK_CODE;
const shot = (n) => path.join(__dirname, 'screens', n);
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
  }, CODE);
  const list = await p.evaluate(async () =>
    (await fetch('/api/workspaces')).json(),
  );
  const ws = (k) => list.find((w) => w.name.includes(k)).id;
  const sel = ws('selection'),
    research = ws('research');
  const go = async (route, id) => {
    await p.goto(`${WEB}/#/${route}?ws=${id}`);
    await p.waitForTimeout(4500);
  };
  const height = () => p.evaluate(() => document.documentElement.scrollHeight);
  const opens = (sel) =>
    p.evaluate(
      (s) => [...document.querySelectorAll(s)].map((d) => d.open),
      sel,
    );

  // --- Decide ---
  await go('projects/decide', sel);
  log('DECIDE height', await height(), 'viewport 900');
  log('DECIDE option folds open', await opens('details.decide-option'));
  log('DECIDE alternative folds open', await opens('.alt > details.fold'));
  log('DECIDE claim folds open', await opens('.claim > details.fold'));
  // Keyboard: Tab focus on the first option summary, Enter opens, Space closes.
  const first = p.locator('details.decide-option > summary').first();
  await first.focus();
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  log('KEY Enter opens', (await opens('details.decide-option'))[0]);
  await p.keyboard.press(' ');
  await p.waitForTimeout(200);
  log('KEY Space closes', !(await opens('details.decide-option'))[0]);
  // Expand all / Collapse all for the options.
  const decideForm = p.locator('form.decide');
  await decideForm.getByRole('button', { name: 'Expand all' }).click();
  log('EXPAND ALL', await opens('details.decide-option'));
  await decideForm.getByRole('button', { name: 'Collapse all' }).click();
  log('COLLAPSE ALL', await opens('details.decide-option'));
  await p.screenshot({ path: shot('decide-collapsed.png'), fullPage: true });
  // A blocked Record: empty one option's reason while it is closed elsewhere.
  await p.locator('details.decide-option > summary').nth(1).click();
  const reason = p
    .locator('details.decide-option')
    .nth(1)
    .locator('input[id^="why-"]');
  await reason.fill('');
  await p.locator('details.decide-option > summary').nth(1).click(); // close it again
  await p.waitForTimeout(200);
  log(
    'BLOCKED summary',
    (
      await p.locator('details.decide-option > summary').nth(1).textContent()
    ).trim(),
  );
  log(
    'BLOCKED line',
    await p.evaluate(
      () =>
        [...document.querySelectorAll('form.decide p.small')]
          .map((x) => x.textContent)
          .find((t) => t.startsWith('Before you can record')) ?? 'none',
    ),
  );
  log(
    'RECORD disabled',
    await decideForm.locator('button[type=submit]').isDisabled(),
  );
  await decideForm.screenshot({ path: shot('decide-blocked.png') });
  // Open state kept while the app stays open: open an alternative, go to Scores and back.
  await p.locator('.alt > details.fold > summary').nth(2).click();
  await p
    .getByRole('tab', { name: 'Scores and specs' })
    .or(p.locator('a:has-text("Scores and specs")').first())
    .first()
    .click();
  await p.waitForTimeout(1500);
  await p
    .getByRole('tab', { name: 'Decide' })
    .or(p.locator('a:has-text("Decide")').first())
    .first()
    .click();
  await p.waitForTimeout(1500);
  log(
    'KEPT after leaving and returning',
    (await opens('.alt > details.fold'))[2],
    'reason still empty:',
    (await reason.inputValue()) === '',
  );

  // --- Scores and specs ---
  await go('projects/specs', sel);
  log('SCORES height', await height());
  await p.screenshot({ path: shot('scores-collapsed.png'), fullPage: true });
  await p.locator('ul.entities button.text').first().click();
  await p.waitForTimeout(1500);
  log('SPEC tasks fold open (not frozen)', await opens('.spec details.fold'));
  log(
    'SPEC blockers outside fold',
    await p.evaluate(() =>
      [...document.querySelectorAll('.spec > p')]
        .map((x) => x.textContent)
        .join(' | ')
        .slice(0, 300),
    ),
  );
  const why = p.locator('#frz-why');
  if (await why.count()) {
    await why.fill('Walk: freeze to raise an approval (throwaway database).');
    await p.getByRole('button', { name: 'Freeze this version' }).click();
    await p.waitForTimeout(2500);
    log(
      'FREEZE outcome',
      (await p.locator('.freeze [aria-live]').textContent()).slice(0, 200),
    );
  }

  // --- Approvals ---
  await go('monitor/approvals', sel);
  log(
    'APPROVALS decisions open',
    await opens('article.decision > details.fold'),
  );
  log(
    'L-5 heading inside each summary, once',
    await p.evaluate(() =>
      [...document.querySelectorAll('article.decision')].map(
        (a) =>
          !!a.querySelector('summary h3') &&
          a.querySelectorAll('h3.question').length === 1,
      ),
    ),
  );
  log(
    'APPROVALS decision summary',
    (
      await p
        .locator('article.decision summary')
        .first()
        .textContent()
        .catch(() => 'none')
    ).slice(0, 200),
  );
  // Turn on routine approvals for a run, so a policy card exists.
  const run = p.locator('#rp-run');
  if (await run.count()) {
    const v = await run.locator('option').nth(1).getAttribute('value');
    await run.selectOption(v);
    await p.waitForTimeout(300);
    await p
      .locator('input[id="rp-new-confirm"], input[id$="-confirm"]')
      .first()
      .check();
    await p
      .getByRole('button', { name: 'Turn on routine approvals for this run' })
      .click();
    await p.waitForTimeout(2000);
  }
  log('POLICY folds open', await opens('.routine-card > details.fold'));
  log(
    'POLICY summary',
    (
      await p
        .locator('.routine-card summary')
        .first()
        .textContent()
        .catch(() => 'none')
    ).slice(0, 200),
  );
  await p.screenshot({ path: shot('approvals.png'), fullPage: true });
  await p.getByRole('button', { name: 'Show answered and closed' }).click();
  await p.waitForTimeout(1500);
  log('ALL decisions open', await opens('article.decision > details.fold'));
  // Review L-7: collapse everything, then follow a link to one decision: it opens.
  await p.getByRole('button', { name: 'Collapse all' }).first().click();
  const decId = await p.evaluate(
    async (w) =>
      (await (await fetch(`/api/workspaces/${w}/decisions`)).json())[0]?.id,
    sel,
  );
  await p.goto(`${WEB}/#/monitor/approvals?ws=${sel}&id=${decId}`);
  await p.waitForTimeout(2000);
  log(
    'L-7 linked decision open after Collapse all',
    await p.evaluate(
      () => document.querySelector('article.decision > details')?.open,
    ),
  );
  // Re-review R-1: close it, go to Decide, follow the same link again: it opens again.
  await p.locator('article.decision > details > summary').first().click();
  await go('projects/decide', sel);
  await p.goto(`${WEB}/#/monitor/approvals?ws=${sel}&id=${decId}`);
  await p.waitForTimeout(2000);
  log(
    'R-1 same link again after closing',
    await p.evaluate(
      () => document.querySelector('article.decision > details')?.open,
    ),
  );

  // --- Proposals: start one from the recorded selection ---
  await go('projects/proposals', sel);
  const startBtn = p.getByRole('button', { name: 'Start a proposal' }).first();
  if (await startBtn.count()) {
    await startBtn.click();
    await p.waitForTimeout(2000);
    log('PROPOSAL section folds open', await opens('details.proposal-fold'));
    log(
      'PROPOSAL first summaries',
      (
        await p
          .locator('details.proposal-fold > summary')
          .evaluateAll((s) => s.slice(0, 4).map((x) => x.textContent.trim()))
      ).join(' || '),
    );
    log(
      'PROPOSAL checks visible',
      (await p.locator('.proposal-checks').first().textContent()).slice(0, 160),
    );
    log('PROPOSALS height', await height());
    await p.getByRole('button', { name: 'Expand all' }).first().click();
    log(
      'PROPOSALS height with every section open (the old layout)',
      await height(),
    );
    await p.getByRole('button', { name: 'Collapse all' }).first().click();
    // Review L-6: open a section, save, and it is still open after the editor remounts.
    await p.locator('details.proposal-fold > summary').nth(5).click();
    await p.getByRole('button', { name: 'Save proposal' }).click();
    await p.waitForTimeout(2500);
    const after = await opens('details.proposal-fold');
    log(
      'L-6 after save: section 6 open',
      after[5],
      'open count',
      after.filter(Boolean).length,
    );
    await p.screenshot({ path: shot('proposal-new.png'), fullPage: true });
  } else log('PROPOSAL none eligible');

  // Re-review R-2: choices made on one proposal do not carry to another opened by address.
  const props = await p.evaluate(
    async (w) =>
      (await (await fetch(`/api/workspaces/${w}/proposals`)).json()).map(
        (x) => x.id,
      ),
    sel,
  );
  if (props.length >= 2) {
    await go(`projects/proposals`, sel);
    await p.goto(`${WEB}/#/projects/proposals?ws=${sel}&id=${props[0]}`);
    await p.waitForTimeout(2000);
    const fresh = await opens('details.proposal-fold');
    await p.getByRole('button', { name: 'Expand all' }).first().click();
    await p.goto(`${WEB}/#/projects/proposals?ws=${sel}&id=${props[1]}`);
    await p.waitForTimeout(2000);
    const other = await opens('details.proposal-fold');
    log(
      'R-2 other proposal opens with its own defaults, open count',
      other.filter(Boolean).length,
      'of',
      other.length,
      '(fresh first proposal had',
      fresh.filter(Boolean).length,
      ')',
    );
  } else log('R-2 needs two proposals, found', props.length);
  // Re-review R-3: collapsed option summaries on Decide stay short.
  await go('projects/decide', sel);
  log(
    'R-3 collapsed option summary heights',
    await p.evaluate(() =>
      [...document.querySelectorAll('details.decide-option > summary')].map(
        (x) => Math.round(x.getBoundingClientRect().height),
      ),
    ),
  );

  // --- Empty lists ---
  await go('projects/decide', research);
  log(
    'EMPTY decide',
    (await p.locator('section.panel').first().textContent()).includes(
      'No problem records yet',
    ),
    'expand buttons:',
    await p.getByRole('button', { name: 'Expand all' }).count(),
  );
  await go('monitor/approvals', research);
  await p.reload();
  await p.waitForTimeout(3000);
  log(
    'EMPTY approvals',
    (await p.locator('section.panel').first().textContent()).includes(
      'Nothing needs you right now',
    ),
    'decision cards:',
    await p.locator('article.decision').count(),
    'expand buttons:',
    await p.getByRole('button', { name: 'Expand all' }).count(),
  );
  await b.close();
})();
