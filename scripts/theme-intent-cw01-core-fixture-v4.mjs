// CW-01 fixture-only admission/lifecycle core, version 4 (repairs v3 re-review
// L-1 on top of the v2 F1-F3 and v3 R-1 to R-3 repairs). Pure: no file, clock,
// environment, registry, process, port, SQL or credential access. Every input is
// injected fixture evidence; no result can become an operational receipt or
// authorize start, stop, SQL, credentials or native acceptance. Versions 1 to 3
// (scripts/theme-intent-cw01-core-fixture.mjs, -v2.mjs, -v3.mjs) are preserved.
import { createHash } from 'node:crypto';

export const SQL_ASSET = Object.freeze({
  path: 'scripts/theme-intent-cw01-observer-sql-v2.sql',
  version: 'cw01-observer-sql/2',
  sha256: '074561c3e36d655888aed442664f6419d817a5d5ea48116eb2714381339f89b2',
});
export const CORE_VERSION = 'cw01-fixture-core/4';
export const RECEIPT_FORMAT = 'theme-intent-cw01-fixture-receipt/4';
const PRIOR_RECEIPT_FORMATS = [
  'theme-intent-cw01-fixture-receipt/1',
  'theme-intent-cw01-fixture-receipt/2',
  'theme-intent-cw01-fixture-receipt/3',
];
// Freshness is measured to the measured spawn, not to caller intent times (F2):
// every pre-spawn observation (preflight, job context, AutoRun) is at most 15 s
// older than pg_ctl's creation; B and the pre-stop revalidation are at most 5 s
// older than the stop pg_ctl's creation. The owner attestation is at most 120 s
// older than pg_ctl's creation (R-1; this repair's choice, for Jordan to confirm).
export const LIMITS = Object.freeze({
  autorun_max_age_ms: 15000,
  prespawn_max_age_ms: 15000,
  attestation_max_age_ms: 120000,
  prestop_max_age_ms: 5000,
  pg_ctl_timeout_s: 80,
  outer_deadline_ms: 90000,
  sql_total_ms: 30000,
  pidfile_max_bytes: 16384,
});
export const TERMINAL = Object.freeze([
  'blocked',
  'start_unknown',
  'ownership_unavailable',
  'invalid_producer_observed',
  'sql_unknown',
  'stop_unknown',
  'W2_reference_recorded',
]);
// Separate grants each later scope needs; naming them here grants nothing.
export const LATER_SCOPES = Object.freeze([
  'registry_autorun_existence_read',
  'w1_pidfile_read',
  'process_metadata',
  'protected_credential',
  'sql_observer',
  'cluster_start',
  'cluster_stop',
]);
const BINDINGS = [
  'cluster_dir',
  'port',
  'database',
  'observer_actor',
  'pg_ctl_image_sha256',
  'postgres_image_sha256',
  'cmd_image',
  'working_dir',
  'log_path',
  'startup_boundary_sha256',
  'background_allowlist',
  'relation_fingerprint_sha256',
  'credential_mechanism',
  'grants',
  'adapter_reviews',
];
const GRANTS = LATER_SCOPES;
const REVIEWS = [
  'process_metadata_adapter',
  'pidfile_adapter',
  'registry_adapter',
  'collector_L1_L4',
  'reader_N1_N4',
];
const WORK = [
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
];
const AUTORUN_KEY = 'Software\\Microsoft\\Command Processor';
const FORBIDDEN = new Set([
  'retry_start',
  'retry_stop',
  'second_stop',
  'stop_fast',
  'stop_immediate',
  'kill',
  'terminate_backend',
  'adopt',
  'reconnect',
  'extend_deadline',
  'cleanup',
  'escalate',
]);
const HEX64 = /^[a-f0-9]{64}$/;
const COUNT = /^(0|[1-9][0-9]{0,9})$/;
const isCount = (v) => typeof v === 'string' && COUNT.test(v);
const FT_UNIX_EPOCH = 116444736000000000n;

const pass = (extra = {}) => ({ ok: true, ...extra });
const fail = (code, to) => ({ ok: false, code, ...(to ? { to } : {}) });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const safeTime = (v) => Number.isSafeInteger(v) && v >= 0;
const posInt = (v) => Number.isSafeInteger(v) && v > 0;
const text = (v) => typeof v === 'string' && v.trim().length > 0;
function filetime(v) {
  return typeof v === 'string' && /^[0-9]{1,20}$/.test(v) ? BigInt(v) : null;
}
const ftMs = (ft) => Number((ft - FT_UNIX_EPOCH) / 10000n);

function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (isObj(v))
    return (
      '{' +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(v[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(v === undefined ? null : v);
}
export const digest = (v) =>
  createHash('sha256').update(canonical(v), 'utf8').digest('hex');

// N4: one approved drive-rooted spelling plus the CMD-safe subset (L1). Bad
// spellings are refused, never normalized into a match.
export function admitPathSpelling(p) {
  if (typeof p !== 'string' || p.length < 4 || p.length > 259)
    return fail('PATH_UNADMITTED');
  if (!/^[A-Za-z]:\\/.test(p)) return fail('PATH_NOT_DRIVE_ROOTED');
  if (/[\x00-\x1f\x7f]/.test(p)) return fail('PATH_CONTROL_CHARACTER');
  if (/["%^&|<>!()]/.test(p)) return fail('PATH_CMD_METACHARACTER');
  if (p.includes('/') || /[*?]/.test(p) || p.slice(2).includes(':'))
    return fail('PATH_UNSUPPORTED_SPELLING');
  for (const seg of p.slice(3).split('\\')) {
    if (seg === '' || seg === '.' || seg === '..')
      return fail('PATH_DOT_OR_EMPTY_SEGMENT');
    if (/[. ]$/.test(seg)) return fail('PATH_TRAILING_DOT_OR_SPACE');
    if (
      /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i.test(
        seg,
      )
    )
      return fail('PATH_RESERVED_DEVICE');
    if (/~[0-9]/.test(seg)) return fail('PATH_SHORT_NAME_ALIAS');
  }
  return pass();
}
const sameSpelling = (a, b) =>
  admitPathSpelling(a).ok && admitPathSpelling(b).ok && a === b;

// Evidence must be measured by the bound fixture adapter for this manifest and
// SQL asset. A model-supplied assertion is never accepted as a measurement.
function measured(e, ctx) {
  if (!isObj(e)) return fail('EVIDENCE_MISSING');
  if (e.provenance !== 'fixture_measurement')
    return fail('ASSERTION_NOT_MEASURED');
  if (e.fixture !== true) return fail('UNLABELED_EVIDENCE');
  if (e.adapter_sha256 !== ctx.fixture_adapter_sha256)
    return fail('ADAPTER_NOT_BOUND');
  if (e.manifest_sha256 !== ctx.manifest_sha256)
    return fail('VERSION_BINDING_CHANGED');
  return pass();
}

export function admitRequest(request) {
  const out = (status, blockers) => ({ fixture: true, status, blockers });
  if (!isObj(request)) return out('blocked', ['REQUEST_MISSING']);
  if (request.mode === 'operational')
    // Operational adapters, bindings and grants do not exist in this milestone.
    return out('blocked', ['OPERATIONAL_ADAPTERS_UNIMPLEMENTED']);
  if (request.mode !== 'fixture') return out('blocked', ['INVALID_MODE']);
  const blockers = [];
  if (
    typeof request.request_id !== 'string' ||
    !/^[A-Za-z0-9._-]{8,64}$/.test(request.request_id)
  )
    blockers.push('REQUEST_ID_INVALID');
  for (const k of [
    'manifest_sha256',
    'inspector_sha256',
    'fixture_adapter_sha256',
  ])
    if (!HEX64.test(request[k] ?? '')) blockers.push('HASH_INVALID:' + k);
  if (
    !isObj(request.sql_asset) ||
    request.sql_asset.version !== SQL_ASSET.version ||
    request.sql_asset.sha256 !== SQL_ASSET.sha256
  )
    blockers.push('SQL_ASSET_MISMATCH');
  const b = isObj(request.bindings) ? request.bindings : {};
  for (const k of BINDINGS) {
    const v = b[k];
    if (v === undefined || v === null || v === 'pending')
      blockers.push('BINDING_MISSING:' + k);
    else if (!isObj(v) || v.fixture !== true)
      blockers.push('BINDING_NOT_FIXTURE_LABELED:' + k);
  }
  if (blockers.some((x) => x.startsWith('BINDING_')))
    return out('blocked', blockers);
  for (const k of ['cluster_dir', 'working_dir', 'log_path'])
    if (!admitPathSpelling(b[k].value).ok)
      blockers.push('BINDING_PATH_UNADMITTED:' + k);
  if (
    !admitPathSpelling(b.cmd_image.path).ok ||
    !HEX64.test(b.cmd_image.sha256 ?? '')
  )
    blockers.push('BINDING_PATH_UNADMITTED:cmd_image');
  if (b.cmd_image.view !== 'system32') blockers.push('UNBOUND_REGISTRY_VIEW');
  if (
    !Number.isSafeInteger(b.port.value) ||
    b.port.value < 1 ||
    b.port.value > 65535
  )
    blockers.push('BINDING_PORT_INVALID');
  for (const k of [
    'pg_ctl_image_sha256',
    'postgres_image_sha256',
    'startup_boundary_sha256',
    'relation_fingerprint_sha256',
  ])
    if (!HEX64.test(b[k].value ?? ''))
      blockers.push('BINDING_HASH_INVALID:' + k);
  for (const k of ['database', 'observer_actor', 'credential_mechanism'])
    if (!text(b[k].value)) blockers.push('BINDING_VALUE_MISSING:' + k);
  const allow = b.background_allowlist.types;
  if (
    !isObj(allow) ||
    Object.values(allow).some(
      (r) =>
        !isObj(r) ||
        !Number.isSafeInteger(r.min) ||
        !Number.isSafeInteger(r.max) ||
        r.min < 0 ||
        r.max < r.min ||
        r.writes_storage_reviewed !== true,
    )
  )
    blockers.push('BACKGROUND_ALLOWLIST_UNBOUND');
  for (const g of GRANTS)
    if (
      !isObj(b.grants[g]) ||
      b.grants[g].fixture !== true ||
      !text(b.grants[g].id)
    )
      blockers.push('GRANT_MISSING:' + g);
  for (const r of REVIEWS)
    if (b.adapter_reviews[r] !== 'fixture_stub')
      blockers.push('ADAPTER_REVIEW_MISSING:' + r);
  return out(blockers.length ? 'blocked' : 'admitted', blockers);
}

// R1: fresh, exact-scope, existence-only AutoRun observations for HKLM and HKCU.
export function checkAutoRun(observations, ctx) {
  if (ctx.request.bindings.cmd_image.view !== 'system32')
    return fail('UNBOUND_REGISTRY_VIEW');
  if (!Array.isArray(observations) || observations.length !== 2)
    return fail('AUTORUN_UNKNOWN');
  const seen = new Set();
  for (const o of observations) {
    const m = measured(o, ctx);
    if (!m.ok) return m;
    if (!['HKLM', 'HKCU'].includes(o.hive) || seen.has(o.hive))
      return fail('AUTORUN_SCOPE_AMBIGUOUS');
    seen.add(o.hive);
    if (o.key !== AUTORUN_KEY || o.value !== 'AutoRun')
      return fail('AUTORUN_WRONG_SCOPE');
    if (o.view !== '64') return fail('WRONG_REGISTRY_VIEW');
    if (o.existence_only !== true || 'data' in o || 'value_text' in o)
      return fail('AUTORUN_NOT_EXISTENCE_ONLY');
    if (o.result === 'present') return fail('AUTORUN_PRESENT');
    if (o.result === 'unavailable') return fail('AUTORUN_UNAVAILABLE');
    // Missing evidence is never read as absence.
    if (o.result !== 'absent') return fail('AUTORUN_UNKNOWN');
    if (
      !safeTime(o.observed_at_ms) ||
      o.observed_at_ms < ctx.admitted_at_ms ||
      o.observed_at_ms > ctx.start_intent_at_ms ||
      ctx.start_intent_at_ms - o.observed_at_ms > LIMITS.autorun_max_age_ms
    )
      return fail('AUTORUN_STALE');
  }
  return pass({
    later_registry_inspection_requires_own_grant: true,
    oldest_observed_at_ms: Math.min(
      ...observations.map((o) => o.observed_at_ms),
    ),
  });
}

// I1: conservative nested-job refusal; start only outside any job.
export function checkJobContext(job, ctx) {
  const m = measured(job, ctx);
  if (!m.ok) return m;
  if (job.in_job === true) return fail('NESTED_JOB_REFUSED');
  if (job.in_job !== false) return fail('JOB_CONTEXT_UNKNOWN');
  if (
    !safeTime(job.observed_at_ms) ||
    job.observed_at_ms < ctx.admitted_at_ms ||
    job.observed_at_ms > ctx.start_intent_at_ms
  )
    return fail('JOB_CONTEXT_STALE');
  return pass();
}

// Six-item W1-W3 undertaking: explicit, fresh, never prefilled or inferred.
export function checkAttestation(att, ctx) {
  if (!isObj(att)) return fail('ATTESTATION_MISSING');
  const m = measured({ ...att, provenance: 'fixture_measurement' }, ctx);
  if (!m.ok) return m;
  if (att.provenance !== 'owner_affirmation')
    return fail('ATTESTATION_NOT_OWNER');
  if ('prefilled_from' in att || 'copied_from' in att)
    return fail('ATTESTATION_COPIED');
  if (
    !text(att.operator_ref) ||
    att.scope !== 'W1-W3' ||
    att.inspector_sha256 !== ctx.request.inspector_sha256 ||
    att.request_id !== ctx.request.request_id
  )
    return fail('ATTESTATION_SCOPE_MISMATCH');
  if (
    !safeTime(att.affirmed_at_ms) ||
    att.affirmed_at_ms < ctx.admitted_at_ms ||
    att.affirmed_at_ms > ctx.start_intent_at_ms
  )
    return fail('ATTESTATION_NOT_FRESH');
  const items = Array.isArray(att.items) ? att.items : [];
  for (let i = 1; i <= 6; i++) {
    const it = items.find((x) => isObj(x) && x.item === i);
    if (
      !it ||
      it.affirmed !== true ||
      !text(it.basis) ||
      !text(it.source) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(it.date ?? '') ||
      typeof it.uncertainty !== 'string'
    )
      return fail('ATTESTATION_INCOMPLETE');
  }
  if (items.length !== 6) return fail('ATTESTATION_INCOMPLETE');
  return pass({ ceiling: 'W1_W2_supported_W3_pending' });
}

// W1-only bounded pidfile layout (REL_18_6 pidfile.h; Windows line 7 empty).
export function validatePidfile(pf, ctx) {
  const m = measured(pf, ctx);
  if (!m.ok) return m;
  if (
    pf.stable !== true ||
    pf.single_link !== true ||
    pf.reparse_free !== true ||
    !safeTime(pf.size_bytes) ||
    pf.size_bytes > LIMITS.pidfile_max_bytes
  )
    return fail('PIDFILE_UNSTABLE_OR_UNSAFE');
  const l = pf.lines;
  if (
    !Array.isArray(l) ||
    l.length !== 8 ||
    l.some((x) => typeof x !== 'string')
  )
    return fail('PIDFILE_MALFORMED');
  if (/^-[0-9]+$/.test(l[0])) return fail('STANDALONE_BACKEND_PID');
  if (!/^[1-9][0-9]{0,9}$/.test(l[0])) return fail('PIDFILE_MALFORMED');
  if (!sameSpelling(l[1], ctx.request.bindings.cluster_dir.value))
    return fail('PIDFILE_DIRECTORY_MISMATCH');
  if (!/^[0-9]{1,12}$/.test(l[2])) return fail('PIDFILE_MALFORMED');
  if (l[3] !== String(ctx.request.bindings.port.value))
    return fail('PIDFILE_PORT_MISMATCH');
  if (l[4] !== '') return fail('PIDFILE_SOCKET_PRESENT');
  if (l[5] !== '127.0.0.1') return fail('PIDFILE_LISTENER_MISMATCH');
  if (l[6] !== '') return fail('PIDFILE_LINE7_NOT_EMPTY');
  if (l[7] === 'standby ') return fail('PIDFILE_STANDBY');
  if (l[7] !== 'ready   ') return fail('PIDFILE_NOT_READY');
  return pass({ pid: Number(l[0]), start_s: Number(l[2]) });
}

// R2: upward walk from the pidfile PID through handle-bound instances, with
// GetProcessTimes containment instead of assumed PID non-reuse.
export function checkProcessChain(chain, ctx) {
  const m = measured(chain, ctx);
  if (!m.ok) return m;
  if (chain.walk !== 'upward_from_pidfile')
    return fail('CHAIN_NOT_UPWARD_WALK');
  const r = chain.records;
  if (
    !Array.isArray(r) ||
    r.length !== 3 ||
    r[0]?.role !== 'postmaster' ||
    r[1]?.role !== 'shell' ||
    r[2]?.role !== 'pg_ctl'
  )
    return fail('CHAIN_SHAPE');
  const [pm, sh, pc] = r;
  for (const x of r)
    if (
      x.handle_bound !== true ||
      !posInt(x.pid) ||
      !posInt(x.parent_pid) ||
      filetime(x.creation_ft) === null ||
      (x.exit_ft !== null && filetime(x.exit_ft) === null)
    )
      return fail('CHAIN_NOT_HANDLE_BOUND');
  const b = ctx.request.bindings;
  if (pm.pid !== ctx.pidfile.pid) return fail('PIDFILE_PID_MISMATCH');
  if (
    pm.image_sha256 !== b.postgres_image_sha256.value ||
    sh.image_sha256 !== b.cmd_image.sha256 ||
    pc.image_sha256 !== b.pg_ctl_image_sha256.value
  )
    return fail('IMAGE_MISMATCH');
  if (pm.parent_pid !== sh.pid || sh.parent_pid !== pc.pid)
    return fail('PARENT_LINK_MISMATCH');
  const launch = ctx.launch;
  if (pc.pid !== launch.pid || pc.creation_ft !== launch.creation_ft)
    return fail('PG_CTL_INSTANCE_MISMATCH');
  const pcStart = filetime(pc.creation_ft);
  const shStart = filetime(sh.creation_ft);
  const pmStart = filetime(pm.creation_ft);
  // pg_ctl -w exited 0, so the launch handle must show that exit, and the chain's
  // pg_ctl record must carry the same exit time (F1).
  const pcExit = filetime(launch.exit_ft);
  if (pcExit === null || pc.exit_ft !== launch.exit_ft || pcExit < pcStart)
    return fail('PG_CTL_INSTANCE_MISMATCH');
  if (shStart < pcStart || shStart > pcExit)
    return fail('SHELL_OUTSIDE_PG_CTL_LIFETIME');
  if (pmStart < shStart) return fail('POSTMASTER_PRECEDES_SHELL');
  // cmd /C waits for postgres; an exited shell is the version probe or a reuse.
  if (sh.exit_ft !== null) return fail('SHELL_NOT_RUNNING');
  if (pm.exit_ft !== null) return fail('POSTMASTER_NOT_RUNNING');
  if (ftMs(pcStart) < ctx.start_intent_at_ms)
    return fail('PG_CTL_BEFORE_INTENT');
  return pass({ postmaster: { pid: pm.pid, creation_ft: pm.creation_ft } });
}

function counts(c, allow, to) {
  if (!isObj(c)) return fail('COUNT_UNAVAILABLE', 'sql_unknown');
  for (const k of ['client', 'walsender', 'null_type'])
    if (!isCount(c[k])) return fail('COUNT_UNAVAILABLE', 'sql_unknown');
  if (c.client !== '0' || c.walsender !== '0')
    return fail('FOREIGN_ACCESS', to);
  if (c.null_type !== '0') return fail('NULL_ACTIVITY_TYPE', to);
  if (c.desktop_adoption !== false) return fail('ADOPTION_OR_UNKNOWN', to);
  if (!Array.isArray(c.background))
    return fail('COUNT_UNAVAILABLE', 'sql_unknown');
  const seen = new Map();
  for (const row of c.background) {
    if (!isObj(row) || !text(row.type) || !isCount(row.n) || seen.has(row.type))
      return fail('COUNT_UNAVAILABLE', 'sql_unknown');
    seen.set(row.type, Number(row.n));
  }
  for (const [type] of seen)
    if (!Object.hasOwn(allow, type)) return fail('UNKNOWN_BACKGROUND_TYPE', to);
  for (const [type, range] of Object.entries(allow)) {
    const n = seen.get(type) ?? 0;
    if (n < range.min || n > range.max)
      return fail('BACKGROUND_OUT_OF_RANGE', to);
  }
  return pass();
}

function sqlCommon(s, ctx) {
  const m = measured(s, ctx);
  if (!m.ok) return { ...m, to: 'ownership_unavailable' };
  if (
    s.sql_asset_version !== SQL_ASSET.version ||
    s.sql_asset_sha256 !== SQL_ASSET.sha256
  )
    return fail('SQL_ASSET_CHANGED', 'ownership_unavailable');
  if (s.deadline_exceeded !== false) return fail('SQL_DEADLINE', 'sql_unknown');
  const r = s.results;
  if (!isObj(r)) return fail('SQL_RESULT_UNAVAILABLE', 'sql_unknown');
  if (r.observer_ok !== true)
    return fail('OBSERVER_INSUFFICIENT', 'ownership_unavailable');
  const i = r.instance;
  if (!isObj(i) || typeof i.in_recovery !== 'boolean')
    return fail('INSTANCE_UNAVAILABLE', 'ownership_unavailable');
  if (i.in_recovery) return fail('IN_RECOVERY', 'ownership_unavailable');
  if (!safeTime(i.server_started_at_ms) || !posInt(i.backend_pid))
    return fail('INSTANCE_UNAVAILABLE', 'ownership_unavailable');
  return pass();
}

// R3: the observer backend's validated parent must be the owned postmaster.
function backendParent(r, ctx) {
  const p = r.backend_parent;
  if (!isObj(p))
    return fail('SQL_PARENT_LINK_MISSING', 'ownership_unavailable');
  const created = filetime(p.backend_creation_ft);
  if (
    p.handle_bound !== true ||
    p.backend_pid !== r.instance.backend_pid ||
    created === null
  )
    return fail('SQL_PARENT_LINK_MISSING', 'ownership_unavailable');
  const pm = ctx.postmaster;
  if (p.parent_pid !== pm.pid || p.parent_creation_ft !== pm.creation_ft)
    return fail('SQL_PARENT_NOT_OWNED_POSTMASTER', 'ownership_unavailable');
  if (created < filetime(pm.creation_ft))
    return fail('SQL_PARENT_PID_REUSE', 'ownership_unavailable');
  return pass();
}

export function checkSqlA(a, ctx) {
  const c = sqlCommon(a, ctx);
  if (!c.ok) return c;
  const r = a.results;
  if (
    !text(a.connection_id) ||
    !text(a.transaction_id) ||
    !safeTime(a.observed_at_ms) ||
    !safeTime(a.connected_at_ms)
  )
    return fail('SQL_RESULT_UNAVAILABLE', 'sql_unknown');
  // The single connection opens after ownership was observed (F2).
  if (
    a.connected_at_ms < ctx.start_observed_at_ms ||
    a.observed_at_ms < a.connected_at_ms
  )
    return fail('TIME_CONTRADICTION', 'ownership_unavailable');
  if (a.observed_at_ms - a.connected_at_ms > LIMITS.sql_total_ms)
    return fail('SQL_TOTAL_EXCEEDED', 'sql_unknown');
  for (const k of [
    'database_ok',
    'address_ok',
    'port_ok',
    'readonly_ok',
    'isolation_ok',
  ])
    if (r[k] !== true)
      return fail('IDENTITY_GATE_FAILED:' + k, 'ownership_unavailable');
  const link = backendParent(r, ctx);
  if (!link.ok) return link;
  // Times are supporting evidence only; contradictions still block.
  const startMs = r.instance.server_started_at_ms;
  const pmMs = ftMs(filetime(ctx.postmaster.creation_ft));
  if (
    ctx.pidfile.start_s * 1000 > startMs ||
    pmMs >= (ctx.pidfile.start_s + 1) * 1000 ||
    startMs > a.observed_at_ms ||
    pmMs < ctx.start_intent_at_ms
  )
    return fail('TIME_CONTRADICTION', 'ownership_unavailable');
  const allow = ctx.request.bindings.background_allowlist.types;
  const act = counts(r.counts, allow, 'invalid_producer_observed');
  if (!act.ok) return act;
  const invalidations = [];
  const sb = r.startup_boundary;
  if (
    !isObj(sb) ||
    !isObj(sb.session_preloads) ||
    !isObj(sb.local_preloads) ||
    sb.session_preloads.scope !== 'observer_session' ||
    sb.local_preloads.scope !== 'observer_session'
  )
    invalidations.push('PRELOAD_NOT_SESSION_LABELED');
  else if (
    sb.shared_preloads !== true ||
    sb.session_preloads.match !== true ||
    sb.local_preloads.match !== true ||
    sb.archive_mode !== true ||
    sb.max_wal_senders !== true
  )
    invalidations.push('STARTUP_BOUNDARY_MISMATCH');
  for (const k of [
    'ledger_match',
    'relation_fingerprint_match',
    'listener_settings_match',
  ])
    if (r[k] !== true) invalidations.push('SCHEMA_OR_SETTINGS_MISMATCH:' + k);
  if (!isObj(r.work)) invalidations.push('WORK_UNAVAILABLE');
  else
    for (const k of WORK)
      if (!isCount(r.work[k])) invalidations.push('WORK_UNAVAILABLE:' + k);
      // A positive count invalidates clearance; it never authorizes a sweep.
      else if (r.work[k] !== '0') invalidations.push('WORK_PRESENT:' + k);
  return pass({ invalidations });
}

export function checkSqlB(b, a, ctx) {
  const c = sqlCommon(b, ctx);
  if (!c.ok) return c;
  if (b.sql_asset_sha256 !== a.sql_asset_sha256)
    return fail('SQL_ASSET_CHANGED', 'ownership_unavailable');
  if (b.connection_id !== a.connection_id)
    return fail('CONNECTION_CHANGED', 'ownership_unavailable');
  if (!text(b.transaction_id) || b.transaction_id === a.transaction_id)
    return fail('B_NOT_NEW_TRANSACTION', 'ownership_unavailable');
  if (
    !safeTime(b.observed_at_ms) ||
    b.observed_at_ms <= a.observed_at_ms ||
    b.sample_id === a.sample_id
  )
    return fail('STALE_B_EVIDENCE', 'ownership_unavailable');
  // A and B share one 30-second SQL phase measured from A's connection (F2).
  if (b.observed_at_ms - a.connected_at_ms > LIMITS.sql_total_ms)
    return fail('SQL_TOTAL_EXCEEDED', 'sql_unknown');
  const r = b.results;
  if (
    r.instance.server_started_at_ms !==
      a.results.instance.server_started_at_ms ||
    r.instance.backend_pid !== a.results.instance.backend_pid
  )
    return fail('INSTANCE_CHANGED', 'ownership_unavailable');
  const link = backendParent(r, ctx);
  if (!link.ok) return link;
  return counts(
    r.counts,
    ctx.request.bindings.background_allowlist.types,
    'invalid_producer_observed',
  );
}

function checkPreflight(e, ctx) {
  const m = measured(e, ctx);
  if (!m.ok) return m;
  if (!safeTime(e.observed_at_ms) || e.observed_at_ms < ctx.admitted_at_ms)
    return fail('PREFLIGHT_TIME_INVALID');
  const zero = ['processes', 'listeners', 'leases'];
  if (
    e.cluster_running === true ||
    e.pidfile === 'present' ||
    zero.some((k) => Number.isSafeInteger(e[k]) && e[k] > 0)
  )
    return fail('PREEXISTING_CLUSTER_NO_ADOPTION');
  if (
    e.cluster_running !== false ||
    e.pidfile !== 'absent' ||
    zero.some((k) => e[k] !== 0)
  )
    return fail('PREFLIGHT_UNAVAILABLE');
  const sig = e.signal_files;
  if (!isObj(sig)) return fail('PREFLIGHT_UNAVAILABLE');
  if (sig.recovery === 'present' || sig.standby === 'present')
    return fail('SIGNAL_FILE_PRESENT');
  if (sig.recovery !== 'absent' || sig.standby !== 'absent')
    return fail('PREFLIGHT_UNAVAILABLE');
  return pass();
}

const deadlineOk = (o) =>
  o.timed_out === false &&
  o.outer_deadline_exceeded === false &&
  o.pg_ctl_timeout_s === LIMITS.pg_ctl_timeout_s;

// Event handlers return { to, code?, ctx?, invalidations? }.
const HANDLERS = {
  admit: {
    from: 'prepared',
    run(e, run) {
      const r = admitRequest(run.request);
      if (r.status !== 'admitted')
        return { to: 'blocked', code: r.blockers.join(',') };
      if (!safeTime(e?.at_ms))
        return { to: 'blocked', code: 'ADMISSION_TIME_INVALID' };
      return { to: 'admitted', ctx: { admitted_at_ms: e.at_ms } };
    },
  },
  preflight: {
    from: 'admitted',
    run(e, run) {
      const r = checkPreflight(e, run.ctx);
      return r.ok
        ? {
            to: 'preflight_stopped',
            ctx: { preflight_observed_at_ms: e.observed_at_ms },
          }
        : { to: 'blocked', code: r.code };
    },
  },
  start_intent: {
    from: 'preflight_stopped',
    run(e, run) {
      if (
        !isObj(e) ||
        !safeTime(e.at_ms) ||
        e.at_ms < run.ctx.admitted_at_ms ||
        e.at_ms < run.ctx.preflight_observed_at_ms
      )
        return { to: 'blocked', code: 'START_INTENT_INVALID' };
      const ctx = { ...run.ctx, start_intent_at_ms: e.at_ms };
      const results = [
        checkAttestation(e.attestation, ctx),
        checkJobContext(e.job, ctx),
        checkAutoRun(e.autorun, ctx),
      ];
      for (const r of results)
        if (!r.ok) return { to: 'blocked', code: r.code };
      return {
        to: 'start_intent',
        ctx: {
          start_intent_at_ms: e.at_ms,
          job_observed_at_ms: e.job.observed_at_ms,
          attestation_affirmed_at_ms: e.attestation.affirmed_at_ms,
          autorun_oldest_at_ms: results[2].oldest_observed_at_ms,
        },
      };
    },
  },
  start_outcome: {
    from: 'start_intent',
    run(e, run) {
      // The outcome and launch handle are measured evidence too (F1): an
      // asserted or unlabeled outcome is unknown, never a pass.
      if (!isObj(e))
        return { to: 'start_unknown', code: 'START_TIMEOUT_OR_UNKNOWN' };
      const m = measured(e, run.ctx);
      if (!m.ok) return { to: 'start_unknown', code: m.code };
      // Exit status alone is never ownership; a late/unknown result is never a pass.
      if (
        !deadlineOk(e) ||
        e.pg_ctl_exit === null ||
        e.pg_ctl_exit === undefined
      )
        return { to: 'start_unknown', code: 'START_TIMEOUT_OR_UNKNOWN' };
      if (e.pg_ctl_exit !== 0)
        return { to: 'start_unknown', code: 'START_NONZERO' };
      const launch = e.launch;
      const created = isObj(launch) ? filetime(launch.creation_ft) : null;
      const exited = isObj(launch) ? filetime(launch.exit_ft) : null;
      if (!posInt(launch?.pid) || created === null || exited === null)
        return { to: 'ownership_unavailable', code: 'LAUNCH_HANDLE_UNBOUND' };
      // F2: the 90-second outer deadline runs from start intent through the
      // ownership observation, measured from the evidence, not a flag alone.
      const spawnMs = ftMs(created);
      if (
        !safeTime(e.observed_at_ms) ||
        e.observed_at_ms < ftMs(exited) ||
        e.observed_at_ms - run.ctx.start_intent_at_ms > LIMITS.outer_deadline_ms
      )
        return { to: 'start_unknown', code: 'OUTER_DEADLINE_EXCEEDED' };
      if (spawnMs < run.ctx.start_intent_at_ms)
        return { to: 'ownership_unavailable', code: 'PG_CTL_BEFORE_INTENT' };
      // F2: pre-spawn observations must be fresh at the measured spawn.
      if (
        spawnMs - run.ctx.autorun_oldest_at_ms > LIMITS.autorun_max_age_ms ||
        spawnMs - run.ctx.job_observed_at_ms > LIMITS.prespawn_max_age_ms ||
        spawnMs - run.ctx.attestation_affirmed_at_ms >
          LIMITS.attestation_max_age_ms ||
        spawnMs - run.ctx.preflight_observed_at_ms > LIMITS.prespawn_max_age_ms
      )
        return { to: 'ownership_unavailable', code: 'PRESPAWN_EVIDENCE_STALE' };
      const pf = validatePidfile(e.pidfile, run.ctx);
      if (!pf.ok) return { to: 'ownership_unavailable', code: pf.code };
      const ctx = { ...run.ctx, pidfile: pf, launch };
      const ch = checkProcessChain(e.chain, ctx);
      if (!ch.ok) return { to: 'ownership_unavailable', code: ch.code };
      return {
        to: 'candidate_process_bound',
        ctx: {
          pidfile: { pid: pf.pid, start_s: pf.start_s },
          launch: { ...launch },
          postmaster: ch.postmaster,
          start_observed_at_ms: e.observed_at_ms,
        },
      };
    },
  },
  sql_A: {
    from: 'candidate_process_bound',
    run(e, run) {
      const r = checkSqlA(e, run.ctx);
      if (!r.ok) return { to: r.to ?? 'ownership_unavailable', code: r.code };
      return {
        to: 'sql_A',
        via: 'owned_running',
        // R-3/L-1: e is already step's deep-frozen copy.
        ctx: { sqlA: e },
        invalidations: r.invalidations,
      };
    },
  },
  sql_B: {
    from: 'sql_A',
    run(e, run) {
      const r = checkSqlB(e, run.ctx.sqlA, run.ctx);
      if (!r.ok) return { to: r.to ?? 'ownership_unavailable', code: r.code };
      return { to: 'sql_B', ctx: { sqlB: e } };
    },
  },
  disconnect: {
    from: 'sql_B',
    run(e, run) {
      const m = measured(e, run.ctx);
      if (!m.ok) return { to: 'ownership_unavailable', code: m.code };
      if (e.our_connection_closed !== true || e.other_backends_terminated !== 0)
        return { to: 'ownership_unavailable', code: 'DISCONNECT_UNVERIFIED' };
      return { to: 'disconnected' };
    },
  },
  stop_intent: {
    from: 'disconnected',
    run(e, run) {
      if (
        !isObj(e) ||
        e.mode !== 'smart' ||
        e.pg_ctl_timeout_s !== LIMITS.pg_ctl_timeout_s
      )
        return { to: 'ownership_unavailable', code: 'ESCALATION_FORBIDDEN' };
      const bMs = run.ctx.sqlB.observed_at_ms;
      if (
        !safeTime(e.at_ms) ||
        e.at_ms < bMs ||
        e.at_ms - bMs > LIMITS.prestop_max_age_ms
      )
        return { to: 'ownership_unavailable', code: 'STALE_PRESTOP_EVIDENCE' };
      const m = measured(e.revalidation, run.ctx);
      if (!m.ok) return { to: 'ownership_unavailable', code: m.code };
      const v = e.revalidation;
      // F2: the revalidation is timed between B and the stop intent.
      if (
        !safeTime(v.observed_at_ms) ||
        v.observed_at_ms < bMs ||
        v.observed_at_ms > e.at_ms
      )
        return { to: 'ownership_unavailable', code: 'STALE_PRESTOP_EVIDENCE' };
      if (
        v.pidfile_stable !== true ||
        v.handle_alive !== true ||
        v.chain_unchanged !== true ||
        v.sql_instance_unchanged !== true ||
        v.postmaster_pid !== run.ctx.postmaster.pid ||
        v.postmaster_creation_ft !== run.ctx.postmaster.creation_ft
      )
        return {
          to: 'ownership_unavailable',
          code: 'OWNERSHIP_REVALIDATION_FAILED',
        };
      return { to: 'stop_intent', ctx: { stop_intent_at_ms: e.at_ms } };
    },
  },
  stop_outcome: {
    from: 'stop_intent',
    run(e, run) {
      if (!isObj(e))
        return { to: 'stop_unknown', code: 'STOP_TIMEOUT_OR_UNKNOWN' };
      // F1: the stop outcome and its launch handle are measured evidence.
      const m = measured(e, run.ctx);
      if (!m.ok) return { to: 'stop_unknown', code: m.code };
      if (!deadlineOk(e) || e.pg_ctl_exit !== 0)
        return { to: 'stop_unknown', code: 'STOP_TIMEOUT_OR_UNKNOWN' };
      // R-2: completion is pg_ctl's handle exit, so the stop launch handle
      // must show an exit at or after its creation, as for start.
      const created = isObj(e.launch) ? filetime(e.launch.creation_ft) : null;
      const exited = isObj(e.launch) ? filetime(e.launch.exit_ft) : null;
      if (
        !posInt(e.launch?.pid) ||
        created === null ||
        exited === null ||
        exited < created
      )
        return { to: 'stop_unknown', code: 'LAUNCH_HANDLE_UNBOUND' };
      // F2: B is at most 5 s older than the measured stop spawn.
      const spawnMs = ftMs(created);
      if (
        spawnMs < run.ctx.stop_intent_at_ms ||
        spawnMs - run.ctx.sqlB.observed_at_ms > LIMITS.prestop_max_age_ms
      )
        return { to: 'stop_unknown', code: 'STALE_PRESTOP_EVIDENCE' };
      const s = e.stopped_observation;
      const sm = measured(s, run.ctx);
      if (!sm.ok) return { to: 'stop_unknown', code: sm.code };
      if (
        !safeTime(s.observed_at_ms) ||
        s.observed_at_ms < ftMs(exited) ||
        s.observed_at_ms - run.ctx.stop_intent_at_ms > LIMITS.outer_deadline_ms
      )
        return { to: 'stop_unknown', code: 'OUTER_DEADLINE_EXCEEDED' };
      if (s.pidfile !== 'absent' || s.processes !== 0 || s.listeners !== 0)
        return { to: 'stop_unknown', code: 'STOPPED_STATE_UNVERIFIED' };
      return { to: 'stopped_verified' };
    },
  },
  w2_reference: {
    from: 'stopped_verified',
    run(e, run) {
      const m = measured(e, run.ctx);
      if (!m.ok) return { to: 'blocked', code: m.code };
      if (
        !HEX64.test(e.reference_sha256 ?? '') ||
        e.stable !== true ||
        e.signal_files?.recovery !== 'absent' ||
        e.signal_files?.standby !== 'absent'
      )
        return { to: 'blocked', code: 'W2_REFERENCE_UNAVAILABLE' };
      return { to: 'W2_reference_recorded' };
    },
  },
  sql_deadline: {
    from: ['candidate_process_bound', 'sql_A', 'sql_B'],
    // Without a timely B and ownership observation there is no stop authority.
    run: () => ({ to: 'sql_unknown', code: 'SQL_DEADLINE' }),
  },
};

function deepFreeze(v) {
  if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
// F3: the run holds a frozen copy of the request, so a caller changing its own
// object after admission cannot change later decisions; its digest is recorded.
function snapshot(request) {
  try {
    return deepFreeze(JSON.parse(JSON.stringify(request)));
  } catch {
    return null;
  }
}

export function newRun(input) {
  const request = isObj(input) ? snapshot(input) : null;
  return Object.freeze({
    fixture: true,
    mode: 'fixture',
    state: 'prepared',
    request,
    request_sha256: digest(request),
    ctx: Object.freeze({
      request,
      manifest_sha256: request?.manifest_sha256,
      fixture_adapter_sha256: request?.fixture_adapter_sha256,
    }),
    invalidations: Object.freeze([]),
    history: Object.freeze([]),
  });
}

function append(run, event, evidence, to, outcome, code) {
  const prev = run.history.at(-1)?.entry_sha256 ?? null;
  const body = {
    seq: run.history.length + 1,
    event,
    from: run.state,
    to,
    outcome,
    reason: code ?? null,
    input_sha256: digest(evidence ?? null),
    core_version: CORE_VERSION,
    request_sha256: run.request_sha256,
    sql_asset_sha256: SQL_ASSET.sha256,
    manifest_sha256: run.request?.manifest_sha256 ?? null,
    prev_sha256: prev,
  };
  return Object.freeze({ ...body, entry_sha256: digest(body) });
}

export function step(run, event, evidenceInput) {
  // L-1: copy first, then validate, digest and store that same deep-frozen
  // copy, so a toJSON method or later mutation cannot separate what was checked
  // from what is kept. Evidence that is not plain JSON (for example a BigInt)
  // becomes null and fails closed in the handler instead of throwing (v3 I-2).
  const evidence = snapshot(evidenceInput);
  const refuse = (code) =>
    Object.freeze({
      ...run,
      history: Object.freeze([
        ...run.history,
        append(run, event, evidence, run.state, 'refused', code),
      ]),
      refused: code,
    });
  if (FORBIDDEN.has(event)) return refuse('RETRY_OR_ESCALATION_FORBIDDEN');
  if (TERMINAL.includes(run.state)) return refuse('TERMINAL_STATE');
  const h = HANDLERS[event];
  if (!h) return refuse('UNKNOWN_EVENT');
  if (![h.from].flat().includes(run.state)) return refuse('OUT_OF_ORDER');
  const r = h.run(evidence, run);
  const entries = [];
  let cur = run;
  if (r.via) {
    const e = append(cur, event, evidence, r.via, 'accepted', null);
    entries.push(e);
    cur = { ...cur, state: r.via, history: [...cur.history, e] };
  }
  const last = append(
    cur,
    event,
    evidence,
    r.to,
    TERMINAL.includes(r.to) && r.code ? 'terminal' : 'accepted',
    r.code,
  );
  return Object.freeze({
    ...run,
    state: r.to,
    refused: undefined,
    ctx: Object.freeze({ ...run.ctx, ...(r.ctx ?? {}) }),
    invalidations: Object.freeze([
      ...run.invalidations,
      ...(r.invalidations ?? []),
    ]),
    history: Object.freeze([...run.history, ...entries, last]),
  });
}

export function fixtureReceipt(run) {
  const body = {
    format: RECEIPT_FORMAT,
    label: 'FIXTURE - not operational evidence',
    fixture: true,
    mode: 'fixture',
    operational: false,
    authorizes: [],
    core_version: CORE_VERSION,
    request_sha256: run.request_sha256,
    request_id: run.request?.request_id ?? null,
    manifest_sha256: run.request?.manifest_sha256 ?? null,
    inspector_sha256: run.request?.inspector_sha256 ?? null,
    sql_asset: { version: SQL_ASSET.version, sha256: SQL_ASSET.sha256 },
    final_state: run.state,
    sequence:
      run.state === 'W2_reference_recorded' && run.invalidations.length === 0
        ? 'fixture_sequence_consistent'
        : 'fixture_sequence_not_clear',
    invalidations: [...run.invalidations],
    attestation_ceiling: 'W1_W2_supported_W3_pending',
    later_scopes_requiring_own_grants: [...LATER_SCOPES],
    history: run.history.map((e) => ({ ...e })),
    chain_head_sha256: run.history.at(-1)?.entry_sha256 ?? null,
  };
  return Object.freeze({ ...body, receipt_sha256: digest(body) });
}

// No receipt produced in this milestone can satisfy any operational gate.
export function admitOperationalGate(receipt, gate) {
  const reason =
    !isObj(receipt) ||
    receipt.format === RECEIPT_FORMAT ||
    PRIOR_RECEIPT_FORMATS.includes(receipt.format) ||
    receipt.fixture !== false ||
    receipt.mode !== 'operational'
      ? 'FIXTURE_CANNOT_SATISFY_OPERATIONAL_GATE'
      : 'OPERATIONAL_ADAPTERS_UNIMPLEMENTED';
  return Object.freeze({
    fixture: true,
    gate: gate ?? null,
    admitted: false,
    reason,
  });
}
