import {
  parse,
  DesktopJobSchema,
  type DesktopJob,
  type DesktopJobReport,
} from '@creator/contracts';
import { ArtifactSupervisor } from './artifacts.js';

export interface PairedJobPorts {
  start(executionId: string): Promise<{ continue: boolean }>;
  check(): Promise<{ continue: boolean }>;
  finish(report: DesktopJobReport): Promise<unknown>;
}

/** One exact artifact, one admission and one execution. Transport uncertainty is never a retry. */
export async function executePairedJob(
  raw: DesktopJob,
  artifacts: ArtifactSupervisor,
  ports: PairedJobPorts,
  signal?: AbortSignal,
) {
  const job = parse(DesktopJobSchema, raw);
  if (
    job.state !== 'leased' ||
    !job.lease_id ||
    !job.lease_expires_at ||
    Date.parse(job.lease_expires_at) <= Date.now() ||
    Date.parse(job.expires_at) <= Date.now()
  )
    throw new Error('Paired job lease expired or missing');
  if (signal?.aborted) throw new Error('Worker is stopping');
  const { manifest } = await artifacts.open(
    job.product_id,
    job.artifact_id,
    job.manifest_sha256,
  );
  if (
    manifest.workspace_id !== job.workspace_id ||
    manifest.owner_id !== job.owner_id ||
    manifest.package.sha256 !== job.archive_sha256 ||
    manifest.toolchain.backend !== 'wsl2-bwrap-systemd' ||
    manifest.state !== 'verified' ||
    manifest.availability.runnable_demo.state !== 'available'
  )
    throw new Error('Paired artifact binding or isolation backend mismatch');
  const profile = await artifacts.executor.profile();
  if (
    profile.recipe_hash !== manifest.toolchain.recipe_hash ||
    profile.policy_hash !== manifest.toolchain.policy_hash ||
    profile.bridge_hash !== manifest.toolchain.bridge_hash
  )
    throw new Error(
      'Artifact execution profile changed; reverify before running',
    );
  let executionId: string | null = null;
  let admitted = false;
  let stopping = false;
  let checking: Promise<void> | null = null;
  const stop = async () => {
    stopping = true;
    if (executionId)
      await artifacts.executor.cancel(
        job.product_id,
        executionId,
        job.owner_id,
      );
  };
  const abort = () => {
    void stop().catch(() => {});
  };
  const check = async () => {
    if (!admitted) return;
    try {
      if (
        signal?.aborted ||
        Date.parse(job.expires_at) <= Date.now() ||
        !(await ports.check()).continue
      )
        await stop();
    } catch {
      await stop();
    }
  };
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setInterval(() => {
    if (checking) return;
    checking = check()
      .catch(() => {
        stopping = true;
      })
      .finally(() => {
        checking = null;
      });
  }, 500);
  try {
    const outcome = await artifacts.start(
      job.product_id,
      job.artifact_id,
      job.manifest_sha256,
      job.owner_id,
      job.input,
      async (id) => {
        executionId = id;
        if (stopping || signal?.aborted || !(await ports.start(id)).continue)
          throw new Error('Paired job was stopped before dispatch');
        admitted = true;
        if (!(await ports.check()).continue)
          throw new Error('Paired job was revoked before dispatch');
        if (stopping || signal?.aborted)
          throw new Error('Worker stopped before dispatch');
      },
    );
    const report: DesktopJobReport = {
      execution_id: outcome.id,
      manifest_sha256: job.manifest_sha256,
      archive_sha256: job.archive_sha256,
      backend: 'wsl2-bwrap-systemd',
      state: outcome.state === 'running' ? 'cleanup_required' : outcome.state,
      stdout: outcome.log.slice(0, 8000),
      stdout_truncated: outcome.log.length > 8000,
      exit_code: outcome.exit_code,
      reason: outcome.reason?.slice(0, 500) ?? null,
    };
    await ports.finish(report);
    return { report, local_execution: outcome };
  } finally {
    clearInterval(timer);
    signal?.removeEventListener('abort', abort);
    if (checking) await checking;
  }
}
