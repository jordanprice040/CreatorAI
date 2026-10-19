import { OpsStatusSchema, type OpsStatus } from '@creator/contracts';
import { api, when } from './oversight.js';
import { Status, useLoad } from './ui.js';

const VERIFICATION: Record<OpsStatus['readiness']['verification'], string> = {
  verified: 'Verified: an owner recorded a passing check of this exact build.',
  unverified: 'Not verified: no owner-recorded check of this deployment.',
  stale:
    'Stale: the last recorded check was of a different commit, configuration or schema.',
  failed: 'Failed: the last recorded check of this build did not pass.',
};
const AVAILABILITY: Record<string, string> = {
  online: 'online',
  unreachable: 'unreachable (stopped reporting)',
  paused: 'paused',
  shutdown: 'shut down',
  revoked: 'revoked',
  expired: 'pairing expired',
};

/** X06 operations view: readiness, environment, verification, workers, queues and alerts. */
export function Operations() {
  const data = useLoad(() => api(OpsStatusSchema, 'ops/status'), []);
  const s = data.data;
  return (
    <section className="panel">
      <h2>Operations</h2>
      <Status loading={data.loading} error={data.error} retry={data.reload} />
      {s && (
        <>
          <p>
            <strong>
              {s.readiness.mode === 'hosted' ? 'Hosted' : 'Local'}{' '}
              {s.readiness.environment}
            </strong>{' '}
            · {s.readiness.ready ? 'ready' : 'not ready'} · schema{' '}
            {s.readiness.schema_version ?? 'unknown'} · build{' '}
            {s.readiness.build_commit?.slice(0, 12) ?? 'not set'}
          </p>
          <p>{VERIFICATION[s.readiness.verification]}</p>
          <ul>
            {s.checks.map((c) => (
              <li key={c.name}>
                {c.ok ? 'OK' : 'Failing'}: {c.name}. {c.detail}
              </li>
            ))}
          </ul>
          <h3>Local workers</h3>
          {s.metrics.workers.local_last_seen.length === 0 ? (
            <p>No paired local workers.</p>
          ) : (
            <ul>
              {s.metrics.workers.local_last_seen.map((w) => (
                <li key={w.id}>
                  {w.label}: {AVAILABILITY[w.availability]} · last seen{' '}
                  {w.last_seen_at ? when(w.last_seen_at) : 'never'}
                </li>
              ))}
            </ul>
          )}
          <p className="small">
            An unreachable worker gets no new work and nothing is reassigned to
            another device. Its open jobs expire or wait for reconciliation.
          </p>
          <h3>Queues and outcomes</h3>
          <ul>
            <li>
              Outbox pending: {s.metrics.queue.outbox_pending}
              {s.metrics.queue.outbox_oldest_pending_seconds !== null &&
                ` (oldest ${s.metrics.queue.outbox_oldest_pending_seconds}s)`}
            </li>
            <li>
              Workflow leases: {s.metrics.workers.workflow_leases_active}{' '}
              active, {s.metrics.workers.workflow_leases_expired} expired
            </li>
            <li>Local jobs open: {s.metrics.workers.local_jobs_open}</li>
            <li>
              Unknown outcomes:{' '}
              {Object.values(s.metrics.uncertain).reduce((a, b) => a + b, 0)}
            </li>
            <li>
              Webhooks in the last day: {s.metrics.webhooks.accepted_24h}{' '}
              accepted, {s.metrics.webhooks.rejected_signature_24h} rejected
            </li>
          </ul>
          <h3>Alerts</h3>
          <p className="small">
            Evaluated here only; nothing is sent outside this deployment.
          </p>
          <ul>
            {s.alerts
              .filter((a) => a.state === 'firing')
              .map((a) => (
                <li key={a.id}>
                  {a.severity}: {a.summary} ({a.metric} = {a.value})
                </li>
              ))}
            {!s.alerts.some((a) => a.state === 'firing') && (
              <li>None firing.</li>
            )}
          </ul>
          <p className="small">Observed {when(s.metrics.observed_at)}.</p>
          <button className="secondary" onClick={data.reload}>
            Refresh
          </button>
        </>
      )}
    </section>
  );
}
