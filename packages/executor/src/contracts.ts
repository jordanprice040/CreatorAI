import { z, parse } from '@creator/contracts';
import { createHash } from 'node:crypto';

export const digest = (s: string | Buffer) =>
  createHash('sha256').update(s).digest('hex');
export const id = z.uuid();
export const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
// The filesystem dialect is deliberately smaller than either Git's or Windows'. ADR-0076: a
// segment may start with underscores before its first letter or digit, so Python package files
// such as __init__.py and __main__.py are admitted; a leading dot or dash still is not, and the
// generated __pycache__ directory stays out of every candidate.
export const PATH_SEGMENT = /^_*[a-z0-9][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;
export const pathSchema = z
  .string()
  .min(1)
  .max(180)
  .refine(
    (p) =>
      p
        .split('/')
        .every(
          (s) =>
            PATH_SEGMENT.test(s) &&
            s !== '__pycache__' &&
            !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/.test(s),
        ),
    {
      message:
        'Each path segment uses a-z, 0-9, _ and -, with dots only between parts; it starts with a letter or digit after optional leading underscores; __pycache__ and Windows device names are refused',
    },
  );
export const bindingSchema = z.strictObject({
  workspace_id: id,
  owner_id: id,
  spec_id: id,
  spec_version: z.number().int().positive(),
  spec_hash: hash,
  freeze_id: id,
  tasks: z
    .array(
      z.strictObject({
        key: z.string().regex(/^T[1-9][0-9]?$/),
        hash,
        file_scope: z.array(pathSchema).min(1).max(20),
      }),
    )
    .min(1)
    .max(40),
});
export type Binding = z.infer<typeof bindingSchema>;
export const productSchema = z.strictObject({
  format: z.literal('local-product/1'),
  id,
  binding: bindingSchema,
  template_hash: hash,
  integration_owner: id,
  initial_commit: sha,
  git_version: z.string().max(200),
  /** A revision starts from an earlier verified package instead of the bare template. */
  base: z
    .strictObject({
      artifact_id: id,
      manifest_sha256: hash,
      product_id: id,
      commit: sha,
    })
    .optional(),
});
export type Product = z.infer<typeof productSchema>;
export const taskSchema = z.strictObject({
  id,
  product_id: id,
  key: z.string(),
  base_commit: sha,
  file_scope: z.array(pathSchema),
  spec_task_hash: hash,
});
export type Task = z.infer<typeof taskSchema>;
export const changesSchema = z.strictObject({
  expected_commit: sha,
  changes: z
    .array(
      z.strictObject({
        path: pathSchema,
        before_hash: hash.nullable(),
        content: z
          .string()
          .max(128 * 1024)
          .nullable(),
      }),
    )
    .min(1)
    .max(100),
});
export type Changes = z.infer<typeof changesSchema>;
export const qaCaseSchema = z.strictObject({
  check_key: z.string().regex(/^A[1-9][0-9]?$/),
  args: z.array(z.string().max(500)).max(12),
  stdin: z.string().max(4000),
  stdout: z.string().max(12000),
  exit_code: z.number().int().min(0).max(125),
});
export type QaCase = z.infer<typeof qaCaseSchema>;
export const executionSchema = z.strictObject({
  id,
  product_id: id,
  task_id: id,
  commit: sha,
  recipe: z.literal('python-build/1'),
  recipe_hash: hash,
  policy_hash: hash,
  input_hash: hash,
  state: z.enum([
    'running',
    'succeeded',
    'failed',
    'blocked',
    'cancelled',
    'lost',
    'cleanup_required',
  ]),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  environment: z.record(z.string(), z.unknown()),
  log: z.string().max(70000),
  exit_code: z.number().int().nullable(),
  reason: z.string().nullable(),
});
export type Execution = z.infer<typeof executionSchema>;
export function checked<T>(schema: z.ZodType<T>, raw: unknown): T {
  return parse(schema, raw);
}
