import { z, id, timestamp } from './primitives.js';

/**
 * ADR-0093 (P28): a workspace's OpenAI API key, added in Models and connections. The key goes
 * from the browser to the studio once, into the protected vault; nothing returns it. The status
 * names only its last four characters.
 */
export const OPENAI_KEY_PATTERN = /^[A-Za-z0-9_-]{20,300}$/;
export const DEFAULT_OPENAI_KEY_MODEL = 'gpt-6-astra';

export const ApiKeySaveSchema = z.strictObject({
  // Checked by hand in the service so a refusal never repeats the value.
  api_key: z.string(),
  model_id: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9._:-]+$/),
  /** The saved key's version being replaced, or null when there is none yet. */
  expected_version: z.number().int().positive().nullable(),
});
export type ApiKeySave = z.infer<typeof ApiKeySaveSchema>;

/** Review 1 N-6: point the saved key at another model; the key itself is not sent again. */
export const ApiKeyModelSchema = z.strictObject({
  model_id: ApiKeySaveSchema.shape.model_id,
  expected_version: z.number().int().positive(),
});

export const ApiKeyRemoveSchema = z.strictObject({
  expected_version: z.number().int().positive(),
});

export const ApiKeyStatusSchema = z.strictObject({
  provider: z.literal('openai'),
  /** The studio process's own key (CREATOR_LIVE_PROVIDER=openai); it wins when both exist. */
  environment: z.strictObject({ model_id: z.string().max(200) }).nullable(),
  saved: z
    .strictObject({
      model_id: z.string().max(200),
      last_four: z.string().length(4),
      version: z.number().int().positive(),
      saved_at: timestamp,
      saved_by: id,
    })
    .nullable(),
  /** Which key a call from this workspace would use now. */
  /** `saved_unavailable`: a key is saved but this studio cannot open it (no store, missing file). */
  in_use: z.enum(['environment', 'saved', 'saved_unavailable', 'none']),
  model_id: z.string().max(200).nullable(),
  /** False when the studio has no protected store, so a key cannot be saved here. */
  can_save: z.boolean(),
  note: z.string().max(800).nullable(),
  /** Review 1 L-2: an unused key file could not be deleted from this computer just now. */
  unused_file_left: z.boolean(),
});
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;
