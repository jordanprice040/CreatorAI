import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  RECIPE_BENCHMARK_INFO,
  SpecContentSchema,
  z,
  type RecipeBenchmarkId,
  type RecipeBenchmarkInfo,
  type SpecContent,
} from '@creator/contracts';
import { cliCaseSchema, digest, type CliCase } from './contracts.js';

/**
 * ADR-0105: the in-app recipe benchmarks. The desktop bundle keeps the repository layout
 * (service/app/dist -> ../../../config), like config/connections/benchmarks.
 */
export const RECIPE_BENCHMARKS_ROOT = new URL(
  '../../../config/recipe-benchmarks/',
  import.meta.url,
);
/** The reviewed web checker the web benchmark's freeze names (the worker's own copy). */
const WEB_CHECKER = new URL('../worker/web_recipe.py', import.meta.url);

const freezeSchema = z.strictObject({
  format: z.literal('recipe-benchmark-freeze/1'),
  benchmark_id: z.string(),
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
});
const expectationsSchema = z
  .object({
    format: z.literal('recipe-benchmark-expectations/1'),
    benchmark_id: z.string(),
    recipe: z.string(),
    attempts: z.number().int(),
    build_plan_caps: z.object({
      max_repairs: z.number().int(),
      max_calls: z.number().int(),
      max_output_tokens: z.number().int(),
      timeout_ms: z.number().int(),
      data_class: z.literal('synthetic'),
    }),
    pass_bar_per_attempt: z.array(z.string()).min(1),
  })
  .passthrough();
const extendedSchema = z.object({
  benchmark_id: z.string(),
  cases: z.array(
    z.object({
      id: z.string().max(20),
      args: z.array(z.string()),
      stdin: z.string(),
      stdout: z.string(),
      exit_code: z.number().int(),
    }),
  ),
});

export interface RecipeBenchmark {
  info: RecipeBenchmarkInfo;
  /** The frozen spec content, exactly as the studio's spec schema parses it. */
  content: SpecContent;
  title: string;
  freeze_sha256: string;
  /**
   * Extended cases, run after the build on the exported package with the studio case rule. They
   * carry no acceptance check: `A99` is a label only, and no spec freezes it.
   */
  extended: { id: string; case: CliCase }[];
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

/**
 * Why a frozen benchmark may not run now: a file changed, was added or is missing since its
 * freeze, or the web checker the freeze names is not the worker's. Empty when it may.
 * (`scorer:` entries are source files that are not shipped; a test checks them.)
 */
export async function recipeFreezeProblems(
  id: RecipeBenchmarkId,
  root: URL = RECIPE_BENCHMARKS_ROOT,
): Promise<string[]> {
  const dir = fileURLToPath(new URL(`${id}/`, root));
  let freeze: z.infer<typeof freezeSchema>;
  try {
    freeze = freezeSchema.parse(
      JSON.parse(await readFile(join(dir, 'FREEZE.json'), 'utf8')),
    );
  } catch {
    return [`${id} is not frozen (FREEZE.json is missing or unreadable)`];
  }
  const problems: string[] = [];
  if (freeze.benchmark_id !== id)
    problems.push(`${id}: FREEZE.json names ${freeze.benchmark_id}`);
  const now = new Map<string, string>();
  for (const f of await walk(dir)) {
    const rel = relative(dir, f).split('\\').join('/');
    if (rel !== 'FREEZE.json') now.set(rel, digest(await readFile(f)));
  }
  for (const [k, v] of Object.entries(freeze.files)) {
    if (k.startsWith('scorer:')) continue;
    if (k === 'checker:web_recipe.py') {
      const h = await readFile(WEB_CHECKER)
        .then((b) => digest(b))
        .catch(() => null);
      if (h !== v)
        problems.push(
          `${id}: the worker's web checker ${h ? 'differs from' : 'is missing, unlike'} the frozen one`,
        );
      continue;
    }
    if (now.get(k) !== v)
      problems.push(
        `${id}: ${k} ${now.has(k) ? 'changed' : 'is missing'} since the freeze`,
      );
  }
  for (const k of now.keys())
    if (!(k in freeze.files))
      problems.push(`${id}: ${k} was added after the freeze`);
  return problems;
}

/** Loads a frozen in-app benchmark; refuses while its freeze is broken. */
export async function loadRecipeBenchmark(
  id: RecipeBenchmarkId,
  root: URL = RECIPE_BENCHMARKS_ROOT,
): Promise<RecipeBenchmark> {
  const problems = await recipeFreezeProblems(id, root);
  if (problems.length)
    throw new Error(`Benchmark freeze broken: ${problems.join('; ')}`);
  const dir = fileURLToPath(new URL(`${id}/`, root));
  const read = async (f: string) =>
    JSON.parse(await readFile(join(dir, f), 'utf8')) as unknown;
  const info = RECIPE_BENCHMARK_INFO[id];
  const spec = z
    .object({
      benchmark_id: z.literal(id),
      title: z.string(),
      content: z.unknown(),
    })
    .parse(await read('spec.json'));
  const content = SpecContentSchema.parse(spec.content);
  const exp = expectationsSchema.parse(await read('expectations.json'));
  const caps = exp.build_plan_caps;
  if (
    exp.benchmark_id !== id ||
    exp.recipe !== info.recipe ||
    exp.attempts !== info.attempts ||
    caps.max_calls !== info.caps.max_calls ||
    caps.max_repairs !== info.caps.max_repairs ||
    caps.max_output_tokens !== info.caps.max_output_tokens ||
    caps.timeout_ms !== info.caps.timeout_ms
  )
    throw new Error(
      `${id}: expectations differ from the studio's benchmark list`,
    );
  const extended = info.extended_cases
    ? extendedSchema
        .parse(await read('extended-cases.json'))
        .cases.map((c) => ({
          id: c.id,
          case: cliCaseSchema.parse({
            check_key: 'A99',
            args: c.args,
            stdin: c.stdin,
            stdout: c.stdout,
            exit_code: c.exit_code,
          }),
        }))
    : [];
  if (extended.length !== info.extended_cases)
    throw new Error(
      `${id}: ${extended.length} extended cases, not ${info.extended_cases}`,
    );
  return {
    info,
    content,
    title: spec.title,
    freeze_sha256: digest(await readFile(join(dir, 'FREEZE.json'))),
    extended,
  };
}
