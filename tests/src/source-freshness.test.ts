import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createApi, recheckOperationId } from '@creator/api';
import {
  ProblemComparisonSchema,
  RetrievalSchema,
  SourceDetailSchema,
  SourceRecheckResultSchema,
  StoredEntitySchema,
  type ClaimEvidence,
  type PassageCheck,
  type SourceRecheckResult,
} from '@creator/contracts';
import { passageCheck, passageLabels } from '@creator/domain';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// F8 (ADR-0126): source freshness on Decide.

const H = (c: string) => c.repeat(64);
const base = {
  latest_state: 'fetched' as const,
  source_version: 1,
  source_current_version: 2,
  cited_passage_hash: H('a'),
  quote: 'the median wait was 41 days',
  current_hashes: [H('b')],
  current_excerpts: ['The median wait was 38 days in 2025.'],
};

test('passage check: page gone wins, same version needs no look, then hash, then quote', () => {
  assert.equal(passageCheck({ ...base, latest_state: 'removed' }), 'page_gone');
  assert.equal(
    passageCheck({
      ...base,
      latest_state: 'inaccessible',
      source_current_version: 1,
    }),
    'page_gone',
  );
  assert.equal(
    passageCheck({ ...base, source_current_version: 1 }),
    'same_version',
  );
  assert.equal(
    passageCheck({ ...base, current_hashes: [H('b'), H('a')] }),
    'passage_kept',
  );
  // The paragraph was edited elsewhere but the quoted words survive (whitespace-normalized).
  assert.equal(
    passageCheck({
      ...base,
      current_excerpts: [
        null,
        'Edited: the median   wait was 41 days, as before.',
      ],
    }),
    'quote_kept',
  );
  assert.equal(passageCheck(base), 'passage_changed');
  // Hash-only retention: no excerpts, the hash alone decides.
  assert.equal(
    passageCheck({ ...base, current_excerpts: [null] }),
    'passage_changed',
  );
  assert.equal(
    passageCheck({
      ...base,
      current_hashes: [H('a')],
      current_excerpts: [null],
    }),
    'passage_kept',
  );
  assert.equal(
    passageCheck({ ...base, cited_passage_hash: null, quote: null }),
    'cannot_tell',
  );
  // A failed or blocked refetch is not evidence the page is gone.
  assert.equal(
    passageCheck({
      ...base,
      latest_state: 'failed',
      source_current_version: 1,
    }),
    'same_version',
  );
});

test('passage labels skip retracted and superseded rows', () => {
  const row = (check: PassageCheck, freshness = 'changed' as const) => ({
    check,
    freshness,
  });
  assert.deepEqual(
    passageLabels([row('same_version', 'current' as never)]),
    [],
  );
  assert.deepEqual(passageLabels([row('passage_changed')]), [
    'a recheck found a cited passage changed or gone',
  ]);
  assert.deepEqual(passageLabels([row('quote_kept')]), [
    'a cited source changed but the quoted passage is still there',
  ]);
  assert.deepEqual(
    passageLabels([
      { check: 'passage_changed', freshness: 'retracted' },
      { check: 'passage_changed', freshness: 'claim_changed' },
    ]),
    [],
  );
});

test('recheck operation ids are stable valid UUIDs per recheck and source', () => {
  const a = recheckOperationId(randomUUID(), randomUUID());
  assert.match(
    a,
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const r = randomUUID();
  const s = randomUUID();
  assert.equal(
    recheckOperationId(r, s),
    recheckOperationId(r.toUpperCase(), s),
  );
  assert.notEqual(
    recheckOperationId(r, s),
    recheckOperationId(randomUUID(), s),
  );
});

type Fresh = {
  oldest: string | null;
  never: number;
  sources: number;
  changed: number;
  gone: number;
};
type Rules = {
  checkedAgo: (iso: string, now: number) => string;
  claimFreshness: (c: ClaimEvidence) => Fresh;
  claimFreshnessLine: (f: Fresh, now: number) => string;
  claimFlags: (f: Fresh) => string[];
  recheckSummary: (r: SourceRecheckResult) => string;
};
async function loadRules() {
  const source = await readFile(
    'apps/web/src/source-freshness-rules.ts',
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Rules;
  new Function('exports', code)(exports);
  return exports;
}

test('web rules: checked times, claim lines, flags and the recheck summary', async () => {
  const r = await loadRules();
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.equal(r.checkedAgo('2026-11-16T11:59:30Z', now), 'just now');
  assert.equal(r.checkedAgo('2026-11-16T12:05:00Z', now), 'just now');
  assert.equal(r.checkedAgo('2026-11-16T11:59:00Z', now), '1 minute ago');
  assert.equal(r.checkedAgo('2026-11-16T09:00:00Z', now), '3 hours ago');
  assert.equal(r.checkedAgo('2026-11-04T12:00:00Z', now), '12 days ago');

  const row = (
    source: string,
    checked: string | null,
    passage_check: PassageCheck,
    freshness = 'current',
  ) =>
    ({
      support: { source_id: source },
      freshness,
      last_checked_at: checked,
      passage_check,
    }) as unknown as ClaimEvidence['rows'][number];
  const claim = (rows: ClaimEvidence['rows']) =>
    ({ rows }) as unknown as ClaimEvidence;
  const f = r.claimFreshness(
    claim([
      row('s1', '2026-11-14T12:00:00Z', 'same_version'),
      row('s1', '2026-11-14T12:00:00Z', 'same_version'),
      row('s2', '2026-11-04T12:00:00Z', 'passage_changed', 'changed'),
      row('s3', '2026-11-15T12:00:00Z', 'page_gone', 'removed'),
      // Retracted support neither dates nor flags the claim.
      row('s4', '2020-01-01T00:00:00Z', 'passage_changed', 'retracted'),
    ]),
  );
  assert.deepEqual(
    { ...f },
    {
      oldest: '2026-11-04T12:00:00Z',
      never: 0,
      sources: 3,
      changed: 1,
      gone: 1,
    },
  );
  assert.equal(
    r.claimFreshnessLine(f, now),
    'oldest source checked 12 days ago',
  );
  assert.deepEqual(r.claimFlags(f), [
    'a quoted passage changed',
    'a page is gone',
  ]);
  const one = r.claimFreshness(claim([row('s1', null, 'same_version')]));
  assert.equal(r.claimFreshnessLine(one, now), 'source never checked');
  assert.equal(r.claimFreshnessLine(r.claimFreshness(claim([])), now), '');

  const src = (outcome: string) => ({ outcome }) as never;
  const result = {
    sources: [
      src('unchanged'),
      src('changed'),
      src('page_gone'),
      src('not_checked'),
      src('not_tried'),
    ],
    not_rechecked: 2,
    stopped: { reason_code: 'x', explanation: 'Needs your approval.' },
  } as unknown as SourceRecheckResult;
  assert.equal(
    r.recheckSummary(result),
    'Rechecked 4 sources: 1 unchanged, 1 changed, 1 gone or unreadable, 1 not checked. Stopped early (1 not tried): Needs your approval. 2 more cited sources left for the next recheck.',
  );
});

const REPORT = 'https://health.fixture.test/reports/clinic-access-2025';
const STAFFING = 'https://health.fixture.test/reports/staffing-brief';
const WIRE = 'https://wire.fixture.test/stories/clinic-waits';

test('Decide recheck: fetches cited sources, flags changed passages, never edits claims', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const address = api.server.address();
  assert.ok(address && typeof address !== 'string');
  const root = `http://127.0.0.1:${address.port}/api`;
  const auth = await login(root);
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`${root}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? auth.read
          : { ...auth.write, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as unknown;
    if (!res.ok)
      throw new Error(`${path}: ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  const ws = (await call('workspaces', {
    name: 'F8 fixture',
    record_mode: 'fixture',
  })) as { id: string };
  const w = `workspaces/${ws.id}`;
  const newRun = async (grant: boolean) => {
    const run = StoredEntitySchema.parse(
      await call(`${w}/entities`, {
        kind: 'run',
        title: 'F8 run',
        body: {
          state: 'queued',
          experiment_condition: 'human_in_loop',
          discovery_method: 'structured',
          config_hash: null,
        },
      }),
    );
    await call(`${w}/runs`, {
      run: { id: run.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
    if (grant)
      await call(`${w}/grants`, {
        run_id: run.id,
        action_types: ['source.fetch'],
        target_kind: null,
        max_amount_nano_usd: null,
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['public'],
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rationale: 'Fetch fixture pages for the F8 test.',
      });
    return run.id;
  };
  const runId = await newRun(true);
  const fetchPage = async (url: string) =>
    RetrievalSchema.parse(
      await call(`${w}/runs/${runId}/source-fetches`, {
        url,
        task_id: null,
        logical_operation_id: randomUUID(),
        justification: 'F8 test.',
      }),
    );
  const got = {
    report: await fetchPage(REPORT),
    staffing: await fetchPage(STAFFING),
    wire: await fetchPage(WIRE),
  };
  const passage = async (sourceId: string | null, needle: string) => {
    const d = SourceDetailSchema.parse(await call(`${w}/sources/${sourceId}`));
    const p = d.passages.find((x) => x.excerpt?.includes(needle));
    assert.ok(p, needle);
    return p.id;
  };
  const problem = StoredEntitySchema.parse(
    await call(`${w}/entities`, {
      kind: 'problem',
      title: 'Rural clinic waits',
      body: {
        statement: 'Rural patients wait long for first appointments.',
        affected_group: 'Rural patients',
        uncertainty: 'Fixture.',
      },
    }),
  );
  const claim = async (
    statement: string,
    sourceId: string | null,
    needle: string,
    quote: string,
  ) => {
    const c = StoredEntitySchema.parse(
      await call(`${w}/entities`, {
        kind: 'claim',
        title: statement,
        body: { statement, basis: 'observation', uncertainty: 'Fixture.' },
      }),
    );
    await call(`${w}/claims/${c.id}/support`, {
      claim_version: 1,
      rationale: 'Assessed against the passage (fixture).',
      evidence: 'passage',
      passage_id: await passage(sourceId, needle),
      stance: 'supports',
      support_type: 'observation',
      quote,
    });
    await call(`${w}/links`, {
      relation: 'supports',
      from: { id: c.id, version: 1 },
      to: { id: problem.id, version: problem.version },
      rationale: 'Evidence for the problem.',
    });
    return c.id;
  };
  const rural = await claim(
    'Rural waits were 41 days.',
    got.report.source_id,
    '41 days',
    'was 41 days, up from 29 days in 2022',
  );
  const urban = await claim(
    'Urban waits were 12 days.',
    got.report.source_id,
    'Urban clinics',
    'median wait of 12 days in both years',
  );
  const vacant = await claim(
    'Nursing posts were vacant.',
    got.staffing.source_id,
    '18 percent',
    '18 percent of nursing posts vacant in 2025',
  );
  const wire = await claim(
    'Managers blamed vacancies.',
    got.wire.source_id,
    'Clinic managers',
    'staff vacancies were the main cause',
  );

  const comparison = async () =>
    ProblemComparisonSchema.parse(
      await call(`${w}/problems/${problem.id}/comparison`),
    );
  const rowsOf = async () => {
    const cmp = await comparison();
    return new Map(cmp.claims.map((c) => [c.evidence.claim.id, c.evidence]));
  };
  const before = await rowsOf();
  for (const e of before.values()) {
    assert.equal(e.rows[0]!.passage_check, 'same_version');
    assert.ok(e.rows[0]!.last_checked_at, 'a fetched source has a check time');
  }
  const usage = async () =>
    Number(
      (await db.pool.query('select count(*) as n from usage_records')).rows[0]
        .n,
    );
  const usageBefore = await usage();

  const recheckId = randomUUID();
  const recheck = async (run: string, id = recheckId) =>
    SourceRecheckResultSchema.parse(
      await call(`${w}/problems/${problem.id}/source-rechecks`, {
        run_id: run,
        recheck_id: id,
      }),
    );
  const result = await recheck(runId);
  const outcome = (url: string) =>
    result.sources.find((s) => s.url === url)?.outcome;
  assert.equal(result.sources.length, 3, 'three distinct cited sources');
  assert.equal(outcome(REPORT), 'changed');
  assert.equal(outcome(STAFFING), 'page_gone');
  assert.equal(outcome(WIRE), 'unchanged');
  assert.equal(result.stopped, null);
  assert.equal(result.not_rechecked, 0);
  assert.equal(await usage(), usageBefore, 'a recheck makes no model calls');

  const after = await rowsOf();
  const check = (id: string) => after.get(id)!.rows[0]!.passage_check;
  assert.equal(check(rural), 'passage_changed');
  assert.equal(check(urban), 'passage_kept');
  assert.equal(check(vacant), 'page_gone');
  assert.equal(check(wire), 'same_version');
  assert.ok(
    after
      .get(rural)!
      .labels.includes('a recheck found a cited passage changed or gone'),
  );
  assert.ok(
    after
      .get(urban)!
      .labels.includes(
        'a cited source changed but the quoted passage is still there',
      ),
  );
  // Flags only: every claim and support row is the one recorded before the recheck.
  for (const [id, e] of before) {
    const now = after.get(id)!;
    assert.equal(now.claim.version, e.claim.version);
    assert.deepEqual(
      now.rows.map((r) => r.support),
      e.rows.map((r) => r.support),
    );
    assert.ok(
      Date.parse(now.rows[0]!.last_checked_at!) >=
        Date.parse(e.rows[0]!.last_checked_at!),
    );
  }

  // A retried request replays the recorded fetches instead of fetching again.
  const again = await recheck(runId);
  assert.deepEqual(
    again.sources.map((s) => s.retrieval_id).sort(),
    result.sources.map((s) => s.retrieval_id).sort(),
  );

  // A run without fetch permission stops at the first fetch that needs approval, so one press
  // files one request, and the rest are not tried.
  const bare = await newRun(false);
  const held = await recheck(bare, randomUUID());
  assert.equal(held.sources[0]!.state, 'needs_human');
  assert.ok(held.sources[0]!.decision_id);
  assert.ok(held.stopped);
  assert.deepEqual(
    held.sources.slice(1).map((s) => s.outcome),
    ['not_tried', 'not_tried'],
  );
  const filed = await db.pool.query(
    `select count(*) as n from source_retrievals where run_id = $1`,
    [bare],
  );
  assert.equal(Number(filed.rows[0].n), 1);
});
