import test from 'node:test';
import assert from 'node:assert/strict';
import {
  desktopKey,
  mapOpenResult,
  mapRunValueResult,
  classifySample,
  classifyWindow,
} from '../scripts/theme-intent-observation-classifier-fixture-v2.mjs';
const key = (localappdata_exact, extra = {}) =>
  desktopKey({
    localappdata_exact,
    override_unset: true,
    launch_paths_confirmed: true,
    ...extra,
  });
const sample = (at_ms, extra = {}) => ({
  at_ms,
  binding_sha256: 'a'.repeat(64),
  available: true,
  identity_matches: true,
  scope_bound: true,
  active_home_attested: true,
  continuity_attested: true,
  other_producers_idle: true,
  key_bound: true,
  launch_during_sampling: false,
  pg_ctl_status: 3,
  listeners: 0,
  desktop_processes: 0,
  service_processes: 0,
  postgres_processes: 0,
  leases: 0,
  helper_mutexes: 0,
  desktop_mutexes: 0,
  desktop_events: 0,
  run_value: 'absent',
  run_history_reconciled: true,
  ...extra,
});
const window = (samples, extra = {}) =>
  classifyWindow({
    kind: 'PR-01',
    launch_during_sampling: false,
    handles_closed: true,
    ...(extra.kind === 'SH-01'
      ? { running_state_recorded: true, planned_quit: true, quit_request_ms: 0 }
      : {}),
    start_ms: 0,
    now_ms: samples.at(-1)?.at_ms ?? 0,
    samples,
    ...extra,
  });
test('join emulation matches Rust-executed admitted vectors including real trailing-separator branch', () => {
  for (const local of [
    'C:\\Users\\jorda\\AppData\\Local',
    'C:\\Users\\jorda\\AppData\\Local\\',
    'c:\\users\\JORDA\\appdata\\local',
  ])
    assert.deepEqual(key(local), {
      fixture: true,
      status: 'bound',
      key16: 'd8c7860557013e56',
    });
});
test('Rust-executed double-backslash and forward-slash cases are unavailable, never alternative keys', () => {
  for (const local of [
    'C:\\Users\\jorda\\AppData\\Local\\\\',
    'C:\\Users\\jorda\\AppData\\Local/',
    'C:/Users/jorda/AppData/Local',
    'C:\\Users\\é\\AppData\\Local',
    'relative',
    'C:\\a\\..\\Local',
    'C:\\a\\.\\Local',
    'C:\\a\\\\Local',
  ]) {
    const result = key(local);
    assert.equal(result.status, 'unavailable');
    assert.equal('key16' in result, false);
  }
  assert.equal(
    key('C:\\Local', { override_unset: false }).status,
    'unavailable',
  );
  assert.equal(
    key('C:\\Local', { launch_paths_confirmed: false }).status,
    'unavailable',
  );
});
test('open result not-found is absent only with bound key; errors including wrong type stay unavailable', () => {
  assert.equal(mapOpenResult(true, 0), 'present');
  assert.equal(mapOpenResult(true, 2), 'absent');
  for (const code of [0, 2, 5, 6, 87, undefined, '2', -1])
    assert.equal(mapOpenResult(false, code), 'unavailable');
  for (const code of [5, 6, 87, undefined, '2', -1])
    assert.equal(mapOpenResult(true, code), 'unavailable');
});
test('Run existence is type-agnostic with only file-not-found absent', () => {
  assert.equal(mapRunValueResult(0), 'present');
  assert.equal(mapRunValueResult(2), 'absent');
  for (const code of [5, 6, 87, undefined, '2', null])
    assert.equal(mapRunValueResult(code), 'unavailable');
});
test('every required binding, count and availability matters; unavailable never means zero', () => {
  assert.equal(classifySample(sample(0)).status, 'stopped');
  for (const name of [
    'identity_matches',
    'scope_bound',
    'active_home_attested',
    'continuity_attested',
    'other_producers_idle',
    'key_bound',
    'available',
    'run_history_reconciled',
  ])
    assert.equal(
      classifySample(sample(0, { [name]: false })).status,
      'unavailable',
    );
  for (const name of [
    'listeners',
    'desktop_processes',
    'service_processes',
    'postgres_processes',
    'leases',
    'helper_mutexes',
    'desktop_mutexes',
    'desktop_events',
  ]) {
    assert.equal(classifySample(sample(0, { [name]: 1 })).status, 'activity');
    for (const value of [undefined, -1, NaN, '0', 0.5])
      assert.equal(
        classifySample(sample(0, { [name]: value })).status,
        'unavailable',
      );
  }
  for (const value of [1, 4, undefined, '3'])
    assert.equal(
      classifySample(sample(0, { pg_ctl_status: value })).status,
      'unavailable',
    );
  assert.equal(
    classifySample(sample(0, { pg_ctl_status: 0 })).status,
    'contradiction',
  );
  assert.equal(
    classifySample(sample(0, { run_value: 'present' })).status,
    'stopped',
  );
  assert.equal(
    classifySample(sample(0, { run_value: 'unavailable' })).status,
    'unavailable',
  );
});
test('PR01 stopped pair needs spacing, complete evidence, identical binding and bounded fresh end', () => {
  assert.equal(window([sample(0), sample(1000)]).status, 'pass');
  assert.equal(window([sample(0)]).status, 'pending');
  assert.equal(window([sample(0), sample(999)]).status, 'unknown');
  assert.equal(
    window([sample(0), sample(1000, { binding_sha256: 'b'.repeat(64) })])
      .status,
    'unknown',
  );
  assert.equal(
    window([sample(0), sample(1000, { available: false })]).status,
    'unknown',
  );
  assert.equal(
    window([sample(0), sample(1000, { listeners: 1 })]).status,
    'blocked',
  );
  assert.equal(
    window([sample(0), sample(1000)], { now_ms: 15001 }).status,
    'unknown',
  );
  assert.equal(
    window([sample(0), sample(1000)], { now_ms: 1001 }).reason,
    'STALE_LAST_SAMPLE',
  );
  assert.equal(window([sample(14000), sample(15000)]).status, 'pass');
});
test('SH01 can observe ordinary shutdown activity then stopped pair, but no deadline extension', () => {
  const kind = 'SH-01';
  assert.equal(
    window([sample(0, { postgres_processes: 1 }), sample(1000), sample(2000)], {
      kind,
    }).status,
    'pass',
  );
  assert.equal(
    window([sample(0), sample(1000, { available: false }), sample(2000)], {
      kind,
    }).status,
    'unknown',
  );
  assert.equal(window([sample(89000), sample(90000)], { kind }).status, 'pass');
  assert.equal(window([sample(90000)], { kind }).status, 'unknown');
  assert.equal(
    window([sample(89001), sample(90001)], { kind }).reason,
    'DEADLINE_EXCEEDED',
  );
  assert.equal(
    window([sample(0), sample(1000), sample(2000, { desktop_processes: 1 })], {
      kind,
    }).status,
    'pending',
  );
});
test('launch/unknown launch during sampling blocks, independent of stopped counts', () => {
  for (const kind of ['PR-01', 'SH-01'])
    for (const launch_during_sampling of [true, undefined])
      assert.equal(
        window([sample(0), sample(1000, { launch_during_sampling })], { kind })
          .status,
        'blocked',
      );
});
test('malformed and reordered windows are redacted unknown results', () => {
  const sentinel = 'SENTINEL_PRIVATE_CODE';
  for (const value of [
    null,
    { kind: sentinel },
    { kind: 'PR-01', start_ms: 0, now_ms: 0, samples: sentinel },
  ]) {
    const result = classifyWindow(value);
    assert.equal(result.status, 'unknown');
    assert.doesNotMatch(JSON.stringify(result), /SENTINEL/);
  }
  assert.equal(window([sample(1000), sample(0)]).status, 'unknown');
  assert.equal(window([sample(-1)]).status, 'unknown');
});
test('unknown injected fields and error payloads never appear in outputs', () => {
  const extra = {
    password: 'SENTINEL',
    cookie: 'SENTINEL',
    command_line: 'SENTINEL',
    raw_error: 'SENTINEL',
  };
  for (const value of [
    classifySample(sample(0, extra)),
    window([sample(0, extra), sample(1000, extra)]),
    key('C:\\Local', extra),
  ]) {
    assert.equal(value.fixture, true);
    assert.doesNotMatch(
      JSON.stringify(value),
      /SENTINEL|password|cookie|command_line|raw_error/,
    );
  }
});

test('M1 explicit launch wins over incomplete sample and every earlier rejection (P1a,P1c-P1g)', () => {
  const launch = sample(1000, {
    launch_during_sampling: true,
    available: false,
  });
  assert.equal(classifySample(launch).reason, 'LAUNCH_DURING_SAMPLING');
  assert.equal(
    classifySample({ launch_during_sampling: true }).status,
    'incident',
  );
  const cases = [
    { samples: [sample(0, { available: false }), launch] },
    { samples: [sample(0), launch], now_ms: 15001 },
    { samples: [sample(0), { ...launch, at_ms: 999 }] },
    { samples: [sample(0, { listeners: 1 }), launch] },
    {
      samples: [
        ...Array.from({ length: 17 }, (_, i) => sample(i * 1000)),
        { ...launch, at_ms: 17000 },
      ],
      now_ms: 17000,
    },
    { samples: [sample(0, { binding_sha256: 'bad' }), launch] },
    { samples: [sample(0), launch], kind: 'invalid', start_ms: -1 },
    { samples: [launch], handles_closed: false, planned_quit: false },
  ];
  for (const extra of cases) {
    const result = window(extra.samples, extra);
    assert.deepEqual(result, {
      fixture: true,
      status: 'blocked',
      reason: 'LAUNCH_DURING_SAMPLING',
    });
  }
  assert.equal(
    classifyWindow({ launch_during_sampling: true }).reason,
    'LAUNCH_DURING_SAMPLING',
  );
});
test('M2 SH01 requires recorded running, planned Quit, and exact request origin (P3)', () => {
  const samples = [sample(0), sample(1000)];
  const plain = {
    kind: 'SH-01',
    start_ms: 0,
    now_ms: 1000,
    samples,
    launch_during_sampling: false,
    handles_closed: true,
  };
  assert.equal(classifyWindow(plain).reason, 'PLANNED_QUIT_NOT_ESTABLISHED');
  assert.equal(window(samples, { kind: 'SH-01' }).status, 'pass');
  for (const extra of [
    { running_state_recorded: false },
    { running_state_recorded: undefined },
    { planned_quit: false },
    { planned_quit: undefined },
    { quit_request_ms: undefined },
    { quit_request_ms: 1 },
    { quit_request_ms: '0' },
  ])
    assert.equal(
      window(samples, { kind: 'SH-01', ...extra }).reason,
      'PLANNED_QUIT_NOT_ESTABLISHED',
    );
  assert.equal(
    window([sample(200), sample(1200)], {
      kind: 'SH-01',
      start_ms: 200,
      quit_request_ms: 200,
    }).status,
    'pass',
  );
});
test('M3 contradictory postgres observation invalidates either whole window, never ordinary activity (P2)', () => {
  const contradiction = sample(0, { pg_ctl_status: 0, postgres_processes: 0 });
  assert.equal(classifySample(contradiction).status, 'contradiction');
  for (const kind of ['PR-01', 'SH-01']) {
    for (const samples of [
      [contradiction, sample(1000), sample(2000)],
      [
        sample(0, { listeners: 1 }),
        { ...contradiction, at_ms: 1000 },
        sample(2000),
        sample(3000),
      ],
      [
        sample(0, { available: false }),
        { ...contradiction, at_ms: 1000 },
        sample(2000),
      ],
    ])
      assert.equal(
        window(samples, { kind }).reason,
        'CONTRADICTORY_POSTGRES_OBSERVATION',
      );
  }
  assert.equal(
    window(
      [
        sample(0, { pg_ctl_status: 0, postgres_processes: 1 }),
        sample(1000),
        sample(2000),
      ],
      { kind: 'SH-01' },
    ).status,
    'pass',
  );
  assert.equal(
    window([contradiction, sample(1000, { launch_during_sampling: true })])
      .reason,
    'LAUNCH_DURING_SAMPLING',
  );
});
test('L2 native-refused OneDrive components are unavailable (P4)', () => {
  for (const local of [
    'C:\\Users\\x\\OneDrive\\Local',
    'C:\\ONEDRIVE-work\\Local',
    'C:\\Users\\x\\onedrivePersonal',
  ])
    assert.equal(key(local).status, 'unavailable');
  assert.equal(key('C:\\Users\\x\\MyOneDrive\\Local').status, 'bound');
});
test('L3 window attestation covers intervals and post-final handle closure', () => {
  const samples = [sample(0), sample(1000)];
  for (const launch_during_sampling of [true, undefined, 'unknown'])
    assert.equal(window(samples, { launch_during_sampling }).status, 'blocked');
  for (const handles_closed of [false, undefined, 'true'])
    assert.equal(
      window(samples, { handles_closed }).reason,
      'HANDLES_NOT_CONFIRMED_CLOSED',
    );
  assert.equal(
    window(samples, { handles_closed: false, launch_during_sampling: true })
      .reason,
    'LAUNCH_DURING_SAMPLING',
  );
});
