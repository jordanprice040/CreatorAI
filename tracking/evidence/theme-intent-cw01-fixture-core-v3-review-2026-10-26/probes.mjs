// Reviewer-only probes appended to an isolated scratch copy of tests/theme-intent-cw01-core-fixture-v3.test.mjs
// (helpers drive/base/sqlA/sqlB/request/ORDER/T/ft come from that file). Not part of the repository test suite.
// ---- reviewer-only probes (not part of the repository) ----
test('PROBE start: launch exit before creation (chain consistent)', () => {
  const run = drive({
    start_outcome: (e) => ({
      ...e,
      launch: { ...e.launch, exit_ft: ft(T + 10050) },
      chain: { ...e.chain, records: e.chain.records.map((r) => r.name === 'pg_ctl' || r.role === 'pg_ctl' ? { ...r, exit_ft: ft(T + 10050) } : r) },
    }),
  });
  console.log('PROBE_START_EXIT_BEFORE_CREATION', run.state, run.history.at(-1).reason);
});
test('PROBE R-3 toJSON: stored copy differs from checked evidence', () => {
  let run = newRun(request());
  for (const ev of ORDER.slice(0, 4)) run = step(run, ev, base[ev]());
  const a = sqlA();
  a.toJSON = function () { const { toJSON, ...rest } = this; return { ...rest, connected_at_ms: T - 100000 }; };
  run = step(run, 'sql_A', a);
  console.log('PROBE_TOJSON_A', run.state, run.ctx.sqlA?.connected_at_ms === T - 100000 ? 'STORED_DIFFERS' : 'STORED_SAME');
  run = step(run, 'sql_B', sqlB());
  console.log('PROBE_TOJSON_B', run.state, run.history.at(-1).reason);
});
test('PROBE R-3 getter: value read differently at check and at copy', () => {
  let run = newRun(request());
  for (const ev of ORDER.slice(0, 4)) run = step(run, ev, base[ev]());
  const a = sqlA();
  let n = 0;
  Object.defineProperty(a, 'connected_at_ms', { enumerable: true, get: () => (n++ === 0 ? T + 12500 : T - 100000) });
  run = step(run, 'sql_A', a);
  console.log('PROBE_GETTER_A', run.state, 'reads=' + n, 'stored=' + (run.ctx.sqlA?.connected_at_ms - T));
});
test('PROBE R-3 non-JSON field: snapshot null', () => {
  let run = newRun(request());
  for (const ev of ORDER.slice(0, 4)) run = step(run, ev, base[ev]());
  let out;
  try {
    run = step(run, 'sql_A', sqlA({}, { extra: 1n }));
    out = run.state + ' sqlA=' + JSON.stringify(run.ctx.sqlA);
    try { const r2 = step(run, 'sql_B', sqlB()); out += ' -> ' + r2.state + ' ' + r2.history.at(-1).reason; } catch (x) { out += ' -> sql_B THROWS ' + x.constructor.name; }
  } catch (x) { out = 'sql_A THROWS ' + x.constructor.name + ': ' + x.message; }
  console.log('PROBE_BIGINT_A', out);
});
test('PROBE R-1 lower edge: attestation affirmed after spawn', () => {
  // affirmed <= start intent <= spawn is enforced elsewhere; confirm.
  const run = drive({ start_intent: (e) => ({ ...e, attestation: { ...e.attestation, affirmed_at_ms: T + 10050 } }) });
  console.log('PROBE_AFFIRM_AFTER_INTENT', run.state, run.history.at(-1).reason);
});
test('PROBE R-3 toJSON false pass: stored A more permissive than checked A', () => {
  const go = (withToJSON) => {
    let run = newRun(request());
    for (const ev of ORDER.slice(0, 4)) run = step(run, ev, base[ev]());
    const a = sqlA();
    if (withToJSON) a.toJSON = function () { const { toJSON, ...rest } = this; return { ...rest, connected_at_ms: T + 40000 }; };
    run = step(run, 'sql_A', a);
    // B observed 37.5 s after A's real connection: SQL phase limit is 30 s.
    run = step(run, 'sql_B', sqlB({}, { observed_at_ms: T + 50000 }));
    return run.state + ' ' + (run.history.at(-1).reason ?? '');
  };
  console.log('PROBE_TOJSON_FALSEPASS plain=' + go(false) + ' | toJSON=' + go(true));
});
test('PROBE v2 BigInt baseline', async () => {
  const v2 = await import('../scripts/theme-intent-cw01-core-fixture-v2.mjs');
  let run = v2.newRun(request());
  // v2 SQL_ASSET is the same asset, so the request is valid for v2 as well.
  for (const ev of ORDER.slice(0, 4)) run = v2.step(run, ev, base[ev]());
  let out;
  try { run = v2.step(run, 'sql_A', sqlA({}, { extra: 1n })); out = run.state; } catch (x) { out = 'THROWS ' + x.constructor.name; }
  console.log('PROBE_V2_BIGINT state_before=' + run.state + ' result=' + out);
});
