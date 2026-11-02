import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GUIDE_OPTIONS,
  cliOptions,
  type PackageFile,
} from '@creator/executor';

const file = (path: string, text: string) =>
  ({ path, content: Buffer.from(text) }) as PackageFile;

test('argparse options are read from the source text with their help, value and default (ADR-0059)', () => {
  const src = `import argparse, sys
# parser.add_argument('--commented-out')
def build():
    p = argparse.ArgumentParser(description="Timing trainer")
    p.add_argument("--practice", action="store_true",
                   help="Practise live: a count-in, then "  # joined literals
                        "press Enter on each beat.")
    p.add_argument('-f', '--fps', type=float, default=60,
                   help='Frames per second (default: %(default)s)')
    p.add_argument("--beats", metavar="N", type=int, default=8, help=f"Beats {sys.argv}")
    p.add_argument("--mode", choices=["early", 'late'], help="Which side, 100%% honest")
    p.add_argument("input", nargs="?", help="Optional timing file")
    p.add_argument("--secret", help=argparse.SUPPRESS)
    p.add_argument(NAME_FROM_CONSTANT, help="computed name")
    return p
`;
  const r = cliOptions([
    file('src/helpers.py', 'x.add_argument("--fps")\n'),
    file('src/main.py', src),
    file('README.md', 'p.add_argument("--not-python")'),
  ]);
  assert.equal(r.options_source, 'argparse');
  assert.equal(r.options_truncated, false);
  const by = Object.fromEntries(r.options.map((o) => [o.names.join(' '), o]));
  // The entry point first; a duplicate from another file is listed once.
  assert.deepEqual(Object.keys(by), [
    '--practice',
    '-f --fps',
    '--beats',
    '--mode',
    'input',
  ]);
  assert.deepEqual(by['--practice'], {
    names: ['--practice'],
    value: null,
    help: 'Practise live: a count-in, then press Enter on each beat.',
    default: null,
    required: false,
    file: 'src/main.py',
  });
  assert.equal(by['-f --fps']!.value, 'FLOAT');
  assert.equal(by['-f --fps']!.default, '60');
  assert.equal(by['-f --fps']!.help, 'Frames per second (default: 60)');
  // A formatted help text depends on the running program: shown as missing.
  assert.equal(by['--beats']!.value, 'N');
  assert.equal(by['--beats']!.help, null);
  assert.equal(by['--mode']!.value, '{early,late}');
  assert.equal(by['--mode']!.help, 'Which side, 100% honest');
  assert.equal(by['input']!.value, null);
  // nargs='?' makes the positional optional.
  assert.equal(by['input']!.required, false);
  assert.equal(r.help_flag, true);
});

test('BooleanOptionalAction, range and named choices, required options and add_help=False are shown as they behave (review L-4)', () => {
  const r = cliOptions([
    file(
      'src/main.py',
      `import argparse
MODES = ["a", "b"]
p = argparse.ArgumentParser(add_help=False)
p.add_argument("--color", action=argparse.BooleanOptionalAction, default=True)
p.add_argument("--level", type=int, choices=range(1, 5))
p.add_argument("--mode", choices=MODES)
p.add_argument("--speed", choices=[1, 2.5, "x"])
p.add_argument("--out", required=True)
p.add_argument("path")
`,
    ),
  ]);
  const by = Object.fromEntries(r.options.map((o) => [o.names[0], o]));
  assert.deepEqual(by['--color']!.names, ['--color', '--no-color']);
  assert.equal(by['--color']!.value, null);
  assert.equal(by['--level']!.value, '{1..4}');
  // A constant's name says nothing about its values: the type or name stands in.
  assert.equal(by['--mode']!.value, 'MODE');
  assert.equal(by['--speed']!.value, '{1,2.5,x}');
  assert.equal(by['--out']!.required, true);
  assert.equal(by['path']!.required, true);
  assert.equal(by['--level']!.required, false);
  assert.equal(r.help_flag, false);
});

test('an unterminated quote cannot make the reader slow: the scan stays linear (review M-1)', () => {
  // Valid Python 3.12 (an f-string reusing its quote inside {}) with 200,000 quote openers.
  const evil = `x = f"{"${"'".repeat(200000)}"}"\nimport sys\nif "--go" in sys.argv: pass\n`;
  const broken = `${"'''x\n".repeat(20000)}${"'a\n".repeat(60000)}`;
  const started = Date.now();
  cliOptions([file('src/main.py', evil), file('src/other.py', broken)]);
  const many = Array.from({ length: 5000 }, () => 'p.add_argument((((').join(
    '\n',
  );
  cliOptions([file('src/main.py', many)]);
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
});

test('without argparse, --flag literals beside sys.argv are listed without descriptions; otherwise nothing', () => {
  const argv = cliOptions([
    file(
      'src/main.py',
      'import sys\nif "--plain" in sys.argv:\n    print("x")\nelif sys.argv[1:] == ["-v"]:\n    pass\nprint("--plain")\n# "--ignored"\n',
    ),
  ]);
  assert.equal(argv.options_source, 'argv');
  assert.deepEqual(
    argv.options.map((o) => [o.names, o.help]),
    [
      [['--plain'], null],
      [['-v'], null],
    ],
  );
  const none = cliOptions([file('src/main.py', 'print("hello --world")\n')]);
  assert.deepEqual(none, {
    options: [],
    options_source: 'none',
    options_truncated: false,
    help_flag: false,
  });
  // The timing analyzer's style: its own usage line, no --help (found live, 2026-11-02).
  assert.equal(argv.help_flag, false);
});

test('the option list is bounded and an unterminated call is skipped', () => {
  const many = Array.from(
    { length: MAX_GUIDE_OPTIONS + 5 },
    (_, i) => `p.add_argument("--o${i}")`,
  ).join('\n');
  const r = cliOptions([
    file(
      'src/main.py',
      `${many}\np.add_argument("--broken", help="never closed"`,
    ),
  ]);
  assert.equal(r.options.length, MAX_GUIDE_OPTIONS);
  assert.equal(r.options_truncated, true);
  assert.ok(!r.options.some((o) => o.names.includes('--broken')));
});
