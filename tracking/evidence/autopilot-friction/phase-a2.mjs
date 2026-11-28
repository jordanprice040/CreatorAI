// Phase A, part 2: "Automate the rest" from a recorded problem on a new run, started from the
// real "How much is automated" panel in Standard mode, settings off and Hands-off.
//   node tracking/evidence/autopilot-friction/phase-a2.mjs <out-dir>
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { session, WEB } from './lib.mjs';
import {
  AUTOPILOT_SETTINGS_DEFAULT,
  handsOff,
} from '../../../packages/contracts/dist/index.js';
const out = process.argv[2] ?? '.';
const s = await session();
const rows = [];

async function runOnce(label, values, from) {
  const seed = await s.cli('seed-discovery', `Audit rest ${label}`);
  const ws = seed.workspace?.id ?? seed.workspace;
  const base = `workspaces/${ws}`;
  await s.wait(async () =>
    (await s.get(`${base}/workflows`)).every((w) => w.finished_at),
  );
  if (values)
    await s.post(`${base}/autopilot-settings`, { expected_version: 0, values });
  const { b, page, errors } = await s.browser();
  let clicks = 0;
  await page.goto(`${WEB}/#/autopilot/run?ws=${ws}`);
  // Standard folds the section closed; opening it is one more click.
  await page.getByRole('button', { name: 'Start the autopilot' }).waitFor({ timeout: 20000 });
  await page.getByText('How much is automated').nth(1).click();
  clicks++;
  await page.getByRole('radio', { name: 'Automate the rest' }).waitFor({ timeout: 20000 });
  await page.getByRole('radio', { name: 'Automate the rest' }).check();
  clicks++;
  await page.locator('#am-run').selectOption('new');
  clicks++;
  if (from === 'select') {
    await page.getByRole('radio', { name: /Choose from the scores already recorded/ }).check();
    clicks++;
  }
  const form = page.locator('section').filter({ has: page.locator('#am-run') }).last();
  await form.getByRole('button', { name: 'Open them here' }).click();
  clicks++;
  await form.getByRole('checkbox', { name: /I have read both summaries/ }).check();
  clicks++;
  const go = page.getByRole('button', { name: /Automate the rest on a new run/ });
  const disabled = await go.isDisabled();
  if (disabled) {
    const blockers = await page.locator('ul.error').allInnerTexts();
    rows.push({ label, blocked: true, blockers });
    await page.screenshot({ path: join(out, `a2-${label}-blocked.png`) });
    await b.close();
    return;
  }
  await go.click();
  clicks++;
  let a;
  await s.wait(async () => {
    const list = await s.get(`${base}/autopilots`);
    a = (Array.isArray(list) ? list : list.autopilots ?? [])[0];
    return a && a.state === 'finished';
  }, 180_000);
  a = await s.get(`${base}/autopilots/${a.id}`);
  await page.goto(`${WEB}/#/autopilot/run?ws=${ws}`);
  await page.waitForTimeout(3000);
  await page.locator('article').first().scrollIntoViewIfNeeded().catch(() => {});
  const shot = `a2-${label}.png`;
  await page.screenshot({ path: join(out, shot) });
  rows.push({
    label,
    clicks_to_start: clicks,
    outcome: a.outcome,
    stop_kind: a.steps.at(-1)?.stop_kind ?? null,
    steps: a.steps.map(
      (x) => `${x.stage}:${x.state}${x.fallback ? `(fallback ${x.fallback.setting})` : ''}`,
    ),
    explanation: a.explanation,
    next: (a.next ?? []).map((n) => `${n.kind}: ${n.label}`),
    card: (await page.locator('article').first().innerText().catch(() => '')).slice(0, 1500),
    errors,
    shot,
  });
  await b.close();
}
await runOnce('off', null, 'assess');
await runOnce('handsoff', handsOff(AUTOPILOT_SETTINGS_DEFAULT), 'assess');
await runOnce('handsoff-ethics', {
  ...handsOff(AUTOPILOT_SETTINGS_DEFAULT),
  choose_model_ethics: true,
  accept_quote_checked_claims: true,
}, 'assess');
writeFileSync(join(out, 'phase-a2.json'), JSON.stringify(rows, null, 2));
for (const r of rows)
  console.log(
    r.blocked
      ? `${r.label}: BLOCKED ${JSON.stringify(r.blockers)}`
      : `${r.label}: ${r.outcome}/${r.stop_kind} after ${r.steps.length} steps [${r.steps.join(', ')}]\n  ${r.explanation}\n  next: ${r.next.join(' | ')}\n  errors: ${r.errors.length}`,
  );
