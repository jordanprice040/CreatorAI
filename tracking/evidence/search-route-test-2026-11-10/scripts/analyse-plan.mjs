// Summarises the plan-route runs in the same shape as summary.json, for fetch-check.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const norm = (u) => u.replace(/[?#].*$/, '').replace(/\/$/, '');
const out = [];
for (const id of ['q1-broad', 'q2-crossfield', 'q3-gap']) {
  const r = JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
  const calls = r.outcome.search_calls ?? [];
  const sources = new Set(calls.flatMap((c) => c.sources).map(norm));
  let candidates = [];
  try { const t = r.outcome.text; candidates = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).candidates; } catch { }
  const cand = candidates.map((c) => ({ ...c, in_search_results: sources.has(norm(c.url)), host: host(c.url) }));
  out.push({
    id, query: r.query, elapsed_ms: r.elapsed_ms, request_id: r.request_id, outcome_kind: r.outcome.kind,
    output_tokens: r.outcome.output_tokens, search_calls: calls.length,
    distinct_queries: [...new Set(calls.flatMap((c) => c.queries))],
    distinct_source_urls: sources.size,
    candidates: cand, candidate_count: cand.length,
    candidates_not_in_sources: cand.filter((c) => !c.in_search_results).map((c) => c.url),
    distinct_hosts: [...new Set(cand.map((c) => c.host))].length,
  });
}
writeFileSync(join(dir, 'summary.json'), JSON.stringify(out, null, 2));
for (const s of out) console.log(s.id, 'calls', s.search_calls, 'queries', s.distinct_queries.length, 'sources', s.distinct_source_urls, 'cands', s.candidate_count, 'hosts', s.distinct_hosts, 'notInSources', JSON.stringify(s.candidates_not_in_sources), 'ms', s.elapsed_ms);
