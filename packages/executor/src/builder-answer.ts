import { z } from '@creator/contracts';
import { digest, hash, pathSchema, sha, type Changes } from './contracts.js';
import { PatchRefusedError } from './products.js';

/**
 * ADR-0109 (B4): the builder/2 answer. A round may come in parts (each part is one builder
 * request; `complete: false` asks for another), and a change may be exact edits to a file
 * instead of its whole content. Nothing is applied until the round's last part: the parts are
 * resolved here into one whole-file patch, which the scoped CAS tool applies as one commit.
 */
export const editSchema = z.strictObject({
  find: z
    .string()
    .min(1)
    .max(128 * 1024),
  replace: z.string().max(128 * 1024),
});
const wholeFile = z.strictObject({
  path: pathSchema,
  before_hash: hash.nullable(),
  content: z
    .string()
    .max(128 * 1024)
    .nullable(),
});
const editedFile = z.strictObject({
  path: pathSchema,
  before_hash: hash.nullable(),
  edits: z.array(editSchema).min(1).max(50),
});
export const changeV2Schema = z.union([wholeFile, editedFile]);
export type ChangeV2 = z.infer<typeof changeV2Schema>;
export const submissionV2Schema = z.strictObject({
  expected_commit: sha,
  changes: z.array(changeV2Schema).min(1).max(100),
  /** Absent means true: a one-part round, as every builder/1 answer was. */
  complete: z.boolean().optional(),
});
export const builderV2Schema = z.strictObject({
  summary: z.string().max(2000),
  submission: submissionV2Schema.nullable(),
  blocker: z.string().max(2000).nullable(),
});
export type BuilderV2Answer = z.infer<typeof builderV2Schema>;

/** Sent to a builder/2 builder as packet data (like PATCH_RULES), and repeated in every part. */
export const ANSWER_RULES = [
  'submission.complete true (or left out) closes this round: all of its parts are applied together as one commit, then reviewed and tested. complete false keeps the parts so far, unapplied, and the next builder request continues the same round with round.part one higher.',
  'round.further_parts_allowed is how many more parts this round may still have after this answer (one request always stays for the reviewer). With 0, this answer must be complete.',
  'A part may add, replace, delete or edit files. A later part may change a path an earlier part changed; before_hash is always the hash of the file in files (null for a file that is new in this round). round.staged shows what the earlier parts of this round wrote.',
  'An edit {find, replace} replaces the one place where find occurs in the current content of the file (round.staged when this round already changed it, else files). find must occur exactly once; a file’s edits apply in order. Use content (the whole file) for new files and large rewrites.',
  'If a part is refused, the whole round is refused and nothing from it is applied; the reason comes back as feedback in the next round.',
  'Keep each answer within the answer limit by splitting a large change into parts, never by cutting a file short.',
] as const;

/** Occurrences of `find` in `text`, counting from each match's end (no overlaps). */
function occurrences(text: string, find: string): number {
  let n = 0;
  for (
    let at = text.indexOf(find);
    at !== -1;
    at = text.indexOf(find, at + find.length)
  )
    n++;
  return n;
}

type Staged = { before_hash: string | null; content: string | null };

/**
 * One round's parts, kept in memory until the round closes. A part is applied to a copy, so a
 * refused part leaves the draft as it was (the build then refuses the whole round anyway).
 */
export class RoundDraft {
  #staged = new Map<string, Staged>();
  #parts = 0;
  constructor(
    private readonly files: readonly {
      path: string;
      hash: string;
      content: string;
    }[],
  ) {}
  get parts() {
    return this.#parts;
  }
  /** Adds one part's changes. Throws PatchRefusedError, naming the change, when it cannot apply. */
  add(changes: readonly ChangeV2[]) {
    const next = new Map(this.#staged);
    const seen = new Set<string>();
    for (const c of changes) {
      if (seen.has(c.path))
        throw new PatchRefusedError(`Duplicate changed path: ${c.path}`);
      seen.add(c.path);
      const committed = this.files.find((f) => f.path === c.path) ?? null;
      const committedHash = committed?.hash ?? null;
      const earlier = next.get(c.path);
      // A path an earlier part changed keeps that part's base; otherwise the scoped CAS tool
      // checks a whole file's before_hash when the round is applied, as it always has.
      if (earlier && c.before_hash !== earlier.before_hash)
        throw new PatchRefusedError(
          `Stale file content: ${c.path} (an earlier part of this round changed it; before_hash stays the hash given in files, or null for a file not in files)`,
        );
      let content: string | null;
      if ('edits' in c) {
        // Edits need the base they were written against.
        if (!earlier && (committed === null || c.before_hash !== committedHash))
          throw new PatchRefusedError(
            committed === null
              ? `Edits need an existing file: ${c.path} is not in files (send content for a new file)`
              : `Stale file content: ${c.path} (before_hash must be the hash given in files)`,
          );
        const base = earlier ? earlier.content : committed!.content;
        if (base === null)
          throw new PatchRefusedError(
            `Edits need an existing file: an earlier part of this round deleted ${c.path}`,
          );
        content = base;
        for (const [i, e] of c.edits.entries()) {
          const n = occurrences(content, e.find);
          if (n !== 1)
            throw new PatchRefusedError(
              `Edit ${i + 1} of ${c.path} does not apply: its find text occurs ${n} times in the current content; it must occur exactly once`,
            );
          const at = content.indexOf(e.find);
          content =
            content.slice(0, at) +
            e.replace +
            content.slice(at + e.find.length);
        }
      } else content = c.content;
      const before = earlier ? earlier.before_hash : c.before_hash;
      // A file new in this round and deleted again by a later part leaves nothing to change.
      if (earlier && before === null && content === null) next.delete(c.path);
      else next.set(c.path, { before_hash: before, content });
    }
    this.#staged = next;
    this.#parts++;
  }
  /** What the earlier parts wrote, for the next part's packet (content null: deleted). */
  view() {
    return [...this.#staged].map(([path, s]) => ({
      path,
      hash: s.content === null ? null : digest(s.content),
      content: s.content,
    }));
  }
  /** The round as one whole-file patch, one change per path, for the scoped CAS tool. */
  changes(): Changes['changes'] {
    return [...this.#staged].map(([path, s]) => ({
      path,
      before_hash: s.before_hash,
      content: s.content,
    }));
  }
}

/**
 * Resolves a one-part builder/2 submission against `files` into the whole-file patch the scoped
 * CAS tool takes (plan qualification grading). Throws PatchRefusedError like a build round.
 */
export function resolveSubmission(
  submission: z.infer<typeof submissionV2Schema>,
  files: readonly { path: string; hash: string; content: string }[],
): Changes {
  const draft = new RoundDraft(files);
  draft.add(submission.changes);
  return {
    expected_commit: submission.expected_commit,
    changes: draft.changes(),
  };
}
