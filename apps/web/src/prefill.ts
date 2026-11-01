/**
 * A value the Chat page hands to a form on another tab: the address to add as a source, or
 * an idea to use as a theme. Each hand-off has its own nonce, so the same text can be sent
 * twice. Filling a field submits nothing; the form and its gates do the rest.
 */
export type Prefill = { value: string; nonce: number } | null;
