import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createApi } from '@creator/api';
import { ConnectionStore } from '@creator/db';
import { ContractError } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0082 (P19): one Standard/Advanced choice per person, kept on the server; Standard hides
// rarely used tabs without removing their routes; the first-run path takes one step at a time.

async function load<T>(file: string) {
  const source = await readFile(`apps/web/src/${file}`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;
  new Function('exports', code)(exports);
  return exports;
}

test('the view choice is per person, versioned, and refuses a stale write', async (t) => {
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
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const call = async (
    method: string,
    body?: unknown,
    headers: Record<string, string> = auth.write,
  ) => {
    const r = await fetch(`${base}/me/view-mode`, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as Record<string, any> };
  };

  // Never chosen: Standard, version 0.
  let r = await call('GET', undefined, auth.read);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    view_mode: 'standard',
    version: 0,
    updated_at: null,
  });
  // Signed out: refused.
  assert.equal((await call('GET', undefined, {})).status, 401);
  // A write without the CSRF token is refused.
  assert.equal(
    (
      await call(
        'POST',
        { expected_version: 0, view_mode: 'advanced' },
        auth.read,
      )
    ).status,
    403,
  );
  r = await call('POST', { expected_version: 0, view_mode: 'advanced' });
  assert.equal(r.status, 200);
  assert.equal(r.body.view_mode, 'advanced');
  assert.equal(r.body.version, 1);
  // Another window still holding version 0 cannot overwrite it.
  r = await call('POST', { expected_version: 0, view_mode: 'standard' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'VERSION_CONFLICT');
  // Unknown modes and extra fields are refused before anything is written.
  for (const bad of [
    { expected_version: 1, view_mode: 'expert' },
    { expected_version: 1, view_mode: 'standard', grant: true },
    { expected_version: -1, view_mode: 'standard' },
  ])
    assert.equal((await call('POST', bad)).status, 400, JSON.stringify(bad));
  r = await call('POST', { expected_version: 1, view_mode: 'standard' });
  assert.equal(r.body.version, 2);
  assert.equal(
    (await call('GET', undefined, auth.read)).body.view_mode,
    'standard',
  );

  // Another person's choice is their own: the owner's does not show through, nor theirs here.
  const other = randomUUID();
  await db.pool.query(
    `insert into actors (id, kind, display_name) values ($1, 'human', 'Tester')`,
    [other],
  );
  const store = new ConnectionStore(db.pool);
  assert.equal((await store.viewPreference({ actorId: other })).version, 0);
  await store.setViewPreference(
    { actorId: other },
    { expected_version: 0, view_mode: 'advanced' },
  );
  assert.equal(
    (await call('GET', undefined, auth.read)).body.view_mode,
    'standard',
  );
  assert.equal(
    (await store.viewPreference({ actorId: other })).view_mode,
    'advanced',
  );
  // Two windows racing from version 1: exactly one wins.
  const results = await Promise.allSettled([
    store.setViewPreference(
      { actorId: other },
      { expected_version: 1, view_mode: 'standard' },
    ),
    store.setViewPreference(
      { actorId: other },
      { expected_version: 1, view_mode: 'advanced' },
    ),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  const lost = results.find((x) => x.status === 'rejected') as
    PromiseRejectedResult | undefined;
  assert.ok(lost?.reason instanceof ContractError);
  assert.equal((lost.reason as ContractError).code, 'VERSION_CONFLICT');
  assert.equal((await store.viewPreference({ actorId: other })).version, 2);
});

type Section = { view: string; label: string; group?: string };
type Page = { key: string; label: string; sections: Section[] };
type Pages = {
  PAGES: Page[];
  ADVANCED_ONLY: string[];
  shownSections(page: Page, standard: boolean, current?: string): Section[];
  hiddenTabs(page: Page, standard: boolean, current?: string): string[];
  parseRoute(hash: string): { view: string };
};

test('Standard lists fewer tabs; every route still opens; Advanced lists all', async () => {
  const p = await load<Pages>('pages.ts');
  const page = (k: string) => p.PAGES.find((x) => x.key === k)!;
  const views = (s: Section[]) => s.map((x) => x.view);
  assert.deepEqual(views(p.shownSections(page('projects'), true)), [
    'path',
    'submit',
    'compare',
    'proposals',
    'scores',
    'build',
    'gallery',
  ]);
  assert.deepEqual(p.hiddenTabs(page('projects'), true), ['Launch']);
  assert.deepEqual(p.hiddenTabs(page('monitor'), true), ['Workers']);
  assert.deepEqual(p.hiddenTabs(page('settings'), true), ['Study']);
  // Every page keeps at least one listed tab.
  for (const pg of p.PAGES)
    assert.ok(p.shownSections(pg, true).length > 0, pg.key);
  // The open tab is listed even when Standard would hide it.
  assert.ok(
    views(p.shownSections(page('monitor'), true, 'operations')).includes(
      'operations',
    ),
  );
  assert.deepEqual(p.hiddenTabs(page('monitor'), true, 'operations'), []);
  // Advanced lists everything and hides nothing.
  for (const pg of p.PAGES) {
    assert.deepEqual(p.shownSections(pg, false), pg.sections);
    assert.deepEqual(p.hiddenTabs(pg, false), []);
  }
  // Routes are not removed: each hidden view still opens from its address.
  for (const [hash, view] of <[string, string][]>[
    ['#/projects/sell', 'payments'],
    ['#/projects/campaigns', 'marketing'],
    ['#/projects/maintain', 'portfolio'],
    ['#/monitor/workers', 'operations'],
    ['#/settings/study', 'studies'],
  ])
    assert.equal(p.parseRoute(hash).view, view, hash);
  assert.deepEqual([...p.ADVANCED_ONLY].sort(), [
    'marketing',
    'operations',
    'payments',
    'portfolio',
    'studies',
  ]);
});

test('the shown mode: a saved server choice wins; before one, this browser keeps what it saw', async () => {
  const m = await load<{
    effectiveMode(
      server: { view_mode: string; version: number } | null,
      cached: string | null,
      legacy: string | null,
    ): string;
  }>('view-mode-rules.ts');
  assert.equal(m.effectiveMode(null, null, null), 'standard');
  assert.equal(
    m.effectiveMode({ view_mode: 'standard', version: 0 }, null, null),
    'standard',
  );
  // Discover's older Guided/Advanced choice carries over until a choice is saved.
  assert.equal(m.effectiveMode(null, null, 'advanced'), 'advanced');
  assert.equal(m.effectiveMode(null, null, 'guided'), 'standard');
  assert.equal(m.effectiveMode(null, 'advanced', 'guided'), 'advanced');
  assert.equal(m.effectiveMode(null, 'junk', null), 'standard');
  // A saved choice (version above 0) wins over anything in this browser.
  assert.equal(
    m.effectiveMode(
      { view_mode: 'standard', version: 3 },
      'advanced',
      'advanced',
    ),
    'standard',
  );
  assert.equal(
    m.effectiveMode({ view_mode: 'advanced', version: 1 }, 'standard', null),
    'advanced',
  );
});

type Facts = {
  fixture: boolean;
  budgets: number;
  pricing: number;
  claims: number;
  problems: number;
  alternatives: number;
  scorecards: number;
  specs: number;
  proposals?: number;
  built: boolean;
};
type FirstRun = {
  firstRunSteps(f: Facts): {
    steps: { key: string; done: boolean; action: { view: string } }[];
    current: number;
  };
  showFirstRun(f: Facts, hidden: boolean): boolean;
};

test('the first-run path takes one step at a time and ends at a proposal, spec or build', async () => {
  const r = await load<FirstRun>('first-run-rules.ts');
  const empty: Facts = {
    fixture: true,
    budgets: 0,
    pricing: 0,
    claims: 0,
    problems: 0,
    alternatives: 0,
    scorecards: 0,
    specs: 0,
    built: false,
  };
  const at = (f: Facts) => {
    const { steps, current } = r.firstRunSteps(f);
    return current < 0 ? 'finished' : steps[current]!.key;
  };
  // The same order as the main path: evidence, then the budget a discovery needs.
  assert.equal(at(empty), 'evidence');
  assert.equal(at({ ...empty, claims: 2 }), 'budget');
  // Fixture work needs pricing too; a real workspace's plan route does not.
  assert.equal(at({ ...empty, claims: 2, budgets: 1 }), 'budget');
  assert.equal(
    at({ ...empty, fixture: false, claims: 2, budgets: 1 }),
    'discover',
  );
  let f: Facts = { ...empty, budgets: 1, pricing: 1 };
  assert.equal(at(f), 'evidence');
  f = { ...f, claims: 2 };
  assert.equal(at(f), 'discover');
  f = { ...f, problems: 1, alternatives: 3 };
  assert.equal(at(f), 'score');
  f = { ...f, scorecards: 1 };
  assert.equal(at(f), 'choose');
  assert.ok(r.showFirstRun(f, false));
  assert.equal(r.showFirstRun(f, true), false, 'hidden by the person');
  for (const done of [{ proposals: 1 }, { specs: 1 }, { built: true }]) {
    assert.equal(at({ ...f, ...done }), 'finished', JSON.stringify(done));
    assert.equal(r.showFirstRun({ ...f, ...done }, false), false);
  }
  // A later record never skips an earlier gap: problems without a budget still stop at budget.
  assert.equal(at({ ...empty, claims: 4, problems: 1 }), 'budget');
  // A discovery that proposed no options has nothing to score.
  assert.equal(at({ ...f, scorecards: 0, alternatives: 0 }), 'choose');
  // Each step has exactly one button.
  for (const s of r.firstRunSteps(empty).steps) assert.ok(s.action.view);
});
