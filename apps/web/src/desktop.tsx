import { useState, type FormEvent } from 'react';
import {
  DesktopDeviceSchema,
  DesktopJobSchema,
  ArtifactSummarySchema,
  RunInputSchema,
  z,
  type DesktopDevice,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { useLoad } from './ui.js';

/** X06: an active worker whose presence lease lapsed is shown as unreachable, not active. */
function availability(d: DesktopDevice): string {
  const now = Date.now();
  if (d.state === 'revoked') return 'revoked';
  if (Date.parse(d.expires_at) < now) return 'pairing expired';
  if (d.state !== 'active') return d.state;
  return d.lease_expires_at && Date.parse(d.lease_expires_at) >= now
    ? 'online'
    : 'unreachable: not reporting';
}

/** Status tone for the badge; the badge text always states the availability in words. */
function tone(d: DesktopDevice): 'ok' | 'warn' | 'off' {
  const a = d.kind === 'worker' ? availability(d) : d.state;
  if (a === 'online' || a === 'active') return 'ok';
  if (a === 'revoked' || a === 'pairing expired' || a === 'shutdown')
    return 'off';
  return 'warn';
}

export function DesktopDevices({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
}) {
  const data = useLoad(
    () => api(z.array(DesktopDeviceSchema), 'desktop/devices'),
    [workspace.id],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  async function control(d: DesktopDevice, state: string) {
    if (!session) return;
    setBusy(d.id);
    setError('');
    try {
      await api(DesktopDeviceSchema, `desktop/devices/${d.id}/control`, {
        body: { state },
        csrf: session.csrf_token,
      });
      data.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  return (
    <section className="panel">
      <h2>Devices and local workers</h2>
      <p>
        Desktop sessions share studio records. Presence pairing grants no
        execution authority. Execution-capable workers accept only exact
        owner-submitted artifact jobs using the reviewed offline WSL sandbox.
      </p>
      <p>
        Closing a desktop window leaves a separately started worker running.
        Shutdown asks it to stop on its next poll; revocation immediately denies
        further authenticated polls. A stale last-seen time means presence is
        unknown.
      </p>
      <p>
        To pair a local worker, run{' '}
        <code>node apps/desktop/worker.mjs pair {workspace.id}</code> and open
        the approval link in your signed-in system browser.
      </p>
      <p>
        For execution, explicitly pair with{' '}
        <code>
          node apps/desktop/worker.mjs run {workspace.id} PRODUCTS_ROOT
        </code>
        . PRODUCTS_ROOT must be the same local product store used by this
        studio. Execution uses the fixed 20-second, 256 MiB sandbox; local
        compute cost is unmetered, not zero.
      </p>
      <button className="secondary" onClick={() => data.reload()}>
        Refresh devices
      </button>
      {(error || data.error) && (
        <p className="error" role="alert">
          {error || data.error}
        </p>
      )}
      {data.loading && (
        <p className="small loading" role="status">
          Loading devices…
        </p>
      )}
      {data.data
        ?.filter(
          (d) => d.workspace_id === null || d.workspace_id === workspace.id,
        )
        .map((d) => (
          <article key={d.id} className="decision device">
            <div className="decision-head">
              <h3>{d.label}</h3>
              <span className={`badge dev-${tone(d)}`}>
                {d.kind === 'worker' ? availability(d) : d.state}
              </span>
            </div>
            <p>
              {d.kind} · {d.state}
              {d.kind === 'worker' && ` · ${availability(d)}`} · expires{' '}
              {when(d.expires_at)}
            </p>
            <p>Declared capabilities: {d.capabilities.join(', ') || 'None'}</p>
            <p>
              Last seen:{' '}
              {d.last_seen_at ? when(d.last_seen_at) : 'Not observed'} ·
              Presence lease:{' '}
              {d.lease_expires_at ? when(d.lease_expires_at) : 'None'}
            </p>
            {d.state !== 'revoked' && (
              <div className="actions">
                {d.kind === 'worker' && (
                  <>
                    <button
                      className="secondary"
                      disabled={busy === d.id || d.state === 'paused'}
                      onClick={() => void control(d, 'paused')}
                    >
                      Pause
                    </button>
                    <button
                      className="secondary"
                      disabled={busy === d.id || d.state === 'active'}
                      onClick={() => void control(d, 'active')}
                    >
                      Resume
                    </button>
                    <button
                      className="secondary"
                      disabled={busy === d.id || d.state === 'shutdown'}
                      onClick={() => void control(d, 'shutdown')}
                    >
                      Shutdown worker
                    </button>
                  </>
                )}
                <button
                  className="secondary"
                  disabled={busy === d.id}
                  onClick={() => void control(d, 'revoked')}
                >
                  Revoke {d.kind === 'worker' ? 'worker' : 'desktop session'}
                </button>
              </div>
            )}
            {d.kind === 'worker' && d.capabilities.includes('artifact.run') && (
              <PairedJobs
                key={d.id}
                device={d}
                workspace={workspace}
                session={session}
              />
            )}
          </article>
        ))}
      {!data.loading &&
        data.data?.filter(
          (d) => d.workspace_id === null || d.workspace_id === workspace.id,
        ).length === 0 && (
          <p className="small empty-note">No paired devices.</p>
        )}
    </section>
  );
}

function PairedJobs({
  device,
  workspace,
  session,
}: {
  device: DesktopDevice;
  workspace: Workspace;
  session: SessionInfo | null;
}) {
  const history = useLoad(
    () => api(z.array(DesktopJobSchema), `desktop/devices/${device.id}/jobs`),
    [device.id],
  );
  const artifacts = useLoad(
    () =>
      api(
        z.array(ArtifactSummarySchema),
        `workspaces/${workspace.id}/artifacts`,
      ),
    [workspace.id],
  );
  const [artifactId, setArtifactId] = useState('');
  const [input, setInput] = useState('{"args":[],"stdin":""}');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function queue(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setError('');
    setBusy(true);
    try {
      const runInput = RunInputSchema.parse(JSON.parse(input));
      const artifact = artifacts.data?.find((a) => a.id === artifactId);
      if (!artifact) throw new Error('Select a runnable artifact.');
      setAttempted(true);
      await api(DesktopJobSchema, `desktop/devices/${device.id}/jobs`, {
        csrf: session.csrf_token,
        body: {
          request_id: requestId,
          artifact_id: artifactId,
          manifest_sha256: artifact.manifest_sha256,
          input: runInput,
        },
      });
      history.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function control(jobId: string, action: 'cancel' | 'reconcile') {
    if (!session) return;
    setError('');
    setBusy(true);
    try {
      await api(DesktopJobSchema, `desktop/jobs/${jobId}/${action}`, {
        csrf: session.csrf_token,
        body: {},
        timeoutMs: 30000,
      });
      history.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h4>Bounded artifact jobs</h4>
      <p>
        One attempt per request, one unresolved job per workspace, at most three
        globally and 20 per hour. Job results are worker reports; they do not
        independently verify or promote a product.
      </p>
      <form className="job-form" onSubmit={(e) => void queue(e)}>
        <label htmlFor={`artifact-${device.id}`}>Exact artifact</label>
        <select
          id={`artifact-${device.id}`}
          value={artifactId}
          disabled={attempted || busy}
          onChange={(e) => setArtifactId(e.target.value)}
        >
          <option value="">Select an artifact</option>
          {artifacts.data
            ?.filter(
              (a) =>
                a.state === 'verified' &&
                a.availability.runnable_demo.state === 'available',
            )
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.commit.slice(0, 10)}
              </option>
            ))}
        </select>
        <label htmlFor={`input-${device.id}`}>
          Run input JSON (args and stdin)
        </label>
        <textarea
          id={`input-${device.id}`}
          rows={3}
          value={input}
          disabled={attempted || busy}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="secondary strong"
          disabled={
            busy || !session || !artifactId || device.state !== 'active'
          }
        >
          {attempted ? 'Retry same request safely' : 'Queue one execution'}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            setRequestId(crypto.randomUUID());
            setAttempted(false);
            setError('');
          }}
        >
          New execution request
        </button>
      </form>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => history.reload()}
      >
        Refresh jobs
      </button>
      {(error || history.error || artifacts.error) && (
        <p className="error" role="alert">
          {error || history.error || artifacts.error}
        </p>
      )}
      {history.loading && (
        <p className="small loading" role="status">
          Loading job history…
        </p>
      )}
      {history.data?.map((job) => (
        <article key={job.id} className="decision">
          <h5>{job.id}</h5>
          <p>
            {job.state} · exact manifest {job.manifest_sha256.slice(0, 12)} ·{' '}
            {when(job.created_at)}
          </p>
          <p>
            Verification: worker report only. Local compute billing: not
            metered.
          </p>
          {['queued', 'leased', 'running'].includes(job.state) && (
            <button
              className="secondary"
              disabled={busy || job.cancel_requested}
              onClick={() => void control(job.id, 'cancel')}
            >
              Cancel job
            </button>
          )}
          {job.state === 'reconciling' && (
            <>
              <p>
                Outcome uncertain. No automatic retry. Stop the old worker
                before reconciling local execution evidence.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void control(job.id, 'reconcile')}
              >
                Verify local stop and reconcile
              </button>
            </>
          )}
          {job.report && (
            <>
              <p>
                Worker reported {job.report.state}; exit{' '}
                {job.report.exit_code ?? 'unknown'}
                {job.report.stdout_truncated
                  ? ' · output truncated; full log retained locally'
                  : ''}
              </p>
              <pre>{job.report.stdout}</pre>
              {job.report.reason && <p>{job.report.reason}</p>}
            </>
          )}
        </article>
      ))}
    </section>
  );
}
