// Isolated fixture checks for core v3 (v2 F1-F3 plus re-review R-1 to R-3): no SQL, process,
// registry, pidfile or credential access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SQL_ASSET,
  CORE_VERSION,
  LATER_SCOPES,
  admitRequest,
  admitPathSpelling,
  newRun,
  step,
  fixtureReceipt,
  admitOperationalGate,
} from '../scripts/theme-intent-cw01-core-fixture-v3.mjs';

const repo = new URL('../', import.meta.url);
const bytes = (p) => readFileSync(new URL(p, repo));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const H = (c) => c.repeat(64);
const ADAPTER = H('a');
const MANIFEST = H('b');
const CLUSTER = 'D:\\fixture\\cw01 cluster';
const PORT = 55432;
const T = 1_800_000_000_000;
const ft = (ms) => String(BigInt(ms) * 10000n + 116444736000000000n);
const meta = {
  fixture: true,
  provenance: 'fixture_measurement',
  adapter_sha256: ADAPTER,
  manifest_sha256: MANIFEST,
};
const fx = (value) => ({ fixture: true, value });

function request(extra = {}) {
  return {
    mode: 'fixture',
    request_id: 'cw01-fixture-0001',
    manifest_sha256: MANIFEST,
    inspector_sha256: H('c'),
    fixture_adapter_sha256: ADAPTER,
    sql_asset: { version: SQL_ASSET.version, sha256: SQL_ASSET.sha256 },
    bindings: {
      cluster_dir: fx(CLUSTER),
      port: fx(PORT),
      database: fx('creator_fixture'),
      observer_actor: fx('fixture_observer'),
      pg_ctl_image_sha256: fx(H('d')),
      postgres_image_sha256: fx(H('e')),
      cmd_image: {
        fixture: true,
        path: 'C:\\Windows\\System32\\cmd.exe',
        sha256: H('f'),
        view: 'system32',
      },
      working_dir: fx('C:\\Windows\\System32'),
      log_path: fx('D:\\fixture\\cw01 logs\\pg.log'),
      startup_boundary_sha256: fx(H('1')),
      background_allowlist: {
        fixture: true,
        types: {
          checkpointer: { min: 1, max: 1, writes_storage_reviewed: true },
          'io worker': { min: 0, max: 3, writes_storage_reviewed: true },
          'autovacuum launcher': {
            min: 0,
            max: 1,
            writes_storage_reviewed: true,
          },
        },
      },
      relation_fingerprint_sha256: fx(H('2')),
      credential_mechanism: fx('fixture-stub'),
      grants: Object.fromEntries([
        ['fixture', true],
        ...LATER_SCOPES.map((g) => [g, { fixture: true, id: 'fixture-' + g }]),
      ]),
      adapter_reviews: {
        fixture: true,
        process_metadata_adapter: 'fixture_stub',
        pidfile_adapter: 'fixture_stub',
        registry_adapter: 'fixture_stub',
        collector_L1_L4: 'fixture_stub',
        reader_N1_N4: 'fixture_stub',
      },
    },
    ...extra,
  };
}

const autorun = (hive, extra = {}) => ({
  ...meta,
  hive,
  key: 'Software\\Microsoft\\Command Processor',
  value: 'AutoRun',
  view: '64',
  existence_only: true,
  result: 'absent',
  observed_at_ms: T + 5000,
  ...extra,
});
const attestation = (extra = {}) => ({
  fixture: true,
  provenance: 'owner_affirmation',
  adapter_sha256: ADAPTER,
  manifest_sha256: MANIFEST,
  operator_ref: 'fixture-operator',
  scope: 'W1-W3',
  inspector_sha256: H('c'),
  request_id: 'cw01-fixture-0001',
  affirmed_at_ms: T + 8000,
  items: [1, 2, 3, 4, 5, 6].map((item) => ({
    item,
    affirmed: true,
    basis: 'fixture basis ' + item,
    source: 'fixture',
    date: '2026-10-26',
    uncertainty: 'none stated (fixture)',
  })),
  ...extra,
});
const proc = (role, pid, parent_pid, createdMs, image, exitMs = null) => ({
  role,
  pid,
  parent_pid,
  creation_ft: ft(createdMs),
  exit_ft: exitMs === null ? null : ft(exitMs),
  image_sha256: image,
  handle_bound: true,
});
const launch = {
  pid: 4100,
  creation_ft: ft(T + 10100),
  exit_ft: ft(T + 12000),
};
const chainRecords = () => [
  proc('postmaster', 4300, 4200, T + 10300, H('e')),
  proc('shell', 4200, 4100, T + 10200, H('f')),
  proc('pg_ctl', 4100, 900, T + 10100, H('d'), T + 12000),
];
const pidLines = () => [
  '4300',
  CLUSTER,
  String(Math.floor((T + 10300) / 1000)),
  String(PORT),
  '',
  '127.0.0.1',
  '',
  'ready   ',
];
const counts = (extra = {}) => ({
  client: '0',
  walsender: '0',
  null_type: '0',
  desktop_adoption: false,
  background: [
    { type: 'checkpointer', n: '1' },
    { type: 'io worker', n: '3' },
  ],
  ...extra,
});
const instance = {
  server_started_at_ms: T + 10500,
  in_recovery: false,
  backend_pid: 5100,
};
const backendParent = (extra = {}) => ({
  backend_pid: 5100,
  parent_pid: 4300,
  parent_creation_ft: ft(T + 10300),
  backend_creation_ft: ft(T + 12900),
  handle_bound: true,
  ...extra,
});
const work = () =>
  Object.fromEntries(
    [
      'workflows',
      'workflow_tasks',
      'outbox',
      'plan_requests',
      'plan_qualifications',
      'budget_reservations',
      'source_retrievals',
      'context_batches',
      'github_operations',
      'marketing_deliveries',
      'portfolio_jobs',
      'desktop_jobs',
      'artifact_previews',
    ].map((k) => [k, '0']),
  );
const sqlA = (results = {}, extra = {}) => ({
  ...meta,
  sql_asset_version: SQL_ASSET.version,
  sql_asset_sha256: SQL_ASSET.sha256,
  deadline_exceeded: false,
  connection_id: 'conn-1',
  connected_at_ms: T + 12500,
  transaction_id: 'tx-A',
  sample_id: 'sample-A',
  observed_at_ms: T + 13000,
  results: {
    observer_ok: true,
    database_ok: true,
    address_ok: true,
    port_ok: true,
    readonly_ok: true,
    isolation_ok: true,
    instance: { ...instance },
    backend_parent: backendParent(),
    startup_boundary: {
      shared_preloads: true,
      session_preloads: { match: true, scope: 'observer_session' },
      local_preloads: { match: true, scope: 'observer_session' },
      archive_mode: true,
      max_wal_senders: true,
    },
    ledger_match: true,
    relation_fingerprint_match: true,
    listener_settings_match: true,
    counts: counts(),
    work: work(),
    ...results,
  },
  ...extra,
});
const sqlB = (results = {}, extra = {}) => ({
  ...meta,
  sql_asset_version: SQL_ASSET.version,
  sql_asset_sha256: SQL_ASSET.sha256,
  deadline_exceeded: false,
  connection_id: 'conn-1',
  transaction_id: 'tx-B',
  sample_id: 'sample-B',
  observed_at_ms: T + 14000,
  results: {
    observer_ok: true,
    instance: { ...instance },
    backend_parent: backendParent(),
    counts: counts(),
    ...results,
  },
  ...extra,
});
const finished = {
  ...meta,
  timed_out: false,
  outer_deadline_exceeded: false,
  pg_ctl_timeout_s: 80,
  pg_ctl_exit: 0,
};
const base = {
  admit: () => ({ at_ms: T - 60000 }),
  preflight: () => ({
    ...meta,
    observed_at_ms: T + 4000,
    cluster_running: false,
    pidfile: 'absent',
    processes: 0,
    listeners: 0,
    leases: 0,
    signal_files: { recovery: 'absent', standby: 'absent' },
  }),
  start_intent: () => ({
    at_ms: T + 10000,
    attestation: attestation(),
    job: { ...meta, in_job: false, observed_at_ms: T + 6000 },
    autorun: [autorun('HKLM'), autorun('HKCU')],
  }),
  start_outcome: () => ({
    ...finished,
    observed_at_ms: T + 12100,
    launch: { ...launch },
    pidfile: {
      ...meta,
      stable: true,
      single_link: true,
      reparse_free: true,
      size_bytes: 96,
      lines: pidLines(),
    },
    chain: { ...meta, walk: 'upward_from_pidfile', records: chainRecords() },
  }),
  sql_A: () => sqlA(),
  sql_B: () => sqlB(),
  disconnect: () => ({
    ...meta,
    our_connection_closed: true,
    other_backends_terminated: 0,
  }),
  stop_intent: () => ({
    at_ms: T + 15000,
    mode: 'smart',
    pg_ctl_timeout_s: 80,
    revalidation: {
      ...meta,
      observed_at_ms: T + 14500,
      pidfile_stable: true,
      handle_alive: true,
      chain_unchanged: true,
      sql_instance_unchanged: true,
      postmaster_pid: 4300,
      postmaster_creation_ft: ft(T + 10300),
    },
  }),
  stop_outcome: () => ({
    ...finished,
    launch: { pid: 6100, creation_ft: ft(T + 15100), exit_ft: ft(T + 15900) },
    stopped_observation: {
      ...meta,
      observed_at_ms: T + 16000,
      pidfile: 'absent',
      processes: 0,
      listeners: 0,
    },
  }),
  w2_reference: () => ({
    ...meta,
    reference_sha256: H('9'),
    stable: true,
    signal_files: { recovery: 'absent', standby: 'absent' },
  }),
};
const ORDER = Object.keys(base);

// Drive the lifecycle, overriding one event's evidence; stops at a terminal state.
function drive(overrides = {}, req = request()) {
  let run = newRun(req);
  for (const ev of ORDER) {
    const evidence = overrides[ev] ? overrides[ev](base[ev]()) : base[ev]();
    run = step(run, ev, evidence);
    if (run.history.at(-1).outcome !== 'accepted') break;
  }
  return run;
}
const last = (run) => run.history.at(-1);
function assertTerminal(run, state, reason) {
  assert.equal(run.state, state);
  assert.equal(last(run).reason, reason);
  // No later event, including stop, can leave a terminal state.
  const after = step(run, 'stop_intent', base.stop_intent());
  assert.equal(after.state, state);
  assert.equal(after.refused, 'TERMINAL_STATE');
  assert.notEqual(fixtureReceipt(run).sequence, 'fixture_sequence_consistent');
}

test('successor SQL asset: exact hash, M1/R3/L3/L4/I-a content, read-only allowlist', () => {
  const sql = bytes(SQL_ASSET.path);
  assert.equal(sha(sql), SQL_ASSET.sha256);
  const s = sql.toString('utf8');
  assert.ok(!s.includes('\r'));
  assert.match(
    s,
    /pg_catalog\.host\(pg_catalog\.inet_server_addr\(\)\) = '127\.0\.0\.1' AS address_ok/,
  );
  assert.ok(!/inet_server_addr\(\)::text/.test(s));
  for (const id of ['A04', 'B03'])
    assert.match(
      s,
      new RegExp(
        '-- @' +
          id +
          ' [^\\n]*instance\\nSELECT pg_catalog\\.pg_postmaster_start_time\\(\\) AS server_started_at,\\n\\s+pg_catalog\\.pg_is_in_recovery\\(\\) AS in_recovery,\\n\\s+pg_catalog\\.pg_backend_pid\\(\\) AS backend_pid;',
      ),
    );
  for (const id of ['A14', 'B07'])
    assert.match(
      s,
      new RegExp(
        '-- @' +
          id +
          ' [^\\n]*\\nSELECT count\\(\\*\\)::text AS n FROM pg_catalog\\.pg_stat_activity\\n WHERE backend_type IS NULL;',
      ),
    );
  assert.match(s, /SET transaction_timeout = '30s';/);
  for (const k of [
    'session_preload_libraries',
    'local_preload_libraries',
    'shared_preload_libraries',
    'archive_mode',
    'max_wal_senders',
  ])
    assert.ok(s.includes(`current_setting('${k}')`), k);
  // Terminal needs_human tasks have finished_at set and are not counted (v1.1 L1).
  assert.match(s, /FROM public\.workflow_tasks WHERE finished_at IS NULL;\n/);
  assert.ok(!/needs_human/.test(s.replace(/^--.*$/gm, '')));
  const code = s.replace(/^--.*$/gm, '');
  assert.ok(
    !/\b(COMMIT|INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|COPY|DO|CALL|VACUUM|TRUNCATE)\b/i.test(
      code,
    ),
  );
  assert.ok(
    !/pg_terminate_backend|pg_cancel_backend|pg_reload_conf|set_config|dblink|lo_/i.test(
      code,
    ),
  );
  const markers = [...s.matchAll(/^-- @([A-Z][0-9]{2}) /gm)].map((m) => m[1]);
  assert.equal(new Set(markers).size, markers.length);
  assert.deepEqual(
    markers.filter((m) => m.startsWith('B')),
    ['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08'],
  );
});

test('successor preserves every original statement line except the M1 correction; original bytes unchanged', () => {
  const design = bytes(
    'docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md',
  );
  assert.equal(
    sha(design),
    '7aaa898cf8fc6b6a2d2b728a2e32e92dfc4ed295dfff44d29d4cdf4c30c17252',
  );
  const doc = design.toString('utf8');
  const section = doc.slice(
    doc.indexOf('## Fixed schema29 SQL contract'),
    doc.indexOf('## W2 fingerprint'),
  );
  const original = [...section.matchAll(/```sql\r?\n([\s\S]*?)```/g)]
    .flatMap((m) => m[1].split(/\r?\n/))
    .filter((l) => l.trim());
  const m1 =
    "       pg_catalog.inet_server_addr()::text = '127.0.0.1' AS address_ok,";
  assert.ok(original.includes(m1));
  // Ordered, per statement: drop the six added statements, revert M1, and the
  // remaining lines must equal the original sequence exactly (review I-2).
  const parts = bytes(SQL_ASSET.path)
    .toString('utf8')
    .split(/^-- @([A-Z][0-9]{2})[^\n]*\n/m);
  const added = new Set(['S05', 'A04', 'A05', 'A14', 'B03', 'B07']);
  const m1New =
    "       pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1' AS address_ok,";
  const seq = [];
  for (let i = 1; i < parts.length; i += 2)
    if (!added.has(parts[i]))
      for (const l of parts[i + 1].split('\n'))
        if (l.trim() && !l.startsWith('--')) seq.push(l === m1New ? m1 : l);
  assert.deepEqual(seq, original);
});

test('complete fixture sequence stays fixture-labeled and never satisfies an operational gate', () => {
  const run = drive();
  assert.equal(run.state, 'W2_reference_recorded');
  assert.ok(run.history.some((e) => e.to === 'owned_running'));
  const receipt = fixtureReceipt(run);
  assert.equal(receipt.fixture, true);
  assert.equal(receipt.operational, false);
  assert.deepEqual(receipt.authorizes, []);
  assert.equal(receipt.sequence, 'fixture_sequence_consistent');
  assert.equal(receipt.attestation_ceiling, 'W1_W2_supported_W3_pending');
  assert.deepEqual(receipt.sql_asset, {
    version: SQL_ASSET.version,
    sha256: SQL_ASSET.sha256,
  });
  receipt.history.forEach((e, i) => {
    assert.equal(e.prev_sha256, i ? receipt.history[i - 1].entry_sha256 : null);
    assert.equal(e.sql_asset_sha256, SQL_ASSET.sha256);
    assert.equal(e.manifest_sha256, MANIFEST);
  });
  for (const gate of [
    'cluster_start',
    'cluster_stop',
    'sql_observer',
    'protected_credential',
    'native_acceptance',
  ])
    assert.deepEqual(
      { ...admitOperationalGate(receipt, gate) },
      {
        fixture: true,
        gate,
        admitted: false,
        reason: 'FIXTURE_CANNOT_SATISFY_OPERATIONAL_GATE',
      },
    );
});

test('fixture-to-operational promotion is refused however the receipt is relabeled', () => {
  const receipt = fixtureReceipt(drive());
  for (const forged of [
    { ...receipt, fixture: false },
    { ...receipt, fixture: false, mode: 'operational' },
    {
      ...receipt,
      format: 'theme-intent-cw01-operational-receipt/1',
      fixture: undefined,
      mode: 'operational',
    },
  ])
    assert.equal(
      admitOperationalGate(forged, 'cluster_start').reason,
      'FIXTURE_CANNOT_SATISFY_OPERATIONAL_GATE',
    );
  const opLike = { format: 'other/1', fixture: false, mode: 'operational' };
  assert.equal(admitOperationalGate(opLike, 'cluster_start').admitted, false);
  assert.equal(
    admitOperationalGate(opLike, 'cluster_start').reason,
    'OPERATIONAL_ADAPTERS_UNIMPLEMENTED',
  );
  assert.deepEqual(admitRequest(request({ mode: 'operational' })).blockers, [
    'OPERATIONAL_ADAPTERS_UNIMPLEMENTED',
  ]);
  const op = drive({}, request({ mode: 'operational' }));
  assert.equal(op.state, 'blocked');
});

test('missing operational bindings, grants and reviews are blockers; no default fills them', () => {
  const r = request();
  r.bindings.port = 'pending';
  delete r.bindings.background_allowlist;
  r.bindings.observer_actor = { value: 'actual_actor' };
  const out = admitRequest(r);
  assert.equal(out.status, 'blocked');
  assert.deepEqual(out.blockers, [
    'BINDING_MISSING:port',
    'BINDING_NOT_FIXTURE_LABELED:observer_actor',
    'BINDING_MISSING:background_allowlist',
  ]);
  const g = request();
  delete g.bindings.grants.registry_autorun_existence_read;
  g.bindings.adapter_reviews.reader_N1_N4 = 'pending';
  g.bindings.background_allowlist.types.checkpointer.writes_storage_reviewed = false;
  assert.deepEqual(admitRequest(g).blockers, [
    'BACKGROUND_ALLOWLIST_UNBOUND',
    'GRANT_MISSING:registry_autorun_existence_read',
    'ADAPTER_REVIEW_MISSING:reader_N1_N4',
  ]);
  assert.equal(drive({}, g).state, 'blocked');
});

test('changed SQL asset or manifest version is refused at admission and in evidence', () => {
  for (const sql_asset of [
    { version: 'cw01-observer-sql/1', sha256: SQL_ASSET.sha256 },
    { version: SQL_ASSET.version, sha256: H('0') },
  ])
    assert.deepEqual(admitRequest(request({ sql_asset })).blockers, [
      'SQL_ASSET_MISMATCH',
    ]);
  const changedA = drive({
    sql_A: (e) => ({ ...e, sql_asset_sha256: H('0') }),
  });
  assertTerminal(changedA, 'ownership_unavailable', 'SQL_ASSET_CHANGED');
  // Refused at A itself, not only by the later A/B comparison.
  assert.equal(last(changedA).event, 'sql_A');
  assertTerminal(
    drive({
      sql_B: (e) => ({ ...e, sql_asset_version: 'cw01-observer-sql/1' }),
    }),
    'ownership_unavailable',
    'SQL_ASSET_CHANGED',
  );
  assertTerminal(
    drive({ sql_B: (e) => ({ ...e, manifest_sha256: H('7') }) }),
    'ownership_unavailable',
    'VERSION_BINDING_CHANGED',
  );
  assert.equal(
    drive({ preflight: (e) => ({ ...e, manifest_sha256: H('7') }) }).state,
    'blocked',
  );
});

test('N4 spelling and CMD-safe path rules refuse rather than normalize', () => {
  for (const p of [
    'D:\\fixture\\cw01 cluster',
    'C:\\Windows\\System32\\cmd.exe',
    'D:\\données\\pg',
  ])
    assert.ok(admitPathSpelling(p).ok, p);
  for (const [p, code] of [
    ['D:/fixture/cw01', 'PATH_NOT_DRIVE_ROOTED'],
    ['D:\\fixture/cw01', 'PATH_UNSUPPORTED_SPELLING'],
    ['\\\\?\\D:\\fixture', 'PATH_NOT_DRIVE_ROOTED'],
    ['\\\\server\\share\\pg', 'PATH_NOT_DRIVE_ROOTED'],
    ['D:\\fixture\\..\\pg', 'PATH_DOT_OR_EMPTY_SEGMENT'],
    ['D:\\fixture\\.\\pg', 'PATH_DOT_OR_EMPTY_SEGMENT'],
    ['D:\\fixture\\\\pg', 'PATH_DOT_OR_EMPTY_SEGMENT'],
    ['D:\\fixture\\pg\\', 'PATH_DOT_OR_EMPTY_SEGMENT'],
    ['D:\\fixture\\pg.', 'PATH_TRAILING_DOT_OR_SPACE'],
    ['D:\\fixture\\pg ', 'PATH_TRAILING_DOT_OR_SPACE'],
    ['D:\\fixture\\NUL', 'PATH_RESERVED_DEVICE'],
    ['D:\\fixture\\com1.log', 'PATH_RESERVED_DEVICE'],
    ['D:\\fixture\\CONIN$', 'PATH_RESERVED_DEVICE'],
    ['D:\\fixture\\conout$.txt', 'PATH_RESERVED_DEVICE'],
    ['D:\\PROGRA~1\\pg', 'PATH_SHORT_NAME_ALIAS'],
    ['D:\\fixture\\pg:stream', 'PATH_UNSUPPORTED_SPELLING'],
    ['D:\\%TEMP%\\pg', 'PATH_CMD_METACHARACTER'],
    ['D:\\a&b\\pg', 'PATH_CMD_METACHARACTER'],
    ['D:\\a^b', 'PATH_CMD_METACHARACTER'],
    ['D:\\a!b', 'PATH_CMD_METACHARACTER'],
    ['D:\\a(x86)', 'PATH_CMD_METACHARACTER'],
    ['D:\\a"b', 'PATH_CMD_METACHARACTER'],
    ['D:\\a\tb', 'PATH_CONTROL_CHARACTER'],
  ])
    assert.equal(admitPathSpelling(p).code, code, p);
  const r = request();
  r.bindings.cmd_image.view = 'wow64';
  assert.ok(admitRequest(r).blockers.includes('UNBOUND_REGISTRY_VIEW'));
});

test('R1 AutoRun: present, unavailable, unknown, missing, wrong view/scope and stale evidence block start', () => {
  const at = (mod) =>
    drive({ start_intent: (e) => ({ ...e, autorun: mod(e.autorun) }) });
  const cases = [
    [(a) => [autorun('HKLM', { result: 'present' }), a[1]], 'AUTORUN_PRESENT'],
    [(a) => [a[0], autorun('HKCU', { result: 'present' })], 'AUTORUN_PRESENT'],
    [
      (a) => [a[0], autorun('HKCU', { result: 'unavailable' })],
      'AUTORUN_UNAVAILABLE',
    ],
    [(a) => [a[0], autorun('HKCU', { result: undefined })], 'AUTORUN_UNKNOWN'],
    [(a) => [a[0]], 'AUTORUN_UNKNOWN'],
    [() => undefined, 'AUTORUN_UNKNOWN'],
    [(a) => [a[0], autorun('HKLM')], 'AUTORUN_SCOPE_AMBIGUOUS'],
    [(a) => [a[0], autorun('HKCU', { view: '32' })], 'WRONG_REGISTRY_VIEW'],
    [
      (a) => [
        a[0],
        autorun('HKCU', {
          key: 'Software\\Wow6432Node\\Microsoft\\Command Processor',
        }),
      ],
      'AUTORUN_WRONG_SCOPE',
    ],
    [
      (a) => [a[0], autorun('HKCU', { value: 'autorun' })],
      'AUTORUN_WRONG_SCOPE',
    ],
    [
      (a) => [a[0], autorun('HKCU', { value_text: 'x' })],
      'AUTORUN_NOT_EXISTENCE_ONLY',
    ],
    [
      (a) => [a[0], autorun('HKCU', { existence_only: false })],
      'AUTORUN_NOT_EXISTENCE_ONLY',
    ],
    [
      (a) => [a[0], autorun('HKCU', { observed_at_ms: T + 10000 - 15001 })],
      'AUTORUN_STALE',
    ],
    [
      (a) => [a[0], autorun('HKCU', { observed_at_ms: T - 60001 })],
      'AUTORUN_STALE',
    ],
    [
      (a) => [a[0], autorun('HKCU', { observed_at_ms: T + 10001 })],
      'AUTORUN_STALE',
    ],
    [
      (a) => [a[0], autorun('HKCU', { provenance: 'model_assertion' })],
      'ASSERTION_NOT_MEASURED',
    ],
  ];
  for (const [mod, code] of cases) {
    const run = at(mod);
    assert.equal(run.state, 'blocked', code);
    assert.equal(last(run).reason, code);
    assert.ok(!run.history.some((e) => e.event === 'start_outcome'));
  }
  const r = request();
  r.bindings.cmd_image.view = 'wow64';
  assert.equal(drive({}, r).state, 'blocked');
});

test('R2 process chain: reused PIDs, lifetime containment, probe shell and downward walk give no ownership', () => {
  const chain = (mod) =>
    drive({
      start_outcome: (e) => ({
        ...e,
        chain: { ...e.chain, records: mod(chainRecords()) },
      }),
    });
  const cases = [
    // pg_ctl PID reused by a different instance (creation differs from the launch handle).
    [
      (r) => [r[0], r[1], { ...r[2], creation_ft: ft(T + 10050) }],
      'PG_CTL_INSTANCE_MISMATCH',
    ],
    // A recycled shell PID created after this pg_ctl instance exited.
    [
      (r) => [
        { ...r[0], creation_ft: ft(T + 12600) },
        { ...r[1], creation_ft: ft(T + 12500) },
        r[2],
      ],
      'SHELL_OUTSIDE_PG_CTL_LIFETIME',
    ],
    // A recycled shell PID created before pg_ctl.
    [
      (r) => [r[0], { ...r[1], creation_ft: ft(T + 10000) }, r[2]],
      'SHELL_OUTSIDE_PG_CTL_LIFETIME',
    ],
    // The parent PID belongs to a process created after the postmaster: reuse, not a parent.
    [
      (r) => [r[0], { ...r[1], creation_ft: ft(T + 10400) }, r[2]],
      'POSTMASTER_PRECEDES_SHELL',
    ],
    // pg_ctl's postgres -V probe shell has exited; it cannot be the launch shell.
    [
      (r) => [r[0], { ...r[1], exit_ft: ft(T + 10250) }, r[2]],
      'SHELL_NOT_RUNNING',
    ],
    [
      (r) => [{ ...r[0], exit_ft: ft(T + 13000) }, r[1], r[2]],
      'POSTMASTER_NOT_RUNNING',
    ],
    [
      (r) => [{ ...r[0], parent_pid: 4250 }, r[1], r[2]],
      'PARENT_LINK_MISMATCH',
    ],
    [
      (r) => [r[0], { ...r[1], handle_bound: false }, r[2]],
      'CHAIN_NOT_HANDLE_BOUND',
    ],
    [(r) => [r[0], { ...r[1], image_sha256: H('8') }, r[2]], 'IMAGE_MISMATCH'],
    [(r) => [r[0], r[1]], 'CHAIN_SHAPE'],
    [(r) => [r[1], r[0], r[2]], 'CHAIN_SHAPE'],
  ];
  for (const [mod, code] of cases)
    assertTerminal(chain(mod), 'ownership_unavailable', code);
  assertTerminal(
    drive({
      start_outcome: (e) => ({
        ...e,
        chain: { ...e.chain, walk: 'downward_from_pg_ctl' },
      }),
    }),
    'ownership_unavailable',
    'CHAIN_NOT_UPWARD_WALK',
  );
  assertTerminal(
    drive({
      start_outcome: (e) => ({
        ...e,
        pidfile: { ...e.pidfile, lines: ['4999', ...e.pidfile.lines.slice(1)] },
      }),
    }),
    'ownership_unavailable',
    'PIDFILE_PID_MISMATCH',
  );
  // pg_ctl exited 0, so a launch handle without an exit is unbound (v2, F1).
  assertTerminal(
    drive({
      start_outcome: (e) => ({ ...e, launch: { ...e.launch, exit_ft: null } }),
    }),
    'ownership_unavailable',
    'LAUNCH_HANDLE_UNBOUND',
  );
});

test('W1 pidfile: Windows layout, line 7 empty, ready status and N4 directory spelling', () => {
  const pf = (i, v) =>
    drive({
      start_outcome: (e) => ({
        ...e,
        pidfile: {
          ...e.pidfile,
          lines: e.pidfile.lines.map((x, j) => (j === i ? v : x)),
        },
      }),
    });
  assertTerminal(
    pf(6, '12345 67890'),
    'ownership_unavailable',
    'PIDFILE_LINE7_NOT_EMPTY',
  );
  assertTerminal(pf(7, 'standby '), 'ownership_unavailable', 'PIDFILE_STANDBY');
  assertTerminal(
    pf(7, 'starting'),
    'ownership_unavailable',
    'PIDFILE_NOT_READY',
  );
  assertTerminal(pf(7, 'ready'), 'ownership_unavailable', 'PIDFILE_NOT_READY');
  assertTerminal(
    pf(0, '-4300'),
    'ownership_unavailable',
    'STANDALONE_BACKEND_PID',
  );
  assertTerminal(
    pf(1, 'D:/fixture/cw01 cluster'),
    'ownership_unavailable',
    'PIDFILE_DIRECTORY_MISMATCH',
  );
  assertTerminal(
    pf(1, 'd:\\fixture\\cw01 cluster'),
    'ownership_unavailable',
    'PIDFILE_DIRECTORY_MISMATCH',
  );
  assertTerminal(
    pf(3, '5432'),
    'ownership_unavailable',
    'PIDFILE_PORT_MISMATCH',
  );
  assertTerminal(
    pf(4, 'D:\\sock'),
    'ownership_unavailable',
    'PIDFILE_SOCKET_PRESENT',
  );
  assertTerminal(
    pf(5, '*'),
    'ownership_unavailable',
    'PIDFILE_LISTENER_MISMATCH',
  );
  assertTerminal(
    drive({
      start_outcome: (e) => ({
        ...e,
        pidfile: { ...e.pidfile, lines: [...e.pidfile.lines, ''] },
      }),
    }),
    'ownership_unavailable',
    'PIDFILE_MALFORMED',
  );
  assertTerminal(
    drive({
      start_outcome: (e) => ({
        ...e,
        pidfile: { ...e.pidfile, stable: false },
      }),
    }),
    'ownership_unavailable',
    'PIDFILE_UNSTABLE_OR_UNSAFE',
  );
});

test('R3: SQL backend must be a child of the owned postmaster; times alone are not the link', () => {
  const a = (bp) => drive({ sql_A: (e) => sqlA({ backend_parent: bp }) });
  assertTerminal(
    a(undefined),
    'ownership_unavailable',
    'SQL_PARENT_LINK_MISSING',
  );
  assertTerminal(
    a(backendParent({ handle_bound: false })),
    'ownership_unavailable',
    'SQL_PARENT_LINK_MISSING',
  );
  assertTerminal(
    a(backendParent({ backend_pid: 5101 })),
    'ownership_unavailable',
    'SQL_PARENT_LINK_MISSING',
  );
  assertTerminal(
    a(backendParent({ parent_pid: 7777 })),
    'ownership_unavailable',
    'SQL_PARENT_NOT_OWNED_POSTMASTER',
  );
  assertTerminal(
    a(backendParent({ parent_creation_ft: ft(T + 10301) })),
    'ownership_unavailable',
    'SQL_PARENT_NOT_OWNED_POSTMASTER',
  );
  assertTerminal(
    a(backendParent({ backend_creation_ft: ft(T + 10200) })),
    'ownership_unavailable',
    'SQL_PARENT_PID_REUSE',
  );
  assertTerminal(
    drive({ sql_B: () => sqlB({ backend_parent: undefined }) }),
    'ownership_unavailable',
    'SQL_PARENT_LINK_MISSING',
  );
  // Consistent times without the direct link still fail; contradictory times also fail.
  assertTerminal(
    drive({
      sql_A: () =>
        sqlA({ instance: { ...instance, server_started_at_ms: T + 9000 } }),
    }),
    'ownership_unavailable',
    'TIME_CONTRADICTION',
  );
});

test('SQL A identity, recovery, NULL activity types and unavailable counts never pass', () => {
  for (const v of [null, false, undefined])
    assertTerminal(
      drive({ sql_A: () => sqlA({ address_ok: v }) }),
      'ownership_unavailable',
      'IDENTITY_GATE_FAILED:address_ok',
    );
  assertTerminal(
    drive({ sql_A: () => sqlA({ observer_ok: null }) }),
    'ownership_unavailable',
    'OBSERVER_INSUFFICIENT',
  );
  assertTerminal(
    drive({
      sql_A: () => sqlA({ instance: { ...instance, in_recovery: true } }),
    }),
    'ownership_unavailable',
    'IN_RECOVERY',
  );
  assertTerminal(
    drive({
      sql_A: () => sqlA({ instance: { ...instance, in_recovery: null } }),
    }),
    'ownership_unavailable',
    'INSTANCE_UNAVAILABLE',
  );
  assertTerminal(
    drive({ sql_A: () => sqlA({ counts: counts({ null_type: '1' }) }) }),
    'invalid_producer_observed',
    'NULL_ACTIVITY_TYPE',
  );
  assertTerminal(
    drive({ sql_B: () => sqlB({ counts: counts({ null_type: '2' }) }) }),
    'invalid_producer_observed',
    'NULL_ACTIVITY_TYPE',
  );
  for (const bad of [null, undefined, '', '01', '-1', '1.0', ' 0', 7])
    assertTerminal(
      drive({ sql_A: () => sqlA({ counts: counts({ null_type: bad }) }) }),
      'sql_unknown',
      'COUNT_UNAVAILABLE',
    );
  assertTerminal(
    drive({
      sql_A: () =>
        sqlA({
          counts: counts({
            background: [
              { type: 'mystery', n: '1' },
              { type: 'checkpointer', n: '1' },
            ],
          }),
        }),
    }),
    'invalid_producer_observed',
    'UNKNOWN_BACKGROUND_TYPE',
  );
  assertTerminal(
    drive({
      sql_A: () =>
        sqlA({
          counts: counts({ background: [{ type: 'io worker', n: '3' }] }),
        }),
    }),
    'invalid_producer_observed',
    'BACKGROUND_OUT_OF_RANGE',
  );
  assertTerminal(
    drive({ sql_A: (e) => ({ ...e, deadline_exceeded: true }) }),
    'sql_unknown',
    'SQL_DEADLINE',
  );
  assertTerminal(
    drive({ sql_A: () => null }),
    'ownership_unavailable',
    'EVIDENCE_MISSING',
  );
});

test('work present or boundary divergence invalidates clearance without authorizing a sweep', () => {
  const run = drive({
    sql_A: () => sqlA({ work: { ...work(), workflow_tasks: '2' } }),
  });
  // Smart stop of our owned cluster remains admissible; clearance does not.
  assert.equal(run.state, 'W2_reference_recorded');
  assert.deepEqual([...run.invalidations], ['WORK_PRESENT:workflow_tasks']);
  assert.equal(fixtureReceipt(run).sequence, 'fixture_sequence_not_clear');
  const pre = drive({
    sql_A: () =>
      sqlA({
        startup_boundary: {
          ...sqlA().results.startup_boundary,
          session_preloads: { match: true },
        },
      }),
  });
  assert.deepEqual([...pre.invalidations], ['PRELOAD_NOT_SESSION_LABELED']);
  const mis = drive({
    sql_A: () =>
      sqlA({
        startup_boundary: {
          ...sqlA().results.startup_boundary,
          archive_mode: false,
        },
      }),
  });
  assert.deepEqual([...mis.invalidations], ['STARTUP_BOUNDARY_MISMATCH']);
  const unavailable = drive({
    sql_A: () => sqlA({ work: { ...work(), outbox: null } }),
  });
  assert.deepEqual([...unavailable.invalidations], ['WORK_UNAVAILABLE:outbox']);
});

test('B must be a fresh transaction on the same connection; foreign access/adoption forbids stop', () => {
  assertTerminal(
    drive({ sql_B: (e) => ({ ...e, connection_id: 'conn-2' }) }),
    'ownership_unavailable',
    'CONNECTION_CHANGED',
  );
  assertTerminal(
    drive({ sql_B: (e) => ({ ...e, transaction_id: 'tx-A' }) }),
    'ownership_unavailable',
    'B_NOT_NEW_TRANSACTION',
  );
  assertTerminal(
    drive({ sql_B: (e) => ({ ...e, observed_at_ms: T + 13000 }) }),
    'ownership_unavailable',
    'STALE_B_EVIDENCE',
  );
  assertTerminal(
    drive({ sql_B: (e) => ({ ...e, sample_id: 'sample-A' }) }),
    'ownership_unavailable',
    'STALE_B_EVIDENCE',
  );
  assertTerminal(
    drive({
      sql_B: () =>
        sqlB({ instance: { ...instance, server_started_at_ms: T + 10600 } }),
    }),
    'ownership_unavailable',
    'INSTANCE_CHANGED',
  );
  assertTerminal(
    drive({
      sql_B: () => sqlB({ instance: { ...instance, in_recovery: true } }),
    }),
    'ownership_unavailable',
    'IN_RECOVERY',
  );
  assertTerminal(
    drive({ sql_B: () => sqlB({ counts: counts({ client: '1' }) }) }),
    'invalid_producer_observed',
    'FOREIGN_ACCESS',
  );
  assertTerminal(
    drive({ sql_B: () => sqlB({ counts: counts({ walsender: '1' }) }) }),
    'invalid_producer_observed',
    'FOREIGN_ACCESS',
  );
  assertTerminal(
    drive({ sql_A: () => sqlA({ counts: counts({ client: '3' }) }) }),
    'invalid_producer_observed',
    'FOREIGN_ACCESS',
  );
  for (const adoption of [true, undefined, null])
    assertTerminal(
      drive({
        sql_B: () => sqlB({ counts: counts({ desktop_adoption: adoption }) }),
      }),
      'invalid_producer_observed',
      'ADOPTION_OR_UNKNOWN',
    );
  // Uncertain ownership at the pre-stop revalidation also forbids stop.
  assertTerminal(
    drive({
      stop_intent: (e) => ({
        ...e,
        revalidation: { ...e.revalidation, handle_alive: null },
      }),
    }),
    'ownership_unavailable',
    'OWNERSHIP_REVALIDATION_FAILED',
  );
  assertTerminal(
    drive({
      stop_intent: (e) => ({
        ...e,
        revalidation: { ...e.revalidation, postmaster_pid: 4301 },
      }),
    }),
    'ownership_unavailable',
    'OWNERSHIP_REVALIDATION_FAILED',
  );
  assertTerminal(
    drive({ stop_intent: (e) => ({ ...e, at_ms: T + 14000 + 5001 }) }),
    'ownership_unavailable',
    'STALE_PRESTOP_EVIDENCE',
  );
  assertTerminal(
    drive({ disconnect: (e) => ({ ...e, other_backends_terminated: 1 }) }),
    'ownership_unavailable',
    'DISCONNECT_UNVERIFIED',
  );
});

test('timeouts and nonzero outcomes are unknown; retry, escalation and adoption are always refused', () => {
  for (const [mod, reason] of [
    [(e) => ({ ...e, timed_out: true }), 'START_TIMEOUT_OR_UNKNOWN'],
    [
      (e) => ({ ...e, outer_deadline_exceeded: true }),
      'START_TIMEOUT_OR_UNKNOWN',
    ],
    [(e) => ({ ...e, pg_ctl_exit: null }), 'START_TIMEOUT_OR_UNKNOWN'],
    [(e) => ({ ...e, pg_ctl_timeout_s: 90 }), 'START_TIMEOUT_OR_UNKNOWN'],
    [(e) => ({ ...e, pg_ctl_exit: 1 }), 'START_NONZERO'],
  ]) {
    const run = drive({ start_outcome: mod });
    assertTerminal(run, 'start_unknown', reason);
    for (const ev of [
      'retry_start',
      'kill',
      'adopt',
      'cleanup',
      'start_outcome',
    ])
      assert.equal(step(run, ev, base.start_outcome()).state, 'start_unknown');
  }
  const stop = drive({ stop_outcome: (e) => ({ ...e, timed_out: true }) });
  assertTerminal(stop, 'stop_unknown', 'STOP_TIMEOUT_OR_UNKNOWN');
  for (const ev of [
    'retry_stop',
    'second_stop',
    'stop_fast',
    'stop_immediate',
    'kill',
    'extend_deadline',
  ])
    assert.equal(step(stop, ev, {}).refused, 'RETRY_OR_ESCALATION_FORBIDDEN');
  assertTerminal(
    drive({
      stop_outcome: (e) => ({
        ...e,
        stopped_observation: { ...e.stopped_observation, processes: 1 },
      }),
    }),
    'stop_unknown',
    'STOPPED_STATE_UNVERIFIED',
  );
  assertTerminal(
    drive({ stop_intent: (e) => ({ ...e, mode: 'fast' }) }),
    'ownership_unavailable',
    'ESCALATION_FORBIDDEN',
  );
  assertTerminal(
    drive({ stop_intent: (e) => ({ ...e, pg_ctl_timeout_s: 90 }) }),
    'ownership_unavailable',
    'ESCALATION_FORBIDDEN',
  );
  // Forbidden events are refused even mid-sequence and leave the state untouched.
  let mid = newRun(request());
  mid = step(mid, 'admit', base.admit());
  for (const ev of ['escalate', 'reconnect', 'terminate_backend'])
    assert.equal(step(mid, ev, {}).state, 'admitted');
  assertTerminal(
    drive({ sql_B: () => null }),
    'ownership_unavailable',
    'EVIDENCE_MISSING',
  );
  let sqlRun = newRun(request());
  for (const ev of ORDER.slice(0, 4)) sqlRun = step(sqlRun, ev, base[ev]());
  assertTerminal(
    step(sqlRun, 'sql_deadline', {}),
    'sql_unknown',
    'SQL_DEADLINE',
  );
  assert.equal(
    step(newRun(request()), 'sql_A', base.sql_A()).refused,
    'OUT_OF_ORDER',
  );
});

test('preflight never adopts a running or unknown cluster; signal files block', () => {
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, cluster_running: true }) })).reason,
    'PREEXISTING_CLUSTER_NO_ADOPTION',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, listeners: 1 }) })).reason,
    'PREEXISTING_CLUSTER_NO_ADOPTION',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, pidfile: 'present' }) })).reason,
    'PREEXISTING_CLUSTER_NO_ADOPTION',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, leases: undefined }) })).reason,
    'PREFLIGHT_UNAVAILABLE',
  );
  assert.equal(
    last(
      drive({
        preflight: (e) => ({
          ...e,
          signal_files: { recovery: 'absent', standby: 'present' },
        }),
      }),
    ).reason,
    'SIGNAL_FILE_PRESENT',
  );
  assert.equal(
    last(
      drive({
        preflight: (e) => ({
          ...e,
          signal_files: { recovery: 'unavailable', standby: 'absent' },
        }),
      }),
    ).reason,
    'PREFLIGHT_UNAVAILABLE',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, provenance: 'model_assertion' }) }))
      .reason,
    'ASSERTION_NOT_MEASURED',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, fixture: undefined }) })).reason,
    'UNLABELED_EVIDENCE',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, adapter_sha256: H('3') }) }))
      .reason,
    'ADAPTER_NOT_BOUND',
  );
});

test('attestation and job context: missing, incomplete, copied, stale or nested blocks start', () => {
  const att = (mod) =>
    last(
      drive({
        start_intent: (e) => ({ ...e, attestation: mod(e.attestation) }),
      }),
    ).reason;
  assert.equal(
    att(() => undefined),
    'ATTESTATION_MISSING',
  );
  assert.equal(
    att((a) => ({ ...a, items: a.items.slice(0, 5) })),
    'ATTESTATION_INCOMPLETE',
  );
  assert.equal(
    att((a) => ({ ...a, items: [...a.items, { ...a.items[0] }] })),
    'ATTESTATION_INCOMPLETE',
  );
  assert.equal(
    att((a) => ({
      ...a,
      items: a.items.map((x) =>
        x.item === 4 ? { ...x, affirmed: 'unknown' } : x,
      ),
    })),
    'ATTESTATION_INCOMPLETE',
  );
  assert.equal(
    att((a) => ({
      ...a,
      items: a.items.map((x) => (x.item === 1 ? { ...x, basis: ' ' } : x)),
    })),
    'ATTESTATION_INCOMPLETE',
  );
  assert.equal(
    att((a) => ({ ...a, prefilled_from: 'old template' })),
    'ATTESTATION_COPIED',
  );
  assert.equal(
    att((a) => ({ ...a, provenance: 'model_assertion' })),
    'ATTESTATION_NOT_OWNER',
  );
  assert.equal(
    att((a) => ({ ...a, affirmed_at_ms: T + 10001 })),
    'ATTESTATION_NOT_FRESH',
  );
  assert.equal(
    att((a) => ({ ...a, affirmed_at_ms: T - 60001 })),
    'ATTESTATION_NOT_FRESH',
  );
  assert.equal(
    att((a) => ({ ...a, scope: 'W1' })),
    'ATTESTATION_SCOPE_MISMATCH',
  );
  assert.equal(
    att((a) => ({ ...a, inspector_sha256: H('4') })),
    'ATTESTATION_SCOPE_MISMATCH',
  );
  assert.equal(
    att((a) => ({ ...a, manifest_sha256: H('4') })),
    'VERSION_BINDING_CHANGED',
  );
  const job = (j) =>
    last(drive({ start_intent: (e) => ({ ...e, job: { ...e.job, ...j } }) }))
      .reason;
  assert.equal(job({ in_job: true }), 'NESTED_JOB_REFUSED');
  assert.equal(job({ in_job: undefined }), 'JOB_CONTEXT_UNKNOWN');
});

test('core module is pure: only node:crypto, no I/O, clock, environment or process access', () => {
  const src = bytes('scripts/theme-intent-cw01-core-fixture-v3.mjs').toString(
    'utf8',
  );
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  assert.deepEqual(
    [...code.matchAll(/^import .*$/gm)].map((m) => m[0]),
    ["import { createHash } from 'node:crypto';"],
  );
  assert.ok(
    !/\b(require|process|globalThis|Date|performance|setTimeout|setInterval|fetch|eval|Function|child_process|spawn|exec)\b/.test(
      code,
    ),
  );
  assert.ok(!/\bimport\s*\(/.test(code));
});

test('v2 F1: asserted or unlabeled start/stop outcomes and mismatched launch handles are never a pass', () => {
  for (const [mod, reason] of [
    [
      (e) => ({ ...e, provenance: 'model_assertion' }),
      'ASSERTION_NOT_MEASURED',
    ],
    [(e) => ({ ...e, fixture: undefined }), 'UNLABELED_EVIDENCE'],
    [(e) => ({ ...e, adapter_sha256: H('3') }), 'ADAPTER_NOT_BOUND'],
    [(e) => ({ ...e, manifest_sha256: H('7') }), 'VERSION_BINDING_CHANGED'],
  ]) {
    assertTerminal(drive({ start_outcome: mod }), 'start_unknown', reason);
    assertTerminal(drive({ stop_outcome: mod }), 'stop_unknown', reason);
  }
  // The chain's pg_ctl exit must be the launch handle's exit.
  assertTerminal(
    drive({
      start_outcome: (e) => ({
        ...e,
        launch: { ...e.launch, exit_ft: ft(T + 11900) },
      }),
    }),
    'ownership_unavailable',
    'PG_CTL_INSTANCE_MISMATCH',
  );
  assertTerminal(
    drive({ start_outcome: (e) => ({ ...e, launch: undefined }) }),
    'ownership_unavailable',
    'LAUNCH_HANDLE_UNBOUND',
  );
  assertTerminal(
    drive({ stop_outcome: (e) => ({ ...e, launch: undefined }) }),
    'stop_unknown',
    'LAUNCH_HANDLE_UNBOUND',
  );
});

test('v2 F2: outer deadline and pre-spawn freshness are measured to the actual pg_ctl spawn', () => {
  const late = (createdMs) => (e) => ({
    ...e,
    observed_at_ms: createdMs + 2100,
    launch: {
      ...e.launch,
      creation_ft: ft(createdMs),
      exit_ft: ft(createdMs + 2000),
    },
  });
  // A spawn an hour after start intent fails even though every flag says on time.
  assertTerminal(
    drive({ start_outcome: late(T + 3_610_100) }),
    'start_unknown',
    'OUTER_DEADLINE_EXCEEDED',
  );
  assertTerminal(
    drive({ start_outcome: (e) => ({ ...e, observed_at_ms: undefined }) }),
    'start_unknown',
    'OUTER_DEADLINE_EXCEEDED',
  );
  // AutoRun older than 15 s at the spawn, though fresh at start intent.
  const intent = (e) => ({
    ...e,
    job: { ...e.job, observed_at_ms: T + 9000 },
  });
  assertTerminal(
    drive({
      preflight: (e) => ({ ...e, observed_at_ms: T + 9000 }),
      start_intent: intent,
      start_outcome: late(T + 20001),
    }),
    'ownership_unavailable',
    'PRESPAWN_EVIDENCE_STALE',
  );
  // Preflight older than 15 s at the spawn.
  assertTerminal(
    drive({ preflight: (e) => ({ ...e, observed_at_ms: T - 6000 }) }),
    'ownership_unavailable',
    'PRESPAWN_EVIDENCE_STALE',
  );
  assert.equal(
    last(drive({ preflight: (e) => ({ ...e, observed_at_ms: undefined }) }))
      .reason,
    'PREFLIGHT_TIME_INVALID',
  );
  assert.equal(
    last(
      drive({
        start_intent: (e) => ({
          ...e,
          job: { ...e.job, observed_at_ms: undefined },
        }),
      }),
    ).reason,
    'JOB_CONTEXT_STALE',
  );
  assert.equal(
    last(
      drive({
        start_intent: (e) => ({
          ...e,
          job: { ...e.job, observed_at_ms: T + 10001 },
        }),
      }),
    ).reason,
    'JOB_CONTEXT_STALE',
  );
  // Job context older than 15 s at the spawn, with the other evidence fresh.
  assertTerminal(
    drive({
      start_intent: (e) => ({
        ...e,
        job: { ...e.job, observed_at_ms: T - 5000 },
      }),
    }),
    'ownership_unavailable',
    'PRESPAWN_EVIDENCE_STALE',
  );
  // One 30-second SQL phase from A's connection through B.
  assertTerminal(
    drive({ sql_B: (e) => ({ ...e, observed_at_ms: T + 12500 + 30001 }) }),
    'sql_unknown',
    'SQL_TOTAL_EXCEEDED',
  );
  assertTerminal(
    drive({ sql_A: (e) => ({ ...e, connected_at_ms: undefined }) }),
    'sql_unknown',
    'SQL_RESULT_UNAVAILABLE',
  );
  assertTerminal(
    drive({ sql_A: (e) => ({ ...e, connected_at_ms: T + 12000 }) }),
    'ownership_unavailable',
    'TIME_CONTRADICTION',
  );
  // Pre-stop revalidation must be timed between B and the stop intent.
  for (const observed_at_ms of [undefined, T + 13999, T + 15001])
    assertTerminal(
      drive({
        stop_intent: (e) => ({
          ...e,
          revalidation: { ...e.revalidation, observed_at_ms },
        }),
      }),
      'ownership_unavailable',
      'STALE_PRESTOP_EVIDENCE',
    );
  // The stop spawn is at most 5 s after B and not before the stop intent.
  for (const createdMs of [T + 14000 + 5001, T + 14900])
    assertTerminal(
      drive({
        stop_outcome: (e) => ({
          ...e,
          // v3 (R-2): the exit must follow the creation, so it moves too.
          launch: {
            ...e.launch,
            creation_ft: ft(createdMs),
            exit_ft: ft(createdMs + 800),
          },
        }),
      }),
      'stop_unknown',
      'STALE_PRESTOP_EVIDENCE',
    );
  assertTerminal(
    drive({
      stop_outcome: (e) => ({
        ...e,
        stopped_observation: {
          ...e.stopped_observation,
          observed_at_ms: T + 15000 + 90001,
        },
      }),
    }),
    'stop_unknown',
    'OUTER_DEADLINE_EXCEEDED',
  );
});

test('v2 F3: the run holds a frozen, digest-bound request snapshot', () => {
  const req = request();
  let run = newRun(req);
  run = step(run, 'admit', base.admit());
  // The caller widens its own allowlist after admission; the run is unaffected.
  req.bindings.background_allowlist.types.mystery = {
    min: 0,
    max: 5,
    writes_storage_reviewed: true,
  };
  req.manifest_sha256 = H('7');
  assert.ok(Object.isFrozen(run.request.bindings.background_allowlist.types));
  for (const ev of ORDER.slice(1, 4)) run = step(run, ev, base[ev]());
  run = step(
    run,
    'sql_A',
    sqlA({
      counts: counts({
        background: [
          { type: 'checkpointer', n: '1' },
          { type: 'mystery', n: '1' },
        ],
      }),
    }),
  );
  assert.equal(run.state, 'invalid_producer_observed');
  assert.equal(last(run).reason, 'UNKNOWN_BACKGROUND_TYPE');
  const receipt = fixtureReceipt(drive());
  assert.equal(receipt.core_version, CORE_VERSION);
  assert.match(receipt.request_sha256, /^[a-f0-9]{64}$/);
  for (const e of receipt.history) {
    assert.equal(e.request_sha256, receipt.request_sha256);
    assert.equal(e.core_version, CORE_VERSION);
    assert.equal(e.manifest_sha256, MANIFEST);
  }
  const other = request();
  other.bindings.port = fx(55433);
  assert.notEqual(newRun(other).request_sha256, receipt.request_sha256);
  // Refusals are frozen too, and v1 fixture receipts still cannot pass a gate.
  assert.ok(Object.isFrozen(step(newRun(request()), 'kill', {})));
  assert.equal(
    admitOperationalGate(
      {
        format: 'theme-intent-cw01-fixture-receipt/1',
        fixture: false,
        mode: 'operational',
      },
      'cluster_start',
    ).reason,
    'FIXTURE_CANNOT_SATISFY_OPERATIONAL_GATE',
  );
});

test('v3 R-1: the owner attestation is at most 120 s older than the measured spawn', () => {
  const early = (affirmed_at_ms) =>
    drive({
      admit: () => ({ at_ms: T - 200000 }),
      start_intent: (e) => ({
        ...e,
        attestation: { ...e.attestation, affirmed_at_ms },
      }),
    });
  // pg_ctl is created at T + 10100; 120 s exactly is accepted, 1 ms more is not.
  assert.equal(early(T + 10100 - 120000).state, 'W2_reference_recorded');
  assertTerminal(
    early(T + 10100 - 120001),
    'ownership_unavailable',
    'PRESPAWN_EVIDENCE_STALE',
  );
});

test('v3 R-2: the stop launch handle must show its exit, and stopped state follows that exit', () => {
  for (const launch of [
    { pid: 6100, creation_ft: ft(T + 15100), exit_ft: null },
    { pid: 6100, creation_ft: ft(T + 15100) },
    { pid: 6100, creation_ft: ft(T + 15100), exit_ft: ft(T + 15099) },
  ])
    assertTerminal(
      drive({ stop_outcome: (e) => ({ ...e, launch }) }),
      'stop_unknown',
      'LAUNCH_HANDLE_UNBOUND',
    );
  // Observed after the spawn but before pg_ctl's exit: not a completed stop.
  assertTerminal(
    drive({
      stop_outcome: (e) => ({
        ...e,
        stopped_observation: {
          ...e.stopped_observation,
          observed_at_ms: T + 15500,
        },
      }),
    }),
    'stop_unknown',
    'OUTER_DEADLINE_EXCEEDED',
  );
});

test('v3 R-3: accepted SQL evidence is held as a deep-frozen copy', () => {
  let run = newRun(request());
  for (const ev of ORDER.slice(0, 4)) run = step(run, ev, base[ev]());
  const a = sqlA();
  run = step(run, 'sql_A', a);
  assert.equal(run.state, 'sql_A');
  // Moving A's connection back 100 s would breach the 30 s SQL phase at B.
  a.connected_at_ms = T - 100000;
  a.results.instance.backend_pid = 9999;
  assert.ok(Object.isFrozen(run.ctx.sqlA.results.instance));
  const b = sqlB();
  run = step(run, 'sql_B', b);
  assert.equal(run.state, 'sql_B');
  // Moving B back 14 s would make the 5 s pre-stop checks fail.
  b.observed_at_ms = T + 1000;
  for (const ev of ['disconnect', 'stop_intent', 'stop_outcome'])
    run = step(run, ev, base[ev]());
  assert.equal(run.state, 'stopped_verified');
});
