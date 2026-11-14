// Pure helpers for the build form's defaults and the build's package state. No imports, so
// they can be tested without a browser. They only choose what is shown first; every gate
// stays on the server.

/**
 * The budget to offer for a run: the newest one that is not bound to another run. A run or
 * task budget belongs to its own run, and the server refuses it for any other.
 */
export function envelopeFor<T extends { id: string; run_id: string | null }>(
  newestFirst: readonly T[],
  runId: string,
): T | undefined {
  return newestFirst.find((e) => e.run_id === null || e.run_id === runId);
}

/**
 * Whether a product's newest build calls for Recover: it was interrupted, its locks were left
 * held, or a test run needs reconciliation. Whole words only (PR #194 M-1): "blocked" in a
 * worker or reviewer reason is not "locked".
 */
export function needsRecover(
  newest: { state: string; reason: string | null } | undefined,
): boolean {
  return (
    newest?.state === 'interrupted' ||
    /\blocked\b|needs reconciliation|recover this product/i.test(
      newest?.reason ?? '',
    )
  );
}

/**
 * The run a build form opens on (final UX pass P-10): the run the spec was frozen in, while
 * it is active and not human-only; otherwise the newest run that can build. Never another
 * project's run while the spec's own run is there. `newestFirst` holds only active runs. A
 * plan-role build needs no model grant on its run: its one approval admits its requests
 * (ADR-0054), so grants play no part in the default.
 */
export function buildRunDefault(
  newestFirst: readonly { run_id: string; autonomy_mode: string }[],
  specRun: string | null,
): string {
  const usable = newestFirst.filter((r) => r.autonomy_mode !== 'human_only');
  return (
    usable.find((r) => r.run_id === specRun)?.run_id ?? usable[0]?.run_id ?? ''
  );
}

/** Every budget a run may draw on, in the given order: shared ones and the run's own. */
export function envelopesFor<T extends { id: string; run_id: string | null }>(
  list: readonly T[],
  runId: string,
): T[] {
  return list.filter((e) => e.run_id === null || e.run_id === runId);
}

/**
 * The Gallery artifact packaged from this build, if any: same spec version and commit. The
 * products route forgets package jobs on restart, so the artifact store is the record.
 */
export function artifactForBuild<
  T extends { commit: string; spec: { id: string; version: number } },
>(
  artifacts: readonly T[],
  build: { commit: string | null; state: string },
  spec: { spec_id: string; spec_version: number },
): T | undefined {
  // PR #194 L-2: a stopped build can share its commit with the resumed build that verified
  // and packaged it; only a verified build is the one a package came from.
  if (!build.commit || build.state !== 'verified_candidate') return undefined;
  return artifacts.find(
    (a) =>
      a.commit === build.commit &&
      a.spec.id === spec.spec_id &&
      a.spec.version === spec.spec_version,
  );
}

/**
 * ADR-0082: the Builder line of Start build's "What will happen". It names the provider the
 * work goes to, so a Claude-plan builder never reads as the ChatGPT plan.
 */
export function builderSummary(
  connection:
    | { kind: string; label: string; plan?: 'chatgpt_plan' | 'claude_code' }
    | undefined,
  fixture: boolean,
) {
  if (!connection)
    return fixture
      ? 'Fixture builder (simulated, no model call)'
      : 'Model broker (metered, reserved from the budget first)';
  const plan = connection.plan === 'claude_code' ? 'Claude' : 'ChatGPT';
  return connection.kind === 'roles'
    ? `Builder and reviewer on your ${plan} plan (${connection.label}), no metered spend`
    : `Codex on your ChatGPT plan (${connection.label}); a grant you approve must cover it`;
}
