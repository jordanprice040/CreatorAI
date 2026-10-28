import { randomUUID } from 'node:crypto';
import { z } from '@creator/contracts';
import { digest, changesSchema, type Binding } from './contracts.js';
import type { ProductSupervisor } from './products.js';
import type { ExecutionSupervisor } from './execution.js';
import { qaPassed } from './build.js';

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

const answerSchema = z.object({ submission: changesSchema.nullable() });

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
  const product = await sup.products.create(binding);
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
}
