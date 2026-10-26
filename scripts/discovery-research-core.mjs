import assert from 'node:assert/strict';

export const FOLLOWUP_LIMITS = Object.freeze({
  max_new_requests: 6,
  retries: 0,
  max_concurrency: 1,
  max_request_ms: 120000,
  max_wall_ms: 720000,
  max_output_chars: 16000,
  max_input_chars: 24000,
  new_metered_spend_nano_usd: '0',
  settings_expansion: false,
});

// This is also the live runner's control loop. No retries or parallel dispatch.
export async function executeFollowup({
  manifests,
  adapter,
  journal,
  now = Date.now,
  signal,
  deadlineAt,
}) {
  const deadline = deadlineAt ?? now() + FOLLOWUP_LIMITS.max_wall_ms;
  let attempted = 0;
  const results = [];
  const ensureActive = () => {
    assert.ok(!signal?.aborted, 'Cancelled; do not dispatch.');
    assert.ok(now() < deadline, 'Total wall deadline reached.');
    assert.ok(
      attempted < FOLLOWUP_LIMITS.max_new_requests,
      'Request cap reached.',
    );
  };
  for (const manifest of manifests) {
    ensureActive();
    const qualification = await adapter.start(manifest, {
      deadline,
      signal,
      remaining_requests: FOLLOWUP_LIMITS.max_new_requests - attempted,
    });
    for (const c of manifest.cases) {
      ensureActive();
      // Persist intent before provider delivery. A crash leaves a non-resumable lock.
      attempted++;
      await journal({
        kind: 'intent',
        qualification,
        case_id: c.case_id,
        attempted,
      });
      assert.ok(
        !signal?.aborted && now() < deadline,
        'Stopped before dispatch.',
      );
      const result = await adapter.invoke(manifest, c, qualification, {
        timeout_ms: Math.min(FOLLOWUP_LIMITS.max_request_ms, deadline - now()),
        max_output_chars: FOLLOWUP_LIMITS.max_output_chars,
        signal,
      });
      results.push({
        task_class: manifest.task_class,
        case_id: c.case_id,
        split: c.split,
        ...result,
      });
      await journal({
        kind: 'outcome',
        results: structuredClone(results),
        attempted,
      });
      if (result.outcome.kind !== 'completed' || result.signal !== 'accepted') {
        // Unknown stays unresolved; no false qualification closure or retry.
        if (result.outcome.kind !== 'unknown')
          await adapter.finish(qualification);
        throw new Error(
          `Stopped at ${c.case_id}: ${result.outcome.kind}/${result.signal}; no retry.`,
        );
      }
      assert.ok(
        !signal?.aborted && now() < deadline,
        'Stopped after outcome; preserve evidence.',
      );
    }
    const decision = await adapter.finish(qualification);
    await journal({ kind: 'decision', decision });
    assert.equal(decision.state, 'qualified');
  }
  return {
    attempted,
    results,
    operational_contract_only: true,
    substantive_review: 'required_not_performed',
  };
}
