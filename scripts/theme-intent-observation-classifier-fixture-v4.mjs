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
  if (
    parts.some(
      (p) =>
        !p || p === '.' || p === '..' || p.toLowerCase().startsWith('onedrive'),
    )
  )
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
const sampleCounts = (sample) => [
  sample.listeners,
  sample.desktop_processes,
  sample.service_processes,
  sample.postgres_processes,
  sample.leases,
  sample.helper_mutexes,
  sample.desktop_mutexes,
  sample.desktop_events,
];
const attestationsOk = (sample) =>
  sample.identity_matches === true &&
  sample.scope_bound === true &&
  sample.active_home_attested === true &&
  sample.continuity_attested === true &&
  sample.other_producers_idle === true &&
  sample.key_bound === true;
const safeTime = (v) => Number.isSafeInteger(v) && v >= 0;
const explicitLaunch = (sample) => sample?.launch_during_sampling === true;
const contradictory = (sample) =>
  sample?.pg_ctl_status === 0 && sample?.postgres_processes === 0;
export function classifySample(sample) {
  // Incident identity must survive unavailable or malformed observation metadata.
  if (explicitLaunch(sample))
    return fixture('incident', 'LAUNCH_DURING_SAMPLING');
  if (contradictory(sample))
    return fixture('contradiction', 'CONTRADICTORY_POSTGRES_OBSERVATION');
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
  if (!attestationsOk(sample))
    return fixture('unavailable', 'BINDING_OR_ATTESTATION_MISSING');
  if (
    !['absent', 'present'].includes(sample.run_value) ||
    sample.run_history_reconciled !== true
  )
    return fixture('unavailable', 'CONTINUITY_UNRESOLVED');
  if (
    !sampleCounts(sample).every(
      (count) => Number.isSafeInteger(count) && count >= 0,
    ) ||
    ![0, 3].includes(sample.pg_ctl_status)
  )
    return fixture('unavailable', 'UNAVAILABLE_OS_RESULT');
  if (
    sample.pg_ctl_status !== 3 ||
    sampleCounts(sample).some((count) => count > 0)
  )
    return fixture('activity', 'NOT_STOPPED');
  return fixture('stopped', 'COMPLETE_STOPPED_SAMPLE');
}
export function classifyWindow(input) {
  // Scan ALL supplied samples before any early return, including over-cap sequences.
  if (
    explicitLaunch(input) ||
    (Array.isArray(input?.samples) && input.samples.some(explicitLaunch))
  )
    return fixture('blocked', 'LAUNCH_DURING_SAMPLING');
  if (
    input !== null &&
    typeof input === 'object' &&
    input.launch_during_sampling !== false
  )
    return fixture('blocked', 'LAUNCH_NOT_EXCLUDED');
  // Preserve the sample classifier's availability split and uncertainty reason.
  if (
    Array.isArray(input?.samples) &&
    input.samples.some(
      (sample) => classifySample(sample).reason === 'LAUNCH_NOT_EXCLUDED',
    )
  )
    return fixture('blocked', 'LAUNCH_NOT_EXCLUDED');
  // Once stopped has been observed, any later non-stopped observation invalidates SH-01.
  if (input?.kind === 'SH-01' && Array.isArray(input.samples)) {
    let seenStopped = false;
    for (const sample of input.samples) {
      const status = classifySample(sample).status;
      if (seenStopped && status !== 'stopped')
        return fixture('blocked', 'RESTART_AFTER_STOPPED_SAMPLE');
      if (status === 'stopped') seenStopped = true;
    }
  }
  if (Array.isArray(input?.samples) && input.samples.some(contradictory))
    return fixture('unknown', 'CONTRADICTORY_POSTGRES_OBSERVATION');
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
  if (
    !safeTime(input.closed_ms) ||
    input.closed_ms !== input.now_ms ||
    input.closed_ms < input.start_ms
  )
    return fixture('unknown', 'INVALID_CLOSURE_TIMING');
  if (input.handles_closed !== true)
    return fixture('unknown', 'HANDLES_NOT_CONFIRMED_CLOSED');
  if (
    input.kind === 'SH-01' &&
    (input.running_state_recorded !== true ||
      input.planned_quit !== true ||
      !safeTime(input.quit_request_ms) ||
      input.quit_request_ms !== input.start_ms)
  )
    return fixture('unknown', 'PLANNED_QUIT_NOT_ESTABLISHED');
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
    if (result.status === 'incident') return fixture('blocked', result.reason);
    if (result.status === 'unavailable')
      return fixture('unknown', 'INCOMPLETE_OBSERVATION');
    if (result.status === 'activity' && input.kind === 'PR-01')
      return fixture('blocked', 'PRELAUNCH_ACTIVITY');
    stopped = result.status === 'stopped' ? stopped + 1 : 0;
    previous = sample;
  }
  if (previous && previous.at_ms > input.closed_ms)
    return fixture('unknown', 'INVALID_CLOSURE_TIMING');
  // SH-01 restart has already been excluded; all at_ms values are query-start times.
  if (stopped >= 2) return fixture('pass', 'TWO_CONSECUTIVE_STOPPED_SAMPLES');
  return elapsed >= bound
    ? fixture('unknown', 'DEADLINE_WITHOUT_STOPPED_PAIR')
    : fixture('pending', 'AWAIT_STOPPED_PAIR');
}
