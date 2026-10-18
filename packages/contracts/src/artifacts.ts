import { z, id, hash, version } from './primitives.js';
import { SpecContentSchema } from './selection.js';

// T13 verified artifacts, private previews and feedback. The manifest is written once by the
// local owner supervisor next to the package bytes; the database keeps an index and every
// read of the bytes re-hashes them against it.

const sha = z.string().regex(/^[a-f0-9]{40}$/);
const short = z.string().trim().min(1).max(300);
const note = z.string().trim().min(1).max(2000);
const checkKey = z.string().regex(/^A[1-9][0-9]?$/);
export const RunInputSchema = z.strictObject({
  args: z.array(z.string().max(500)).max(12),
  stdin: z.string().max(4000),
});
export type RunInput = z.infer<typeof RunInputSchema>;

const PackageFileSchema = z.strictObject({
  path: z.string().min(1).max(180),
  sha256: hash,
  bytes: z.number().int().min(0),
});
const PackageCheckSchema = z.strictObject({
  check_key: checkKey,
  execution_id: id,
  state: z.string().max(40),
  input_hash: hash,
  passed: z.boolean(),
  reason: z.string().max(2000).nullable(),
});
export const AvailabilitySchema = z.strictObject({
  state: z.enum(['available', 'unavailable']),
  reason: z.string().max(500),
});
export const BuildManifestSchema = z.strictObject({
  format: z.literal('build-manifest/1'),
  id,
  created_at: z.iso.datetime(),
  /** verified: the re-extracted package passed every case; otherwise it is kept but not offered as runnable. */
  state: z.enum(['verified', 'failed', 'blocked']),
  workspace_id: id,
  product_id: id,
  owner_id: id,
  spec: z.strictObject({ id, version, hash, freeze_id: id }),
  task: z.strictObject({ id, key: z.string().max(4), hash }),
  build: z.strictObject({
    id,
    plan_hash: hash,
    prompt_hash: hash,
    calls: z.number().int().min(0),
    repairs: z.number().int().min(0),
    fixture_roles: z.boolean(),
  }),
  repository: z.strictObject({
    commit: sha,
    base_commit: sha,
    initial_commit: sha,
    git_version: z.string().max(200),
  }),
  template: z.strictObject({ id: z.literal('checklist/1'), hash }),
  toolchain: z.strictObject({
    recipe: z.literal('python-build/1'),
    recipe_hash: hash,
    policy_hash: hash,
    bridge_hash: hash,
    backend: z.string().max(80),
    python: z.string().max(80).nullable(),
    supervisor_node: z.string().max(40),
  }),
  dependencies: z.strictObject({
    kind: z.literal('python-stdlib-only'),
    lockfile: z.null(),
    note: short,
  }),
  package: z.strictObject({
    kind: z.literal('source_archive'),
    file: z.literal('source.tar'),
    media_type: z.literal('application/x-tar'),
    sha256: hash,
    bytes: z.number().int().min(0),
    input_hash: hash,
    files: z.array(PackageFileSchema).min(1).max(100),
  }),
  availability: z.strictObject({
    source_archive: AvailabilitySchema,
    runnable_demo: AvailabilitySchema,
    native_installer: AvailabilitySchema,
  }),
  startup: z.strictObject({
    runtime: short,
    command: z.array(z.string().max(100)).min(1).max(8),
    network: z.literal('none'),
    requirements: z.array(short).max(10),
    readiness_case: checkKey,
  }),
  tests: z.strictObject({
    cases: z
      .array(
        z.strictObject({
          check_key: checkKey,
          args: RunInputSchema.shape.args,
          stdin: RunInputSchema.shape.stdin,
          stdout: z.string().max(12000),
          exit_code: z.number().int(),
        }),
      )
      .min(1)
      .max(10),
    build_qa: z.array(PackageCheckSchema).max(10),
    package: z.array(PackageCheckSchema).max(10),
  }),
  costs: z.strictObject({
    broker_calls: z.number().int().min(0),
    settled_nano_usd: z.string().regex(/^(0|[1-9][0-9]*)$/),
    unsettled_attempts: z.number().int().min(0),
    local_compute: z.literal('not_metered_by_studio'),
  }),
  lineage: z.strictObject({
    previous: z
      .strictObject({ artifact_id: id, manifest_sha256: hash })
      .nullable(),
    feedback_ids: z.array(id).max(20),
  }),
  limitations: z.array(note).max(20),
});
export type BuildManifest = z.infer<typeof BuildManifestSchema>;

export const RegisterArtifactRequestSchema = z.strictObject({
  product_id: id,
  artifact_id: id,
  manifest_sha256: hash,
});
export const ArtifactSummarySchema = z.strictObject({
  id,
  entity_id: id,
  state: BuildManifestSchema.shape.state,
  manifest_sha256: hash,
  archive_sha256: hash,
  spec: z.strictObject({ id, version }),
  commit: sha,
  backend: z.string().max(80),
  availability: BuildManifestSchema.shape.availability,
  /** Computed on read: a later spec version or a later artifact for the spec replaces this one. */
  current: z.boolean(),
  previous_id: id.nullable(),
  created_at: z.iso.datetime(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;
export const PreviewSchema = z.strictObject({
  id,
  artifact_id: id,
  manifest_sha256: hash,
  state: z.enum([
    'starting',
    'ready',
    'failed',
    'blocked',
    'stopped',
    'revoked',
    'expired',
  ]),
  readiness: z.unknown().nullable(),
  max_runs: z.number().int(),
  runs_used: z.number().int(),
  expires_at: z.iso.datetime(),
  created_at: z.iso.datetime(),
  ended_at: z.iso.datetime().nullable(),
  end_reason: z.string().max(500).nullable(),
  version,
});
export type Preview = z.infer<typeof PreviewSchema>;
export const FeedbackSchema = z.strictObject({
  id,
  artifact_id: id,
  manifest_sha256: hash,
  spec: z.strictObject({ id, version }),
  category: z.enum(['defect', 'change_request', 'question', 'praise']),
  text: note,
  status: z.enum(['submitted', 'accepted', 'declined', 'revised']),
  rationale: z.string().max(2000).nullable(),
  revision: z.strictObject({ id, version }).nullable(),
  version,
  created_at: z.iso.datetime(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
export const ArtifactDetailSchema = z.strictObject({
  artifact: ArtifactSummarySchema,
  manifest: BuildManifestSchema,
  previews: z.array(PreviewSchema),
  feedback: z.array(FeedbackSchema),
  /** Re-hashed from disk on this read; false means the stored bytes no longer match. */
  integrity: z.strictObject({
    checked_at: z.iso.datetime(),
    ok: z.boolean(),
    detail: z.string().max(500),
  }),
});
export type ArtifactDetail = z.infer<typeof ArtifactDetailSchema>;
export const StartPreviewRequestSchema = z.strictObject({
  expected_manifest_sha256: hash,
  ttl_minutes: z.number().int().min(1).max(60),
  max_runs: z.number().int().min(1).max(20),
});
export const PreviewStartSchema = z.strictObject({
  preview: PreviewSchema,
  /** One-time URL on the separate preview origin; the ticket is exchanged for a preview-only cookie. */
  url: z.string().max(500).nullable(),
});
export const StopPreviewRequestSchema = z.strictObject({
  expected_version: version,
  revoke: z.boolean(),
  reason: short,
});
export const PreviewRunSchema = z.strictObject({
  preview_id: id,
  execution_id: id.nullable(),
  state: z.string().max(40),
  stdout: z.string().max(70000),
  exit_code: z.number().int().nullable(),
  reason: z.string().max(2000).nullable(),
  runs_used: z.number().int(),
  max_runs: z.number().int(),
});
export type PreviewRun = z.infer<typeof PreviewRunSchema>;
export const SubmitFeedbackRequestSchema = z.strictObject({
  expected_manifest_sha256: hash,
  category: FeedbackSchema.shape.category,
  text: note,
});
export const DecideFeedbackRequestSchema = z.strictObject({
  expected_version: version,
  decision: z.enum(['accept', 'decline']),
  rationale: short,
});
export const FeedbackRevisionRequestSchema = z.strictObject({
  expected_version: version,
  expected_spec_version: version,
  title: short,
  content: SpecContentSchema,
  reason: short,
});
export const ArtifactComparisonSchema = z.strictObject({
  base: ArtifactSummarySchema,
  candidate: ArtifactSummarySchema,
  /** True when the candidate names the base as its previous version. */
  linked: z.boolean(),
  spec_versions: z.tuple([version, version]),
  changed_tasks: z.array(z.string().max(4)),
  files: z.array(
    z.strictObject({
      path: z.string().max(180),
      change: z.enum(['added', 'removed', 'changed', 'same']),
    }),
  ),
  tests: z.array(
    z.strictObject({
      check_key: checkKey,
      base: z.boolean().nullable(),
      candidate: z.boolean().nullable(),
    }),
  ),
  costs: z.strictObject({
    base_nano_usd: z.string(),
    candidate_nano_usd: z.string(),
    base_calls: z.number().int(),
    candidate_calls: z.number().int(),
  }),
  feedback: z.array(FeedbackSchema),
});
export type ArtifactComparison = z.infer<typeof ArtifactComparisonSchema>;
