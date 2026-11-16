import { z } from './primitives.js';

// ADR-0118 (F5): the owner's support report. The server returns the exact text, already
// redacted, so what the person previews is byte for byte what they copy.
export const SupportReportSchema = z.strictObject({
  generated_at: z.string(),
  text: z.string().max(200_000),
  /** How many secrets, emails, personal folders or names were replaced. */
  hidden: z.number().int().min(0),
});
export type SupportReport = z.infer<typeof SupportReportSchema>;
