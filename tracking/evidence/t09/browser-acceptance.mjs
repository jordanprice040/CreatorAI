// T09 acceptance: headless Chromium against `vite preview` and the API on a database seeded
// with `pnpm cli seed-selection`. Usage:
//   CREATOR_DEV_LOGIN_CODE=... T09_WS=<workspace> T09_PROBLEM=<clinic problem> T09_RUN=<seeded run> \
//   node tracking/evidence/t09/browser-acceptance.mjs <playwright module path> <chromium path>
// Writes screenshots and browser-acceptance.json next to this file. Every step asserts on text
// the rendered page shows; a failed assertion stops the run with a non-zero exit.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , pwPath, chromiumPath] = process.argv;
const { chromium } = await import(pwPath);
const out = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.T09_BASE ?? 'http://127.0.0.1:5173';
const WS = process.env.T09_WS;
const PROBLEM = process.env.T09_PROBLEM;
const RUN = process.env.T09_RUN;
const CODE = process.env.CREATOR_DEV_LOGIN_CODE;
if (!WS || !PROBLEM || !RUN || !CODE) throw new Error('missing T09_* or login env');

const steps = [];
const problems = [];
const browser = await chromium.launch({ executablePath: chromiumPath });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
const main = page.locator('main');
const view = (v, id = '', q = '') =>
  `${BASE}/#/${v}?ws=${WS}${id ? `&id=${encodeURIComponent(id)}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
async function shot(name) {
  await page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
  return `${name}.png`;
}
async function step(name, fn) {
  const started = Date.now();
  try {
    const observed = await fn();
    steps.push({ step: name, result: 'pass', ms: Date.now() - started, ...observed });
    console.log(`PASS ${name}`);
  } catch (e) {
    steps.push({ step: name, result: 'fail', error: String(e?.message ?? e) });
    console.log(`FAIL ${name}: ${e?.message ?? e}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
    throw e;
  }
}
const expectText = (loc, text, timeout = 10000) =>
  loc.getByText(text, { exact: false }).first().waitFor({ timeout });

let workflowId = '';
let newRun = '';
try {
  await step('sign in with the development code and land on the monitor', async () => {
    await page.goto(`${BASE}/#login=${CODE}`);
    await page.getByRole('heading', { name: 'Monitor' }).waitFor();
    await page.goto(view('overview'));
    await page.getByRole('heading', { name: 'Monitor' }).waitFor();
    await expectText(page, 'FIXTURE MODE');
    await expectText(main, 'decisions waiting for you');
    return { screenshot: await shot('01-monitor') };
  });

  await step('keyboard: the first Tab reaches the skip link', async () => {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent);
    if (!/Skip to content/.test(focused ?? '')) throw new Error(`focused ${focused}`);
    return { focused };
  });

  await step('submit a theme: brief, claims, new run with a model permission', async () => {
    await page.goto(view('submit'));
    await page.getByRole('heading', { name: 'Submit a theme' }).waitFor();
    await page.getByLabel('Theme (specific setting or group)').waitFor();
    // Pressing submit on an empty form explains what is missing in plain words.
    await page.getByRole('button', { name: /Save brief and start discovery/ }).click();
    await expectText(main, 'Theme: required');
    await page.getByLabel('Theme (specific setting or group)').fill('Missed follow-up visits at rural clinics');
    await page.getByLabel('First field').fill('healthcare operations');
    await page.getByLabel('Second field').fill('scheduling');
    await page.getByLabel('Target users').fill('Front-desk staff and clinic managers at rural clinics');
    await page.getByLabel('Measurable problem').fill('First appointments go unused when patients do not attend.');
    await page.getByLabel('What would be measured to tell it improved').fill('Share of first-appointment slots left unused each month');
    await page.getByLabel('Data and tools you may use (one per line)').fill('Synthetic appointment histories');
    const group = page.getByRole('group', { name: /What “Rural clinics recorded a 23 percent/ });
    await group.getByLabel('the problem').check();
    await group.getByLabel('who is affected').check();
    const tool = page.getByRole('group', { name: /What “The clinics’ scheduling systems send reminders/ });
    await tool.getByLabel('an existing tool').check();
    await expectText(main, '2 claims attached');
    await page.getByRole('button', { name: /Save brief and start discovery/ }).click();
    await page.waitForURL(/#\/runs\?/, { timeout: 20000 });
    workflowId = new URL(page.url().replace('#/', '')).searchParams.get('id') ?? '';
    if (!workflowId) throw new Error('no workflow id in the address after submit');
    await expectText(main, 'Discovery', 15000);
    return { workflow: workflowId, url: page.url(), screenshot: await shot('02-run-started') };
  });

  await step('the new run is visible on the monitor and persists after a reload', async () => {
    await page.reload();
    await expectText(main, workflowId.slice(0, 8), 15000);
    // The worker runs the workflow on the server; poll the monitor until it is listed as finished.
    for (let i = 0; i < 90; i++) {
      await page.goto(view('overview'));
      await expectText(main, 'Recently finished');
      const finished = ((await main.innerText()).split('Recently finished')[1] ?? '').split('Catalog')[0];
      if (finished.includes(workflowId.slice(0, 8))) break;
      await page.waitForTimeout(1000);
    }
    const text = await main.innerText();
    const finished = (text.split('Recently finished')[1] ?? '').split('Catalog')[0];
    const line = finished.split('\n').find((l) => l.includes(workflowId.slice(0, 8))) ?? '';
    if (!line) throw new Error('the submitted workflow did not finish on the server');
    return { monitor_line: line.trim(), screenshot: await shot('03-monitor-after-submit') };
  });

  await step('inspect evidence: claim passages, origin and freshness', async () => {
    await page.goto(view('compare', PROBLEM));
    await expectText(main, 'Evidence behind the problem');
    await page.getByRole('button', { name: 'All evidence for this claim →' }).first().click();
    await page.waitForURL(/#\/evidence\?/);
    await expectText(main, 'recorded a 23 percent no-show rate');
    const text = await main.innerText();
    return { has_passage: text.includes('recorded a 23 percent'), url: page.url(), screenshot: await shot('04-evidence') };
  });

  await step('compare the clinic problem: alternatives side by side with scores and gates', async () => {
    await page.goto(view('compare', PROBLEM));
    await expectText(main, 'Alternatives side by side');
    const cards = await main.locator('article.alt').count();
    if (cards < 5) throw new Error(`expected 5 alternatives, saw ${cards}`);
    await expectText(main, 'rank 1');
    await expectText(main, 'Ethics and access');
    return { alternatives: cards, screenshot: await shot('05-compare') };
  });

  await step('decide: supervised gate asks, approval in Decisions, then recorded', async () => {
    const choices = [
      [/^Human-led/, 'defer', 'No coordinator is funded this quarter (browser check).', 'a coordinator is funded'],
      [/^Software/, 'select_for_build', 'Gates pass and a manual baseline exists (browser check).', 'the manual baseline shows no fewer unused slots'],
      [/^Use the existing tool/, 'recommend_alternative', 'Highest suitability (browser check).', 'reminders are already fully configured'],
      [/^Front-desk/, 'reject', 'Duplicates a catalog idea (browser check).', 'it proves distinct'],
      [/^Hybrid/, 'research_further', 'Assessment incomplete (browser check).', 'evidence on combined flags appears'],
    ];
    for (const [legend, disposition, reason, reverse] of choices) {
      const fs = main.locator('fieldset').filter({ has: page.locator('legend', { hasText: legend }) });
      await fs.getByLabel('Disposition').selectOption(disposition);
      await fs.getByLabel('Reason').fill(reason);
      await fs.getByLabel('Would reverse if').fill(reverse);
    }
    await page.getByLabel('Overall rationale').fill('Browser acceptance selection: recommend reminders now, test flagging against a manual baseline.');
    await page.getByLabel(/Override reason/).fill('The human-led option is deferred because no coordinator is funded (browser check).');
    await page.getByLabel('Record under run').selectOption(RUN);
    await page.getByRole('button', { name: /Record this selection/ }).click();
    const waiting = main.getByText('Waiting for your approval.');
    const recorded = main.getByText('Selection recorded.');
    await waiting.or(recorded).first().waitFor({ timeout: 15000 });
    let asked = false;
    if (await waiting.isVisible()) {
      asked = true;
      await shot('06-decide-needs-approval');
      await page.getByRole('button', { name: 'Open the decision' }).click();
      await page.waitForURL(/#\/decisions\?/);
      const card = main.locator('article.decision.focused');
      await card.waitFor();
      await expectText(card, 'Asked by');
      await card.getByLabel('Your reason (required, brief)').fill('Approving the browser-check selection once.');
      await card.getByRole('button', { name: 'Approve this action once' }).click();
      await page.waitForTimeout(800);
      await shot('07-decision-approved');
      await page.goBack();
      // The form state is in memory; after navigating back it is rebuilt, so fill it again.
      if (!(await main.getByRole('button', { name: /I approved it: submit again/ }).isVisible().catch(() => false))) {
        await page.goto(view('compare', PROBLEM));
        await expectText(main, 'Alternatives side by side');
        for (const [legend, disposition, reason, reverse] of choices) {
          const fs = main.locator('fieldset').filter({ has: page.locator('legend', { hasText: legend }) });
          await fs.getByLabel('Disposition').selectOption(disposition);
          await fs.getByLabel('Reason').fill(reason);
          await fs.getByLabel('Would reverse if').fill(reverse);
        }
        await page.getByLabel('Overall rationale').fill('Browser acceptance selection: recommend reminders now, test flagging against a manual baseline.');
        await page.getByLabel(/Override reason/).fill('The human-led option is deferred because no coordinator is funded (browser check).');
        await page.getByLabel('Record under run').selectOption(RUN);
        await page.getByRole('button', { name: /Record this selection/ }).click();
      } else {
        await main.getByRole('button', { name: /I approved it: submit again/ }).click();
      }
      await recorded.waitFor({ timeout: 15000 });
    }
    await expectText(main, 'Browser acceptance selection');
    await page.reload();
    await expectText(main, 'Browser acceptance selection', 15000);
    return { asked_for_approval: asked, persisted_after_reload: true, screenshot: await shot('08-decided') };
  });

  await step('search history: text, exact id prefix and the activity log', async () => {
    await page.goto(view('search', '', 'no-show'));
    await expectText(main, 'Text search');
    const marks = await main.locator('mark').count();
    if (marks === 0) throw new Error('no highlighted snippet');
    const text = await main.innerText();
    await shot('09-search-text');
    await page.goto(view('search', '', PROBLEM.slice(0, 8)));
    await expectText(main, 'Id search');
    await expectText(main, 'matched id prefix');
    await shot('10-search-id');
    await page.goto(view('activity', 'selection.', ''));
    await expectText(main, 'Local owner');
    const act = await main.innerText();
    if (!/selection/i.test(act)) throw new Error('no selection event in activity');
    await page.goto(view('activity', '', 'Answered decision'));
    await expectText(main, 'Answered decision');
    return {
      text_hits_with_marks: marks,
      sections: ['Records', 'Source passages', 'Decisions', 'Activity'].filter((s) => text.includes(s)),
      screenshot: await shot('11-activity'),
    };
  });

  await step('budget denial: a tiny budget refuses the call before it is sent', async () => {
    await page.goto(view('budgets'));
    await page.getByRole('heading', { name: 'Fund a budget' }).waitFor();
    await page.getByLabel('Name').fill('Tiny browser-check budget');
    await page.getByLabel(/^Cap/).fill('0.000001');
    await page.getByRole('button', { name: 'Fund budget' }).click();
    await expectText(main, 'Tiny browser-check budget');
    await page.getByLabel('Prompt').fill('Summarize the clinic evidence');
    const opt = await page.locator('#benv option', { hasText: 'Tiny browser-check budget' }).getAttribute('value');
    await page.locator('#benv').selectOption(opt);
    await page.locator('#brun').selectOption({ label: new RegExp(RUN.slice(0, 8)) }).catch(async () => {
      const v = await page.locator('#brun option', { hasText: RUN.slice(0, 8) }).getAttribute('value');
      await page.locator('#brun').selectOption(v);
    });
    await page.getByRole('button', { name: /Reserve and send/ }).click();
    const status = page.locator('form p[role=status]');
    await status.waitFor({ timeout: 10000 });
    const said = await status.innerText();
    if (!/denied/i.test(said) || !/budget/i.test(said)) throw new Error(`unexpected outcome: ${said}`);
    await expectText(main, 'Not sent');
    return { outcome: said, screenshot: await shot('12-budget-denied') };
  });

  await step('permission revocation: revoked standing permission makes the next call ask', async () => {
    await page.goto(view('decisions'));
    await page.getByRole('heading', { name: /Decisions, policies and runs/ }).waitFor();
    const policies = main.locator('li', { hasText: 'model · generate' });
    await policies.first().waitFor({ timeout: 10000 });
    const before = await policies.count();
    if (before === 0) throw new Error('no standing model policy to revoke');
    const target = policies.first();
    const runLabel = (await target.innerText()).match(/run ([0-9a-f]{8})/)?.[1] ?? '';
    await target.getByRole('button', { name: 'Revoke' }).click();
    await page.waitForTimeout(800);
    const after = await main.locator('li', { hasText: 'model · generate' }).count();
    if (after !== before - 1) throw new Error(`policies ${before} → ${after}`);
    newRun = runLabel;
    await shot('13-permission-revoked');
    await page.goto(view('budgets'));
    await page.getByLabel('Prompt').waitFor();
    await page.getByLabel('Prompt').fill('Summarize the clinic evidence');
    const opt = await page.locator('#benv option', { hasText: 'Fixture discovery budget' }).getAttribute('value');
    await page.locator('#benv').selectOption(opt);
    const v = await page.locator('#brun option', { hasText: runLabel }).getAttribute('value');
    await page.locator('#brun').selectOption(v);
    await page.getByRole('button', { name: /Reserve and send/ }).click();
    const status = page.locator('form p[role=status]');
    await status.waitFor({ timeout: 10000 });
    const said = await status.innerText();
    if (/settled|charged/i.test(said.split('(')[0])) throw new Error(`call went through after revocation: ${said}`);
    await page.goto(view('activity', 'grant.', ''));
    await expectText(main, 'Revoked');
    return { run: runLabel, policies_before: before, policies_after: after, outcome: said, screenshot: await shot('14-after-revocation') };
  });

  await step('gallery is reserved and offers no download or preview', async () => {
    await page.goto(view('gallery'));
    await expectText(main, 'Not available yet.');
    const downloads = await main.getByRole('link', { name: /download|preview/i }).count();
    const buttons = await main.getByRole('button', { name: /download|preview/i }).count();
    if (downloads + buttons > 0) throw new Error('gallery shows a download or preview control');
    return { screenshot: await shot('15-gallery') };
  });

  await step('narrow screen: monitor and compare fit a 390px phone width', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(view('overview'));
    await expectText(main, 'decisions waiting for you');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot('16-mobile-monitor');
    await page.goto(view('compare', PROBLEM));
    await expectText(main, 'Alternatives side by side');
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0 || overflow2 > 0) throw new Error(`horizontal overflow ${overflow}px / ${overflow2}px`);
    return { horizontal_overflow_px: [overflow, overflow2], screenshot: await shot('17-mobile-compare') };
  });
} finally {
  writeFileSync(
    join(out, 'browser-acceptance.json'),
    JSON.stringify({ base: BASE, workspace: WS, workflow: workflowId, revoked_run: newRun, steps, console_problems: problems }, null, 2) + '\n',
  );
  await browser.close();
}
if (problems.length) console.log('Console problems:', problems);
