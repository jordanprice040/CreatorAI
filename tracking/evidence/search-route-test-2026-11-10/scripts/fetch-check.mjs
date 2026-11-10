// Guarded-fetch check for the search probe candidates. Uses the studio's own HttpFetchAdapter,
// checkUrl/classifyStatus and extractDocument (built from C:\dev\creator_agent_p15, whose
// packages/research matches origin/main), and repeats SourceBroker's per-hop rules. It does not
// use the studio database, grants or retrieval rows: those durable parts are NOT exercised.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const P = 'C:\\dev\\creator_agent_p15\\packages';
const { HttpFetchAdapter, extractDocument } = await import(pathToFileURL(join(P, 'research', 'dist', 'index.js')).href);
const { checkUrl, classifyStatus } = await import(pathToFileURL(join(P, 'domain', 'dist', 'index.js')).href);
const { createHash } = await import('node:crypto');
const dir = process.argv[2];
const PER_QUERY = 5;
const policy = {
  version: 'source-policy/1.0', protocols: ['https'], ports: [443], hosts: [], any_public_host: true,
  max_bytes: 3_000_000, timeout_ms: 20_000, max_redirects: 5,
  content_types: ['text/html', 'application/xhtml+xml', 'text/plain'],
  max_passages: 200, max_excerpt_chars: 500, max_fetches_per_run: 15,
};
const adapter = new HttpFetchAdapter();
const norm = (s) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim();
async function guardedFetch(raw) {
  const t0 = Date.now();
  let v = checkUrl(raw, policy);
  if (!v.ok) return { state: 'blocked', reason_code: v.reason_code, ms: Date.now() - t0 };
  let url = v.url; const redirects = [];
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), policy.timeout_ms);
  try {
    for (let hop = 0; ; hop++) {
      const out = await adapter.fetchHop({ url, signal: ctl.signal, maxBytes: policy.max_bytes, prior: 0 });
      const ms = Date.now() - t0;
      if (out.kind !== 'response') return { state: out.kind === 'blocked' ? 'blocked' : 'failed', reason_code: out.reason_code, ms };
      const cls = classifyStatus(out.status);
      if (cls === 'redirect') {
        redirects.push({ url: url.toString(), status: out.status });
        if (!out.location) return { state: 'failed', reason_code: 'redirect_without_location', ms };
        if (hop >= policy.max_redirects) return { state: 'blocked', reason_code: 'too_many_redirects', ms };
        const nv = checkUrl(new URL(out.location, url).toString(), policy);
        if (!nv.ok) return { state: 'blocked', reason_code: nv.reason_code, redirects, ms };
        url = nv.url; continue;
      }
      if (cls !== 'ok') return { state: cls, reason_code: `http_${out.status}`, final_url: url.toString(), redirects, ms };
      if (out.truncated) return { state: 'too_large', reason_code: 'byte_limit', ms };
      const media = out.content_type?.split(';')[0]?.trim().toLowerCase() ?? '';
      const content_hash = createHash('sha256').update(out.body).digest('hex');
      if (out.content_encoding && out.content_encoding !== 'identity') return { state: 'unsupported_type', reason_code: 'content_encoding', content_hash, ms };
      if (!policy.content_types.includes(media)) return { state: 'unsupported_type', reason_code: 'content_type', media, bytes: out.body.length, content_hash, ms };
      const doc = extractDocument(out.body, out.content_type, url);
      return { state: 'fetched', final_url: url.toString(), redirects, http_status: out.status, media, bytes: out.body.length, content_hash, doc, ms };
    }
  } finally { clearTimeout(timer); }
}
const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
const results = [];
const fingerprints = new Map();
for (const q of summary) {
  for (const c of q.candidates.slice(0, PER_QUERY)) {
    const retrieved_at = new Date().toISOString();
    const r = await guardedFetch(c.url);
    const row = { query: q.id, url: c.url, search_title: c.title, retrieved_at, state: r.state, reason_code: r.reason_code ?? null, ms: r.ms, redirects: r.redirects?.length ?? 0, final_url: r.final_url ?? null, media: r.media ?? null, bytes: r.bytes ?? null, content_hash: r.content_hash ?? null };
    if (r.doc) {
      const text = r.doc.paragraphs.map((p) => p.text).join('\n\n');
      const words = text.split(/\s+/).filter(Boolean).length;
      const passages = r.doc.paragraphs.filter((p) => p.text.length >= 80).length;
      // Quote check against stored text: a real sentence from the page must match exactly at its
      // locator; an invented one must not.
      const real = r.doc.paragraphs.find((p) => p.text.length >= 120);
      const quote = real ? real.text.slice(10, 90) : null;
      const at = quote ? text.indexOf(quote) : -1;
      const invented = 'volunteers who receive three reminders attend 47% more often than others';
      Object.assign(row, {
        page_title: r.doc.title, published_at: r.doc.published_at, canonical_url: r.doc.canonical_url,
        text_hash: r.doc.text_hash, fingerprint: r.doc.fingerprint, instruction_like: r.doc.instruction_like,
        paragraphs: r.doc.paragraphs.length, passages_80plus: passages, words,
        low_text: words < 300,
        title_matches_search: !!(r.doc.title && c.title && (norm(r.doc.title).includes(norm(c.title).slice(0, 40)) || norm(c.title).includes(norm(r.doc.title).slice(0, 40)))),
        quote_check: quote ? { quote, found_at: at, locator_ok: at >= 0 && text.slice(at, at + quote.length) === quote, invented_found: text.includes(invented) } : null,
      });
      const prev = fingerprints.get(r.doc.fingerprint);
      row.duplicate_of = prev ?? null;
      if (!prev) fingerprints.set(r.doc.fingerprint, c.url);
    }
    results.push(row);
    console.log(row.query, row.state, row.reason_code ?? '', row.words ?? '', row.low_text ? 'LOW_TEXT' : '', row.url);
  }
}
writeFileSync(join(dir, 'fetch-results.json'), JSON.stringify({ policy, note: 'Adapter, per-hop policy and extractor only; no studio DB, grants or retrieval rows.', results }, null, 2));
