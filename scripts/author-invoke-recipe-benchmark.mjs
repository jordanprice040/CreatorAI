#!/usr/bin/env node
// ADR-0115: authors p14-larger-ledgercheck-v6, a copy of the frozen p14-larger-ledgercheck-v5
// whose only change is the answer form its attempts' plan-route role answers may take:
// `invoke_lines_then_json_fence` (a few leading lines that are wholly an invented tool call before
// the one json fence). Spec content, studio cases, extended cases, reference, caps and pass bars
// are copied exactly (a test compares them). It refuses to overwrite and never dispatches a model.
// Usage: node scripts/author-invoke-recipe-benchmark.mjs
//        node scripts/recipe-benchmarks.mjs freeze p14-larger-ledgercheck-v6
//        pnpm format
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FROM = 'p14-larger-ledgercheck-v5';
const TO = 'p14-larger-ledgercheck-v6';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'config/recipe-benchmarks');
const src = join(DIR, FROM);
const out = join(DIR, TO);
if (existsSync(out))
  throw new Error(`${out} already exists; frozen benchmarks are not rewritten`);

cpSync(join(src, 'reference'), join(out, 'reference'), { recursive: true });
const read = (f) => JSON.parse(readFileSync(join(src, f), 'utf8'));
const write = (f, v) =>
  writeFileSync(join(out, f), `${JSON.stringify(v, null, 2)}\n`);

const spec = read('spec.json');
write('spec.json', { ...spec, benchmark_id: TO });
const extended = read('extended-cases.json');
write('extended-cases.json', { ...extended, benchmark_id: TO });

const exp = read('expectations.json');
if (exp.answer_wrapping !== undefined)
  throw new Error(`${FROM} already names an answer form`);
const { recut_note: _, ...kept } = exp;
write('expectations.json', {
  ...kept,
  benchmark_id: TO,
  copied_from: FROM,
  copy_note: `Same task as ${FROM}: spec content, studio cases, extended cases, reference, build plan caps, attempts and pass bars are unchanged; only benchmark_id, copied_from, this note, answer_wrapping and its note differ (v5's recut_note, about its own cuts before it ran, is not carried over). Authored 2026-11-15 (ADR-0115) after claude-sonnet-5-5 on the local Claude Code connection failed ${FROM} (record 49fe5782) because its first builder answer began with invented tool-call lines before one json fence. That record stays as it ran and nothing is re-graded; a pass here is not independent of it. ${FROM}'s own copy note: ${exp.copy_note}`,
  answer_wrapping: 'invoke_lines_then_json_fence',
  answer_wrapping_note:
    'Each plan-route role answer (builder and reviewer) may be exactly one ```json or bare ``` code fence around the whole answer, optionally preceded by at most 8 lines that are each wholly a one-line <invoke ...>...</invoke> or a lone </invoke> (blank lines among them allowed). Those lines are dropped unread and counted beside the call; any other text before, between or after fails the answer, as in v5',
});
console.log(`wrote ${out}; now freeze it`);
