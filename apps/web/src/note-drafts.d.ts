export type NoteDraft = {
    text: string;
    /** The server version the text was based on. */
    base_version: number;
    /** Text of a save that was in flight when this copy was written (review L-A). */
    sent?: string;
};
export declare function readNoteDraft(actor: string, ws: string): NoteDraft | null;
export declare function writeNoteDraft(actor: string, ws: string, draft: NoteDraft | null): void;
/** Removes every notes safety copy in this tab; called on sign-out. */
export declare function clearNoteDrafts(): void;
