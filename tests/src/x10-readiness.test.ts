import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  checkPilot,
  PILOT_CONFIG,
  DIMENSIONS,
  evaluateReadiness,
  type OwnerPilot,
  type ReadinessRow,
  type Register,
} from '@creator/orchestrator';
import { percentile, runBench } from './x10-bench.js';
import { TEST_DB_ENV } from './pg-harness.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const exists = (p: string) => existsSync(join(root, p));
const isFile = (p: string) => {
  try {
    return statSync(join(root, p)).isFile();
  } catch {
    return false;
  }
};
const requirements = read('context/REQUIREMENTS.md');
const registerBytes = read('config/readiness.json');
const register = () => JSON.parse(registerBytes) as Register;
const pilot = () => JSON.parse(read('config/owner-pilot.json')) as OwnerPilot;
// Fixed clocks derived from the committed pilot window, so these checks neither start
// failing when the real window passes nor drift if the owner edits the window.
const committedStart = Date.parse(pilot().window.starts_at!);
const committedEnd = Date.parse(pilot().window.ends_at!);
const IN_WINDOW = new Date((committedStart + committedEnd) / 2);
const JUST_BEFORE_END = new Date(committedEnd - 1000);
const AT_END = new Date(committedEnd);
const AFTER_WINDOW = new Date(committedEnd + 1000);
const evaluate = (
  r: Register,
  p: OwnerPilot = pilot(),
  now: Date = IN_WINDOW,
) =>
  evaluateReadiness(r, p, requirements, exists, isFile, JSON.stringify(r), now);
const verifiedRow = (id: string): ReadinessRow => ({
  id,
  states: Object.fromEntries(
    DIMENSIONS.map((d) => [d, 'verified']),
  ) as ReadinessRow['states'],
  required: [...DIMENSIONS],
  evidence: ['config/readiness.json'],
  blocked_on: null,
});
const filledPilot = (r: Register): OwnerPilot => ({
  ...pilot(),
  status: 'not_started',
  decided_by: 'owner (synthetic test value)',
  decided_at: '2026-10-19T00:00:00Z',
  budget_nano_usd: '5000000000',
  window: {
    starts_at: '2026-10-20T00:00:00Z',
    ends_at: '2099-01-01T00:00:00Z',
  },
  schedules: [{ kind: 'synthetic' }],
  enabled_accounts: [r.integrations[0]!.id],
  platforms: ['local-web'],
  stop_rules: {
    max_spend_nano_usd: '4000000000',
    max_consecutive_failures: 3,
    max_owner_minutes: 120,
    stop_on_unknown_cost: true,
  },
});

test('X10 committed register is consistent, cites real evidence, and does not claim readiness', () => {
  const r = evaluate(register(), pilot());
  assert.deepEqual(r.problems, []);
  assert.equal(r.verdict, 'not_ready');
  assert.equal(r.requirements.length, 54);
  // The owner pilot was decided on 2026-10-30 and recorded as completed by Jordan on
  // 2026-11-10, with its log as evidence. A completed pilot is judged by its record, so its
  // gate passes from its finish time on, though its window has passed; before that time
  // the record would be claiming a finish that had not happened yet.
  assert.equal(pilot().status, 'completed');
  const finishedAt = Date.parse(pilot().finished_at!);
  for (const now of [new Date(finishedAt), new Date(finishedAt + 86_400_000)])
    assert.deepEqual(evaluate(register(), pilot(), now).pilot, {
      ready: true,
      refusals: [],
    });
  assert.deepEqual(
    evaluate(register(), pilot(), new Date(finishedAt - 1000)).pilot.refusals,
    ['Pilot finish time is in the future.'],
  );
  // The same plan not yet finished passes while its window is open (up to its last
  // second), and is refused once it has ended.
  const running: OwnerPilot = { ...pilot(), status: 'running', evidence: [] };
  assert.deepEqual(evaluate(register(), running, JUST_BEFORE_END).pilot, {
    ready: true,
    refusals: [],
  });
  for (const now of [AT_END, AFTER_WINDOW])
    assert.deepEqual(evaluate(register(), running, now).pilot, {
      ready: false,
      refusals: ['Pilot window has already ended.'],
    });
  // A completed pilot whose evidence is missing is still refused after its window.
  assert.deepEqual(
    evaluate(
      register(),
      { ...pilot(), evidence: ['docs/NEVER_WRITTEN.md'] },
      new Date(finishedAt),
    ).pilot.refusals,
    ['Pilot evidence "docs/NEVER_WRITTEN.md" is not a file in the repository.'],
  );
  // Nothing in the studio has a verified live model call, so live discovery rows stay open.
  assert.ok(
    r.requirements.find((x) => x.id === 'C01')?.missing.includes('live'),
  );
  assert.ok(
    r.integrations
      .find((x) => x.id === 'openai-models')
      ?.missing.includes('live'),
  );
});

test('X10 readiness refuses unsupported claims, missing rows and inconsistent states', () => {
  const problems = (mutate: (r: Register) => void) => {
    const r = register();
    mutate(r);
    return evaluate(r).problems.join('\n');
  };
  assert.match(
    problems((r) => {
      r.requirements[0]!.states.live = 'verified';
      r.requirements[0]!.evidence = [];
    }),
    /C01: claims .*live.* verified with no evidence/,
  );
  assert.match(
    problems((r) => {
      r.requirements[1]!.evidence = ['tracking/evidence/never-written'];
    }),
    /does not exist/,
  );
  assert.match(
    problems((r) => {
      r.requirements[2]!.evidence = ['../outside'];
    }),
    /must be repository-relative/,
  );
  assert.match(
    problems((r) => r.requirements.splice(4, 1)),
    /Requirement C05 has no readiness row/,
  );
  assert.match(
    problems((r) => r.requirements.push({ ...r.requirements[0]!, id: 'C99' })),
    /C99 is not in the requirement table/,
  );
  assert.match(
    problems((r) => r.integrations.push({ ...r.integrations[0]! })),
    /Duplicate readiness row openai-models/,
  );
  assert.match(
    problems((r) => {
      r.integrations[0]!.states.activated = 'verified';
    }),
    /"activated" verified but "live" is not/,
  );
  assert.match(
    problems((r) => {
      r.requirements[0]!.blocked_on = null;
    }),
    /not ready .* but blocked_on is empty/,
  );
  assert.match(
    problems((r) => {
      delete (r.requirements[0]!.states as Partial<ReadinessRow['states']>)
        .native;
    }),
    /state "native" is missing/,
  );
  assert.match(
    problems((r) => {
      r.requirements[8]!.required = ['implemented', 'live'];
    }),
    /"live" is required but marked not_applicable/,
  );
});

test('X10 pilot gate: owner choices, stop rules and verified accounts are all required', () => {
  const base = register();
  const undecided: OwnerPilot = {
    ...pilot(),
    decided_by: null,
    decided_at: null,
    budget_nano_usd: null,
    window: { starts_at: null, ends_at: null },
    schedules: null,
    enabled_accounts: [],
    platforms: [],
    stop_rules: {
      max_spend_nano_usd: null,
      max_consecutive_failures: null,
      max_owner_minutes: null,
      stop_on_unknown_cost: true,
    },
  };
  assert.ok(checkPilot(undecided, base, isFile).refusals.length >= 8);
  // An account the owner has not activated is refused even though its live path is verified.
  const unactivated = register();
  unactivated.integrations.find(
    (i) => i.id === 'claude-code',
  )!.states.activated = 'not_verified';
  assert.match(
    checkPilot(pilot(), unactivated, isFile, IN_WINDOW).refusals.join('\n'),
    /"claude-code" has not been activated/,
  );
  // A register in which everything is verified, with a complete owner plan, may start.
  const all = register();
  all.requirements = all.requirements.map((r) => verifiedRow(r.id));
  all.integrations = all.integrations.map((r) => verifiedRow(r.id));
  const plan = filledPilot(all);
  assert.deepEqual(checkPilot(plan, all, isFile).refusals, []);
  const refusals = (p: Partial<OwnerPilot>, reg = all) =>
    checkPilot({ ...plan, ...p }, reg, isFile).refusals.join('\n');
  assert.match(
    refusals({
      stop_rules: { ...plan.stop_rules, max_spend_nano_usd: '6000000000' },
    }),
    /exceeds the pilot budget/,
  );
  assert.match(
    refusals({
      stop_rules: { ...plan.stop_rules, stop_on_unknown_cost: false },
    }),
    /unknown billing is not zero/,
  );
  assert.match(refusals({ budget_nano_usd: '1.5' }), /pilot budget/);
  // Manual runs only (decision #29) is an explicit empty schedule list; null is no choice.
  assert.deepEqual(
    checkPilot({ ...plan, schedules: [] }, all, isFile).refusals,
    [],
  );
  assert.match(refusals({ schedules: null }), /not chosen pilot schedules/);
  assert.match(
    refusals({
      window: {
        starts_at: '2026-01-02T00:00:00Z',
        ends_at: '2026-01-01T00:00:00Z',
      },
    }),
    /ends before it starts/,
  );
  assert.match(
    refusals({ platforms: ['mac-desktop'] }),
    /not one this studio supports/,
  );
  assert.match(
    refusals({ enabled_accounts: ['made-up'] }),
    /not an integration/,
  );
  // The committed register has no live-verified account and no verified hosted platform.
  assert.match(
    refusals(
      { enabled_accounts: ['openai-models'], platforms: ['hosted'] },
      base,
    ),
    /Platform "hosted" is not verified ready[\s\S]*openai-models" has no verified live path/,
  );
  assert.match(
    refusals({ status: 'completed', evidence: [] }),
    /completed without evidence/,
  );
  // Even a passing plan does not make the product ready until the pilot is completed.
  const r = evaluateReadiness(all, plan, requirements, exists, isFile, '{}');
  assert.deepEqual(r.problems, []);
  assert.equal(r.verdict, 'not_ready');
  const finished: OwnerPilot = {
    ...plan,
    status: 'completed',
    finished_by: 'owner (synthetic test value)',
    finished_at: '2026-11-01T00:00:00Z',
    evidence: ['docs/OWNER_PILOT_LOG.md'],
  };
  const LATER = new Date('2026-12-01T00:00:00Z');
  const done = evaluateReadiness(
    all,
    finished,
    requirements,
    exists,
    isFile,
    '{}',
    LATER,
  );
  assert.equal(done.verdict, 'ready');
  // A completed record must say who finished it and when, inside or after its window and
  // not in the future, with repository-relative evidence other than the pilot config.
  const completedRefusals = (p: Partial<OwnerPilot>) =>
    checkPilot({ ...finished, ...p }, all, isFile, LATER).refusals.join('\n');
  assert.equal(completedRefusals({}), '');
  assert.match(completedRefusals({ finished_by: null }), /finished_by/);
  assert.match(completedRefusals({ finished_at: null }), /finished_at/);
  assert.match(completedRefusals({ finished_at: 'yesterday' }), /finished_at/);
  assert.match(
    completedRefusals({ finished_at: '2026-01-01T00:00:00Z' }),
    /finished before its window started/,
  );
  // A window wholly in the future cannot have been finished.
  assert.match(
    completedRefusals({
      window: {
        starts_at: '2027-01-01T00:00:00Z',
        ends_at: '2027-02-01T00:00:00Z',
      },
    }),
    /finished before its window started/,
  );
  assert.match(
    completedRefusals({ finished_at: '2026-12-02T00:00:00Z' }),
    /finish time is in the future/,
  );
  assert.match(
    completedRefusals({ evidence: [PILOT_CONFIG] }),
    /cannot be the pilot config itself/,
  );
  // Other spellings of the config path are still the config.
  for (const same of [
    './config/owner-pilot.json',
    'config//owner-pilot.json',
    'config/./owner-pilot.json',
    'docs/../config/owner-pilot.json',
  ])
    assert.match(
      completedRefusals({ evidence: [same] }),
      /cannot be the pilot config itself/,
    );
  // Evidence must be a file: not empty, the repository root or a folder.
  for (const notFile of ['', ' ', '.', './', 'docs', 'docs/'])
    assert.match(
      completedRefusals({ evidence: [notFile] }),
      /repository-relative file path|is not a file/,
    );
  // Impossible dates are not times: no month 13, no February 30, no hour 25.
  for (const bad of [
    '2026-13-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
    '2026-11-01T25:00:00Z',
  ])
    assert.match(completedRefusals({ finished_at: bad }), /finished_at/);
  // finished_by must be non-blank text.
  for (const who of ['', '   ', 42 as unknown as string])
    assert.match(completedRefusals({ finished_by: who }), /finished_by/);
  // A running pilot with an impossible window end is refused, not left unbounded.
  for (const end of ['2026-13-01T00:00:00Z', '2099-02-30T00:00:00Z'])
    assert.match(
      checkPilot(
        { ...plan, window: { starts_at: plan.window.starts_at, ends_at: end } },
        all,
        isFile,
        LATER,
      ).refusals.join('\n'),
      /has not chosen the pilot window/,
    );
  for (const bad of [
    '/etc/passwd',
    '../outside.md',
    'docs\\OWNER_PILOT_LOG.md',
  ])
    assert.match(
      completedRefusals({ evidence: [bad] }),
      /must be a repository-relative file path/,
    );
});

test('X10 release archive binds every file to the commit and refuses tampering', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'creator-x10-archive-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args: string[]) =>
    execFileSync(process.execPath, ['scripts/release-archive.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const fails = (re: RegExp, ...args: string[]) =>
    assert.throws(
      () => run(...args),
      (e: { stderr?: string }) => re.test(String(e.stderr)),
    );
  const out = join(dir, 'a');
  assert.match(run('--build', 'HEAD', out), /matches git ls-tree/);
  fails(/new output directory/, '--build', 'HEAD', out);
  const manifestPath = join(out, 'MANIFEST.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const tarPath = join(out, manifest.tar);
  const original = readFileSync(tarPath);
  // Change one byte of a file and re-hash the tar: the per-file check still catches it.
  const tampered = Buffer.from(original);
  const at = tampered.indexOf('Creator Agent');
  tampered[at] = tampered[at]! ^ 1;
  writeFileSync(tarPath, tampered);
  manifest.tar_sha256 = createHash('sha256').update(tampered).digest('hex');
  writeFileSync(manifestPath, JSON.stringify(manifest));
  fails(/sha256 differs/, '--verify', out);
  writeFileSync(tarPath, original);
  run('--build', 'HEAD', join(dir, 'b'));
  const pristine = JSON.parse(
    readFileSync(join(dir, 'b', 'MANIFEST.json'), 'utf8'),
  );
  pristine.files.push({ path: 'extra.txt', bytes: 0, sha256: 'x', blob: 'x' });
  writeFileSync(join(dir, 'b', 'MANIFEST.json'), JSON.stringify(pristine));
  fails(/Missing from tar: extra.txt/, '--verify', join(dir, 'b'));
  run('--build', 'HEAD', join(dir, 'c'));
  assert.match(
    run('--extract', join(dir, 'c'), join(dir, 'x')),
    /Extracted \d+ files/,
  );
  assert.equal(
    readFileSync(join(dir, 'x', 'package.json'), 'utf8'),
    execFileSync('git', ['show', 'HEAD:package.json'], {
      cwd: root,
      encoding: 'utf8',
    }),
  );
});

test('X10 benchmark percentiles use nearest rank', () => {
  const s = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(s, 50), 50);
  assert.equal(percentile(s, 95), 95);
  assert.equal(percentile(s, 99), 99);
  assert.equal(percentile([7], 99), 7);
});

test('X10 benchmark seeds the declared workload through the real store and drops its database', async (t) => {
  const admin = process.env[TEST_DB_ENV];
  if (!admin)
    return t.skip(`PostgreSQL gate not run: ${TEST_DB_ENV} is not set`);
  const before = await databases(admin);
  const r = await runBench({
    adminUrl: admin,
    ideas: 60,
    events: 700,
    samples: 5,
  });
  assert.equal(r.seeded.ideas, 60);
  assert.ok(r.seeded.audit_events! >= 700);
  assert.equal(r.seeded.history_rows, r.seeded.audit_events);
  assert.ok(r.seeded.reservations! > 0);
  for (const k of [
    'catalog_text_search',
    'catalog_browse',
    'catalog_id_lookup',
    'bounded_lineage',
    'cost_aggregation',
    'event_display_lag',
  ])
    assert.equal(r.measurements[k]?.samples, 5, k);
  assert.match(r.label, /synthetic/);
  assert.ok(r.provisional_targets.every((x) => /provisional/.test(x.target)));
  // Its own database is gone (another bench may be running, so only check nothing was added).
  const after = await databases(admin);
  assert.ok(
    after.every((d) => before.includes(d)),
    after.join(),
  );
});

async function databases(url: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query(
    `select datname from pg_database where datname like 'creator_bench_%' order by 1`,
  );
  await c.end();
  return rows.map((x: { datname: string }) => x.datname);
}
