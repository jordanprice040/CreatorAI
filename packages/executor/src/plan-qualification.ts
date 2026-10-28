import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from '@creator/contracts';
import { digest, type Binding } from './contracts.js';
import type { ProductSupervisor } from './products.js';
import type { ExecutionSupervisor } from './execution.js';
import { builderSchema, qaPassed } from './build.js';

/** The patch_cases benchmark check (contracts BenchmarkCheckSchema, ADR-0048). */
export interface PatchCasesCheck {
  kind: 'patch_cases';
  file_scope: string[];
  cases: {
    check_key: string;
    args: string[];
    stdin: string;
    stdout: string;
    exit_code: number;
  }[];
}

// Graded with the builder schema a real build uses, so a qualified answer is one T12 accepts.
const answerSchema = builderSchema;

/** The qualification root's pending-worker marker, if a crash or failed reap left one. */
async function pendingMarker(root: string) {
  const raw = await readFile(join(root, 'pending-worker.json'), 'utf8').catch(
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null;
      throw e;
    },
  );
  return raw === null
    ? null
    : (JSON.parse(raw) as { product_id?: string; execution_id?: string });
}

/**
 * Settles a worker outcome an earlier grading left unresolved (the app closed mid-case, or the
 * reap could not be verified), the way product Recover does: the executor verifies the worker
 * stopped before freeing the marker and the dead dispatch lock. That throwaway product is then
 * removed. Refuses, saying why, when the worker cannot be shown stopped; nothing is resent.
 */
async function settleLeftover(
  sup: { products: ProductSupervisor; executor: ExecutionSupervisor },
  ownerId: string,
) {
  const marker = await pendingMarker(sup.products.root);
  if (marker) {
    const { product_id: productId, execution_id: executionId } = marker;
    const exists =
      productId &&
      executionId &&
      (await sup.products.product(productId).then(
        () => true,
        () => false,
      ));
    if (!exists)
      throw new Error(
        `An earlier qualification case left an unresolved worker run that cannot be reconciled (${join(sup.products.root, 'pending-worker.json')}). Check in WSL that no creator worker unit is running, then remove that file.`,
      );
    await sup.executor.reconcile(productId, executionId, ownerId);
    await rm(sup.products.dir(productId), { recursive: true, force: true });
  }
  await sup.products.recoverDeadLock('dispatch', '', ownerId);
}

/**
 * Grades one patch_build qualification answer the way T12 QA grades a build: the scoped patch
 * goes onto the reviewed template in a throwaway product, and every case runs in the isolated
 * worker. Accepted only if all cases match exactly. Nothing here trusts the model's claims.
 */
export async function scorePatchCase(
  sup: { products: ProductSupervisor; executor: ExecutionSupervisor },
  ownerId: string,
  check: PatchCasesCheck,
  text: string | null,
): Promise<
  'accepted' | 'schema_invalid' | 'acceptance_check_failed' | 'provider_error'
> {
  let answer: z.infer<typeof answerSchema>;
  try {
    answer = answerSchema.parse(JSON.parse(text ?? ''));
  } catch {
    return 'schema_invalid';
  }
  if (!answer.submission) return 'acceptance_check_failed';
  const taskHash = digest(JSON.stringify(check));
  const binding: Binding = {
    workspace_id: randomUUID(),
    owner_id: ownerId,
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: taskHash,
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: taskHash, file_scope: check.file_scope }],
  };
  await settleLeftover(sup, ownerId);
  let product;
  // A failed create can leave a partial directory; this root holds only throwaway products
  // and plan requests run one at a time, so anything new here after a failure is its debris.
  const before = new Set(await readdir(sup.products.root).catch(() => []));
  try {
    product = await sup.products.create(binding);
  } catch {
    for (const name of await readdir(sup.products.root).catch(() => []))
      if (!before.has(name) && /^[0-9a-f-]{36}$/.test(name))
        await rm(join(sup.products.root, name), {
          recursive: true,
          force: true,
        }).catch(() => {});
    return 'provider_error';
  }
  try {
    const task = await sup.products.createTask(
      product.id,
      'T1',
      product.initial_commit,
      binding,
    );
    let commit: string;
    try {
      // The benchmark packet cannot know this product's commit; the hashes still bind the files.
      ({ commit } = await sup.products.apply(
        product.id,
        task.id,
        { ...answer.submission, expected_commit: product.initial_commit },
        binding,
      ));
    } catch {
      return 'acceptance_check_failed';
    }
    for (const c of check.cases) {
      let execution;
      try {
        execution = await sup.executor.run(
          product.id,
          task.id,
          commit,
          binding,
          () => {},
          c,
        );
      } catch {
        // The worker could not run the case. That is never a pass; the owner sees the reason.
        return 'provider_error';
      }
      if (!qaPassed(execution, commit, c)) return 'acceptance_check_failed';
    }
    return 'accepted';
  } catch {
    return 'provider_error';
  } finally {
    // Throwaway product: the plan request ledger keeps the signal; the files are not evidence.
    // Kept while the worker marker names it (or the marker is unreadable): reconciliation
    // needs its execution record.
    const marker = await pendingMarker(sup.products.root).catch(() => ({
      product_id: product.id,
    }));
    if (marker?.product_id !== product.id)
      await rm(sup.products.dir(product.id), {
        recursive: true,
        force: true,
      }).catch(() => {});
  }
}
