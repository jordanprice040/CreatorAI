// ADR-0135 review 1 (H1, M1, N4): the tester installer's PostgreSQL runtime carries the Visual
// C++ runtime and the licence notices, leaves out StackBuilder and unused lib modules, and refuses
// a DLL no notice covers. The bin listing below is the real EDB 18.1 x64 binaries zip's.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VC_RUNTIME,
  findVcRuntime,
  stagePostgres,
  uncoveredDlls,
} from '../apps/desktop/postgres-bundle.mjs';

const EDB_18_1_BIN = [
  'clusterdb.exe',
  'createdb.exe',
  'createuser.exe',
  'dropdb.exe',
  'dropuser.exe',
  'ecpg.exe',
  'icudt77.dll',
  'icuin77.dll',
  'icuio77.dll',
  'icutu77.dll',
  'icuuc77.dll',
  'initdb.exe',
  'libcrypto-3-x64.dll',
  'libcurl.dll',
  'libcurl.lib',
  'libecpg_compat.dll',
  'libecpg.dll',
  'libiconv-2.dll',
  'libintl-9.dll',
  'liblz4.dll',
  'libpgtypes.dll',
  'libpq.dll',
  'libssl-3-x64.dll',
  'libwinpthread-1.dll',
  'libxml2.dll',
  'libxslt.dll',
  'libzstd.dll',
  'oid2name.exe',
  'pg_amcheck.exe',
  'pg_archivecleanup.exe',
  'pg_basebackup.exe',
  'pg_checksums.exe',
  'pg_combinebackup.exe',
  'pg_config.exe',
  'pg_controldata.exe',
  'pg_createsubscriber.exe',
  'pg_ctl.exe',
  'pg_dump.exe',
  'pg_dumpall.exe',
  'pg_isready.exe',
  'pg_receivewal.exe',
  'pg_recvlogical.exe',
  'pg_resetwal.exe',
  'pg_restore.exe',
  'pg_rewind.exe',
  'pg_test_fsync.exe',
  'pg_test_timing.exe',
  'pg_upgrade.exe',
  'pg_verifybackup.exe',
  'pg_waldump.exe',
  'pg_walsummary.exe',
  'pgbench.exe',
  'postgres.exe',
  'psql.exe',
  'reindexdb.exe',
  'stackbuilder.exe',
  'testplug.dll',
  'vacuumdb.exe',
  'vacuumlo.exe',
  'wxbase328u_net_vc_x64_custom.dll',
  'wxbase328u_vc_x64_custom.dll',
  'wxbase328u_xml_vc_x64_custom.dll',
  'wxmsw328u_adv_vc_x64_custom.dll',
  'wxmsw328u_aui_vc_x64_custom.dll',
  'wxmsw328u_core_vc_x64_custom.dll',
  'wxmsw328u_html_vc_x64_custom.dll',
  'wxmsw328u_xrc_vc_x64_custom.dll',
  'zlib1.dll',
];

function fixture(binNames = EDB_18_1_BIN) {
  const dir = mkdtempSync(join(tmpdir(), 'pg-bundle-'));
  const src = join(dir, 'pgsql');
  for (const d of ['bin', 'lib', 'share/timezone', 'doc', 'pgAdmin 4/python'])
    mkdirSync(join(src, d), { recursive: true });
  for (const f of binNames) writeFileSync(join(src, 'bin', f), 'x');
  for (const f of [
    'plpgsql.dll',
    'plugin_debugger.dll',
    'system_stats.dll',
    'uuid-ossp.dll',
  ])
    writeFileSync(join(src, 'lib', f), 'x');
  writeFileSync(join(src, 'share/timezone/UTC'), 'tz');
  // The only Visual C++ runtime copies in the zip are pgAdmin's; they must not be used.
  for (const f of VC_RUNTIME)
    writeFileSync(join(src, 'pgAdmin 4/python', f), 'x');
  const vc = join(dir, 'crt');
  mkdirSync(vc);
  for (const f of VC_RUNTIME) writeFileSync(join(vc, f), 'crt');
  return { dir, src, vc };
}

test('stages the real EDB layout with the runtime and notices and without StackBuilder', () => {
  const { dir, src, vc } = fixture();
  try {
    const dest = join(dir, 'out');
    stagePostgres(src, dest, vc);
    const bin = readdirSync(join(dest, 'bin'));
    for (const f of VC_RUNTIME) assert.ok(bin.includes(f), `${f} staged`);
    assert.ok(bin.includes('postgres.exe') && bin.includes('icuuc77.dll'));
    assert.deepEqual(
      bin.filter((f) => /^wx|^stackbuilder|\.lib$/i.test(f)),
      [],
    );
    assert.deepEqual(readdirSync(join(dest, 'lib')), ['plpgsql.dll']);
    assert.deepEqual(readdirSync(join(dest, 'share/timezone')), ['UTC']);
    assert.deepEqual(readdirSync(dest).sort(), [
      'THIRD_PARTY_NOTICES.txt',
      'bin',
      'lib',
      'share',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a bin DLL that no licence notice covers', () => {
  const { dir, src, vc } = fixture([...EDB_18_1_BIN, 'libnew-1.dll']);
  try {
    assert.throws(
      () => stagePostgres(src, join(dir, 'out'), vc),
      /No licence notice covers libnew-1\.dll/,
    );
    assert.deepEqual(
      uncoveredDlls(EDB_18_1_BIN.filter((f) => !/^wx/i.test(f))),
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finds the Visual C++ runtime or refuses to build without it', () => {
  const { dir, src, vc } = fixture();
  try {
    const pgBin = join(src, 'bin');
    const none = { ProgramFiles: join(dir, 'pf') };
    assert.throws(
      () => findVcRuntime({ pgBin, env: none }),
      /Visual C\+\+ runtime .* was not found/,
    );
    assert.throws(
      () => findVcRuntime({ explicit: join(dir, 'empty'), pgBin, env: none }),
      /must hold vcruntime140\.dll/,
    );
    assert.equal(findVcRuntime({ explicit: vc, pgBin, env: none }), vc);
    // The newest Visual Studio redistributable folder wins.
    const msvc = join(
      dir,
      'pf',
      'Microsoft Visual Studio',
      '2022',
      'BuildTools',
      'VC',
      'Redist',
      'MSVC',
    );
    for (const ver of ['14.38.33135', '14.42.34433', '14.9.1']) {
      const crt = join(msvc, ver, 'x64', 'Microsoft.VC143.CRT');
      mkdirSync(crt, { recursive: true });
      for (const f of VC_RUNTIME) writeFileSync(join(crt, f), ver);
    }
    assert.equal(
      findVcRuntime({ pgBin, env: none }),
      join(msvc, '14.42.34433', 'x64', 'Microsoft.VC143.CRT'),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
