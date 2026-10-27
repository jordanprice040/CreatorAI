import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Loads one web module with its sibling imports stubbed, so pure display helpers can be
// checked without a browser.
async function load<T>(file: string, stubs: Record<string, unknown> = {}) {
  const source = await readFile(`apps/web/src/${file}`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const require = createRequire(
    new URL('../../apps/web/package.json', import.meta.url),
  );
  const exports = {} as T;
  new Function('require', 'exports', code)(
    (name: string) => (name in stubs ? stubs[name] : require(name)),
    exports,
  );
  return exports;
}

test('money keeps every significant digit and drops trailing zeros', async () => {
  const { money } = await load<{
    money: (nano: string | null, fixture: boolean) => string;
  }>('budgets.tsx', { './oversight.js': {} });
  assert.equal(money('55770000', true), '0.05577 sim');
  assert.equal(money('0', true), '0.00 sim');
  assert.equal(money('100000000000', false), '$100.00');
  assert.equal(money('1', false), '$0.000000001');
  assert.equal(money('-2500000000', false), '-$2.50');
  assert.equal(money(null, false), '—');
});

test('problem pickers prefer a problem with options and clip labels at words', async () => {
  const ui = await load<{
    clip: (text: string, max: number) => string;
    richestProblem: (
      problems: { id: string }[],
      counts: Map<string, number>,
    ) => string;
    problemLabel: (
      p: { id: string; title: string },
      counts: Map<string, number>,
      max?: number,
    ) => string;
    eventText: (summary: string) => string;
  }>('ui.tsx', { './oversight.js': {} });
  const problems = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.equal(
    ui.richestProblem(
      problems,
      new Map([
        ['a', 0],
        ['b', 2],
        ['c', 5],
      ]),
    ),
    'c',
  );
  // Nothing proposed anywhere, or counts unavailable: keep the listed order.
  assert.equal(ui.richestProblem(problems, new Map([['a', 0]])), 'a');
  assert.equal(ui.richestProblem([], new Map()), '');

  const title =
    'Unused first-appointment slots at rural clinics: Rural clinics recorded a 23 percent no-show rate';
  const clipped = ui.clip(title, 60);
  assert.ok(clipped.length <= 60);
  assert.ok(clipped.endsWith('…'));
  assert.ok(title.startsWith(clipped.slice(0, -1)));
  assert.equal(ui.clip('Short title', 60), 'Short title');
  assert.equal(
    ui.problemLabel({ id: 'a', title: 'E-books' }, new Map([['a', 0]])),
    'E-books (no options proposed)',
  );
  assert.equal(
    ui.problemLabel({ id: 'b', title: 'E-books' }, new Map()),
    'E-books',
  );

  assert.equal(ui.eventText('study.assigned'), 'Study assigned');
  assert.equal(ui.eventText('study.protocol_frozen'), 'Study protocol frozen');
  assert.equal(
    ui.eventText('Answered decision: approve_once'),
    'Answered decision: approve_once',
  );
});

test('dollar amounts typed in Settings become exact nano-USD', async () => {
  const { usdToNano } = await load<{
    usdToNano: (text: string) => string | null;
  }>('settings.tsx', {
    './oversight.js': {},
    './budgets.js': {},
    './ui.js': {},
    './page-drafts.js': {},
  });
  assert.equal(usdToNano('20'), '20000000000');
  assert.equal(usdToNano('$12.5'), '12500000000');
  assert.equal(usdToNano(' 0.000000001 '), '1');
  assert.equal(usdToNano('0'), '0');
  for (const bad of ['', '-1', '1e3', '1.0000000001', '12,50', 'abc'])
    assert.equal(usdToNano(bad), null, bad);
});

test('payments show credit accounts as positive amounts of what they name', async () => {
  const { asShown } = await load<{
    asShown: (account: string, nano: string) => string;
  }>('payments.tsx', {
    './oversight.js': {},
    './budgets.js': {},
    './settings.js': {},
    './ui.js': {},
    './funding.js': {},
  });
  assert.equal(asShown('revenue', '-25000000000'), '25000000000');
  assert.equal(asShown('owner_funding', '-5000000000'), '5000000000');
  assert.equal(asShown('bank', '5000000000'), '5000000000');
  assert.equal(asShown('refunds', '1000000000'), '1000000000');
});

test('funding reads percentages as basis points and says why a source does not count', async () => {
  type Rail = {
    kind: 'processor_balance' | 'owner_attested';
    status: 'available' | 'unavailable';
    status_reason: string | null;
    connection_id: string | null;
    available_nano: string | null;
    observed_at: string | null;
    expires_at: string | null;
  };
  const { percentToBps, railState } = await load<{
    percentToBps: (text: string) => number | null;
    railState: (
      rail: Rail,
      active: ReadonlySet<string>,
      now: number,
    ) => { counts: boolean; note: string };
  }>('funding.tsx', {
    './oversight.js': { when: (iso: string) => iso.slice(0, 10) },
    './budgets.js': {},
    './settings.js': {},
    './ui.js': {},
  });
  assert.equal(percentToBps('25'), 2500);
  assert.equal(percentToBps('12.5%'), 1250);
  assert.equal(percentToBps('0.01'), 1);
  assert.equal(percentToBps('100'), 10_000);
  for (const bad of ['100.01', '-1', '1.234', '', 'ten'])
    assert.equal(percentToBps(bad), null, bad);

  const now = Date.parse('2026-10-27T12:00:00Z');
  const fresh: Rail = {
    kind: 'owner_attested',
    status: 'available',
    status_reason: null,
    connection_id: null,
    available_nano: '10000000000',
    observed_at: '2026-10-27T11:00:00Z',
    expires_at: '2026-10-28T11:00:00Z',
  };
  assert.equal(railState(fresh, new Set(), now).counts, true);
  assert.match(
    railState({ ...fresh, expires_at: '2026-10-27T11:59:00Z' }, new Set(), now)
      .note,
    /out of date/,
  );
  assert.equal(
    railState(
      { ...fresh, available_nano: null, expires_at: null },
      new Set(),
      now,
    ).note,
    'no balance recorded yet',
  );
  assert.match(
    railState(
      { ...fresh, status: 'unavailable', status_reason: 'Account frozen' },
      new Set(),
      now,
    ).note,
    /Account frozen/,
  );
  const processor: Rail = {
    ...fresh,
    kind: 'processor_balance',
    connection_id: 'c1',
  };
  assert.equal(railState(processor, new Set(), now).counts, false);
  assert.equal(railState(processor, new Set(['c1']), now).counts, true);
});
