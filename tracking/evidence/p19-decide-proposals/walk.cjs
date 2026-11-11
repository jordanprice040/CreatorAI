// P19 follow-up walk: the Decide selection form and the Proposals form in Standard and Advanced,
// on a throwaway database seeded with `pnpm cli seed-selection` (reviewer ports 5183/4330/4340).
// Usage: node walk.cjs   (CREATOR_DEV_LOGIN_CODE as LOGIN_CODE). Prints observations.
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
  const csrf = await p.evaluate(async () => {
    const s = await (await fetch('/api/auth/session')).json();
    return s.csrf_token;
  });
  const setMode = (mode) =>
    p.evaluate(
      async ({ mode, csrf }) => {
        const cur = await (await fetch('/api/me/view-mode')).json();
        const r = await fetch('/api/me/view-mode', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
          body: JSON.stringify({
            view_mode: mode,
            expected_version: cur.version,
          }),
        });
        return r.status;
      },
      { mode, csrf },
    );
  const list = await p.evaluate(async () =>
    (await fetch('/api/workspaces')).json(),
  );
  const ws = list.find((w) => w.name.toLowerCase().includes('selection')).id;
  const go = async (route) => {
    await p.goto(`${WEB}/#/${route}?ws=${ws}`);
    await p.reload();
    await p.waitForTimeout(4500);
  };
  const decideFacts = () =>
    p.evaluate(() => {
      const f = document.querySelector('form.decide');
      if (!f) return null;
      const run = f.querySelector('#dec-run');
      const ov = f.querySelector('#dec-override');
      return {
        folds: [...f.querySelectorAll('details.routine')].map((d) => [
          d.querySelector('summary').textContent,
          d.open,
        ]),
        runInsideFold: !!run?.closest('details.routine'),
        overrideInsideFold: !!ov?.closest('details.routine'),
        whatHappens: [...f.querySelectorAll('.what-happens dt')].map((d) => [
          d.textContent,
          d.nextElementSibling.textContent,
        ]),
      };
    });

  for (const mode of ['standard', 'advanced']) {
    log(`MODE ${mode}`, await setMode(mode));
    await go('projects/decide');
    log(`DECIDE ${mode}`, await decideFacts());
    await p
      .locator('form.decide')
      .screenshot({ path: shot(`decide-${mode}.png`) });
  }

  // Standard: typing into the override reason keeps it in its fold (walk-override.cjs covers a
  // reason that is really folded, typed with the keyboard).
  await setMode('standard');
  await go('projects/decide');
  await p.fill('#dec-override', 'testing the fold');
  await p.waitForTimeout(300);
  log('DECIDE override typed', await decideFacts());
  await p.fill('#dec-override', '');

  // Proposals: open the first proposal, or start one from the first eligible option.
  const proposalFacts = () =>
    p.evaluate(() => {
      const f = document.querySelector('form.proposal-form');
      if (!f) return null;
      const group = [...f.querySelectorAll('details.routine')].find((d) =>
        d.querySelector('.proposal-fold'),
      );
      const titles = (root) =>
        [...root.querySelectorAll('.proposal-fold .fold-title')].map(
          (t) => t.textContent,
        );
      return {
        sectionsInView: titles(f).filter(
          (t) => !group || !titles(group).includes(t),
        ),
        foldedGroup: group
          ? {
              summary: group.querySelector('summary').textContent,
              open: group.open,
              sections: titles(group),
            }
          : null,
        reasonFold: [...f.querySelectorAll('details.routine > summary')]
          .map((s) => s.textContent)
          .filter((t) => t.startsWith('What changed')),
        whatHappens: [...f.querySelectorAll('.what-happens dt')].map((d) => [
          d.textContent,
          d.nextElementSibling.textContent,
        ]),
        reviewMarks: [
          ...document.querySelectorAll(
            '.proposal-review-form details.routine > summary',
          ),
        ].map((s) => s.textContent),
      };
    });
  for (const mode of ['standard', 'advanced']) {
    await setMode(mode);
    await go('projects/proposals');
    const openExisting = p
      .locator('.proposal-list button, ul.rows button')
      .first();
    const start = p
      .getByRole('button', {
        name: /Start a proposal|Draft a proposal|Start proposal/,
      })
      .first();
    if (await start.count()) {
      await start.click();
      await p.waitForTimeout(2000);
      log(`NEW DRAFT ${mode}`, await proposalFacts());
      await p.getByRole('button', { name: 'Save proposal' }).click();
      await p.waitForTimeout(2500);
    } else if (await openExisting.count()) {
      await openExisting.click();
      await p.waitForTimeout(2000);
    }
    log(`PROPOSAL ${mode}`, await proposalFacts());
    await p
      .locator('section.proposal')
      .screenshot({ path: shot(`proposal-${mode}.png`) });
  }
  // Standard: Expand all opens the folded group too.
  await setMode('standard');
  await go('projects/proposals');
  const again = p.locator('.proposal-list button, ul.rows button').first();
  if (await again.count()) await again.click();
  await p.waitForTimeout(2000);
  await p
    .locator('form.proposal-form')
    .getByRole('button', { name: 'Expand all' })
    .click();
  await p.waitForTimeout(300);
  log('PROPOSAL expand all', (await proposalFacts())?.foldedGroup);
  log('ERRORS', errors);
  await b.close();
})();
