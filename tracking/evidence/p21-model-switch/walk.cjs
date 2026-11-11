// P21 browser walk: one switch in the top bar changes the default on every listed form.
const { chromium } = require('playwright');
const fs = require('fs');
const WS = process.env.WS;
const CONN = process.env.CONN;
const B = 'http://127.0.0.1:5183';
const OUT = process.argv[2];
const log = [];
const note = (k, v) => {
  log.push({ step: k, value: v });
  console.log(k, JSON.stringify(v));
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 1400, height: 1000 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  let p = await ctx.newPage();
  await p.goto(`${B}/#login=walkcode_p21_0123456789abcdefghijkl`);
  await p.waitForTimeout(1500);
  // A fresh page per form, so only that form is mounted.
  const go = async (hash) => {
    await p.close();
    p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${hash}: ${e.message}`));
    p.on(
      'response',
      (r) =>
        r.status() >= 400 && errors.push(`${hash}: ${r.status()} ${r.url()}`),
    );
    await p.goto(`${B}/#/${hash}?ws=${WS}`);
    await p.waitForTimeout(2500);
    await p.$$eval('main details', (ds) =>
      ds.forEach((d) => {
        d.open = true;
      }),
    );
    await p.waitForTimeout(300);
  };
  const val = (sel) => p.$eval(sel, (x) => x.value).catch(() => null);
  const notes = () =>
    p.$$eval('main .model-note', (n) => n.map((x) => x.textContent));
  const forms = async (tag) => {
    await go('projects/discover');
    await p.selectOption('#x-route', 'subscription');
    await p.selectOption('#b-route', 'subscription');
    await p.waitForTimeout(500);
    note(`${tag}: Explore model`, await val('#x-model'));
    note(`${tag}: Discover model`, await val('#b-plan-model'));
    note(`${tag}: Discover page notes`, await notes());
    await go('projects/decide');
    if (await p.$('#as-route')) {
      await p.selectOption('#as-route', 'subscription');
      await p.waitForTimeout(400);
    }
    note(`${tag}: Assess model`, await val('#as-model'));
    note(`${tag}: Assess note`, await notes());
    if (tag.startsWith('2')) {
      const a = await p.$('#as-model');
      if (a) {
        await a.scrollIntoViewIfNeeded();
        await p.screenshot({ path: `${OUT}/05-assess-default-and-note.png` });
      }
    }
    await go('connections/models');
    note(`${tag}: Qualify model`, await val(`#q-model-${CONN}`));
    note(
      `${tag}: Chat answers card model`,
      await p
        .$eval(
          'section[aria-labelledby="chat-answers-title"] select:nth-of-type(1)',
          () => null,
        )
        .catch(() => null),
    );
    const chatCard = await p.$$eval('select', (s) =>
      s
        .filter((x) =>
          [...x.options].some((o) => o.value.startsWith('claude-walk')),
        )
        .map((x) => x.id || '(chat card)'),
    );
    const chatVals = await p.$$eval('select', (s) =>
      s
        .filter(
          (x) =>
            !x.id &&
            [...x.options].some((o) => o.value.startsWith('claude-walk')),
        )
        .map((x) => x.value),
    );
    note(`${tag}: model selects on Models page`, chatCard);
    note(`${tag}: Chat answers card model`, chatVals);
    await go('chat/conversations');
    note(
      `${tag}: Chat intro`,
      await p.$eval(
        'main',
        (m) => (m.textContent.match(/answered by [^ ]+/) || [null])[0],
      ),
    );
  };
  await go('projects/discover');
  await p.screenshot({
    path: `${OUT}/01-top-bar-before.png`,
    clip: { x: 248, y: 0, width: 1152, height: 120 },
  });
  await forms('1 before any switch');
  const switchTo = async (model, shot) => {
    await go('projects/discover');
    await p.click('details.model-switch summary');
    await p.waitForTimeout(800);
    if (shot)
      await p.screenshot({
        path: `${OUT}/${shot}-picker-open.png`,
        clip: { x: 248, y: 0, width: 1152, height: 520 },
      });
    await p.click(`label.model-switch-option:has-text("${model}")`);
    await p.waitForTimeout(1200);
    note(
      `switch to ${model}: status`,
      await p.$eval('details.model-switch [role=status]', (x) => x.textContent),
    );
    if (shot)
      await p.screenshot({
        path: `${OUT}/${shot}-picker-switched.png`,
        clip: { x: 248, y: 0, width: 1152, height: 520 },
      });
  };
  await switchTo('claude-walk-haiku', '02');
  await forms('2 after switching to haiku');
  await switchTo('claude-walk-sonnet', '');
  await forms('3 after switching to sonnet');
  await go('projects/discover');
  await p.selectOption('#b-route', 'subscription');
  await p.waitForTimeout(500);
  await (await p.$('#b-plan-model')).scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/04-discover-default-and-note.png` });
  // A pick on the form wins for that form only; the top bar keeps the choice.
  await p.selectOption('#b-plan-model', 'claude-walk-haiku');
  await p.waitForTimeout(300);
  note('Discover after picking haiku on the form', await val('#b-plan-model'));
  note('Discover notes after the form pick', await notes());
  note(
    'top bar after the form pick',
    await p.$eval('details.model-switch summary', (x) => x.textContent),
  );
  note('errors', errors);
  fs.writeFileSync(`${OUT}/walk.json`, JSON.stringify(log, null, 2));
  await b.close();
})();
