import { randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from '@creator/contracts';
import {
  digest,
  cliCaseSchema as qaCaseSchema,
  type Binding,
} from './contracts.js';
import type { ProductSupervisor } from './products.js';
import type { ExecutionSupervisor } from './execution.js';
import { qaPassed } from './build.js';
import { builderV2Schema, resolveSubmission } from './builder-answer.js';
import { fileAt } from './files.js';
import { git } from './git.js';

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
// ADR-0109: builder/2's; a qualification answer is one part (complete), and its edits apply to
// the template's files exactly as a build round's do.
const answerSchema = builderV2Schema;

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

type PatchSignal =
  'accepted' | 'schema_invalid' | 'acceptance_check_failed' | 'provider_error';

/** A grading signal and, when it is not a pass, one plain sentence (at most 200 characters) saying where it failed (F10). */
export interface PatchGrade {
  signal: PatchSignal;
  detail: string | null;
}

const said = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * Grades one patch_build qualification answer the way T12 QA grades a build: the scoped patch
 * goes onto the reviewed template in a throwaway product, and every case runs in the isolated
 * worker. Accepted only if all cases match exactly. Nothing here trusts the model's claims.
 */
export async function scorePatchCase(
  ...args: Parameters<typeof gradePatchCase>
): Promise<PatchSignal> {
  return (await gradePatchCase(...args)).signal;
}

/**
 * scorePatchCase with the reason kept: which step a non-passing answer failed, in words the
 * owner can act on. It names a failed check and its exit codes but never prints expected
 * output, so a held-out case's answer key stays out of the record.
 */
export async function gradePatchCase(
  sup: { products: ProductSupervisor; executor: ExecutionSupervisor },
  ownerId: string,
  check: PatchCasesCheck,
  text: string | null,
): Promise<PatchGrade> {
  const g = await grade(sup, ownerId, check, text);
  // The one place the 200-character bound (the request's reason field) is applied.
  return { signal: g.signal, detail: g.detail && clip(g.detail, DETAIL_MAX) };
}

const DETAIL_MAX = 200;

async function grade(
  sup: { products: ProductSupervisor; executor: ExecutionSupervisor },
  ownerId: string,
  check: PatchCasesCheck,
  text: string | null,
): Promise<PatchGrade> {
  let answer: z.infer<typeof answerSchema>;
  try {
    answer = answerSchema.parse(JSON.parse(text ?? ''));
  } catch (e) {
    return {
      signal: 'schema_invalid',
      detail:
        text === null
          ? 'No answer text came back.'
          : e instanceof z.ZodError
            ? `The answer is JSON but not in the builder format: ${clip(
                e.issues
                  .map(
                    (i) => `${i.path.join('.') || '(top level)'} ${i.message}`,
                  )
                  .join('; '),
                300,
              )}`
            : 'The answer is not valid JSON.',
    };
  }
  if (!answer.submission)
    return {
      signal: 'acceptance_check_failed',
      detail: `The builder submitted no code change. Its stated blocker: ${
        answer.blocker ? `"${answer.blocker}"` : 'none given'
      }.`,
    };
  if (answer.submission.complete === false)
    return {
      signal: 'acceptance_check_failed',
      detail:
        'The builder set complete false, but a qualification task allows one part only.',
    };
  const submission = answer.submission;
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
  } catch (e) {
    for (const name of await readdir(sup.products.root).catch(() => []))
      if (!before.has(name) && /^[0-9a-f-]{36}$/.test(name))
        await rm(join(sup.products.root, name), {
          recursive: true,
          force: true,
        }).catch(() => {});
    return {
      signal: 'provider_error',
      detail: `The studio could not set up the template to grade on: ${said(e)}`,
    };
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
      // The template's files, as a build round's packet gives them, for before hashes and edits.
      const tree = sup.products.worktree(product.id, task.id);
      const names = (
        await git(tree, [
          'ls-tree',
          '-r',
          '--name-only',
          product.initial_commit,
        ])
      )
        .split('\n')
        .filter(Boolean);
      const files = [];
      for (const name of names) {
        const content = await readFile(await fileAt(tree, name), 'utf8');
        files.push({ path: name, hash: digest(content), content });
      }
      // The benchmark packet cannot know this product's commit; the hashes still bind the files.
      ({ commit } = await sup.products.apply(
        product.id,
        task.id,
        resolveSubmission(
          { ...submission, expected_commit: product.initial_commit },
          files,
        ),
        binding,
      ));
    } catch (e) {
      return {
        signal: 'acceptance_check_failed',
        detail: `The code change was refused or did not apply (${submission.changes
          .map((c) => c.path)
          .join(', ')}): ${said(e)}`,
      };
    }
    for (const stored of check.cases) {
      // The worker hashes the case in schema key order; a manifest read back from jsonb has
      // its keys reordered, so compare against the same normalized case.
      const c = qaCaseSchema.parse(stored);
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
      } catch (e) {
        // The worker could not run the case. That is never a pass; the owner sees the reason.
        return {
          signal: 'provider_error',
          detail: `The worker could not run check ${c.check_key}: ${said(e)}`,
        };
      }
      // A run the worker could not carry out (blocked, lost, cleanup pending) judged nothing.
      if (!['succeeded', 'failed'].includes(execution.state))
        return {
          signal: 'provider_error',
          detail: `The worker did not finish check ${c.check_key} (${execution.state}${
            execution.reason ? `: ${execution.reason}` : ''
          }).`,
        };
      if (!qaPassed(execution, commit, c)) {
        const exit =
          execution.exit_code === c.exit_code
            ? `exit code ${String(execution.exit_code)} as expected`
            : `exit code ${String(execution.exit_code)}, expected ${c.exit_code}`;
        const output =
          execution.log === c.stdout
            ? 'output matched'
            : 'output did not match';
        const unbound =
          execution.exit_code === c.exit_code &&
          execution.log === c.stdout &&
          execution.reason === null;
        return {
          signal: 'acceptance_check_failed',
          detail: unbound
            ? `Check ${c.check_key} failed: the worker's record is not bound to this exact check and commit.`
            : `Check ${c.check_key} failed: ${exit}; ${output}${
                execution.reason ? ` (${execution.reason})` : ''
              }.`,
        };
      }
    }
    return { signal: 'accepted', detail: null };
  } catch (e) {
    return {
      signal: 'provider_error',
      detail: `Grading stopped: ${said(e)}`,
    };
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
