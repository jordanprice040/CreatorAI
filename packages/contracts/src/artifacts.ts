import { z, id, hash, version } from './primitives.js';
import { SpecContentSchema } from './selection.js';
import {
  BrowserPageSchema,
  BrowserStepSchema,
  BuildRecipeSchema,
} from './web-recipe.js';

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
  // ADR-0078: static-site/1 and static-web/1 for generated static web pages.
  template: z.strictObject({
    id: z.enum(['checklist/1', 'static-site/1']),
    hash,
  }),
  toolchain: z.strictObject({
    recipe: BuildRecipeSchema,
    recipe_hash: hash,
    policy_hash: hash,
    bridge_hash: hash,
    backend: z.string().max(80),
    python: z.string().max(80).nullable(),
    /** static-web/1: the pinned headless browser QA ran in; absent on Python manifests. */
    browser: z.string().max(80).nullable().optional(),
    /** ADR-0078 review M-2: present when the build roles are not qualified for this recipe. */
    role_qualification: z.literal('unqualified_trial').optional(),
    supervisor_node: z.string().max(40),
  }),
  dependencies: z.strictObject({
    kind: z.enum(['python-stdlib-only', 'static-files-only']),
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
        z.union([
          z.strictObject({
            check_key: checkKey,
            args: RunInputSchema.shape.args,
            stdin: RunInputSchema.shape.stdin,
            stdout: z.string().max(12000),
            exit_code: z.number().int(),
          }),
          // ADR-0078: a frozen browser case (static-web/1).
          z.strictObject({
            check_key: checkKey,
            page: BrowserPageSchema,
            steps: z.array(BrowserStepSchema).min(1).max(25),
          }),
        ]),
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
    // ADR-0048 plan route: the roles ran as ChatGPT-plan requests, which spend no dollars but
    // use plan quota. Absent on broker builds, so existing manifests are unchanged.
    plan_requests: z
      .strictObject({
        connection_id: id,
        model_id: z.string().min(1).max(120),
        request_ids: z.array(z.string().min(1).max(80)).min(1).max(6),
      })
      .optional(),
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
  /** Review L-11: copied from the manifest so pages show what the package itself records. */
  role_qualification: z.literal('unqualified_trial').optional(),
});
export type ArtifactSummary = z.infer<typeof ArtifactSummarySchema>;
/** ADR-0069: how long a preview lasts. Timed is still the default. */
export const PreviewLifetimeSchema = z.enum(['timed', 'until_stopped']);
export type PreviewLifetime = z.infer<typeof PreviewLifetimeSchema>;
/** An open preview page reports a viewer this often. */
export const PREVIEW_HEARTBEAT_SECONDS = 30;
/** Until stopped: a preview with no viewer for this long ends as abandoned. */
export const PREVIEW_IDLE_GRACE_SECONDS = 180;
/** A one-time preview link must be opened within this many minutes. */
export const PREVIEW_LINK_MINUTES = 10;
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
  /** ADR-0069: Timed previews end at `expires_at`; Until-stopped previews have no expiry. */
  lifetime: PreviewLifetimeSchema,
  expires_at: z.iso.datetime().nullable(),
  /** Last time an open preview page (or the opening link) showed a viewer. */
  last_seen_at: z.iso.datetime().nullable(),
  /** Until stopped: ends as abandoned when no viewer is seen by this time; null for Timed. */
  idle_until: z.iso.datetime().nullable(),
  idle_grace_seconds: z.number().int().nullable(),
  /** Runs still in flight when Stop/Revoke ended the preview: none, cancelled, or unknown. */
  cleanup: z.enum(['none', 'cancelled', 'unknown']).nullable(),
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
export const StartPreviewRequestSchema = z
  .strictObject({
    expected_manifest_sha256: hash,
    /** Omitted means Timed, as before ADR-0069. */
    lifetime: PreviewLifetimeSchema.optional(),
    /** Required for Timed; refused for Until stopped (it has no expiry to set). */
    ttl_minutes: z.number().int().min(1).max(60).optional(),
    max_runs: z.number().int().min(1).max(20),
  })
  .refine(
    (r) =>
      (r.lifetime ?? 'timed') === 'timed'
        ? r.ttl_minutes !== undefined
        : r.ttl_minutes === undefined,
    {
      message:
        'A Timed preview needs ttl_minutes; an Until-stopped preview takes none.',
      path: ['ttl_minutes'],
    },
  );
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

/**
 * ADR-0058: an owner-started interactive session of one verified package, in a console
 * window on the studio's computer, inside the isolated worker. Screen output is not
 * captured, and a session is the owner's own try, never QA or verification evidence.
 */
/** Shell-style display of the confirmed command; it is never executed through a shell. */
export function terminalCommand(args: readonly string[]): string {
  const word = (s: string) =>
    /^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
  return ['python3', 'src/main.py', ...args].map(word).join(' ');
}
/**
 * F16 / ADR-0059: how to use a package, from the exact frozen spec version it was built from.
 * Only visible (not held-out) cases of the built task appear.
 */
export const SpecGuideSchema = z.strictObject({
  flows: z.array(
    z.strictObject({
      key: z.string(),
      name: z.string(),
      steps: z.array(z.string()),
    }),
  ),
  examples: z.array(
    z.strictObject({
      check_key: z.string(),
      statement: z.string(),
      args: RunInputSchema.shape.args,
      stdin: z.string(),
      stdout: z.string(),
      exit_code: z.number().int(),
    }),
  ),
  /** Visible cases beyond the ones shown. */
  more_examples: z.number().int().min(0),
  /** The task has held-out cases that the guide deliberately leaves out. */
  held_out_hidden: z.boolean(),
});
export type SpecGuide = z.infer<typeof SpecGuideSchema>;
/**
 * ADR-0059: one command-line option as read from the package's source text (argparse
 * `add_argument` calls, or `--flag` literals beside `sys.argv`). The source is read, never run.
 */
export const CliOptionSchema = z.strictObject({
  names: z.array(z.string().max(80)).min(1).max(4),
  /** Placeholder for the value it takes (metavar, type or choices); null for a flag. */
  value: z.string().max(120).nullable(),
  help: z.string().max(400).nullable(),
  default: z.string().max(80).nullable(),
  /** A positional argument without `nargs='?'`/`'*'`, or an option with `required=True`. */
  required: z.boolean(),
  file: z.string().max(200),
});
export type CliOption = z.infer<typeof CliOptionSchema>;
export const ArtifactGuideSchema = z.strictObject({
  /** Null when the pinned spec version is missing, redacted or no longer matches. */
  spec: SpecGuideSchema.nullable(),
  command: z.array(z.string()),
  options: z.array(CliOptionSchema).max(40),
  /** How the options were found: argparse calls, sys.argv literals, or nothing found. */
  options_source: z.enum(['argparse', 'argv', 'none']),
  /** More options were found than are listed. */
  options_truncated: z.boolean(),
  /**
   * The program answers `--help` with its own description: argparse without
   * `add_help=False`, or a `--help` option of its own. Jordan's timing analyzer refused it.
   */
  help_flag: z.boolean(),
});
export type ArtifactGuide = z.infer<typeof ArtifactGuideSchema>;
export const TerminalStartRequestSchema = z.strictObject({
  manifest_sha256: hash,
  args: RunInputSchema.shape.args,
});
export type TerminalStartRequest = z.infer<typeof TerminalStartRequestSchema>;
export const TerminalStopRequestSchema = z.strictObject({ artifact_id: id });
export const TerminalSessionSchema = z.strictObject({
  id,
  product_id: id,
  artifact_id: id,
  manifest_sha256: hash,
  package_sha256: hash,
  task_id: id,
  commit: sha,
  args: RunInputSchema.shape.args,
  /** The command as shown in the confirmation, for the record. */
  command: z.string().max(8000),
  recipe: z.literal('python-terminal/1'),
  recipe_hash: hash,
  bridge_hash: hash,
  policy_hash: hash,
  state: z.enum([
    'running',
    'ended',
    'stopped',
    'timed_out',
    'window_closed',
    'lost',
    'blocked',
    'cleanup_required',
  ]),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime().nullable(),
  exit_code: z.number().int().nullable(),
  reason: z.string().max(2000).nullable(),
  environment: z.record(z.string(), z.unknown()),
  /**
   * ADR-0059: every run in the window, oldest first (the last 50), as the worker reported
   * them when the session ended. Later runs' arguments were typed by the owner in the
   * window itself. Absent on sessions recorded before reruns existed.
   */
  runs: z
    .array(
      z.strictObject({
        args: RunInputSchema.shape.args,
        exit_code: z.number().int().nullable(),
        seconds: z.number().int().min(0),
      }),
    )
    .max(50)
    .optional(),
  /** All runs in the window, including any beyond the 50 kept in `runs`. */
  run_count: z.number().int().min(0).optional(),
});
export type TerminalSession = z.infer<typeof TerminalSessionSchema>;
