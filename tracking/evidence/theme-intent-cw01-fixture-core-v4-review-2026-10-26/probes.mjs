// Appended to a scratch copy of tests/theme-intent-cw01-core-fixture-v4.test.mjs (with v3 and v4 cores copied beside it);
// run there with: node --test --test-name-pattern PROBE. Never run against the repository copy.
// ---- reviewer probes (scratch only) ----
import * as V3 from '../scripts/theme-intent-cw01-core-fixture-v3.mjs';
const out = [];
const tryStep = (mod, run, ev, e) => { try { const r = mod.step(run, ev, e); return { ok: true, r }; } catch (x) { return { ok: false, err: x.constructor.name + ': ' + x.message }; } };
function prefixRun(mod, k) { let run = mod.newRun(request()); for (const ev of ORDER.slice(0, k)) run = mod.step(run, ev, base[ev]()); return run; }
test('PROBE matrix: bad evidence at every state and event, v3 vs v4', () => {
  const bads = { undef: () => undefined, nul: () => null, big: () => 10n, bigfield: (ev) => ({ ...base[ev](), extra: 1n }), str: () => 'x', arr: () => [], nanTime: (ev) => ({ ...base[ev](), at_ms: NaN, observed_at_ms: NaN }), infTime: (ev) => ({ ...base[ev](), at_ms: Infinity, observed_at_ms: Infinity }) };
  let v4throws = 0, v3throws = 0, diffs = 0, progressedOnBad = 0, cells = 0;
  for (let k = 0; k <= ORDER.length; k++) {
    for (const ev of [...ORDER, 'sql_deadline']) {
      for (const [bn, bf] of Object.entries(bads)) {
        cells++;
        const r4 = tryStep({ step }, prefixRun({ newRun, step }, k), ev, bf(base[ev] ? ev : 'admit'));
        const r3 = tryStep(V3, prefixRun(V3, k), ev, bf(base[ev] ? ev : 'admit'));
        if (!r4.ok) { v4throws++; out.push(`V4 THROW k=${k} ev=${ev} bad=${bn} ${r4.err}`); }
        if (!r3.ok) v3throws++;
        if (r4.ok && r3.ok) {
          const a = [r4.r.state, r4.r.refused ?? last(r4.r).reason].join('/'), b = [r3.r.state, r3.r.refused ?? last(r3.r).reason].join('/');
          if (a !== b) { diffs++; out.push(`DIFF k=${k} ev=${ev} bad=${bn} v4=${a} v3=${b}`); }
        }
        if (r4.ok && !r4.r.refused && last(r4.r).outcome === 'accepted' && !['sql_deadline'].includes(ev) && !['nanTime','infTime','bigfield'].includes(bn)) { progressedOnBad++; out.push(`ACCEPTED-ON-BAD k=${k} ev=${ev} bad=${bn} -> ${r4.r.state}`); }
        if (r4.ok && !r4.r.refused && last(r4.r).outcome === 'accepted' && ['nanTime','infTime'].includes(bn) && ev !== 'sql_deadline') { out.push(`ACCEPTED-NONFINITE k=${k} ev=${ev} bad=${bn} -> ${r4.r.state}`); }
      }
    }
  }
  out.push(`matrix cells=${cells} v4throws=${v4throws} v3throws=${v3throws} v3/v4 diffs(both non-throwing)=${diffs}`);
});
test('PROBE plain-data differential: every carried override path gives the same state/reason in v3 and v4', () => {
  const full4 = drive(); let r3 = V3.newRun(request()); for (const ev of ORDER) r3 = V3.step(r3, ev, base[ev]());
  out.push(`happy v4=${full4.state} v3=${r3.state}; history digests equal per entry input: ${full4.history.every((e, i) => e.input_sha256 === r3.history[i].input_sha256)}`);
});
test('PROBE stored copy digest equals history input digest for every accepted step', () => {
  let run = newRun(request()); let ok = true;
  for (const ev of ORDER) { run = step(run, ev, base[ev]()); }
  ok = digest(run.ctx.sqlA) === run.history.find((e) => e.event === 'sql_A' || e.input_sha256 && false)?.input_sha256;
  const idx = run.history.findIndex((e) => e.event === 'sql_A');
  out.push(`sqlA ctx digest == history input digest: ${digest(run.ctx.sqlA) === run.history[idx]?.input_sha256} (entry event field present: ${idx >= 0})`);
  const idxB = run.history.findIndex((e) => e.event === 'sql_B');
  out.push(`sqlB ctx digest == history input digest: ${digest(run.ctx.sqlB) === run.history[idxB]?.input_sha256}`);
});
test('PROBE getter evidence is read once at copy time', () => {
  let run = prefixRun({ newRun, step }, 4); let n = 0;
  const a = sqlA(); const real = a.connected_at_ms;
  Object.defineProperty(a, 'connected_at_ms', { enumerable: true, get: () => (n++ === 0 ? real : T - 100000) });
  const r = step(run, 'sql_A', a);
  out.push(`getter reads=${n} state=${r.state} stored=${r.ctx.sqlA?.connected_at_ms === real} digestMatch=${digest(r.ctx.sqlA) === last(r).input_sha256}`);
  const v3r = tryStep(V3, prefixRun(V3, 4), 'sql_A', (() => { let m = 0; const b = sqlA(); Object.defineProperty(b, 'connected_at_ms', { enumerable: true, get: () => (m++ === 0 ? real : T - 100000) }); return b; })());
  out.push(`v3 same getter: ${v3r.ok ? v3r.r.state + '/' + (last(v3r.r).reason) : v3r.err}`);
});
test('PROBE v3 review L-1 scenario (A toJSON reports connection at T+40000, B at T+50000)', () => {
  const shifted = sqlA({}, { connected_at_ms: T + 40000 });
  for (const [name, mod] of [['v3', V3], ['v4', { newRun, step }]]) {
    let run = prefixRun(mod, 4);
    run = mod.step(run, 'sql_A', { ...sqlA(), toJSON: () => shifted });
    const ctxConn = run.ctx.sqlA?.connected_at_ms;
    const b = mod.step(run, 'sql_B', sqlB({}, { observed_at_ms: T + 50000 }));
    out.push(`${name}: A ctx.connected=${ctxConn === T + 40000 ? 'T+40000' : ctxConn} A history digest==digest(ctx)=${digest(run.ctx.sqlA) === last(run).input_sha256}; B -> ${b.state}/${last(b).reason}`);
  }
});
test('PROBE nested toJSON and Date', () => {
  let run = prefixRun({ newRun, step }, 4);
  const a = sqlA(); a.results = { ...a.results, instance: { ...a.results.instance, toJSON() { return { ...this, backend_pid: 9999, toJSON: undefined }; } } };
  const r = step(run, 'sql_A', a);
  out.push(`nested toJSON: state=${r.state}/${last(r).reason} stored pid=${r.ctx.sqlA?.results?.instance?.backend_pid} digestMatch=${digest(r.ctx.sqlA ?? null) === last(r).input_sha256}`);
  const d = step(prefixRun({ newRun, step }, 0), 'admit', { at_ms: new Date(T - 60000) });
  out.push(`Date at_ms: state=${d.state}/${d.refused ?? last(d).reason}`);
});
test('PROBE report', () => { console.log('PROBE-OUTPUT\n' + out.join('\n')); });
