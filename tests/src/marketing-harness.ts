import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  BuildManifestSchema,
  type MarketingDraftRequest,
} from '@creator/contracts';
import type { MarketingStore, CommandContext } from '@creator/db';
import { verifiedRelease } from './payments-harness.js';

/** Explicit DB fixture seam, not execution evidence. Actual packaging gates remain in T13. */
export async function marketingRelease(
  store: MarketingStore,
  pool: pg.Pool,
  ws: string,
  ctx: CommandContext,
) {
  const h = 'a'.repeat(64);
  const task = randomUUID();
  const check = {
    check_key: 'A1',
    execution_id: randomUUID(),
    state: 'succeeded',
    input_hash: h,
    passed: true,
    reason: null,
  };
  const availability = {
    state: 'available',
    reason: 'Synthetic test fixture.',
  };
  const makeManifest = (row: {
    id: string;
    product_id: string;
    spec_id: string;
    freeze_id: string;
  }) =>
    BuildManifestSchema.parse({
      format: 'build-manifest/1',
      id: row.id,
      created_at: new Date().toISOString(),
      state: 'verified',
      workspace_id: ws,
      product_id: row.product_id,
      owner_id: ctx.actorId,
      spec: { id: row.spec_id, version: 1, hash: h, freeze_id: row.freeze_id },
      task: { id: task, key: 'T1', hash: h },
      build: {
        id: randomUUID(),
        plan_hash: h,
        prompt_hash: h,
        calls: 0,
        repairs: 0,
        fixture_roles: true,
      },
      repository: {
        commit: 'a'.repeat(40),
        base_commit: 'a'.repeat(40),
        initial_commit: 'a'.repeat(40),
        git_version: 'fixture',
      },
      template: { id: 'checklist/1', hash: h },
      toolchain: {
        recipe: 'python-build/1',
        recipe_hash: h,
        policy_hash: h,
        bridge_hash: h,
        backend: 'test-double',
        python: null,
        supervisor_node: 'fixture',
      },
      dependencies: {
        kind: 'python-stdlib-only',
        lockfile: null,
        note: 'Synthetic fixture, no execution.',
      },
      package: {
        kind: 'source_archive',
        file: 'source.tar',
        media_type: 'application/x-tar',
        sha256: h,
        bytes: 10,
        input_hash: h,
        files: [{ path: 'src/main.py', sha256: h, bytes: 10 }],
      },
      availability: {
        source_archive: availability,
        runnable_demo: availability,
        native_installer: {
          state: 'unavailable',
          reason: 'No native package.',
        },
      },
      startup: {
        runtime: 'Python fixture',
        command: ['python', 'src/main.py'],
        network: 'none',
        requirements: [],
        readiness_case: 'A1',
      },
      tests: {
        cases: [
          {
            check_key: 'A1',
            args: [],
            stdin: '',
            stdout: 'fixture only',
            exit_code: 0,
          },
        ],
        build_qa: [check],
        package: [check],
      },
      costs: {
        broker_calls: 0,
        settled_nano_usd: '0',
        unsettled_attempts: 0,
        local_compute: 'not_metered_by_studio',
      },
      lineage: { previous: null, feedback_ids: [] },
      limitations: ['Synthetic test seam; no code executed.'],
    });
  const release = await verifiedRelease(store, pool, ws, ctx, makeManifest);
  const row = (
    await pool.query('select * from artifact_manifests where id=$1', [
      release.artifact_id,
    ])
  ).rows[0];
  const manifest = BuildManifestSchema.parse(row.manifest);
  const manifest_sha256 = release.manifest_sha256;
  const request: MarketingDraftRequest = {
    artifact_id: release.artifact_id,
    manifest_sha256,
    audience: {
      description: 'Synthetic reviewers',
      provenance: 'Owner-created local fixture IDs; no real contacts.',
      recipients: ['test:one', 'test:two', 'test:three'],
    },
    experiment: {
      hypothesis: 'Reviewers can provide feedback on the recorded demo.',
      metric: 'feedback_received',
      success_threshold: 1,
      price_hypothesis_cents: 500,
      stop_rule: 'Stop at grant cap or expiry; owner may cancel.',
    },
    budget_nano_usd: '0',
    channel: 'local_fixture',
  };
  return { manifest, request, row };
}
