import { randomUUID } from 'node:crypto';
import { ContractError } from '@creator/contracts';
import type { ConnectionStore } from '@creator/db';
import type { PlanConnectionService } from './plan-service.js';

/** How long a lease lasts without renewal; a crashed process's queue is taken over after it. */
export const QUEUE_LEASE_MS = 120_000;
/** Renewal and polling interval while running. */
const RENEW_MS = 30_000;
const POLL_MS = 10_000;
/** Unexpected failures in a row after which a queue is stopped instead of retried. */
export const QUEUE_MAX_FAILURES = 3;

/**
 * ADR-0088 (P24): runs queued qualifications one after another in the studio process, so the
 * person can leave the page. Each queue is worked on under a lease held in the database; a
 * process that dies leaves the lease to expire and the next process continues where it
 * stopped. The runner holds no authority of its own: each qualification is started and each
 * case admitted through the same store and service paths as a Run pressed by the owner who
 * queued it, against the connection as it is at that moment.
 */
export class QualificationQueueRunner {
  readonly holder: string;
  readonly #active = new Map<string, Promise<void>>();
  /** Unexpected failures in a row per queue; reset by a step that works (review L-2). */
  readonly #failures = new Map<string, number>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #sweeping: Promise<void> | null = null;
  #stopped = false;

  constructor(
    private readonly deps: {
      store: Pick<
        ConnectionStore,
        | 'leaseQualificationQueue'
        | 'renewQualificationQueueLease'
        | 'releaseQualificationQueueLease'
        | 'nextQueuedQualification'
        | 'recordQueuedRun'
        | 'abandonQualificationQueue'
      >;
      service: Pick<PlanConnectionService, 'runQualification'>;
      leaseMs?: number;
      /** Errors the runner could not record (database down); never thrown. */
      onError?: (e: unknown) => void;
    },
    holder: string = randomUUID(),
  ) {
    this.holder = holder;
  }

  start() {
    if (this.#timer) return;
    this.#stopped = false;
    this.#timer = setInterval(() => this.kick(), POLL_MS);
    this.#timer.unref();
    this.kick();
  }

  /** Looks for queues to run now (after a queue was started, say) instead of at the next poll. */
  kick() {
    if (this.#stopped || this.#sweeping) return;
    this.#sweeping = this.sweep()
      .catch((e: unknown) => this.deps.onError?.(e))
      .finally(() => {
        this.#sweeping = null;
      });
  }

  /**
   * Stops polling and taking new work. A qualification already running is not waited for (it
   * can take an hour): if the process then exits, its lease expires and the next studio process
   * resumes the queue, as after a crash.
   */
  async stop() {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#sweeping;
  }

  /** Leases every free running queue and starts working on each; resolves once all are leased. */
  async sweep() {
    const ms = this.deps.leaseMs ?? QUEUE_LEASE_MS;
    while (!this.#stopped) {
      // Review of PR #176, L-1: never lease again a queue this runner is still working on (its
      // lease can lapse while a run goes on, after a database outage or a sleep).
      const lease = await this.deps.store.leaseQualificationQueue(
        this.holder,
        ms,
        [...this.#active.keys()],
      );
      if (!lease) return;
      const work = this.#work(lease.id, lease.workspace_id, lease.created_by)
        .catch((e: unknown) => this.#failed(lease.id, e))
        .finally(() => this.#active.delete(lease.id));
      this.#active.set(lease.id, work);
    }
  }

  /** Waits for every queue this runner is working on (tests). */
  async idle() {
    await this.#sweeping;
    await Promise.allSettled([...this.#active.values()]);
  }

  async #work(id: string, ws: string, actorId: string) {
    const { store, service } = this.deps;
    const ms = this.deps.leaseMs ?? QUEUE_LEASE_MS;
    // A renewal that finds another holder means this runner lost the queue: it finishes the
    // case in hand (it cannot be recalled) and then leaves the queue to the new holder.
    let lost = false;
    const renew = setInterval(
      () => {
        void store
          .renewQualificationQueueLease(id, this.holder, ms)
          .then((held) => {
            if (!held) lost = true;
          })
          .catch((e: unknown) => this.deps.onError?.(e));
      },
      Math.min(RENEW_MS, Math.max(1000, Math.floor(ms / 4))),
    );
    renew.unref();
    try {
      for (;;) {
        const next = await store.nextQueuedQualification(id, this.holder);
        this.#failures.delete(id);
        if (next.kind === 'end') return;
        let reason = 'the run ended without a result';
        try {
          const out = await service.runQualification(
            { actorId },
            ws,
            next.qualification_id,
            id,
          );
          if (out.state === 'stopped') reason = words(out.reason);
        } catch (e) {
          // A refusal's message is generic ("not admitted"); its details say why.
          reason =
            e instanceof ContractError
              ? [e.message, ...e.details].join(' ')
              : e instanceof Error
                ? e.message
                : String(e);
        }
        if (lost) return;
        const go = await store.recordQueuedRun(
          id,
          this.holder,
          next.position,
          reason,
        );
        if (!go || this.#stopped) return;
      }
    } finally {
      clearInterval(renew);
      await store
        .releaseQualificationQueueLease(id, this.holder)
        .catch((e: unknown) => this.deps.onError?.(e));
    }
  }

  /**
   * Review of PR #176, L-2: an unexpected error (not a refusal, which the store records as a
   * stop) is retried at the next poll, so a database blip does not end a queue. The same queue
   * failing this many times in a row is stopped with the error as its reason instead of being
   * shown as running and retried forever.
   */
  async #failed(id: string, e: unknown) {
    this.deps.onError?.(e);
    const n = (this.#failures.get(id) ?? 0) + 1;
    this.#failures.set(id, n);
    if (n < QUEUE_MAX_FAILURES) return;
    this.#failures.delete(id);
    await this.deps.store
      .abandonQualificationQueue(
        id,
        this.holder,
        e instanceof Error ? e.message : String(e),
      )
      .catch((x: unknown) => this.deps.onError?.(x));
  }
}

const words = (s: string) => s.replace(/_/g, ' ');
