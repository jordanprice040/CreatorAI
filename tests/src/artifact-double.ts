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
  /** When set, package runs wait here until released or cancelled (in-flight run tests). */
  gate: { release: () => void; promise: Promise<void> } | null = null;
  /** Execution ids whose cancel was requested. */
  cancelled: string[] = [];
  /** A held run that does not end when cancelled (cleanup "unknown"). */
  ignoreCancel = false;
  hold(): void {
    let release = () => {};
    const promise = new Promise<void>((r) => (release = r));
    this.gate = { release, promise };
  }
  override async cancel(
    _productId: string,
    executionId: string,
    _owner: string,
  ): Promise<void> {
    this.cancelled.push(executionId);
    if (!this.ignoreCancel) this.gate?.release();
  }
  private record(
    productId: string,
    taskId: string,
    commit: string,
    hashOfInput: string,
    source: string,
    input?: QaCase | RunInput,
  ): Execution {
    const browser = input && 'steps' in input ? input : null;
    const expected = input && 'check_key' in input && !browser ? input : null;
    // A browser case gets the reviewed checker's passing result line (ADR-0078).
    const log =
      source === 'exported_package' && this.packageOutput !== null
        ? this.packageOutput
        : browser
          ? JSON.stringify({
              format: 'browser-qa/1',
              passed: true,
              reason: null,
              steps: browser.steps.map((_, index) => ({
                index,
                passed: true,
                detail: 'passed',
              })),
              page_errors: [],
              outbound: [],
            })
          : 'stdout' in (expected ?? {})
            ? (expected as { stdout: string }).stdout
            : this.interactive;
    return {
      id: randomUUID(),
      product_id: productId,
      task_id: taskId,
      commit,
      recipe: browser ? 'static-web/1' : 'python-build/1',
      recipe_hash: digest('test-double-recipe'),
      policy_hash: digest('test-double-policy'),
      input_hash: hashOfInput,
      state:
        expected && 'exit_code' in expected && expected.exit_code !== 0
          ? 'failed'
          : 'succeeded',
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
      exit_code: expected && 'exit_code' in expected ? expected.exit_code : 0,
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
    await onStarted(e.id);
    if (this.gate) {
      await this.gate.promise;
      if (this.cancelled.includes(e.id))
        return { ...e, state: 'cancelled', reason: 'cancelled', log: '' };
    }
    return e;
  }
}
