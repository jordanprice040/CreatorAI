import fs from 'node:fs';
import { classifyWindow as v3 } from '../../../scripts/theme-intent-observation-classifier-fixture-v3.mjs';
import { classifyWindow as v4 } from '../../../scripts/theme-intent-observation-classifier-fixture-v4.mjs';
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

const input = {
  kind: 'PR-01',
  launch_during_sampling: false,
  handles_closed: true,
  start_ms: 0,
  now_ms: 1000,
  samples: [sample(0), sample(1000, { launch_during_sampling: undefined })],
};
const result = {
  fixture: true,
  case: 'U7 missing closed_ms plus otherwise available uncertain sample',
  v3: v3(input),
  v4: v4(input),
};
fs.writeFileSync(
  new URL('./baseline-probes.json', import.meta.url),
  JSON.stringify(result, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(result));
