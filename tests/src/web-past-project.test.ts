import test from 'node:test';
import assert from 'node:assert/strict';
import type { PastProject } from '@creator/contracts';
import { loadWeb } from './web-module.js';

// F9 "Start a similar project" (ADR-0125): how a past project's setup fills the Discover form.
type Fill = {
  theme: string;
  fieldA: string;
  fieldB: string;
  data: string;
  constraints: string;
  timeLimit: string;
  excluded: Record<string, string>;
  revisions: number;
  maxAgeDays: number;
  dataClass: string;
  oversight: string;
  route: string;
  connectionId: string;
  model: string;
  onlySites: string;
  skipSites: string;
  notes: string[];
};
type Settings = { dataClass: string; oversight: string; route: string };
type Conn = {
  id: string;
  label: string;
  models: string[];
  qualified: string[];
  blockers: string[];
  allowedDataClasses: string[];
};
type Handoff = { only?: string; skip?: string; nonce: number } | null;
type Mod = {
  fillFromPast: (
    p: PastProject,
    o: { fixture: boolean; defaults: Settings; connections: Conn[] },
  ) => Fill;
  copiedSettings: (f: Fill) => Record<string, unknown>;
  pastProjectLabel: (p: PastProject, day?: (iso: string) => string) => string;
  sitesHandoff: (f: Fill, nonce: number) => Handoff;
  sitesText: (f: Fill) => string;
  NOT_COPIED: string;
};
type Defaults = { studioDefaults: (fixture: boolean) => Settings };

const past = (over: Partial<PastProject> = {}): PastProject => ({
  workflow_id: '11111111-1111-4111-8111-111111111111',
  run_id: '22222222-2222-4222-8222-222222222222',
  state: 'succeeded',
  started_at: '2026-11-10T09:00:00.000Z',
  brief: {
    id: '33333333-3333-4333-8333-333333333333',
    version: 2,
    title: 'Missed first appointments',
    body: {
      theme: 'Missed first appointments at rural clinics',
      fields: ['Clinic scheduling', 'Airline revenue management'],
      target_users: 'Rural clinic schedulers',
      context: null,
      measurable_problem: 'Many first appointments are missed.',
      outcome_measure: 'First-appointment no-show rate',
      data_and_tools: ['Clinic calendar export', 'SMS gateway'],
      time_limit: 'Four weeks',
      budget_limit: 'No paid services',
      nae_seed: null,
      constraints: ['Synthetic data only.', 'No patient names.'],
    },
  },
  settings: {
    perspectives: ['software', 'existing_tool', 'process_change', 'hybrid'],
    excluded: [{ perspective: 'human_led', reason: 'No staff time.' }],
    max_revisions: 2,
    max_age_days: 90,
    data_class: 'public',
    oversight: 'supervised',
  },
  sites: {
    exploration_id: '44444444-4444-4444-8444-444444444444',
    only_hosts: ['who.int'],
    excluded_hosts: ['ads.example'],
  },
  connection: {
    kind: 'subscription',
    connection_id: '55555555-5555-4555-8555-555555555555',
    model_id: 'gpt-6-astra',
  },
  ...over,
});

const conn = {
  id: '55555555-5555-4555-8555-555555555555',
  label: 'ChatGPT plan',
  models: ['gpt-6-astra'],
  qualified: ['gpt-6-astra'],
  blockers: [],
  allowedDataClasses: ['synthetic', 'public'],
};

test('a past project fills the brief, settings, websites and connection, and nothing else', async () => {
  const m = (await loadWeb('past-project.ts')) as Mod;
  const d = (await loadWeb('discover-defaults.ts')) as Defaults;
  const defaults = d.studioDefaults(false);
  const f = m.fillFromPast(past(), {
    fixture: false,
    defaults,
    connections: [conn],
  });
  assert.equal(f.theme, 'Missed first appointments at rural clinics');
  assert.equal(f.fieldA, 'Clinic scheduling');
  assert.equal(f.fieldB, 'Airline revenue management');
  assert.equal(f.data, 'Clinic calendar export\nSMS gateway');
  assert.equal(f.constraints, 'Synthetic data only.\nNo patient names.');
  assert.equal(f.timeLimit, 'Four weeks');
  assert.deepEqual(f.excluded, { human_led: 'No staff time.' });
  assert.equal(f.revisions, 2);
  assert.equal(f.maxAgeDays, 90);
  assert.equal(f.dataClass, 'public');
  assert.equal(f.oversight, 'supervised');
  assert.equal(f.route, 'subscription');
  assert.equal(f.connectionId, conn.id);
  assert.equal(f.model, 'gpt-6-astra');
  assert.equal(f.onlySites, 'who.int');
  assert.equal(f.skipSites, 'ads.example');
  assert.deepEqual(f.notes, []);
  // The fill has no place for claims, roles, grants or budgets at all.
  for (const k of Object.keys(f))
    assert.ok(!/claim|evidence|role|grant|envelope|pricing|allow/i.test(k), k);
  // Model-call permission is a grant: the copied settings never set it.
  assert.ok(!('allowCalls' in m.copiedSettings(f)));
  assert.match(m.NOT_COPIED, /Claims.*approvals.*decisions.*budgets/);
});

test('what cannot be copied as it was falls back and says why', async () => {
  const m = (await loadWeb('past-project.ts')) as Mod;
  const d = (await loadWeb('discover-defaults.ts')) as Defaults;
  const defaults = d.studioDefaults(false);
  const opts = { fixture: false, defaults, connections: [conn] };

  // Private data is chosen again on purpose for each start, as with a preset.
  const priv = m.fillFromPast(
    past({ settings: { ...past().settings, data_class: 'private_approved' } }),
    opts,
  );
  assert.equal(priv.dataClass, defaults.dataClass);
  assert.match(priv.notes.join(' '), /private data/);

  // A fixture workspace stays synthetic whatever the past run used.
  assert.equal(
    m.fillFromPast(past(), {
      ...opts,
      fixture: true,
      defaults: d.studioDefaults(true),
    }).dataClass,
    'synthetic',
  );

  // A connection that is gone, or a model no longer verified, is not selected.
  const gone = m.fillFromPast(past(), { ...opts, connections: [] });
  assert.equal(gone.connectionId, '');
  assert.equal(gone.route, 'subscription');
  assert.match(gone.notes.join(' '), /no longer listed/);
  const stale = m.fillFromPast(past(), {
    ...opts,
    connections: [{ ...conn, models: ['other-model'] }],
  });
  assert.equal(stale.connectionId, '');
  assert.equal(stale.model, '');
  assert.match(stale.notes.join(' '), /no longer a verified model/);

  // A metered run copies the route only; its budget is picked again.
  const api = m.fillFromPast(past({ connection: { kind: 'api' } }), opts);
  assert.equal(api.route, 'api');
  assert.match(api.notes.join(' '), /pick the budget and price list/);

  // A mode Discover does not offer, and a local route, fall back to the usual choice.
  const odd = m.fillFromPast(
    past({
      settings: { ...past().settings, oversight: 'autonomous_within_scope' },
      connection: { kind: 'local', model_id: 'llama' },
    }),
    opts,
  );
  assert.equal(odd.oversight, defaults.oversight);
  assert.equal(odd.route, defaults.route);
  assert.equal(odd.notes.length, 2);

  // A brief with no exploration leaves the website fields empty.
  const plain = m.fillFromPast(
    past({
      sites: { exploration_id: null, only_hosts: [], excluded_hosts: [] },
    }),
    opts,
  );
  assert.equal(plain.onlySites, '');
  assert.equal(plain.skipSites, '');
});

test('the picker label names the theme, the day and how it ended', async () => {
  const m = (await loadWeb('past-project.ts')) as Mod;
  assert.equal(
    m.pastProjectLabel(past({ state: 'cancelled' }), (iso) => iso.slice(0, 10)),
    'Missed first appointments at rural clinics · 2026-11-10 · stopped',
  );
  const long = 'x'.repeat(120);
  const label = m.pastProjectLabel(
    past({
      brief: { ...past().brief, body: { ...past().brief.body, theme: long } },
    }),
  );
  assert.ok(label.startsWith(`${'x'.repeat(69)}…`));
});

test('review 1 L-1: a past connection that cannot run a discovery now is not selected', async () => {
  const m = (await loadWeb('past-project.ts')) as Mod;
  const d = (await loadWeb('discover-defaults.ts')) as Defaults;
  const defaults = d.studioDefaults(false);
  const pick = (c: Partial<Conn>) =>
    m.fillFromPast(past(), {
      fixture: false,
      defaults,
      connections: [{ ...conn, ...c }],
    });
  const signedOut = pick({ blockers: ['Sign in with ChatGPT again'] });
  assert.equal(signedOut.connectionId, '');
  assert.equal(signedOut.model, '');
  assert.match(
    signedOut.notes.join(' '),
    /can't run a discovery right now \(Sign in/,
  );
  const noPublic = pick({ allowedDataClasses: ['synthetic'] });
  assert.equal(noPublic.connectionId, '');
  assert.match(noPublic.notes.join(' '), /does not allow public data/);
  const unqualified = pick({ qualified: [] });
  assert.equal(unqualified.connectionId, '');
  assert.match(
    unqualified.notes.join(' '),
    /not qualified for every discovery step/,
  );
  // A ready connection with a qualified model is selected, with no note.
  const ready = pick({});
  assert.equal(ready.connectionId, conn.id);
  assert.deepEqual(ready.notes, []);
});

test('review 1 L-3, N-1, N-4: only the website lists it had are handed on, said in words', async () => {
  const m = (await loadWeb('past-project.ts')) as Mod;
  const d = (await loadWeb('discover-defaults.ts')) as Defaults;
  const opts = {
    fixture: false,
    defaults: d.studioDefaults(false),
    connections: [conn],
  };
  const sites = (only: string[], skip: string[]) =>
    m.fillFromPast(
      past({
        sites: { exploration_id: null, only_hosts: only, excluded_hosts: skip },
      }),
      opts,
    );
  // None: nothing is handed on, so lists typed on the other panels stay.
  const none = sites([], []);
  assert.equal(m.sitesHandoff(none, 1), null);
  assert.equal(m.sitesText(none), '');
  // Only "only these": Explore gets it; the skip fields are left alone.
  const only = sites(['who.int'], []);
  assert.deepEqual(m.sitesHandoff(only, 2), { only: 'who.int', nonce: 2 });
  assert.match(
    m.sitesText(only),
    /only-these website list .* Explore for me\.$/,
  );
  assert.doesNotMatch(m.sitesText(only), /Search the web/);
  const skip = sites([], ['ads.example']);
  assert.deepEqual(m.sitesHandoff(skip, 3), { skip: 'ads.example', nonce: 3 });
  assert.match(m.sitesText(skip), /Explore for me and Search the web/);
  // A fixture workspace says why a public project starts synthetic.
  const fx = m.fillFromPast(past(), {
    ...opts,
    fixture: true,
    defaults: d.studioDefaults(true),
  });
  assert.equal(fx.dataClass, 'synthetic');
  assert.match(fx.notes.join(' '), /fixture workspace/);
  // N-2: the brief's own budget text is copied; only API budgets and price lists are not.
  assert.match(m.NOT_COPIED, /API budgets and price lists/);
});
