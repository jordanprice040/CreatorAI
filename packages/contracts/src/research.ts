import { z, id, hash, timestamp, counter, version } from './primitives.js';

// T06 source ingestion and claim support. A source is fetched only through the source broker,
// under an owner-approved policy; retrieved text is evidence, never instructions. Nothing here
// grants authority: admission (T03) authorizes each fetch and the broker enforces the policy.
const short = z.string().trim().min(1).max(500);
const note = z.string().trim().min(1).max(1200);

export const SOURCE_POLICY_VERSION = 'source-policy/1.0' as const;
/** What may be kept from a source: bounded excerpts, or only hashes and locators. */
export const RetentionSchema = z.enum(['excerpts', 'hash_only']);
export type Retention = z.infer<typeof RetentionSchema>;
export const HostRuleSchema = z.strictObject({
  /** Exact host, or `*.example.org` for subdomains (not the apex). Lowercase ASCII. */
  host: z
    .string()
    .max(253)
    .regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/),
  retention: RetentionSchema,
});
export const FetchContentTypeSchema = z.enum([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
]);
export const SourcePolicySchema = z
  .strictObject({
    version: z.literal(SOURCE_POLICY_VERSION),
    protocols: z
      .array(z.enum(['https', 'http']))
      .min(1)
      .max(2),
    ports: z.array(z.number().int().min(1).max(65535)).min(1).max(10),
    hosts: z.array(HostRuleSchema).max(500),
    /**
     * ADR-0056: the owner's "any public website" switch. A host no rule names is fetched with
     * excerpts when it is a public DNS name; private addresses are still refused on every hop.
     * Omitted (never false) so policies without the switch keep their earlier hashes.
     */
    any_public_host: z.literal(true).optional(),
    max_bytes: counter.min(1024).max(10_000_000),
    timeout_ms: counter.min(100).max(60_000),
    max_redirects: counter.max(5),
    content_types: z.array(FetchContentTypeSchema).min(1).max(3),
    max_passages: counter.min(1).max(500),
    max_excerpt_chars: counter.min(50).max(2000),
    max_fetches_per_run: counter.min(1).max(10_000),
  })
  .refine((p) => p.hosts.length > 0 || p.any_public_host === true, {
    message:
      'A source policy names at least one host or allows any public host.',
  });
export type SourcePolicy = z.infer<typeof SourcePolicySchema>;

// ---- Owner-approved evidence websites (ADR-0056, migration 35) -----------------------------

/** At most this many website rules in Settings (the desktop window allowed 20). */
export const EVIDENCE_SITES_MAX = 100;
export const EvidenceSiteModeSchema = z.enum(['listed', 'any_public']);
export type EvidenceSiteMode = z.infer<typeof EvidenceSiteModeSchema>;
/** An exact host or `*.example.org`; a named host, never a bare IP address. */
/**
 * PR #103 review L3: `*.` under a shared public suffix (`*.co.uk`, `*.github.io`) is close to
 * "any public website" without its warnings, so it is refused. Not a full public suffix list:
 * a two-label parent whose first label is a usual registry label under a two-letter country
 * code, plus common shared hosting domains. Mirrored in apps/web/src/site-list.ts.
 */
export const SHARED_PARENT_LABELS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'go',
  'gov',
  'govt',
  'ltd',
  'me',
  'ne',
  'net',
  'nhs',
  'or',
  'org',
  'plc',
  'sch',
]);
export const SHARED_HOSTING = new Set([
  'appspot.com',
  'azurewebsites.net',
  'blogspot.com',
  'cloudfront.net',
  'firebaseapp.com',
  'github.io',
  'gitlab.io',
  'herokuapp.com',
  'netlify.app',
  'pages.dev',
  'substack.com',
  'vercel.app',
  'web.app',
  'wordpress.com',
  'workers.dev',
]);
export function sharedSuffixWildcard(host: string): boolean {
  if (!host.startsWith('*.')) return false;
  const parent = host.slice(2);
  const labels = parent.split('.');
  return (
    SHARED_HOSTING.has(parent) ||
    (labels.length === 2 &&
      labels[1]!.length === 2 &&
      SHARED_PARENT_LABELS.has(labels[0]!))
  );
}
export const EvidenceSiteHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]*[a-z][a-z0-9-]*$/,
    'Enter a website host such as www.example.org or *.example.org, with no https:// or path.',
  )
  .refine((h) => !sharedSuffixWildcard(h), {
    message:
      'A *. pattern under a shared suffix such as co.uk or github.io covers many unrelated websites; list the websites, or use any public website.',
  });
export const ChangeEvidenceSitesRequestSchema = z
  .strictObject({
    /** The version the page showed; 0 while the startup list is in force. */
    expected_version: z.number().int().min(0),
    /**
     * PR #103 review L6: with version 0, the startup list the page showed. The startup list can
     * change on a restart, so the server refuses the save if it no longer matches.
     */
    expected_startup: z
      .strictObject({
        mode: EvidenceSiteModeSchema,
        hosts: z.array(z.string().max(253)).max(EVIDENCE_SITES_MAX),
      })
      .optional(),
    mode: EvidenceSiteModeSchema,
    hosts: z.array(EvidenceSiteHostSchema).max(EVIDENCE_SITES_MAX),
    reason: note,
  })
  .refine((b) => new Set(b.hosts).size === b.hosts.length, {
    message: 'A website is listed twice.',
    path: ['hosts'],
  });
export type ChangeEvidenceSitesRequest = z.infer<
  typeof ChangeEvidenceSitesRequestSchema
>;
export const EvidenceSiteChangeSchema = z.strictObject({
  version: z.number().int().positive(),
  mode: EvidenceSiteModeSchema,
  hosts: z.array(z.string()),
  previous_mode: EvidenceSiteModeSchema,
  previous_hosts: z.array(z.string()),
  reason: z.string(),
  actor_id: id,
  created_at: timestamp,
});
export type EvidenceSiteChange = z.infer<typeof EvidenceSiteChangeSchema>;
export const EvidenceSitesSchema = z.strictObject({
  /** False when this deployment has live fetching turned off (CREATOR_SOURCE_FETCH=off). */
  live_available: z.boolean(),
  /** `settings` once the owner saved here; before that, the list the studio started with. */
  source: z.enum(['settings', 'startup']),
  version: z.number().int().min(0),
  mode: EvidenceSiteModeSchema,
  hosts: z.array(z.string()),
  startup_hosts: z.array(z.string()),
  /** Hash of the policy the next fetch in this workspace uses; null when fetching is off. */
  policy_hash: hash.nullable(),
  history: z.array(EvidenceSiteChangeSchema),
});
export type EvidenceSites = z.infer<typeof EvidenceSitesSchema>;

export const SourceFetchRequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(2000),
  task_id: id.nullable(),
  /** Stable identity of this fetch; a repeat returns the recorded retrieval. */
  logical_operation_id: id,
  justification: note,
});
export type SourceFetchRequest = z.infer<typeof SourceFetchRequestSchema>;

/**
 * Terminal outcomes of one retrieval. `blocked` means the policy refused before or during
 * contact (protocol, host, port, credentials, private address, redirect limit); `inaccessible`
 * and `removed` are the server's answer (401/402/403/451 and 404/410); `failed` is transient
 * or unknown (5xx, timeout, network loss, interruption).
 */
export const RetrievalStateSchema = z.enum([
  'in_flight',
  'fetched',
  'blocked',
  'inaccessible',
  'removed',
  'failed',
  'too_large',
  'unsupported_type',
  'denied',
  'needs_human',
]);
export type RetrievalState = z.infer<typeof RetrievalStateSchema>;
export const RetrievalSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  run_id: id,
  task_id: id.nullable(),
  logical_operation_id: id,
  adapter: z.enum(['fixture', 'http', 'none']),
  policy_hash: hash,
  requested_url: z.string().max(2000),
  final_url: z.string().max(2000).nullable(),
  redirects: z
    .array(
      z.strictObject({
        url: z.string().max(2000),
        status: z.number().int(),
      }),
    )
    .max(6),
  state: RetrievalStateSchema,
  reason_code: short,
  explanation: z.string().max(1200),
  http_status: z.number().int().nullable(),
  content_type: z.string().max(200).nullable(),
  bytes: counter.nullable(),
  content_hash: hash.nullable(),
  text_hash: hash.nullable(),
  source_id: id.nullable(),
  source_version: version.nullable(),
  /** True when this retrieval produced a new source version. */
  changed: z.boolean().nullable(),
  instruction_like: z.boolean(),
  admission_id: id.nullable(),
  decision_id: id.nullable(),
  actor_id: id,
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  replayed: z.boolean(),
});
export type Retrieval = z.infer<typeof RetrievalSchema>;

export const PassageSchema = z.strictObject({
  id,
  source_id: id,
  source_version: version,
  ordinal: counter,
  /** Character offsets into the extracted text of that exact version (hash given). */
  locator: z.strictObject({
    kind: z.literal('text_offsets/1'),
    paragraph: counter,
    start: counter,
    end: counter,
    text_hash: hash,
  }),
  /** Null when the host's retention allows hashes only, or after redaction. */
  excerpt: z.string().max(2000).nullable(),
  excerpt_truncated: z.boolean(),
  passage_hash: hash,
  /** Heuristic label for text that reads like instructions. It changes nothing it touches. */
  instruction_like: z.boolean(),
  /**
   * ADR-0086: page furniture (navigation, sign-in, sharing, interface labels, text outside the
   * marked article). Kept and citable, but listed after the page text and left out of reading.
   */
  boilerplate: z.boolean(),
});
export type Passage = z.infer<typeof PassageSchema>;

/**
 * How a passage bears on a claim. Every `supports`/`contradicts` row quotes text that occurs
 * verbatim in the stored passage; the support type says what kind of evidence it is:
 * a source's own assertion, an exact quotation, something observed in the source (a figure,
 * a table, a listed feature), or our inference from it.
 */
export const SupportStanceSchema = z.enum([
  'supports',
  'contradicts',
  'does_not_support',
  'inaccessible',
]);
export type SupportStance = z.infer<typeof SupportStanceSchema>;
export const SupportTypeSchema = z.enum([
  'source_assertion',
  'quotation',
  'observation',
  'inference',
]);
export type SupportType = z.infer<typeof SupportTypeSchema>;
const quote = z.string().trim().min(8).max(1000);
export const ClaimSupportRequestSchema = z.discriminatedUnion('evidence', [
  z
    .strictObject({
      evidence: z.literal('passage'),
      claim_version: version,
      passage_id: id,
      stance: SupportStanceSchema.exclude(['inaccessible']),
      support_type: SupportTypeSchema,
      quote: quote.nullable(),
      rationale: note,
    })
    .superRefine((r, ctx) => {
      if (r.stance !== 'does_not_support' && r.quote === null)
        ctx.addIssue({
          code: 'custom',
          message:
            'Supporting or contradicting evidence must quote the passage.',
        });
    }),
  z.strictObject({
    evidence: z.literal('inaccessible_source'),
    claim_version: version,
    source_id: id,
    source_version: version,
    rationale: note,
  }),
]);
export type ClaimSupportRequest = z.infer<typeof ClaimSupportRequestSchema>;
export const ClaimSupportSchema = z.strictObject({
  id,
  workspace_id: id,
  claim_id: id,
  claim_version: version,
  source_id: id,
  source_version: version,
  passage_id: id.nullable(),
  stance: SupportStanceSchema,
  support_type: SupportTypeSchema.nullable(),
  quote: z.string().max(1000).nullable(),
  rationale: z.string().max(1200),
  link_id: id.nullable(),
  asserted_by: id,
  created_at: timestamp,
  retracted_at: timestamp.nullable(),
  retraction_reason: short.nullable(),
});
export type ClaimSupport = z.infer<typeof ClaimSupportSchema>;
export const RetractSupportRequestSchema = z.strictObject({ reason: short });

/** Freshness of one support row at query time. Only `current` rows count. */
export const FreshnessSchema = z.enum([
  'current',
  'changed',
  'stale',
  'inaccessible',
  'removed',
  'claim_changed',
  'retracted',
]);
export type Freshness = z.infer<typeof FreshnessSchema>;
export const EvidenceStatusSchema = z.enum([
  'supported',
  'contested',
  'contradicted',
  'inferred',
  'needs_recheck',
  'inaccessible',
  'insufficient',
]);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;
export const ClaimEvidenceSchema = z.strictObject({
  claim: z.strictObject({
    id,
    version,
    title: z.string().max(500),
    statement: z.string().max(8000).nullable(),
    basis: z.enum(['observation', 'inference']).nullable(),
  }),
  status: EvidenceStatusSchema,
  labels: z.array(short).max(20),
  explanation: z.string().max(2000),
  /** Distinct source-origin clusters among counted supporting rows (reposts count once). */
  independent_origins: counter,
  contrary_origins: counter,
  max_age_days: counter,
  rows: z
    .array(
      z.strictObject({
        support: ClaimSupportSchema,
        freshness: FreshnessSchema,
        counted: z.boolean(),
        origin_cluster: id,
        source_title: z.string().max(500),
        source_url: z.string().max(2000),
        source_current_version: version,
      }),
    )
    .max(500),
});
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;

export const SourceSummarySchema = z.strictObject({
  id,
  version,
  fixture: z.boolean(),
  title: z.string().max(500),
  url: z.string().max(2000),
  retrieval_status: z.enum(['available', 'inaccessible', 'removed']),
  content_hash: hash.nullable(),
  published_at: timestamp.nullable(),
  retention: RetentionSchema,
  origin_cluster: id,
  cluster_reason: short,
  /** Other sources sharing this origin: reposts are not independent corroboration. */
  cluster_size: counter.min(1),
  last_fetched_at: timestamp.nullable(),
  latest_retrieval: z
    .strictObject({ id, state: RetrievalStateSchema, finished_at: timestamp })
    .nullable(),
  instruction_like: z.boolean(),
});
export type SourceSummary = z.infer<typeof SourceSummarySchema>;
export const SourceDetailSchema = z.strictObject({
  source: SourceSummarySchema,
  passages: z.array(PassageSchema).max(500),
  retrievals: z.array(RetrievalSchema).max(200),
  same_origin: z.array(z.strictObject({ id, url: z.string().max(2000) })),
});
export type SourceDetail = z.infer<typeof SourceDetailSchema>;
export const SourceBrokerStatusSchema = z.strictObject({
  fixture_adapter: z.literal('deterministic-fixture-corpus-v1'),
  live: z.enum(['not_configured', 'configured_unverified']),
  approved_hosts: z.array(z.string().max(260)).max(500),
  policy_hash: hash.nullable(),
  note: z.string(),
});
