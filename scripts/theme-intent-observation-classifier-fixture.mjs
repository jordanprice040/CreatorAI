// Pure fixture classification only. No OS observation, clock, I/O or authority is supplied here.
import { createHash } from 'node:crypto';
const fixture = (status, reason) => ({ fixture: true, status, reason });
export function desktopKey(attestation) {
  if (
    !attestation ||
    attestation.override_unset !== true ||
    attestation.launch_paths_confirmed !== true
  )
    return fixture('unavailable', 'UNATTESTED_KEY');
  const local = attestation.localappdata_exact;
  if (
    typeof local !== 'string' ||
    local.length > 512 ||
    !/^[A-Za-z]:\\/.test(local) ||
    /[^\x20-\x7e]/.test(local) ||
    local.includes('/') ||
    /[:<>"|?*]/.test(local.slice(2))
  )
    return fixture('unavailable', 'UNADMITTED_KEY');
  const body = local.endsWith('\\') ? local.slice(0, -1) : local;
  const parts = body.slice(3).split('\\');
  if (parts.some((p) => !p || p === '.' || p === '..'))
    return fixture('unavailable', 'UNADMITTED_KEY');
  const root =
    local + (local.endsWith('\\') ? '' : '\\') + 'com.creatoragent.studio';
  return {
    fixture: true,
    status: 'bound',
    key16: createHash('sha256')
      .update(root.toLowerCase(), 'utf8')
      .digest('hex')
      .slice(0, 16),
  };
}
export function mapOpenResult(keyBound, code) {
  if (keyBound !== true) return 'unavailable';
  return code === 0 ? 'present' : code === 2 ? 'absent' : 'unavailable';
}
// code is the type-agnostic existence query status; no registry data/type is consumed.
export function mapRunValueResult(code) {
  return code === 0 ? 'present' : code === 2 ? 'absent' : 'unavailable';
}
const countFields = [
  'listeners',
  'desktop_processes',
  'service_processes',
  'postgres_processes',
  'leases',
  'helper_mutexes',
  'desktop_mutexes',
  'desktop_events',
];
const attestFields = [
  'identity_matches',
  'scope_bound',
  'active_home_attested',
  'continuity_attested',
  'other_producers_idle',
  'key_bound',
];
const safeTime = (v) => Number.isSafeInteger(v) && v >= 0;
export function classifySample(sample) {
  if (
    !sample ||
    sample.available !== true ||
    !safeTime(sample.at_ms) ||
    typeof sample.binding_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(sample.binding_sha256)
  )
    return fixture('unavailable', 'INCOMPLETE_OBSERVATION');
  if (sample.launch_during_sampling !== false)
    return fixture('incident', 'LAUNCH_NOT_EXCLUDED');
  if (!attestFields.every((name) => sample[name] === true))
    return fixture('unavailable', 'BINDING_OR_ATTESTATION_MISSING');
  if (
    !['absent', 'present'].includes(sample.run_value) ||
    sample.run_history_reconciled !== true
  )
    return fixture('unavailable', 'CONTINUITY_UNRESOLVED');
  if (
    !countFields.every(
      (name) => Number.isSafeInteger(sample[name]) && sample[name] >= 0,
    ) ||
    ![0, 3].includes(sample.pg_ctl_status)
  )
    return fixture('unavailable', 'UNAVAILABLE_OS_RESULT');
  if (
    sample.pg_ctl_status !== 3 ||
    countFields.some((name) => sample[name] > 0)
  )
    return fixture('activity', 'NOT_STOPPED');
  return fixture('stopped', 'COMPLETE_STOPPED_SAMPLE');
}
export function classifyWindow(input) {
  if (
    !input ||
    !['PR-01', 'SH-01'].includes(input.kind) ||
    !safeTime(input.start_ms) ||
    !safeTime(input.now_ms) ||
    input.now_ms < input.start_ms ||
    !Array.isArray(input.samples) ||
    input.samples.length > (input.kind === 'PR-01' ? 16 : 91)
  )
    return fixture('unknown', 'INVALID_WINDOW');
  const bound = input.kind === 'PR-01' ? 15000 : 90000;
  const elapsed = input.now_ms - input.start_ms;
  if (elapsed > bound) return fixture('unknown', 'DEADLINE_EXCEEDED');
  let previous = null;
  let stopped = 0;
  for (const sample of input.samples) {
    if (
      !sample ||
      !safeTime(sample.at_ms) ||
      sample.at_ms < input.start_ms ||
      sample.at_ms > input.now_ms ||
      (previous &&
        (sample.at_ms - previous.at_ms < 1000 ||
          sample.binding_sha256 !== previous.binding_sha256))
    )
      return fixture('unknown', 'UNSTABLE_OR_INVALID_SEQUENCE');
    const result = classifySample(sample);
    if (result.status === 'incident')
      return fixture('blocked', 'LAUNCH_DURING_SAMPLING');
    if (result.status === 'unavailable')
      return fixture('unknown', 'INCOMPLETE_OBSERVATION');
    if (result.status === 'activity' && input.kind === 'PR-01')
      return fixture('blocked', 'PRELAUNCH_ACTIVITY');
    stopped = result.status === 'stopped' ? stopped + 1 : 0;
    previous = sample;
  }
  if (previous && previous.at_ms !== input.now_ms)
    return fixture('unknown', 'STALE_LAST_SAMPLE');
  // Use only the final consecutive pair; a later active/restarted sample invalidates a prior pair.
  if (stopped >= 2) return fixture('pass', 'TWO_CONSECUTIVE_STOPPED_SAMPLES');
  return elapsed >= bound
    ? fixture('unknown', 'DEADLINE_WITHOUT_STOPPED_PAIR')
    : fixture('pending', 'AWAIT_STOPPED_PAIR');
}
