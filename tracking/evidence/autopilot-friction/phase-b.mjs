// Autopilot friction audit, phase B: one stopped card per stop kind, checked in the real
// Autopilot page. Throwaway database, review ports, fixture provider only, $0, no model call.
// Each card is a copy of a phase A2 autopilot (a real stop at select) with its last step's
// stop kind, outcome and note rewritten in the throwaway database, so the page's own reading
// of each kind is what is checked: the title, what it says to do, its buttons, and whether
// Continue is offered. Run phase-a2.mjs first, then:
//   node tracking/evidence/autopilot-friction/phase-b.mjs <database-url> <out-dir>
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { session, WEB } from './lib.mjs';
const require = createRequire(import.meta.url);
const { Client } = require('../../../packages/db/node_modules/pg');
const [dbUrl, out = '.'] = process.argv.slice(2);
if (!dbUrl || !/walk|throwaway/.test(dbUrl))
  throw new Error('Use a throwaway database whose name contains "walk".');
const db = new Client({ connectionString: dbUrl });
await db.connect();

// The stop kinds and the outcome the runner records with each (apps/api/src/autopilot.ts).
// A refused step takes its outcome from the refusal code, so the caps appear both ways.
const KINDS = [
  ['thin_evidence', 'insufficient_evidence', 'The evidence is too thin to rank options.'],
  ['unknown_ratings', 'needs_person', 'The first option has unknown ratings.'],
  ['tie', 'needs_person', null],
  ['close_ranking', 'needs_person', 'The first two options are close.'],
  ['not_advanceable', 'no_eligible_option', 'The first option cannot be advanced.'],
  ['gate_blocked', 'needs_person', 'A gate blocks the choice.'],
  ['opportunity', 'needs_person', 'The opportunity check says to wait.'],
  ['model_ethics', 'needs_person', 'The ethics gate (model) needs a person.'],
  ['failed_step', 'failed', 'The step failed after its repairs.'],
  ['claims_held', 'needs_person', 'Web claims checked only by their quotes wait for you.'],
  ['person_choice', 'needs_person', 'A person must choose under Decide.'],
  ['approval', 'needs_authority', 'No approval covers this step.'],
  ['paused', 'needs_person', 'The run is paused.'],
  ['run_cap', 'limit_reached', 'The connection’s per-run cap is reached.'],
  ['run_cap', 'needs_authority', 'The connection’s per-run cap is reached.'],
  ['daily_cap', 'limit_reached', 'The connection’s daily cap is reached.'],
  ['usage_limit', 'limit_reached', 'The plan account’s usage limit is reached.'],
  ['connection', 'needs_authority', 'The connection refused: its caps are not accepted.'],
  [
    'open_request',
    'needs_authority',
    'An earlier plan request has an unknown outcome; reconcile it in Models and connections.',
  ],
  ['call_limit', 'limit_reached', 'The autopilot’s call limit is reached.'],
  ['end_time', 'limit_reached', 'The autopilot’s end time passed.'],
  ['spec', 'needs_person', 'A software option stops at its spec.'],
  ['other', 'needs_person', 'Something else stopped it.'],
];

const { rows } = await db.query(
  `select * from autopilots where outcome = 'needs_person'
     and steps->-1->>'stop_kind' = 'tie' order by created_at desc limit 1`,
);
const src = rows[0];
const ws = src.workspace_id;
const s = await session();
const { b, page, errors } = await s.browser();
const results = [];
for (const [kind, outcome, note] of KINDS) {
  const id = randomUUID();
  const steps = structuredClone(src.steps);
  const last = steps.at(-1);
  last.stop_kind = kind;
  if (note) last.note = note;
  if (kind === 'end_time') last.stage = src.stage;
  await db.query(
    `insert into autopilots (id, workspace_id, run_id, fixture, config, config_hash, summary,
       policy_version, state, stage, outcome, explanation, steps, calls_reserved, version,
       created_by, finished_at, routine_policy_id)
     select $1, workspace_id, run_id, fixture, config, config_hash, summary, policy_version,
       'finished', stage, $2, $3, $4::jsonb, 0, 1, created_by, clock_timestamp(),
       routine_policy_id from autopilots where id = $5`,
    [id, outcome, note ?? src.explanation, JSON.stringify(steps), src.id],
  );
  const read = await s.get(`workspaces/${ws}/autopilots/${id}`);
  await page.goto(`${WEB}/#/autopilot/run?ws=${ws}&id=${id}`);
  await page.reload();
  const card = page.locator(`#autopilot-card-${id}`);
  await card.waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const title = (await card.locator('strong').first().textContent())?.trim();
  const buttons = (await card.getByRole('button').allTextContents()).map((t) =>
    t.trim(),
  );
  const text = (await card.textContent()) ?? '';
  const r = {
    kind,
    outcome,
    title,
    next: (read.next ?? []).map((n) => `${n.kind}${n.setting ? `:${n.setting}` : ''}`),
    buttons,
    says_approvals: /Approvals/.test(text),
    continue_offered: buttons.some((t) => /^Continue/.test(t)),
  };
  results.push(r);
  console.log(JSON.stringify(r));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: join(out, `b-${kind}-${outcome}.png`) });
}
await writeFile(join(out, 'phase-b.json'), JSON.stringify(results, null, 2));
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
await b.close();
await db.end();
