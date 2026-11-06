import {
  ContractError,
  type BuildManifest,
  type MarketingDraftRequest,
} from '@creator/contracts';

/** Closed factual vocabulary: free-form capability/testimonial claims are not accepted. */
export function marketingContent(
  m: BuildManifest,
  req: MarketingDraftRequest,
  fixture: boolean,
) {
  const checks = m.tests.package;
  if (
    m.state !== 'verified' ||
    !checks.length ||
    checks.some((c) => !c.passed) ||
    m.tests.cases.some(
      (c) => !checks.some((p) => p.check_key === c.check_key && p.passed),
    )
  ) {
    throw new ContractError(
      'EVIDENCE_MISMATCH',
      'A complete verified package check set is required.',
    );
  }
  const label =
    fixture ||
    m.build.fixture_roles ||
    m.toolchain.backend !== 'wsl2-bwrap-systemd'
      ? 'SYNTHETIC FIXTURE — not real execution, customer validation or demand evidence.'
      : 'Recorded package verification — bounded checks, not customer validation.';
  const claims = checks.map((c) => ({
    text: `Recorded package check ${c.check_key} passed for commit ${m.repository.commit}.`,
    locator: `tests.package/${c.check_key}`,
    execution_id: c.execution_id,
    input_hash: c.input_hash,
    artifact_id: m.id,
    manifest_sha256: req.manifest_sha256,
  }));
  return {
    format: 'marketing-content/1',
    label,
    positioning:
      'Inspect a versioned product candidate and its recorded package checks.',
    landing_page: [
      label,
      'Private product evaluation draft.',
      ...claims.map((c) => c.text),
      ...m.limitations.map((l) => `Limitation: ${l}`),
      'No testimonials, customer counts, traffic or demand have been established.',
      'Call to action: inspect the private package and record feedback.',
    ].join('\n'),
    demonstrations: m.tests.cases.map((c) =>
      'steps' in c
        ? {
            check_key: c.check_key,
            page: c.page,
            steps: c.steps,
            status: 'recorded_case_not_a_new_execution',
          }
        : {
            check_key: c.check_key,
            args: c.args,
            stdin: c.stdin,
            expected_stdout: c.stdout,
            expected_exit_code: c.exit_code,
            status: 'recorded_case_not_a_new_execution',
          },
    ),
    claims,
    limitations: m.limitations,
    pricing: {
      hypothesis_cents: req.experiment.price_hypothesis_cents,
      status: 'unvalidated_hypothesis_no_checkout',
    },
    channel: 'local_fixture',
    opt_out: 'Owner records suppression before further fixture deliveries.',
  };
}
