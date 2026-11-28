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
// The frozen graders run each case under POSIX resource limits (Python's resource module and
// preexec_fn), which Windows Python lacks, so every product fails "compile failed" there.
// Changing a grader is a new benchmark version, so these runs are Linux-only (CI and WSL2).
const graderSkip = !hasPython
  ? 'python3 not on PATH'
  : process.platform === 'win32'
    ? 'the frozen grader needs POSIX resource limits (Linux or WSL2)'
    : false;
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
  { skip: graderSkip },
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
  { skip: graderSkip },
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
  { skip: graderSkip },
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

// Sets v3 and v4 (ADR-0076): the larger task again, each under its own frozen grader and FREEZE.json.
for (const [SET, LARGER3] of [
  ['v3', 'p14-larger-ledgercheck-v3'],
  ['v4', 'p14-larger-ledgercheck-v4'],
] as const) {
  const BENCH3 = join(BENCH, SET);

  test(`set ${SET} is frozen on its own, repeats the v2 larger task, and refuses scoring when edited`, async () => {
    const m = await load();
    const v3 = await m.loadSet(SET);
    assert.deepEqual(await m.verify(SET), []);
    assert.deepEqual(v3.BENCHMARKS, [LARGER3]);
    assert.equal(m.setOf(LARGER3), SET);
    assert.equal(m.setOf(LARGER), 'v2');
    // The task, cases and reference are the v2 ones; only the id and the run notes differ.
    const two = m.loadBenchmark(LARGER);
    const three = v3.loadBenchmark(LARGER3);
    assert.deepEqual(three.spec.content, two.spec.content);
    assert.deepEqual(three.cases, two.cases);
    assert.deepEqual(three.extended, two.extended);
    for (const f of [
      'main.py',
      'ledger/__init__.py',
      'ledger/parse.py',
      'ledger/rules.py',
      'ledger/report.py',
    ])
      assert.equal(
        readFileSync(join(BENCH3, LARGER3, 'reference/src', f), 'utf8'),
        readFileSync(join(BENCH, LARGER, 'reference/src', f), 'utf8'),
      );
    assert.deepEqual(
      three.expectations.known_failure_cases,
      two.expectations.known_failure_cases,
    );
    // The v2 freeze does not bind v3 files, and editing a v3 file breaks only v3.
    const p = join(BENCH3, 'grader.mjs');
    const before = readFileSync(p);
    try {
      writeFileSync(p, Buffer.concat([before, Buffer.from('\n')]));
      assert.deepEqual(await m.verify('v2'), []);
      const r = spawnSync(process.execPath, [
        script,
        'score',
        LARGER3,
        join(BENCH3, LARGER3, 'reference'),
        '--runner',
        'direct',
        '--trusted',
      ]);
      assert.equal(r.status, 2);
      assert.match(r.stderr.toString(), /Refusing to score/);
    } finally {
      writeFileSync(p, before);
    }
  });

  test(
    `the ${SET} reference passes and every listed ${SET} known failure is caught`,
    { skip: graderSkip },
    async () => {
      const m = await load();
      const v3 = await m.loadSet(SET);
      const ref = v3.score(LARGER3, join(BENCH3, LARGER3, 'reference'), {
        kind: 'direct',
      });
      assert.equal(ref.pass, true, JSON.stringify(ref.failures));
      const dir = mkdtempSync(join(tmpdir(), `p14-${SET}-mutant-`));
      try {
        for (const k of v3.loadBenchmark(LARGER3).expectations
          .known_failure_cases as { id: string; caught_by: string[] }[]) {
          const where = join(dir, k.id);
          // The reference equals the v2 one (checked above), so the v2 mutants apply.
          mutant(where, LARGER, MUTANTS[LARGER]![k.id]!);
          const r = v3.score(LARGER3, where, { kind: 'direct' });
          const failed = new Set(r.failures.map((f: { id: string }) => f.id));
          assert.ok(
            k.caught_by.some((c) => failed.has(c)),
            `${LARGER3} ${k.id}: none of ${k.caught_by.join(', ')} failed`,
          );
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}

// B3 (build capability plan, 2026-11-14): the repair benchmark p14-repair-v1, frozen as set
// repair-v1 under its own grader copy. A fair task whose easy-to-miss rules are each caught.
const REPAIR = 'p14-repair-v1';
const REPAIR_DIR = join(BENCH, 'repair-v1');
/** One mutant per listed known failure: edits of the repair reference solution. */
export const REPAIR_MUTANTS: Record<string, Edit[]> = {
  'float-average': [
    [
      'src/main.py',
      /    # Tenths, rounded half up[\s\S]*?return '%d\.%d' % \(tenths \/\/ 10, tenths % 10\)/,
      "    return '%.1f' % (total / count)",
    ],
  ],
  'builtin-round': [
    [
      'src/main.py',
      /    # Tenths, rounded half up[\s\S]*?return '%d\.%d' % \(tenths \/\/ 10, tenths % 10\)/,
      "    return '%.1f' % round(total / count, 1)",
    ],
  ],
  'records-only-line-numbers': [
    [
      'src/main.py',
      "for number, line in enumerate(sys.stdin.read().split('\\n'), start=1):",
      "number = 0\n    for line in sys.stdin.read().split('\\n'):",
    ],
    [
      'src/main.py',
      "        parts = line.split(',')",
      "        number += 1\n        parts = line.split(',')",
    ],
  ],
  'no-cr-strip': [
    [
      'src/main.py',
      "        if line.endswith('\\r'):\n            line = line[:-1]\n",
      '',
    ],
  ],
  'lowercase-display': [
    ['src/main.py', 'people[key] = [name, 0, 0]', 'people[key] = [key, 0, 0]'],
  ],
  'last-seen-spelling': [
    [
      'src/main.py',
      '        people[key][1] += score',
      '        people[key][0] = name\n        people[key][1] += score',
    ],
  ],
  'display-name-sort': [
    [
      'src/main.py',
      'rows.sort(key=lambda p: p[0].lower())',
      'rows.sort(key=lambda p: p[0])',
    ],
  ],
  'int-accepts-sign': [
    [
      'src/main.py',
      "    if not (1 <= len(text) <= 3 and all('0' <= ch <= '9' for ch in text)):\n        return None\n    value = int(text)",
      '    try:\n        value = int(text)\n    except ValueError:\n        return None\n    if value < 0:\n        return None',
    ],
  ],
  'last-comma-split': [
    [
      'src/main.py',
      "        parts = line.split(',')",
      "        parts = line.rsplit(',', 1)",
    ],
  ],
  'min-ignored': [['src/main.py', 'if p[2] >= minimum]', 'if p[2] >= 1]']],
  'min-zero': [
    ['src/main.py', '        if minimum < 1:\n            return None\n', ''],
  ],
};
function repairMutant(dir: string, edits: Edit[]) {
  cpSync(join(REPAIR_DIR, REPAIR, 'reference'), dir, { recursive: true });
  for (const [file, from, to] of edits) {
    const p = join(dir, file);
    const before = readFileSync(p, 'utf8');
    const after = before.replace(from, to);
    assert.notEqual(
      after,
      before,
      `mutant edit did not apply: ${String(from)}`,
    );
    writeFileSync(p, after);
  }
}

test('the repair benchmark is frozen on its own set and passes the studio build rules', async () => {
  const m = await load();
  assert.equal(m.setOf(REPAIR), 'repair-v1');
  assert.equal(m.setOf('p14-larger-ledgercheck-v4'), 'v4');
  assert.deepEqual(await m.verify('repair-v1'), []);
  const set = await m.loadSet('repair-v1');
  assert.deepEqual(set.BENCHMARKS, [REPAIR]);
  const b = set.loadBenchmark(REPAIR);
  // At most 10 studio cases, at least one held out, and a visible case for the rounding rule so a
  // float draft's repair feedback shows expected against actual output.
  assert.equal(b.cases.length, 10);
  assert.equal(
    b.cases.filter((c: { held_out: boolean }) => c.held_out).length,
    6,
  );
  const visible = b.cases.find((c: { id: string }) => c.id === 'A1.2');
  assert.equal(visible.held_out, false);
  assert.equal(visible.stdout, 'Cy 82.3 (4)\n');
  // The v4 freeze does not bind repair files, and editing a repair file breaks only that set.
  const p = join(REPAIR_DIR, 'grader.mjs');
  const before = readFileSync(p);
  try {
    writeFileSync(p, Buffer.concat([before, Buffer.from('\n')]));
    assert.deepEqual(await m.verify('v4'), []);
    assert.notDeepEqual(await m.verify('repair-v1'), []);
  } finally {
    writeFileSync(p, before);
  }
});

test(
  'the repair reference passes and every listed easy-to-miss mistake is caught',
  { skip: graderSkip },
  async () => {
    const m = await load();
    const set = await m.loadSet('repair-v1');
    const ref = set.score(REPAIR, join(REPAIR_DIR, REPAIR, 'reference'), {
      kind: 'direct',
    });
    assert.equal(ref.pass, true, JSON.stringify(ref.failures));
    assert.deepEqual(ref.extended, { passed: 22, total: 22 });
    const listed = set.loadBenchmark(REPAIR).expectations
      .known_failure_cases as {
      id: string;
      caught_by: string[];
    }[];
    assert.deepEqual(
      listed.map((k) => k.id).sort(),
      Object.keys(REPAIR_MUTANTS).sort(),
    );
    const dir = mkdtempSync(join(tmpdir(), 'p14-repair-mutant-'));
    try {
      for (const k of listed) {
        const where = join(dir, k.id);
        repairMutant(where, REPAIR_MUTANTS[k.id]!);
        const r = set.score(REPAIR, where, { kind: 'direct' });
        const failed = new Set(r.failures.map((f: { id: string }) => f.id));
        for (const c of k.caught_by)
          assert.ok(failed.has(c), `${k.id}: ${c} did not fail`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
