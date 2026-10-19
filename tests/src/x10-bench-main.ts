import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runBench } from './x10-bench.js';

// pnpm bench <out-dir> [--ideas N] [--events N] [--samples N]
const args = process.argv.slice(2);
const flag = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const n = Number(args[i + 1]);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--${name} needs a positive integer`);
  args.splice(i, 2);
  return n;
};
const ideas = flag('ideas', 10_000);
const events = flag('events', 100_000);
const samples = flag('samples', 200);
const out = args[0];
const adminUrl = process.env.CREATOR_BENCH_DATABASE_URL;
if (!out || !adminUrl) {
  console.error(
    'Usage: pnpm bench <out-dir> [--ideas 10000] [--events 100000] [--samples 200]\n' +
      'Set CREATOR_BENCH_DATABASE_URL to a disposable PostgreSQL server; the bench creates and drops its own database.',
  );
  process.exit(2);
}
const report = await runBench({
  adminUrl,
  ideas,
  events,
  samples,
  log: (l) => console.error(`[bench] ${l}`),
});
const dir = resolve(out);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'bench.json'), `${JSON.stringify(report, null, 2)}\n`);
const rows = Object.entries(report.measurements).map(
  ([k, v]) =>
    `| ${k} | ${v.samples} | ${v.p50_ms} | ${v.p95_ms} | ${v.p99_ms} | ${v.max_ms} |`,
);
writeFileSync(
  join(dir, 'bench.md'),
  [
    `# X10 benchmark (${report.label})`,
    '',
    `Declared: ${report.declared.ideas} ideas, ${report.declared.events} events. Seeded: ${JSON.stringify(report.seeded)} in ${report.seed_seconds} s.`,
    '',
    `Environment: ${JSON.stringify(report.environment)}`,
    '',
    '| Measurement | Samples | p50 ms | p95 ms | p99 ms | max ms |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    ...report.provisional_targets.map(
      (t) =>
        `- ${t.target}: measured p95 ${t.measured_p95_ms} ms, ${t.met ? 'met' : 'NOT met'}`,
    ),
    ...report.notes.map((n) => `- ${n}`),
    '',
  ].join('\n'),
);
console.log(JSON.stringify(report.measurements, null, 2));
