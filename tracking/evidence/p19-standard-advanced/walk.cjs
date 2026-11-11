// P19 browser walk (ADR-0082): a new person in Standard goes from an empty fixture workspace to
// a scored option and a saved proposal without opening Advanced or the CLI; the choice follows
// them to a second browser; Advanced lists every tab and opens every routine field.
// Usage: node walk.cjs <out dir>   (dev servers on 5183/4330/4340, CREATOR_DEV_LOGIN_CODE below)
const { chromium } = require('playwright');
const fs = require('fs');
const B = 'http://127.0.0.1:5183';
const CODE = process.env.LOGIN_CODE || 'walkcode_p19_0123456789abcdefghijklmn';
const OUT = process.argv[2] || '.';
const log = [];
const note = (k, v) => {
  log.push({ step: k, value: v });
  console.log(k, JSON.stringify(v));
};
const errors = [];
const watch = (p, tag) => {
  p.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  p.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${tag}: ${r.status()} ${r.url()}`);
  });
};
let advancedClicks = 0;
(async () => {
  const b = await chromium.launch();
  const ctxA = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const p = await ctxA.newPage();
  watch(p, 'A');
  const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png` });
  const mode = async (page = p) =>
    page.$eval('#sidebar .view-mode', (el) => {
      const c = el.querySelector('input:checked');
      return c ? c.parentElement.textContent.trim() : null;
    });
  const tabs = async (page = p) =>
    page.$$eval('nav.page-tabs ul.tabs > li', (l) =>
      l.map((x) => x.textContent.trim()),
    );
  const firstRun = () =>
    p
      .$eval('main .first-run', (s) =>
        [...s.querySelectorAll('li')].map(
          (li) =>
            li.querySelector('strong').textContent +
            ': ' +
            li.querySelector('.badge').textContent,
        ),
      )
      .catch(() => null);
  const go = async (hash) => {
    await p.goto(`${B}/#/${hash}?ws=${WS}`);
    await p.waitForTimeout(2500);
  };
  const folds = (scope) =>
    p.$$eval(`${scope} details.routine`, (ds) =>
      ds.map((d) => ({
        open: d.open,
        summary: d.querySelector('summary').textContent,
      })),
    );

  await p.goto(`${B}/#login=${CODE}`);
  await p.waitForTimeout(2500);
  await p.click('text=New workspace');
  const name = `P19 walk ${new Date().toISOString().slice(11, 19)}`;
  await p.fill('input >> nth=0', name);
  await p.click('button:has-text("Create")');
  await p.waitForTimeout(3000);
  const WS = new URL(p.url().replace('#/', '')).searchParams.get('ws');
  note('0 workspace', { name, ws: WS, url: p.url() });
  note('0 view mode on first sign-in', await mode());
  const pref0 = await p.evaluate(() =>
    fetch('/api/me/view-mode').then((r) => r.json()),
  );
  note('0 server view choice before any click', pref0);
  note('1 Getting started on Chat', await firstRun());
  await shot('01-chat-getting-started');

  // Standard navigation: rarely used tabs are not listed, their routes still open.
  await go('projects/path');
  note('1 Projects tabs (Standard)', await tabs());
  await go('monitor/overview');
  note('1 Monitor tabs (Standard)', await tabs());
  await go('settings/general');
  note('1 Settings tabs (Standard)', await tabs());
  await go('monitor/workers');
  note('1 Workers route opens in Standard; tabs while open', await tabs());
  note(
    '1 Workers heading',
    await p
      .locator('main h2:visible')
      .first()
      .textContent()
      .catch(() => null),
  );

  // Step 1: evidence, from the Getting started button.
  await go('chat/conversations');
  await p.click('main .first-run button:has-text("Open Sources and claims")');
  await p.waitForTimeout(2500);
  note('2 opened', p.url().split('#')[1]);
  await p.click('button:has-text("Register a run for fetching")');
  await p.waitForTimeout(2500);
  for (const url of [
    'https://health.fixture.test/reports/clinic-access-2025',
    'https://wire.fixture.test/stories/clinic-waits',
  ]) {
    await p.fill('#evurl', url);
    await p.getByRole('button', { name: 'Fetch', exact: true }).click();
    await p.waitForTimeout(2500);
  }
  await p.click('ul.entities button >> nth=0');
  await p.waitForTimeout(1500);
  await p.click('button:has-text("Cite in a claim") >> nth=0');
  await p.waitForTimeout(800);
  note('2 cite form folds (Standard)', await folds('form.cite'));
  note('2 cite form: basis and stance stay open', {
    basis: await p.isVisible('#cite-basis'),
    stance: await p.isVisible('#cite-stance'),
    kind: await p.isVisible('#cite-type'),
  });
  await p.fill(
    '#cite-statement',
    'Patients at rural clinics wait weeks for appointments.',
  );
  await p.fill(
    '#cite-uncertainty',
    'Synthetic fixture report; how typical it is is unknown.',
  );
  await p.fill(
    '#cite-rationale',
    'The passage states the waiting times directly.',
  );
  await p.screenshot({ path: `${OUT}/02-cite-standard.png`, fullPage: true });
  await p.click('form.cite button:has-text("Save evidence")');
  await p.waitForTimeout(2500);

  // Step 2: budget, from the Getting started button.
  await go('chat/conversations');
  note('3 Getting started after evidence', await firstRun());
  await p.click('main .first-run button:has-text("Open Budgets")');
  await p.waitForTimeout(2500);
  note('3 budget defaults', {
    name: await p.inputValue('#fname'),
    cap: await p.inputValue('#fcap'),
  });
  await p.screenshot({ path: `${OUT}/03-budget-defaults.png`, fullPage: true });
  await p.click('button:has-text("Fund budget")');
  await p.waitForTimeout(1500);
  await p.click('button:has-text("Add fixture pricing")');
  await p.waitForTimeout(1500);

  // Step 3: discover, from the Getting started button.
  await go('chat/conversations');
  note('4 Getting started after budget', await firstRun());
  await p.click('main .first-run button:has-text("Open Discover")');
  await p.waitForTimeout(3000);
  await p.fill('#b-theme', 'Rural clinic access');
  await p.fill('#b-fa', 'Healthcare operations');
  await p.fill('#b-fb', 'Scheduling software');
  await p.fill('#b-users', 'Patients of rural clinics');
  await p.fill('#b-prob', 'Patients wait weeks for an appointment');
  await p.fill('#b-meas', 'Days from request to appointment');
  await p.check('.claims-pick label.claim-attach input');
  await p.waitForTimeout(300);
  await p.check('.claims-pick label:has-text("the problem") input');
  note('4 Discover folds (Standard)', await folds('main'));
  note(
    '4 Discover what will happen',
    await p.$eval('.what-happens', (s) => s.innerText).catch(() => null),
  );
  await p.screenshot({
    path: `${OUT}/04-discover-standard.png`,
    fullPage: true,
  });
  await p.click('button:has-text("Save brief and start discovery")');
  let state = '';
  for (let i = 0; i < 30 && !/Result: succeeded/.test(state); i++) {
    await p.waitForTimeout(2000);
    await go('monitor/runs');
    state = await p.innerText('main');
  }
  note(
    '4 discovery run',
    /Result: succeeded/.test(state) ? 'succeeded' : state.slice(0, 400),
  );

  // Step 4: score an option.
  await go('chat/conversations');
  note('5 Getting started after discovery', await firstRun());
  await p.click('main .first-run button:has-text("Open Decide")');
  await p.waitForTimeout(3000);
  const opts = await p.$$eval('#sc-option option', (os) =>
    os.map((o) => [o.value, o.textContent]),
  );
  const human = opts.find(([, t]) => t.startsWith('Human-led'));
  await p.selectOption('#sc-option', human[0]);
  await p.waitForTimeout(1000);
  const form = p.locator('form.score-form');
  const sets = form.locator('fieldset');
  for (let i = 0, n = await sets.count(); i < n; i++) {
    const f = sets.nth(i);
    const legend = await f.locator('legend').innerText();
    if (/Ethics|Access|Checks|Confidence|Software/.test(legend)) continue;
    if (!(await f.locator(':scope > [role=radiogroup]').count())) continue;
    await f
      .locator(':scope > [role=radiogroup] label:has-text("3") input')
      .check();
    const d = f.locator('details');
    if (await d.count()) await d.first().evaluate((x) => (x.open = true));
    await f.locator('label.claim-pick input').first().check();
    await f
      .locator('textarea')
      .first()
      .fill(
        'The one claim describes long waits that a coordinator could chase.',
      );
  }
  await form
    .locator(
      'fieldset:has(legend:has-text("Software influence")) label:has-text("Unknown") input',
    )
    .check();
  await p.fill('#sc-influence-note', 'Not assessed beyond the one claim.');
  await p.selectOption('#sc-ethics', 'clear');
  await p.fill('#sc-ethics-note', 'No ethical concern found in the evidence.');
  await p.selectOption('#sc-access', 'clear');
  await p.fill('#sc-access-note', 'Needs no new data access.');
  await p.selectOption('#sc-confidence', 'low');
  await p.fill('#sc-confidence-why', 'One synthetic source.');
  note('5 scorecard folds (Standard)', await folds('form.score-form'));
  note(
    '5 scorecard what will happen',
    await form.locator('.what-happens').innerText(),
  );
  await p.screenshot({ path: `${OUT}/05-score-standard.png`, fullPage: true });
  await form.locator('button:has-text("Save scorecard")').click();
  await p.waitForTimeout(3000);
  note(
    '5 scorecard errors',
    await form
      .locator('.error')
      .allInnerTexts()
      .catch(() => []),
  );

  // Humility review form of the hybrid option (rendered, not saved).
  const hb = p.locator('button:has-text("Add a humility review")').first();
  if (await hb.count()) {
    await hb.click();
    await p.waitForTimeout(1000);
    note('5 humility folds (Standard)', await folds('form.humility-form'));
    note(
      '5 humility what will happen',
      await p.locator('form.humility-form .what-happens').innerText(),
    );
    await p
      .locator('form.humility-form')
      .screenshot({ path: `${OUT}/06-humility-standard.png` });
    await p.click('form.humility-form button:has-text("Cancel")');
    await p.waitForTimeout(500);
  }

  // Step 5: choose (Decide), the run's gate asks once, then the proposal.
  const record = async () => {
    const dec = p.locator('form.decide');
    for (const s of await dec.locator('select[id^="dis-"]').all()) {
      const id = (await s.getAttribute('id')).slice(4);
      const legend = await dec
        .locator(`fieldset:has(#dis-${id}) legend`)
        .innerText();
      const h = legend.startsWith('Human-led');
      await s.selectOption({
        label: h ? 'Recommend (no new software)' : 'Defer',
      });
      await p.waitForTimeout(150);
      await p.fill(
        `#why-${id}`,
        h
          ? 'Ranked first and needs no new software.'
          : 'Not pursued in this first pass.',
      );
      await p.fill(
        `#rev-${id}`,
        h
          ? 'A coordinator role cannot be funded.'
          : 'The recommended option fails.',
      );
    }
    await p.fill(
      '#dec-rationale',
      'Start with the human-led option; revisit the others if it fails.',
    );
    await dec.locator('button:has-text("Record this selection")').click();
    await p.waitForTimeout(3000);
  };
  await go('projects/decide');
  await record();
  note(
    '6 after first record',
    (await p.innerText('main')).split('\n').slice(0, 3),
  );
  await go('monitor/approvals');
  const asked = await p.$eval('main', (m) =>
    /Allow candidate\.select/.test(m.innerText),
  );
  note('6 the run asked to allow the selection', asked);
  if (asked) {
    await p
      .locator('main textarea:visible, main input[type=text]:visible')
      .first()
      .fill('I chose the human-led option on Decide.');
    await p.click('button:has-text("Approve this action once")');
    await p.waitForTimeout(2500);
    await go('projects/decide');
    await record();
  }
  note(
    '6 selection history',
    await p.$eval('main', (m) => {
      const t = m.innerText;
      const i = t.indexOf('Selection history');
      return t.slice(i, i + 200);
    }),
  );
  await go('projects/proposals');
  await p.click('button:has-text("Start a proposal")');
  await p.waitForTimeout(1500);
  const pf = p.locator('form.proposal-form');
  const summary = pf.locator('textarea').first();
  if (!(await summary.inputValue()))
    await summary.fill(
      'Fund a named coordinator who follows up on every request until an appointment is booked.',
    );
  await pf.locator('button:has-text("Save proposal")').click();
  await p.waitForTimeout(3000);
  note(
    '7 proposals',
    await p.$$eval('main li', (l) =>
      l.map((x) => x.textContent).filter((t) => t.startsWith('Proposal:')),
    ),
  );
  await go('projects/path');
  note(
    '7 Getting started gone after the proposal',
    (await p.locator('main .first-run').count()) === 0,
  );
  await shot('07-path-after-proposal');
  note('7 view mode at the end of the walk (never switched)', {
    mode: await mode(),
    advancedClicks,
  });

  // Cross-device: switch to Advanced in browser A; a fresh browser B (own sign-in) shows it.
  await p.click('#sidebar .view-mode label:has-text("Advanced") input');
  advancedClicks++;
  await p.waitForTimeout(1500);
  note(
    '8 server choice after the switch in A',
    await p.evaluate(() => fetch('/api/me/view-mode').then((r) => r.json())),
  );
  const ctxB = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const q = await ctxB.newPage();
  watch(q, 'B');
  await q.goto(`${B}/#login=${CODE}`);
  await q.waitForTimeout(2500);
  await q.goto(`${B}/#/projects/path?ws=${WS}`);
  await q.waitForTimeout(3000);
  note('8 browser B view mode', await mode(q));
  note('8 browser B Projects tabs (Advanced)', await tabs(q));
  await q.goto(`${B}/#/monitor/overview?ws=${WS}`);
  await q.waitForTimeout(2500);
  note('8 browser B Monitor tabs (Advanced)', await tabs(q));
  // Advanced parity: no routine folds, every field in view.
  await q.goto(`${B}/#/projects/discover?ws=${WS}`);
  await q.waitForTimeout(3000);
  note(
    '9 Discover routine folds in Advanced',
    await q.$$eval('main details.routine', (d) => d.length),
  );
  note('9 Discover routine fields visible in Advanced', {
    time: await q.isVisible('#b-time'),
    budget: await q.isVisible('#b-budget'),
    revisions: await q.isVisible('#b-rev'),
    route: await q.isVisible('#b-route'),
  });
  await q.goto(`${B}/#/projects/decide?ws=${WS}`);
  await q.waitForTimeout(3000);
  const o2 = await q.$$eval('#sc-option option', (os) =>
    os.map((o) => [o.value, o.textContent]),
  );
  await q.selectOption(
    '#sc-option',
    o2.find(([, t]) => t.startsWith('Change the process'))[0],
  );
  await q.waitForTimeout(800);
  note(
    '9 scorecard routine folds in Advanced',
    await q.$$eval('form.score-form details.routine', (d) => d.length),
  );
  note(
    '9 scorecard check fields visible in Advanced',
    await q.isVisible('#sc-check-current_workaround'),
  );
  await q.screenshot({ path: `${OUT}/08-score-advanced.png`, fullPage: true });
  // Back to Standard in B: A picks it up on reload.
  await q.click('#sidebar .view-mode label:has-text("Standard") input');
  await q.waitForTimeout(1500);
  await p.reload();
  await p.waitForTimeout(3000);
  note('10 browser A after B switched back', await mode());
  note('errors', errors);
  fs.writeFileSync(`${OUT}/walk.json`, JSON.stringify(log, null, 2));
  await b.close();
})();
