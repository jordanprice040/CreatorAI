import { z } from './primitives.js';

/**
 * ADR-0127 (F11, first slice): local models served by Ollama on this computer. The studio only
 * talks to a loopback Ollama server, only reads the version and the installed-model list, and
 * only sends chat requests to a model the owner pinned by name and digest. It never downloads,
 * creates, copies, pushes or deletes a model, and it refuses Ollama cloud models, which the
 * local server would forward off this computer.
 *
 * Nothing in this slice offers a local route to a role: `WorkflowStore` still refuses a
 * `local` resource setup until a local route is qualified per role (a later slice).
 */

/** Ollama's documented default address, written as the IPv4 loopback rather than `localhost`. */
export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
/** Local generation can be slow on a CPU; the owner can change this in the config file. */
export const LOCAL_MODEL_DEFAULT_TIMEOUT_MS = 600_000;
/** Largest response body the adapter reads from the local server. */
export const LOCAL_MODEL_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** An Ollama model name as the server lists it, such as `family:tag` or `ns/family:tag`. */
export const LOCAL_MODEL_NAME_PATTERN =
  /^[a-z0-9][a-z0-9._/-]{0,150}(:[A-Za-z0-9._-]{1,80})?$/;
/** The digest `/api/tags` reports: 64 lowercase hex characters. */
export const LOCAL_MODEL_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Ollama cloud models (tags such as `…:cloud` or `…-cloud`) run on ollama.com even when asked
 * through the local server, so a local route never pins or calls one.
 */
export const isCloudModelName = (name: string) =>
  /(?:^|[:/-])cloud(?:$|[:/-])/i.test(name);

export const LocalModelPinSchema = z.strictObject({
  name: z
    .string()
    .regex(LOCAL_MODEL_NAME_PATTERN)
    .refine((n) => !isCloudModelName(n), 'Ollama cloud models are not local.'),
  /** The exact build the owner chose; a different digest under the same name is refused. */
  digest: z.string().regex(LOCAL_MODEL_DIGEST_PATTERN),
});
export type LocalModelPin = z.infer<typeof LocalModelPinSchema>;

/** `config/local-models.json`: owner-chosen settings, read at start, never written by the studio. */
export const LocalModelsConfigSchema = z
  .strictObject({
    recorded_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    base_url: z.string().url().default(OLLAMA_DEFAULT_BASE_URL),
    request_timeout_ms: z
      .number()
      .int()
      .min(1_000)
      .max(3_600_000)
      .default(LOCAL_MODEL_DEFAULT_TIMEOUT_MS),
    /** Ollama's `num_ctx`; null leaves the model's own default. */
    context_tokens: z
      .number()
      .int()
      .min(512)
      .max(1_048_576)
      .nullable()
      .default(null),
    /** Empty until the owner downloads a model and pins it; no model is assumed. */
    models: z.array(LocalModelPinSchema).max(20).default([]),
    note: z.string().max(2000).optional(),
  })
  .superRefine((c, ctx) => {
    const names = c.models.map((m) => m.name);
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: 'custom',
        message: 'A model is pinned twice.',
        path: ['models'],
      });
  });
export type LocalModelsConfig = z.infer<typeof LocalModelsConfigSchema>;

/** One installed model as `/api/tags` reported it, kept as reported (no invented details). */
export const LocalModelInventoryEntrySchema = z.strictObject({
  name: z.string().max(300),
  digest: z.string().max(200).nullable(),
  size_bytes: z.number().int().nonnegative().nullable(),
  family: z.string().max(200).nullable(),
  parameter_size: z.string().max(100).nullable(),
  quantization_level: z.string().max(100).nullable(),
  /** True when the server marks the model as remote or its tag names Ollama cloud. */
  remote: z.boolean(),
});
export type LocalModelInventoryEntry = z.infer<
  typeof LocalModelInventoryEntrySchema
>;

export const LOCAL_MODEL_CHECK_STATUSES = [
  /** Installed, local, and the digest matches the pin. */
  'ready',
  /** The server answered but does not list the pinned name. */
  'not_installed',
  /** The name is installed with a different digest than the pin. */
  'digest_changed',
  /** The model would run on Ollama's cloud, not this computer. */
  'remote_model',
  /** No answer from the configured loopback address. */
  'unreachable',
  /** The server answered with something that is not Ollama's documented shape. */
  'malformed',
] as const;
export const LocalModelCheckSchema = z.strictObject({
  name: z.string().max(300),
  status: z.enum(LOCAL_MODEL_CHECK_STATUSES),
  pinned_digest: z.string().max(200),
  installed_digest: z.string().max(200).nullable(),
  message: z.string().max(500),
});
export type LocalModelCheck = z.infer<typeof LocalModelCheckSchema>;
