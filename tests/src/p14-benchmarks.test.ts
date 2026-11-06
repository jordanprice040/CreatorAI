// P14 repo benchmarks: the frozen definitions and grader stay intact and buildable, the frozen
// expected outputs are reachable (reference solutions pass), every listed known failure is caught
// by the cases named for it, and the grader matches studio QA on stderr and compile errors.
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
const SMALL = 'p14-small-wordtally-v2';
const LARGER = 'p14-larger-ledgercheck-v2';

type Edit = [file: string, from: string | RegExp, to: string];
/** One mutant per listed known failure: edits of the reference solution. */
const MUTANTS: Record<string, Record<string, Edit[]>> = {
  [SMALL]: {
    'unicode-words': [['src/main.py', "r'[A-Za-z0-9]+'", "r'[^\\W_]+'"]],
    'tie-order': [
      [
        'src/main.py',
        'key=lambda kv: (-kv[1], kv[0])',
        'key=lambda kv: -kv[1]',
      ],
    ],
    'top-zero': [
      ['src/main.py', 'not 1 <= int(value) <= 50', 'not 0 <= int(value) <= 50'],
    ],
    'top-repeated': [
      ['src/main.py', "argv[i] != '--top' or seen or", "argv[i] != '--top' or"],
    ],
    'top-above-50': [['src/main.py', 'int(value) <= 50', 'int(value) <= 500']],
    'no-words-newline': [['src/main.py', "'no words\\n'", "'no words'"]],
  },
  [LARGER]: {
    'no-sys-path': [['src/main.py', /^sys\.path\.insert.*$/m, '']],
    'float-money': [
      [
        'src/ledger/parse.py',
        'return -cents if m.group(1) else cents',
        'return float(text)',
      ],
      [
        'src/ledger/report.py',
        "    sign = '-' if cents < 0 else ''\n    cents = abs(cents)\n    return '%s%d.%02d' % (sign, cents // 100, cents % 100)",
        "    return '%.2f' % cents",
      ],
    ],
    'trimmed-fields': [
      [
        'src/ledger/parse.py',
        "fields = line.split(',')",
        "fields = [f.strip() for f in line.split(',')]",
      ],
    ],
    'plus-amount': [
      [
        'src/ledger/parse.py',
        "_AMOUNT = re.compile(r'(-?)",
        "_AMOUNT = re.compile(r'\\+?(-?)",
      ],
    ],
    'month-unvalidated': [
      [
        'src/main.py',
        '    rows, errors = parse_ledger(sys.stdin.read())\n',
        "    text = sys.stdin.read()\n    if month is not None:\n        text = '\\n'.join(x for x in text.split('\\n') if x.startswith(month + '-'))\n    rows, errors = parse_ledger(text)\n",
      ],
    ],
    'errors-with-report': [
      [
        'src/main.py',
        "            sys.stdout.write('line %d: %s\\n' % (line_no, reason))\n        return 1\n",
        "            sys.stdout.write('line %d: %s\\n' % (line_no, reason))\n",
      ],
    ],
    'first-error-only': [
      [
        'src/ledger/parse.py',
        '    return rows, errors\n',
        '    return rows, errors[:1]\n',
      ],
    ],
    'absent-cap-omitted': [
      [
        'src/ledger/rules.py',
        'set(by_category) | set(caps)',
        'set(by_category)',
      ],
    ],
    'json-separators': [
      [
        'src/ledger/report.py',
        'json.dumps(body, sort_keys=True)',
        "json.dumps(body, sort_keys=True, separators=(',', ':'))",
      ],
    ],
    'json-key-order': [
      [
        'src/ledger/report.py',
        'json.dumps(body, sort_keys=True)',
        'json.dumps(body)',
      ],
    ],
    'month-repeated': [
      [
        'src/main.py',
        'if month is not None or not valid_month(value)',
        'if not valid_month(value)',
      ],
    ],
    'format-repeated': [
      [
        'src/main.py',
        "if fmt is not None or value not in ('text', 'json')",
        "if value not in ('text', 'json')",
      ],
    ],
    'cap-name-rule': [['src/main.py', 'not CATEGORY.fullmatch(name) or ', '']],
  },
};

function mutant(dir: string, id: string, edits: Edit[]) {
  cpSync(join(BENCH, id, 'reference'), dir, { recursive: true });
  for (const [file, from, to] of edits) {
    const p = join(dir, file);
    const before = readFileSync(p, 'utf8');
    const after = before.replace(from, to);
    assert.notEqual(
      after,
      before,
      `mutant edit did not apply: ${file} ${String(from)}`,
    );
    writeFileSync(p, after);
  }
}

test('frozen P14 benchmarks and grader are unchanged since the freeze and pass the studio build rules', async () => {
  const m = await load();
  assert.deepEqual(await m.verify(), []);
  const freeze = JSON.parse(readFileSync(join(BENCH, 'FREEZE.json'), 'utf8'));
  assert.ok('grader.mjs' in freeze.files);
  for (const id of m.BENCHMARKS as string[]) {
    const b = m.loadBenchmark(id);
    assert.ok(b.cases.some((c: { held_out: boolean }) => c.held_out));
    assert.ok(b.cases.length <= 10);
  }
});

test('an edited benchmark file or grader is reported, and scoring is refused', async () => {
  const m = await load();
  for (const p of [
    join(BENCH, SMALL, 'expectations.json'),
    join(BENCH, 'grader.mjs'),
  ]) {
    const before = readFileSync(p);
    try {
      writeFileSync(p, Buffer.concat([before, Buffer.from('\n')]));
      const problems: string[] = await m.verify();
      assert.ok(
        problems.some((x) => x.includes('changed after the freeze')),
        p,
      );
      const r = spawnSync(process.execPath, [
        script,
        'score',
        SMALL,
        join(BENCH, SMALL, 'reference'),
        '--runner',
        'direct',
        '--trusted',
      ]);
      assert.equal(r.status, 2);
      assert.match(r.stderr.toString(), /Refusing to score/);
    } finally {
      writeFileSync(p, before);
    }
  }
});

test('the direct runner is refused without --trusted', () => {
  const r = spawnSync(process.execPath, [
    script,
    'score',
    SMALL,
    '.',
    '--runner',
    'direct',
  ]);
  assert.equal(r.status, 2);
  assert.match(r.stderr.toString(), /without isolation/);
});

test('compare-spec accepts the stored form of the frozen spec and rejects any change', async () => {
  const m = await load();
  const spec = m.loadBenchmark(LARGER).spec;
  const body = {
    format: 'spec/1',
    alternative: { id: 'a', version: 1 },
    selection_id: 's',
    ...spec.content,
  };
  const title = 'Ledger';
  const stored = {
    title,
    body,
    content_hash: m.canonicalHash({ kind: 'specification', title, body }),
  };
  assert.deepEqual(m.compareSpec(LARGER, stored), []);
  const flipped = structuredClone(body);
  flipped.acceptance_checks[0].cases[1].held_out = false;
  const changed = {
    title,
    body: flipped,
    content_hash: m.canonicalHash({
      kind: 'specification',
      title,
      body: flipped,
    }),
  };
  assert.ok(
    m
      .compareSpec(LARGER, changed)
      .some((x: string) => x.includes('acceptance_checks')),
  );
  assert.ok(
    m
      .compareSpec(LARGER, { ...stored, content_hash: '0'.repeat(64) })
      .some((x: string) => x.includes('not the stored version')),
  );
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
  'every listed known failure is caught by the cases named for it',
  { skip: !hasPython && 'python3 not on PATH' },
  async () => {
    const m = await load();
    const dir = mkdtempSync(join(tmpdir(), 'p14-mutant-'));
    try {
      for (const id of m.BENCHMARKS as string[]) {
        const listed = m.loadBenchmark(id).expectations.known_failure_cases as {
          id: string;
          caught_by: string[];
        }[];
        assert.deepEqual(
          listed.map((k) => k.id).sort(),
          Object.keys(MUTANTS[id]!).sort(),
          `${id}: a mutant per listed failure`,
        );
        for (const k of listed) {
          const where = join(dir, `${id}-${k.id}`);
          mutant(where, id, MUTANTS[id]![k.id]!);
          const r = m.score(id, where, { kind: 'direct' });
          const failed = new Set(r.failures.map((f: { id: string }) => f.id));
          assert.ok(
            k.caught_by.some((c) => failed.has(c)),
            `${id} ${k.id}: none of ${k.caught_by.join(', ')} failed`,
          );
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test(
  'like studio QA, stderr output and a compile error in an unused module fail',
  { skip: !hasPython && 'python3 not on PATH' },
  async () => {
    const m = await load();
    const dir = mkdtempSync(join(tmpdir(), 'p14-grader-'));
    try {
      const noisy = join(dir, 'noisy');
      mutant(noisy, SMALL, [
        [
          'src/main.py',
          'def main():\n',
          "def main():\n    sys.stderr.write('warning\\n')\n",
        ],
      ]);
      assert.equal(m.score(SMALL, noisy, { kind: 'direct' }).build.passed, 0);
      const broken = join(dir, 'broken');
      mutant(broken, SMALL, []);
      writeFileSync(join(broken, 'src', 'unused.py'), 'def (:\n');
      const r = m.score(SMALL, broken, { kind: 'direct' });
      assert.equal(r.pass, false);
      assert.ok(r.compile_error);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
