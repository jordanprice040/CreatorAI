// Static gates for the new combined decision, before any credential lookup.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { canonicalHash } from '../packages/domain/dist/index.js';
import {
  assertInstallation,
  assertInstalledFiles,
  verifyHashes,
  sha,
} from './check-discovery-semantics-runner.mjs';
export const DIR = 'tracking/evidence/discovery-research14-live-authorization/';
export function assertScope(p, availability, suite) {
  assert.equal(p.format, 'research14-live-authorization/1');
  assert.equal(p.availability_plan_hash, canonicalHash(availability));
  assert.equal(p.suite_execution_plan_hash, canonicalHash(suite));
  assert.equal(p.max_provider_requests, 7);
  assert.equal(p.max_availability_requests, 1);
  assert.equal(p.max_suite_requests, 6);
  assert.equal(p.retries, 0);
  assert.equal(p.credits, 'confirmed_off');
  assert.equal(p.settings_changes, false);
  assert.equal(p.quota_reset, false);
  assert.equal(p.automatic_next_action, false);
  assert.equal(availability.max_new_provider_requests, 1);
  assert.equal(availability.retries, 0);
  assert.equal(availability.max_request_ms, 120000);
  assert.equal(availability.model_id, suite.model_id);
  assert.equal(availability.connection_id, suite.connection_id);
  assert.equal(availability.workspace_id, suite.workspace_id);
  assert.equal(availability.settings_hash, suite.proposed_settings_hash);
  assert.equal(
    availability.bundle_manifest_sha256,
    suite.bundle_manifest_sha256,
  );
  assert.equal(
    availability.desktop_payload_sha256,
    suite.desktop_payload_sha256,
  );
  assert.equal(availability.suite_execution_plan_hash, canonicalHash(suite));
  assert.equal(p.availability_purpose, 'availability_recheck');
}
export async function check() {
  const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
  const planBytes = await readFile(DIR + 'authorization-plan.json');
  const p = JSON.parse(planBytes),
    a = await read(DIR + 'availability-plan.json'),
    s = await read(
      'tracking/evidence/discovery-research14-runner/execution-plan.json',
    );
  assertScope(p, a, s);
  await verifyHashes(p.source_sha256);
  await verifyHashes(a.source_sha256);
  assertInstallation(await read(p.installation_receipt), s);
  await assertInstalledFiles(s);
  execFileSync(
    process.execPath,
    [
      'scripts/qualify-discovery-research14.mjs',
      '--execution-check',
      s.studio_home,
      p.suite_execution_plan_hash,
      p.suite_review_receipt,
      p.installation_receipt,
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    ['scripts/recheck-research14-availability.mjs', '--check'],
    { stdio: 'pipe' },
  );
  return { p, planBytes };
}
if (
  process.argv[1]
    ?.replaceAll('\\', '/')
    .endsWith('/check-research14-live-authorization.mjs')
) {
  const { p, planBytes } = await check();
  if (process.argv[2] === '--approval-check') {
    assert.equal(
      process.argv[3],
      canonicalHash(p),
      'Exact new combined approval required',
    );
    const receipt = JSON.parse(await readFile(process.argv[4], 'utf8'));
    assert.equal(receipt.status, 'supported_live_authorization_package');
    assert.equal(receipt.reviewer_type, 'model');
    assert.equal(receipt.prior_implementation_involvement, false);
    assert.equal(receipt.authorization_plan_hash, canonicalHash(p));
    assert.equal(
      receipt.artifact_sha256[DIR + 'authorization-plan.json'],
      sha(planBytes),
    );
    for (const [f, h] of Object.entries(p.source_sha256))
      assert.equal(receipt.artifact_sha256[f], h);
    await verifyHashes(receipt.artifact_sha256);
  } else assert.equal(process.argv[2], '--check');
  console.log(
    JSON.stringify({
      authorization_plan_hash: canonicalHash(p),
      max_requests: 7,
      provider_calls: 0,
      status: 'static_checks_passed',
    }),
  );
}
