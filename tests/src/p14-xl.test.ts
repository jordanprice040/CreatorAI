// ADR-0114: the frozen extra-large build benchmark p14-xl-v1. Its reference solution meets every
// frozen expected result, each listed known failure is caught by the cases it names, the studio
// limits match the frozen expectations, and its structure rule passes the reference and fails
// the packages it should. Runs the reference with the local python3 (not isolation evidence).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  MAX_BUILD_CASES,
  RECIPE_BENCHMARK_INFO,
  RECIPE_BENCHMARKS,
  SpecContentSchema,
  recipeQualificationMaxRequests,
  unqualifiedTrial,
} from '@creator/contracts';
import { frozenCases } from '@creator/domain';
import {
  importedNames,
  loadRecipeBenchmark,
  packageStructureBar,
  recipeFreezeProblems,
  type PackageStructureRule,
} from '@creator/executor';
import { firstBuilderInputFloor } from '../../apps/api/dist/recipe-qualification.js';

const ID = 'p14-xl-v1';
const DIR = fileURLToPath(
  new URL(`../../config/recipe-benchmarks/${ID}/`, import.meta.url),
);
const json = (f: string) =>
  JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Record<string, unknown>;

interface Case {
  args: string[];
  stdin: string;
  stdout: string;
  exit_code: number;
  held_out?: boolean;
}
const spec = json('spec.json') as {
  benchmark_id: string;
  content: {
    acceptance_checks: { key: string; cases: Case[] }[];
    tasks: { acceptance: string[] }[];
  };
};
const extended = (
  json('extended-cases.json') as { cases: (Case & { id: string })[] }
).cases;
const expectations = json('expectations.json') as {
  build_plan_caps: Record<string, number | string>;
  structure: PackageStructureRule & { rule: string };
  known_failure_cases: { id: string; caught_by: string[] }[];
  min_input_chars: number;
  attempt_deadline_ms: number;
  answer_wrapping: string;
};

/** Every case by its label: A1.1 is check A1's first studio case, E3 an extended case. */
const cases = new Map<string, Case>();
for (const a of spec.content.acceptance_checks)
  a.cases.forEach((c, i) => cases.set(`${a.key}.${i + 1}`, c));
for (const e of extended) cases.set(e.id, e);

const python = spawnSync('python3', ['--version']).status === 0;
function run(dir: string, c: Case) {
  const r = spawnSync('python3', ['-I', 'src/main.py', ...c.args], {
    cwd: dir,
    input: c.stdin,
    encoding: 'utf8',
    timeout: 20_000,
  });
  return r.stdout === c.stdout && r.status === c.exit_code;
}
function files(dir: string): { path: string; content: string }[] {
  const walk = (d: string): string[] =>
    readdirSync(d)
      .filter((n) => n !== '__pycache__')
      .flatMap((n) =>
        statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)],
      );
  return walk(dir)
    .sort()
    .map((f) => ({
      path: relative(dir, f).split('\\').join('/'),
      content: readFileSync(f, 'utf8'),
    }));
}
const REFERENCE = join(DIR, 'reference');

/** One mutant per listed known failure: exact edits of the reference solution. */
const MUTANTS: Record<string, [file: string, from: string, to: string][]> = {
  'no-sys-path': [
    [
      'main.py',
      'sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))',
      '',
    ],
  ],
  'newest-lot-first': [
    ['stockroom/lots.py', 'lot = lots[0]', 'lot = lots[-1]'],
    ['stockroom/lots.py', 'lots.pop(0)', 'lots.pop()'],
  ],
  'average-cost': [
    [
      'stockroom/lots.py',
      '        cost = 0\n        lots = self._lots.get(sku, [])',
      '        cost = 0\n        lots = self._lots.get(sku, [])\n        units = sum(l[0] for l in lots)\n        average = self.value(sku) // units if units else 0',
    ],
    ['stockroom/lots.py', 'cost += used * lot[1]', 'cost += used * average'],
  ],
  'allocation-stops-at-waiting': [
    [
      'stockroom/orders.py',
      '        if order.state == WAITING and book.fits(order, stock):\n            book.reserve(order)\n            done.append(order.id)',
      '        if order.state == WAITING:\n            if not book.fits(order, stock):\n                break\n            book.reserve(order)\n            done.append(order.id)',
    ],
  ],
  'no-allocation-after-cancel': [
    [
      'stockroom/commands.py',
      "return ['order %s cancelled' % order.id] + _allocation_lines(state)",
      "return ['order %s cancelled' % order.id]",
    ],
  ],
  'current-price-at-ship': [
    [
      'stockroom/commands.py',
      'order.revenue = discounted(order.total(), order.percent)',
      'order.revenue = discounted(sum(q * state.catalog.price(s) for s, q, _ in order.lines), order.percent)',
    ],
  ],
  'discount-rounded': [
    [
      'stockroom/customers.py',
      'return total - total * percent // 100',
      'return total - int(round(total * percent / 100))',
    ],
  ],
  'writeoff-ignores-reservations': [
    [
      'stockroom/commands.py',
      'if quantity > state.stock.on_hand(sku) - state.book.reserved(sku):',
      'if quantity > state.stock.on_hand(sku):',
    ],
  ],
  'ship-keeps-reservation': [
    [
      'stockroom/commands.py',
      '    state.book.release(order)\n    order.cost',
      '    order.cost',
    ],
  ],
  'order-reason-order': [
    [
      'stockroom/commands.py',
      '        quantity = _quantity(quantity_text)\n        _known_item(state, sku)',
      '        _known_item(state, sku)\n        quantity = _quantity(quantity_text)',
    ],
  ],
  'stop-at-first-error': [
    [
      'stockroom/cli.py',
      "            write('line %d: %s\\n' % (number, reason))",
      "            write('line %d: %s\\n' % (number, reason))\n            break",
    ],
  ],
  'no-report-after-errors': [
    [
      'stockroom/cli.py',
      '    for line in render_json(state)',
      '    for line in [] if errors else render_json(state)',
    ],
  ],
  'quiet-hides-errors': [
    [
      'stockroom/cli.py',
      '            errors += 1\n            write(',
      '            errors += 1\n            if not quiet:\n                write(',
    ],
  ],
  'waiting-exit-wins': [
    [
      'stockroom/cli.py',
      '    if errors:\n        return 1\n    return 3 if waiting_left(state) else 0',
      '    if waiting_left(state):\n        return 3\n    return 1 if errors else 0',
    ],
  ],
  'leading-zero-quantity': [
    ['stockroom/fields.py', "r'[1-9][0-9]{0,5}'", "r'[0-9]{1,6}'"],
    [
      'stockroom/fields.py',
      'if value > MAX_QUANTITY:',
      'if value > MAX_QUANTITY or value < 1:',
    ],
  ],
  'split-on-space': [
    [
      'stockroom/script.py',
      'tokens = line.split()',
      "tokens = [t for t in line.split(' ') if t]",
    ],
  ],
  'hash-anywhere': [
    [
      'stockroom/script.py',
      'tokens = line.split()',
      "tokens = line.split('#', 1)[0].split()",
    ],
  ],
  'json-unsorted': [
    [
      'stockroom/report_json.py',
      'json.dumps(report_data(state), sort_keys=True)',
      'json.dumps(report_data(state))',
    ],
  ],
  'failed-order-kept': [
    [
      'stockroom/commands.py',
      '    lines, seen = [], set()\n',
      '    lines, seen = [], set()\n    state.book.add(Order(order_id, customer, 0, []))\n',
    ],
    [
      'stockroom/commands.py',
      '    order = Order(order_id, customer, state.customers.percent(customer), lines)\n    state.book.add(order)',
      '    order = state.book.get(order_id)\n    order.percent = state.customers.percent(customer)\n    order.lines = lines',
    ],
  ],
  'commands-any-case': [
    [
      'stockroom/commands.py',
      'handler = COMMANDS.get(tokens[0])',
      'handler = COMMANDS.get(tokens[0].upper())',
    ],
  ],
  'six-pairs': [
    [
      'stockroom/commands.py',
      'if len(args) < 4 or len(args) > 12 or len(args) % 2 == 1:',
      'if len(args) < 4 or len(args) % 2 == 1:',
    ],
  ],
  'zero-price': [
    [
      'stockroom/commands.py',
      "if price is None or price == 0:\n        raise Refused('bad price')\n    if state.catalog.has(sku):",
      "if price is None:\n        raise Refused('bad price')\n    if state.catalog.has(sku):",
    ],
  ],
  'count-nonblank': [
    [
      'stockroom/script.py',
      "for number, line in enumerate(text.split('\\n'), start=1):",
      "for number, line in enumerate([l for l in text.split('\\n') if l.strip() and not l.strip().startswith('#')], start=1):",
    ],
  ],
  'customer-duplicate-first': [
    [
      'stockroom/commands.py',
      "    percent = parse_percent(args[1])\n    if percent is None:\n        raise Refused('bad percent')\n    if state.customers.has(args[0]):\n        raise Refused('duplicate customer')",
      "    if state.customers.has(args[0]):\n        raise Refused('duplicate customer')\n    percent = parse_percent(args[1])\n    if percent is None:\n        raise Refused('bad percent')",
    ],
  ],
  'price-unknown-first': [
    [
      'stockroom/commands.py',
      "    if price is None or price == 0:\n        raise Refused('bad price')\n    _known_item(state, sku)\n    state.catalog.set_price",
      "    _known_item(state, sku)\n    if price is None or price == 0:\n        raise Refused('bad price')\n    state.catalog.set_price",
    ],
  ],
  'receive-unknown-first': [
    [
      'stockroom/commands.py',
      '    sku = _sku(args[0])\n    quantity = _quantity(args[1])\n    cost = parse_money(args[2])',
      '    sku = _sku(args[0])\n    _known_item(state, sku)\n    quantity = _quantity(args[1])\n    cost = parse_money(args[2])',
    ],
  ],
  'writeoff-unknown-first': [
    [
      'stockroom/commands.py',
      '    quantity = _quantity(args[1])\n    _known_item(state, sku)\n    if quantity >',
      '    _known_item(state, sku)\n    quantity = _quantity(args[1])\n    if quantity >',
    ],
  ],
  'cancel-id-unchecked': [
    [
      'stockroom/commands.py',
      'order = _known_order(state, _order_id(args[0]))\n    if order.state in (SHIPPED, CANCELLED)',
      'order = _known_order(state, args[0])\n    if order.state in (SHIPPED, CANCELLED)',
    ],
  ],
  'pairs-format-first': [
    [
      'stockroom/commands.py',
      '    customer = args[1]\n    if not valid_customer(customer):',
      '    for st, qt in pairs(args[2:]):\n        _sku(st)\n        _quantity(qt)\n    customer = args[1]\n    if not valid_customer(customer):',
    ],
  ],
  'discount-per-line': [
    [
      'stockroom/commands.py',
      'order.revenue = discounted(order.total(), order.percent)',
      'order.revenue = sum(discounted(q * p, order.percent) for _, q, p in order.lines)',
    ],
  ],
  'format-equals': [
    [
      'stockroom/cli.py',
      '        else:\n            return None\n    return fmt',
      "        elif flag == '--format=json' and fmt is None:\n            fmt = 'json'\n            i += 1\n        else:\n            return None\n    return fmt",
    ],
  ],
};

test('ADR-0114: p14-xl-v1 is frozen, intact and loads with the studio limits it was frozen with', async () => {
  assert.deepEqual(await recipeFreezeProblems(ID), []);
  const b = await loadRecipeBenchmark(ID);
  const info = RECIPE_BENCHMARK_INFO[ID];
  assert.equal(b.info, info);
  assert.equal(info.copied_from, null);
  assert.equal(spec.benchmark_id, ID);
  SpecContentSchema.parse(spec.content);
  // ADR-0109's owner caps, and B4's shape: 25 cases (some held out) within a build's 30.
  assert.deepEqual(expectations.build_plan_caps, {
    ...info.caps,
    data_class: 'synthetic',
  });
  assert.equal(info.caps.max_calls, 20);
  const studio = frozenCases(b.content, b.content.tasks[0]!.acceptance);
  assert.equal(studio.length, 25);
  assert.ok(studio.length <= MAX_BUILD_CASES);
  assert.equal(studio.filter((c) => c.held_out).length, 11);
  assert.equal(b.extended.length, 37);
  assert.equal(recipeQualificationMaxRequests(info), 120);
  // The floor Start applies is the larger of the first builder request and the frozen one.
  assert.equal(info.min_input_chars, expectations.min_input_chars);
  assert.ok(firstBuilderInputFloor(b) < info.min_input_chars);
  assert.equal(info.attempt_deadline_ms, expectations.attempt_deadline_ms);
  // Jordan's choice: stray tool-call lines before the fence are dropped, as on ledger v6.
  assert.equal(info.answer_wrapping, 'invoke_lines_then_json_fence');
  assert.equal(expectations.answer_wrapping, info.answer_wrapping);
  const { rule: _, ...rule } = expectations.structure;
  assert.deepEqual(b.structure, rule);
});

test(
  'ADR-0114: the reference is 13 Python files and meets every frozen expected result',
  { skip: !python && 'python3 is not installed' },
  () => {
    const py = files(REFERENCE).filter((f) => f.path.endsWith('.py'));
    assert.equal(py.length, 13);
    assert.ok(
      py.reduce((n, f) => n + f.content.length, 0) > 16_000,
      'more than one builder answer holds at the default answer cap',
    );
    for (const [label, c] of cases)
      assert.ok(run(REFERENCE, c), `${label} fails on the reference`);
  },
);

test(
  'ADR-0114: each listed known failure is caught by the cases it names',
  { skip: !python && 'python3 is not installed' },
  () => {
    const listed = expectations.known_failure_cases;
    assert.deepEqual(
      listed.map((k) => k.id).sort(),
      Object.keys(MUTANTS).sort(),
      'one mutant per known failure',
    );
    for (const k of listed) {
      const dir = mkdtempSync(join(tmpdir(), 'p14-xl-'));
      try {
        cpSync(REFERENCE, dir, {
          recursive: true,
          // Never copy bytecode a reference run left behind.
          filter: (src) => !src.includes('__pycache__'),
        });
        for (const [file, from, to] of MUTANTS[k.id]!) {
          const p = join(dir, 'src', file);
          const text = readFileSync(p, 'utf8');
          assert.equal(
            text.split(from).length,
            2,
            `${k.id}: edit applies once`,
          );
          writeFileSync(p, text.replace(from, to));
        }
        for (const label of k.caught_by) {
          const c = cases.get(label);
          assert.ok(c, `${k.id}: ${label} exists`);
          assert.equal(run(dir, c), false, `${k.id} is not caught by ${label}`);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  },
);

test('ADR-0114: the structure rule passes the reference and fails what it should', () => {
  const rule = expectations.structure;
  const ok = files(REFERENCE);
  const bar = packageStructureBar(ok, rule);
  assert.equal(bar.passed, true, bar.detail);
  const edit = (path: string, content: string | null) =>
    packageStructureBar(
      content === null
        ? ok.filter((f) => f.path !== path)
        : ok.map((f) => (f.path === path ? { ...f, content } : f)),
      rule,
    ).detail;
  assert.match(
    edit('src/stockroom/lots.py', null),
    /src\/stockroom\/lots\.py is missing/,
  );
  assert.match(
    edit('src/stockroom/__init__.py', null),
    /__init__\.py is missing/,
  );
  assert.match(
    edit('src/stockroom/money.py', 'X = 1\n'),
    /money\.py has no top-level function/,
  );
  assert.match(
    edit('src/stockroom/fields.py', 'def f():\n    return (1\n'),
    /fields\.py can't be read as Python \(a bracket is never closed\)/,
  );
  assert.match(
    edit('src/main.py', '# from stockroom.cli import run\nprint(1)\n'),
    /src\/main\.py does not import from stockroom/,
  );
  // A module nobody imports (here report_json, imported only by cli) fails; its own import of
  // itself does not count.
  const cli = ok.find((f) => f.path === 'src/stockroom/cli.py')!.content;
  assert.match(
    edit(
      'src/stockroom/cli.py',
      cli.replace('from .report_json import render_json\n', ''),
    ),
    /report_json\.py is not imported by src\/main\.py or another module of stockroom/,
  );
  // Review N-3: a file in a subfolder does not count as importing a named module.
  const noLots = cli.replace('from .lots import new_stock\n', '');
  assert.match(
    packageStructureBar(
      [
        ...ok.map((f) =>
          f.path === 'src/stockroom/cli.py' ? { ...f, content: noLots } : f,
        ),
        { path: 'src/stockroom/sub/x.py', content: 'from . import lots\n' },
      ],
      rule,
    ).detail,
    /lots\.py is not imported/,
  );
  // Every import form the rule names reaches the module; strings and comments do not.
  for (const [src, pkg] of [
    ['from stockroom.money import x', null],
    ['from stockroom import money as m', null],
    ['import os, stockroom.money', null],
    ['from .money import x', 'stockroom'],
    ['from . import (fields,\n    money)', 'stockroom'],
    ['if True: from .money import x', 'stockroom'],
  ] as const)
    assert.ok(
      importedNames(src, pkg).includes('stockroom.money'),
      JSON.stringify(src),
    );
  for (const [src, pkg] of [
    ['"from stockroom.money import x"', null],
    ['# import stockroom.money', null],
    ['from .money import x', null],
    ['from ..money import x', 'stockroom'],
    ['from stockroom import moneybag', null],
  ] as const)
    assert.ok(
      !importedNames(src, pkg).some(
        (n) => n === 'stockroom.money' || n.startsWith('stockroom.money.'),
      ),
      JSON.stringify(src),
    );
});

test('ADR-0114: a pass on p14-xl-v1 lifts no label (ADR-0112 lists only the ledger benchmarks)', () => {
  assert.deepEqual(RECIPE_BENCHMARKS['python-build/1'], [
    'p14-larger-ledgercheck-v5',
    'p14-larger-ledgercheck-v6',
  ]);
  const roles = {
    connection_id: 'c',
    model_id: 'm',
    builder_prompt_sha256: 'b'.repeat(64),
    reviewer_prompt_sha256: 'r'.repeat(64),
  };
  assert.equal(
    unqualifiedTrial(
      'python-build/1',
      roles,
      [{ ...roles, recipe: 'python-build/1', benchmark_id: ID }],
      'larger',
    ),
    true,
  );
});
