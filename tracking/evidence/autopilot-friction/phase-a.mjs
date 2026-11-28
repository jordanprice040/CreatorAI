// Autopilot friction audit, phase A (Jordan, November 28): start a whole-process autopilot from
// the real Autopilot page in Standard mode, as a person would, with the settings all off, with
// Hands-off, and with Hands-off plus quote-checked claims; record every stop, its card and the
// clicks it took. Throwaway database, fixture provider, $0.
//   node tracking/evidence/autopilot-friction/phase-a.mjs <out-dir>
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

async function runOnce(label, values) {
  const seed = await s.cli('seed-discovery', `Audit ${label}`);
  const ws = seed.workspace?.id ?? seed.workspace;
  const base = `workspaces/${ws}`;
  await s.wait(async () =>
    (await s.get(`${base}/workflows`)).every((w) => w.finished_at),
  );
  if (values)
    await s.post(`${base}/autopilot-settings`, {
      expected_version: 0,
      values,
    });
  const { b, page, errors } = await s.browser();
  let clicks = 0;
  await page.goto(`${WEB}/#/autopilot/run?ws=${ws}`);
  const start = page.getByRole('button', { name: 'Start the autopilot' });
  await start.waitFor({ timeout: 20000 });
  const startedDisabled = await start.isDisabled();
  await page.getByRole('button', { name: 'Open them here' }).click();
  clicks++;
  await page.getByRole('checkbox', { name: /I have read both summaries/ }).check();
  clicks++;
  await start.click();
  clicks++;
  // Wait for the autopilot to stop or finish.
  let a;
  await s.wait(async () => {
    const list = await s.get(`${base}/autopilots`);
    a = (Array.isArray(list) ? list : list.autopilots ?? [])[0];
    return a && a.state === 'finished';
  }, 180_000);
  a = await s.get(`${base}/autopilots/${a.id}`);
  await page.waitForTimeout(2500);
  const card = page.locator('article').first();
  await card.scrollIntoViewIfNeeded().catch(() => {});
  const shot = `a-${label}.png`;
  await page.screenshot({ path: join(out, shot), fullPage: false });
  const text = (await card.innerText().catch(() => '')).slice(0, 1500);
  rows.push({
    label,
    start_disabled_before_reading: startedDisabled,
    clicks_to_start: clicks,
    outcome: a.outcome,
    stop_kind: a.steps.at(-1)?.stop_kind ?? null,
    steps: a.steps.map(
      (x) => `${x.stage}:${x.state}${x.fallback ? `(fallback ${x.fallback.setting})` : ''}`,
    ),
    explanation: a.explanation,
    next: (a.next ?? []).map((n) => `${n.kind}: ${n.label}`),
    card: text,
    errors,
    shot,
  });
  await b.close();
}

await runOnce('off', null);
await runOnce('handsoff', handsOff(AUTOPILOT_SETTINGS_DEFAULT));
await runOnce('handsoff-claims', {
  ...handsOff(AUTOPILOT_SETTINGS_DEFAULT),
  accept_quote_checked_claims: true,
  choose_model_ethics: true,
});
writeFileSync(join(out, 'phase-a.json'), JSON.stringify(rows, null, 2));
for (const r of rows)
  console.log(
    `${r.label}: ${r.outcome}/${r.stop_kind} after ${r.steps.length} steps [${r.steps.join(', ')}]\n  ${r.explanation}\n  next: ${r.next.join(' | ')}\n  errors: ${r.errors.length}`,
  );
