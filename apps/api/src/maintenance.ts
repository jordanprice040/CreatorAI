const JOBS = [
  'outbox',
  'broker_recovery',
  'retrieval_recovery',
  'notifications',
] as const;
type Job = (typeof JOBS)[number];
export const MAINTENANCE_JOBS: readonly Job[] = JOBS;
/** ADR-0116 (N1): a job failing this long is named in its owner's inbox (Advanced view). */
export const MAINTENANCE_ALERT_MS = 10 * 60 * 1000;

/** Jobs whose last success is older than `MAINTENANCE_ALERT_MS` and that are failing now. */
export function failingJobs(
  jobs: Record<
    string,
    {
      last_success_at: string | null;
      last_failure_at: string | null;
      error_code: string | null;
    }
  >,
  since: number,
  now = Date.now(),
): { job: string; code: string }[] {
  return Object.entries(jobs).flatMap(([job, j]) => {
    if (!j.error_code) return [];
    const ok = j.last_success_at ? Date.parse(j.last_success_at) : since;
    return now - ok > MAINTENANCE_ALERT_MS ? [{ job, code: j.error_code }] : [];
  });
}

/** Process-local diagnostics; durable jobs and their idempotence stay in the store. */
export function createMaintenance(
  enabled: boolean,
  log: (message: string) => void = console.error,
) {
  const jobs = Object.fromEntries(
    JOBS.map((name) => [
      name,
      {
        last_success_at: null as string | null,
        last_failure_at: null as string | null,
        error_code: null as string | null,
      },
    ]),
  ) as Record<
    Job,
    {
      last_success_at: string | null;
      last_failure_at: string | null;
      error_code: string | null;
    }
  >;
  const pending = new Map<Job, Promise<void>>();
  function run(name: Job, work: () => Promise<unknown>): Promise<void> {
    const active = pending.get(name);
    if (active) return active;
    const task = Promise.resolve()
      .then(work)
      .then(() => {
        jobs[name].last_success_at = new Date().toISOString();
        jobs[name].error_code = null;
      })
      .catch((error: unknown) => {
        // Only a bounded error code is public; database messages may contain private data.
        const raw =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : null;
        const code =
          typeof raw === 'string' && /^[A-Z0-9_]{1,48}$/.test(raw)
            ? raw
            : 'MAINTENANCE_FAILED';
        if (jobs[name].error_code !== code)
          log(`Maintenance ${name} failed (${code}); retrying.`);
        jobs[name].last_failure_at = new Date().toISOString();
        jobs[name].error_code = code;
        throw error;
      })
      .finally(() => {
        pending.delete(name);
      });
    pending.set(name, task);
    return task;
  }
  return {
    run,
    snapshot: () => ({
      enabled,
      degraded: enabled && JOBS.some((name) => jobs[name].error_code !== null),
      jobs: {
        outbox: { ...jobs.outbox },
        broker_recovery: { ...jobs.broker_recovery },
        retrieval_recovery: { ...jobs.retrieval_recovery },
        notifications: { ...jobs.notifications },
      },
    }),
  };
}
