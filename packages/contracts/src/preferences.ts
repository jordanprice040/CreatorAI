import { z, timestamp } from './primitives.js';

// ADR-0082 (P19): how much of the studio a person sees. One choice per person, kept on the
// server so it follows them to another browser, device or the desktop app. It changes only
// presentation: which routine fields are folded behind their visible defaults and which rarely
// used tabs are listed. It never changes a permission, a cap, a gate or what a form submits.

export const ViewModeSchema = z.enum(['standard', 'advanced']);
export type ViewMode = z.infer<typeof ViewModeSchema>;

export const ViewPreferenceSchema = z.strictObject({
  view_mode: ViewModeSchema,
  /** 0 when the person has never chosen; the studio then shows Standard. */
  version: z.number().int().min(0),
  updated_at: timestamp.nullable(),
});
export type ViewPreference = z.infer<typeof ViewPreferenceSchema>;

export const SetViewPreferenceRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  view_mode: ViewModeSchema,
});
export type SetViewPreferenceRequest = z.infer<
  typeof SetViewPreferenceRequestSchema
>;
