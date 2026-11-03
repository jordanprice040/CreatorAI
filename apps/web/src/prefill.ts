/**
 * A value the Chat page hands to a form on another tab: the address to add as a source, or
 * an idea to use as a theme. Each hand-off has its own nonce, so the same text can be sent
 * twice. Filling a field submits nothing; the form and its gates do the rest. The page calls
 * `used` once it has filled the field, which clears the hand-off (PR #98 L-1).
 */
export type Prefill = { value: string; nonce: number; used: () => void } | null;
