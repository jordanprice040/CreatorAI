// P14 repo benchmarks: the frozen definitions stay intact and buildable, the frozen expected
// outputs are reachable (reference solutions pass), and the held-out cases catch known failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const script = resolve('scripts/p14-benchmark.mjs');
const load = async () => import(pathToFileURL(script).href);
const hasPython = spawnSync('python3', ['--version']).status === 0;
const BENCH = resolve('config/repo-benchmarks');

test('frozen P14 benchmarks are unchanged since the freeze and pass the studio build rules', async () => {
  const m = await load();
  assert.deepEqual(await m.verify(), []);
  const freeze = JSON.parse(readFileSync(join(BENCH, 'FREEZE.json'), 'utf8'));
  assert.equal(freeze.frozen_before_any_run, true);
  for (const id of m.BENCHMARKS as string[]) {
    const b = m.loadBenchmark(id);
    assert.ok(b.cases.some((c: { held_out: boolean }) => c.held_out));
    assert.ok(b.cases.length <= 10);
  }
});

test('an edited frozen file is reported as changed after the freeze', async () => {
  const m = await load();
  const p = join(BENCH, 'p14-small-wordtally-v1', 'expectations.json');
  const before = readFileSync(p);
  try {
    writeFileSync(
      p,
      before.toString().replace('"attempts": 3', '"attempts": 1'),
    );
    const problems: string[] = await m.verify();
    assert.ok(
      problems.some((x) =>
        x.includes('expectations.json changed after the freeze'),
      ),
    );
  } finally {
    writeFileSync(p, before);
  }
});

test('the direct runner is refused without --trusted', () => {
  const r = spawnSync(process.execPath, [
    script,
    'score',
    'p14-small-wordtally-v1',
    '.',
    '--runner',
    'direct',
  ]);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /without isolation/);
});

test(
  'reference solutions meet every frozen expected result',
  { skip: !hasPython && 'python3 not on PATH' },
  async () => {
    const m = await load();
    for (const id of m.BENCHMARKS as string[]) {
      const r = m.score(id, join(BENCH, id, 'reference'), { kind: 'direct' });
      assert.equal(r.pass, true, JSON.stringify(r.failures));
    }
  },
);

test(
  'held-out and extended cases catch the frozen known failures',
  { skip: !hasPython && 'python3 not on PATH' },
  async () => {
    const m = await load();
    const dir = mkdtempSync(join(tmpdir(), 'p14-mutant-'));
    try {
      // Small: ties ordered by first appearance. Held-out cases catch it (one development case does too).
      const small = join(dir, 'small');
      cpSync(join(BENCH, 'p14-small-wordtally-v1', 'reference'), small, {
        recursive: true,
      });
      const main = join(small, 'src', 'main.py');
      writeFileSync(
        main,
        readFileSync(main, 'utf8').replace(
          'key=lambda kv: (-kv[1], kv[0])',
          'key=lambda kv: -kv[1]',
        ),
      );
      const s = m.score('p14-small-wordtally-v1', small, { kind: 'direct' });
      assert.equal(s.pass, false);
      assert.ok(s.failures.some((f: { held_out: boolean }) => f.held_out));

      // Larger: sibling-package import without the sys.path fix fails everything under -I.
      const larger = join(dir, 'larger');
      cpSync(join(BENCH, 'p14-larger-ledgercheck-v1', 'reference'), larger, {
        recursive: true,
      });
      const lmain = join(larger, 'src', 'main.py');
      writeFileSync(
        lmain,
        readFileSync(lmain, 'utf8').replace(/^sys\.path\.insert.*$/m, ''),
      );
      const l = m.score('p14-larger-ledgercheck-v1', larger, {
        kind: 'direct',
      });
      assert.equal(l.build.passed, 0);

      // Larger: rows outside --month left unvalidated passes the build cases but not the extended suite.
      cpSync(join(BENCH, 'p14-larger-ledgercheck-v1', 'reference'), larger, {
        recursive: true,
        force: true,
      });
      const lazy = readFileSync(lmain, 'utf8').replace(
        '    rows, errors = parse_ledger(sys.stdin.read())\n',
        "    text = sys.stdin.read()\n    if month is not None:\n        text = '\\n'.join(x for x in text.split('\\n') if x.startswith(month + '-'))\n    rows, errors = parse_ledger(text)\n",
      );
      writeFileSync(lmain, lazy);
      const z = m.score('p14-larger-ledgercheck-v1', larger, {
        kind: 'direct',
      });
      assert.equal(z.build.passed, z.build.total);
      assert.ok(z.extended.passed < z.extended.total);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
