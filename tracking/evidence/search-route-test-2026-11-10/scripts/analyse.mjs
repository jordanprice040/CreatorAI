import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const summary = [];
for (const id of ['q1-broad', 'q2-crossfield', 'q3-gap']) {
  const lines = readFileSync(join(dir, `${id}.stream.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const meta = JSON.parse(readFileSync(join(dir, `${id}.meta.json`), 'utf8'));
  const searches = [];
  const resultUrls = new Map(); let allResultText = '';
  let finalText = null, result = null;
  for (const m of lines) {
    if (m.type === 'assistant')
      for (const c of m.message.content ?? []) {
        if (c.type === 'tool_use') searches.push({ id: c.id, name: c.name, input: c.input });
        if (c.type === 'server_tool_use') searches.push({ id: c.id, name: c.name, input: c.input, server: true });
        if (c.type === 'text') finalText = c.text;
      }
    if (m.type === 'user')
      for (const c of m.message.content ?? []) {
        if (c.type === 'tool_result') {
          const txt = typeof c.content === 'string' ? c.content : JSON.stringify(c.content); allResultText += txt;
          for (const u of txt.matchAll(/https?:\/\/[^\s"'\\)\]}]+/g)) resultUrls.set(u[0], c.tool_use_id);
        }
      }
    if (m.type === 'result') result = m;
  }
  let candidates = [];
  try { candidates = JSON.parse(finalText.slice(finalText.indexOf('{'), finalText.lastIndexOf('}') + 1)).candidates; } catch { }
  const searched = new Set(resultUrls.keys());
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
  const cand = candidates.map((c) => ({ ...c, in_search_results: allResultText.includes(c.url), host: host(c.url) }));
  summary.push({
    id, query: meta.query, elapsed_ms: meta.elapsed_ms, exit_code: meta.exit_code,
    model: lines.find((l) => l.type === 'system')?.model,
    tool_calls: searches.length, search_queries: searches.map((s) => s.input?.query),
    web_search_requests_reported: result?.usage?.server_tool_use?.web_search_requests,
    usage: result?.usage && { input: result.usage.input_tokens, output: result.usage.output_tokens, cache_read: result.usage.cache_read_input_tokens, cache_create: result.usage.cache_creation_input_tokens },
    total_cost_usd_reported: result?.total_cost_usd, num_turns: result?.num_turns, terminal_reason: result?.terminal_reason,
    distinct_result_urls: searched.size,
    candidates: cand, candidate_count: cand.length,
    candidates_not_in_results: cand.filter((c) => !c.in_search_results).map((c) => c.url),
    distinct_hosts: [...new Set(cand.map((c) => c.host))].length,
  });
}
writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
for (const s of summary) console.log(JSON.stringify({ ...s, candidates: s.candidates.map((c) => `${c.in_search_results ? '' : '[NOT IN RESULTS] '}${c.url}`) }, null, 1));

