import { randomUUID } from 'node:crypto';
import {
  ExecutionSupervisor,
  digest,
  inputHash,
  type Binding,
  type Execution,
  type PackageFile,
  type QaCase,
} from '@creator/executor';
import type { RunInput } from '@creator/contracts';

/**
 * TEST DOUBLE ONLY. Executes nothing: it answers acceptance cases with their own expected
 * output so the packaging, hashing, preview-lease and feedback bookkeeping can be exercised
 * where the reviewed WSL2 worker does not exist. Its records name the backend "test-double",
 * which manifests carry into a visible "not isolation evidence" limitation, and real
 * workspaces refuse to register them. Real isolation is covered by the opt-in WSL2 gate.
 */
export class TestDoubleExecutor extends ExecutionSupervisor {
  /** Interactive (non-case) runs return this text. */
  interactive = 'test double: no program was executed\n';
  /** When set, package (not worktree) runs report this output instead of the expected one. */
  packageOutput: string | null = null;
  runs: { source: 'task_worktree' | 'exported_package'; input: unknown }[] = [];
  private record(
    productId: string,
    taskId: string,
    commit: string,
    hashOfInput: string,
    source: string,
    input?: QaCase | RunInput,
  ): Execution {
    const expected = input && 'check_key' in input ? input : null;
    const log =
      source === 'exported_package' && this.packageOutput !== null
        ? this.packageOutput
        : (expected?.stdout ?? this.interactive);
    return {
      id: randomUUID(),
      product_id: productId,
      task_id: taskId,
      commit,
      recipe: 'python-build/1',
      recipe_hash: digest('test-double-recipe'),
      policy_hash: digest('test-double-policy'),
      input_hash: hashOfInput,
      state: expected && expected.exit_code !== 0 ? 'failed' : 'succeeded',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      environment: {
        backend: 'test-double',
        bridge_hash: digest('test-double-bridge'),
        local_compute_billing: 'not_metered_by_studio',
        acceptance_hash: input ? digest(JSON.stringify(input)) : null,
        input_source: source,
      },
      log,
      exit_code: expected?.exit_code ?? 0,
      reason: null,
    };
  }
  override async run(
    productId: string,
    taskId: string,
    commit: string,
    binding: Binding,
    onStarted: (id: string) => void = () => {},
    qa?: QaCase,
  ): Promise<Execution> {
    const p = await this.products.product(productId);
    this.products.assertBinding(p, binding);
    const files = await this.products.committedFiles(productId, taskId, commit);
    this.runs.push({ source: 'task_worktree', input: qa });
    const e = this.record(
      productId,
      taskId,
      commit,
      inputHash(files),
      'task_worktree',
      qa,
    );
    onStarted(e.id);
    return e;
  }
  override async runPackage(
    productId: string,
    taskId: string,
    commit: string,
    files: PackageFile[],
    owner: string,
    _archive: string,
    onStarted: (id: string) => void = () => {},
    input?: QaCase | RunInput,
  ): Promise<Execution> {
    this.products.assertOwner(await this.products.product(productId), owner);
    this.runs.push({ source: 'exported_package', input });
    const e = this.record(
      productId,
      taskId,
      commit,
      inputHash(files),
      'exported_package',
      input,
    );
    onStarted(e.id);
    return e;
  }
}
