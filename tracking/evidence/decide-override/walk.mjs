// ADR-0138 walk (November 28): Decide's "Clear what blocks this option" panel and the owner's
// warned gate override, on a throwaway database with the fixture provider ($0). Start
// ../owner-actions/stack.mjs first. node tracking/evidence/decide-override/walk.mjs <out-dir>
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { session, WEB } from '../autopilot-friction/lib.mjs';
import { fixtureScorecards } from '../../../packages/domain/dist/index.js';
const out = process.argv[2] ?? '.';
const s = await session();
const seed = await s.cli('seed-discovery', 'Decide override walk');
const ws = seed.workspace?.id ?? seed.workspace;
const base = `workspaces/${ws}`;
const clinic = seed.results.find((r) => r.scenario === 'software');
const problemId = clinic.discovery.catalog_records.problem.id;
const packet = await s.get(`${base}/workflows/${clinic.workflow}/packet`);
const evidence = packet.packet.claims
  .filter((c) => c.status === 'supported')
  .map((c) => ({ id: c.claim_id, version: c.version }));
const before = await s.get(`${base}/problems/${problemId}/report`);
const alts = before.suitability.candidates.map((c) => c.alternative);
for (const card of fixtureScorecards(alts, evidence))
  await s.post(`${base}/scorecards`, card);
const build = alts.find((a) => a.kind === 'build');
const report = await s.get(`${base}/problems/${problemId}/report`);
const row = report.suitability.candidates.find(
  (c) => c.alternative.id === build.id,
);
const notes = { blocked: row.gates.blocked };

const { b, page, errors } = await s.browser();
await page.goto(`${WEB}/#/projects/decide?ws=${ws}&id=${problemId}`);
await page
  .getByText('Clear what blocks this option')
  .first()
  .waitFor({ timeout: 30000 });
const panel = page
  .locator('fieldset')
  .filter({ hasText: build.title.slice(0, 40) })
  .locator('details.gate-clear')
  .first();
await page.getByRole('button', { name: 'Expand all' }).last().click();
await panel.locator('summary').click();
await panel.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, '01-clear-panel.png') });
await panel.getByRole('button', { name: 'Pass these gates myself…' }).click();
await panel.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, '02-override-warning.png') });
await panel
  .getByLabel('Why you pass them (saved with the choice)')
  .fill('Walk: I accept building without a humility review for this test.');
await panel.getByRole('checkbox').check();
await panel.getByRole('button', { name: 'Pass the gates' }).click();
const passed = page.locator('.gate-passed').first();
await passed.waitFor();
await passed.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, '03-gates-passed.png') });
// The blocked choices in this option's dropdown are now enabled and labelled.
const fieldset = passed.locator('xpath=ancestor::fieldset[1]');
const opts = await fieldset
  .locator('select')
  .first()
  .locator('option')
  .evaluateAll((os) =>
    os.map((o) => `${o.disabled ? '[off] ' : ''}${o.textContent}`),
  );
notes.dropdown = opts;
notes.errors = errors;
writeFileSync(join(out, 'walk.json'), JSON.stringify(notes, null, 2));
console.log(JSON.stringify(notes, null, 2));
await b.close();
