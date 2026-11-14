import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

test('a historical qualification keeps its score but cannot appear currently qualified', async () => {
  const { QualificationSummary } = await load<{
    QualificationSummary: (p: { q: unknown }) => unknown;
  }>('qualification-results.tsx', {
    './oversight.js': {},
    './qualification-role.js': await load('qualification-role.ts'),
  });
  const require = createRequire(
    new URL('../../apps/web/package.json', import.meta.url),
  );
  const { renderToStaticMarkup } = require('react-dom/server');
  const q = {
    model_id: 'fixture-model',
    task_class: 'independent_review',
    state: 'qualified',
    development: { passed: 3, total: 3 },
    held_out: { passed: 3, total: 3 },
    decided_at: null,
  };
  const old = renderToStaticMarkup(
    QualificationSummary({ q: { ...q, prompt_current: false } }),
  );
  assert.match(old, /historical pass \(older prompt\)/);
  assert.match(old, /Does not count for the current prompt/);
  assert.match(old, /3\/3/);
  const current = renderToStaticMarkup(
    QualificationSummary({ q: { ...q, prompt_current: true } }),
  );
  assert.match(current, /qualified/);
  assert.ok(!current.includes('historical pass'));
  // PR #175 review M-1: one task class, two roles, two names.
  const scoring = (flags: object) =>
    renderToStaticMarkup(
      QualificationSummary({ q: { ...q, task_class: 'scoring', ...flags } }),
    );
  assert.match(
    scoring({ admits_discovery: true }),
    /scoring job for discovery/,
  );
  assert.match(
    scoring({ admits_assessment: true }),
    /scoring job for assessments/,
  );
  assert.match(
    renderToStaticMarkup(
      QualificationSummary({
        q: { ...q, task_class: 'candidate_generation', admits_discovery: true },
      }),
    ),
    /candidate generation job for discovery/,
  );
});

/** The page map module, which has no imports: modules that import it get the real one. */
function pagesModule(): unknown {
  const code = ts.transpileModule(
    readFileSync('apps/web/src/pages.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {};
  new Function('exports', code)(exports);
  return exports;
}

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
    (name: string) =>
      name in stubs
        ? stubs[name]
        : name === './pages.js'
          ? pagesModule()
          : name === './page-active.js'
            ? { useOnShow: () => {}, useShown: () => 0 }
            : name === './older.js'
              ? { useOlder: () => {}, ShowOlder: () => null }
              : name === './money.js'
                ? { Money: () => null }
                : name === './view-mode.js'
                  ? { useViewMode: () => ({ standard: true }) }
                  : require(name),
    exports,
  );
  return exports;
}

test('money keeps every significant digit and drops trailing zeros', async () => {
  const { money } = await load<{
    money: (nano: string | null, fixture: boolean) => string;
  }>('amounts.ts');
  assert.equal(money('55770000', true), '0.05577 sim');
  assert.equal(money('0', true), '0.00 sim');
  assert.equal(money('100000000000', false), '$100.00');
  assert.equal(money('1', false), '$0.000000001');
  assert.equal(money('-2500000000', false), '-$2.50');
  assert.equal(money(null, false), '—');
});

test('P-9: Standard shows cents, never a real charge as zero, and knows when it rounded', async () => {
  const { cents, roundedAway } = await load<{
    cents: (
      nano: string | null,
      fixture: boolean,
      round?: 'half' | 'down',
    ) => string;
    roundedAway: (nano: string | null) => boolean;
  }>('amounts.ts');
  // "99.97259 sim" and "0.69665 sim charged" from the final UX pass walk.
  assert.equal(cents('99972590000', true), '99.97 sim');
  assert.equal(cents('696650000', true), '0.70 sim');
  assert.equal(cents('15000000', false), '$0.02'); // half a cent rounds up
  assert.equal(cents('14999999', false), '$0.01');
  assert.equal(cents('4999999', false), '<$0.01');
  assert.equal(cents('1', false), '<$0.01');
  assert.equal(cents('9999999', true), '<0.01 sim'); // below a cent never rounds up to it
  assert.equal(cents('0', false), '$0.00');
  assert.equal(cents('-2500000000', false), '-$2.50');
  assert.equal(cents('-1', false), '-<$0.01');
  assert.equal(cents('99995000000', false), '$100.00');
  assert.equal(cents(null, false), '—');
  assert.equal(roundedAway('2500000000'), false);
  assert.equal(roundedAway('55770000'), true);
  assert.equal(roundedAway('1'), true);
  assert.equal(roundedAway(null), false);
  // Review 1 of #197, L-4: what is left rounds down, so $19.995 left never reads $20.00.
  assert.equal(cents('19995000000', false, 'down'), '$19.99');
  assert.equal(cents('19995000000', false), '$20.00');
  assert.equal(cents('99972590000', true, 'down'), '99.97 sim');
  assert.equal(cents('9999999', false, 'down'), '<$0.01'); // still never zero
  assert.equal(cents('2500000000', false, 'down'), '$2.50');
});

test('problem labels clip at words and note problems with nothing proposed', async () => {
  const labels = await load('labels.ts');
  const ui = await load<{
    clip: (text: string, max: number) => string;
    problemLabel: (
      p: { id: string; title: string; created_at: string },
      counts: Map<string, number>,
      max?: number,
    ) => string;
    eventText: (summary: string) => string;
  }>('ui.tsx', { './oversight.js': {}, './labels.js': labels });
  const title =
    'Unused first-appointment slots at rural clinics: Rural clinics recorded a 23 percent no-show rate';
  const clipped = ui.clip(title, 60);
  assert.ok(clipped.length <= 60);
  assert.ok(clipped.endsWith('…'));
  assert.ok(title.startsWith(clipped.slice(0, -1)));
  assert.equal(ui.clip('Short title', 60), 'Short title');
  const at = '2026-10-30T15:12:00Z';
  const empty = ui.problemLabel(
    { id: 'a', title: 'E-books', created_at: at },
    new Map([['a', 0]]),
  );
  assert.match(empty, /^E-books · .+ \(no options proposed\)$/);
  assert.match(
    ui.problemLabel({ id: 'b', title: 'E-books', created_at: at }, new Map()),
    /^E-books · [^(]+$/,
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
  }>('amounts.ts');
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
    './amounts.js': {},
    './ui.js': {},
    './funding.js': {},
    './checkout.js': {},
    './versions.js': {},
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
    './amounts.js': {},
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

test('funding keeps one request key per request and asks before loosening a policy', async () => {
  type Limits = {
    enabled: boolean;
    eligible_bps: number;
    holdback_days: number;
    period_days: number;
    period_cap_nano_usd: string;
    min_reserve_nano_usd: string;
  };
  const { requestKeys, loosens } = await load<{
    requestKeys: (
      prefix: string,
      mint: () => string,
    ) => { key: (body: unknown) => string; clear: () => void };
    loosens: (prev: Limits | null, next: Limits) => boolean;
  }>('funding.tsx', {
    './oversight.js': {},
    './budgets.js': {},
    './amounts.js': {},
    './ui.js': {},
  });
  let n = 0;
  const keys = requestKeys('fund', () => `k${++n}`);
  assert.equal(keys.key({ a: 1 }), 'fund:k1');
  assert.equal(keys.key({ a: 1 }), 'fund:k1', 'a retry reuses the key');
  assert.equal(
    keys.key({ a: 2 }),
    'fund:k2',
    'a changed request gets a new one',
  );
  keys.clear();
  assert.equal(keys.key({ a: 2 }), 'fund:k3', 'after success the next is new');

  const on: Limits = {
    enabled: true,
    eligible_bps: 2500,
    holdback_days: 30,
    period_days: 30,
    period_cap_nano_usd: '5000000000',
    min_reserve_nano_usd: '1000000000',
  };
  assert.equal(loosens(null, on), true);
  assert.equal(loosens({ ...on, enabled: false }, on), true);
  assert.equal(loosens(on, { ...on, enabled: false }), false);
  assert.equal(loosens(on, on), false);
  assert.equal(
    loosens(on, { ...on, eligible_bps: 2400, holdback_days: 40 }),
    false,
  );
  for (const change of [
    { eligible_bps: 10_000 },
    { holdback_days: 0 },
    { period_days: 7 },
    { period_cap_nano_usd: '5000000001' },
    { min_reserve_nano_usd: '0' },
  ])
    assert.equal(
      loosens(on, { ...on, ...change }),
      true,
      JSON.stringify(change),
    );
});

test('Settings describes limit changes in plain words and flags any that widen spending', async () => {
  const { limitChanges } = await load<{
    limitChanges: (
      before: unknown,
      after: unknown,
    ) => { lines: string[]; widens: boolean };
  }>('spending-limits.tsx', {
    './oversight.js': {},
    './budgets.js': {
      money: (n: string) => `$${(Number(n) / 1e9).toFixed(2)}`,
    },
    './amounts.js': {},
    './ui.js': {},
    './page-drafts.js': {},
  });
  const none = { per_run_nano_usd: null, per_model: [] };
  const astra = (n: string) => ({
    provider: 'openai',
    model_id: 'gpt-6-astra',
    limit_nano_usd: n,
  });
  const set = {
    per_run_nano_usd: '2000000000',
    per_model: [astra('5000000000')],
  };
  assert.deepEqual(limitChanges(none, set), {
    lines: [
      'Per run: no limit → $2.00',
      'openai/gpt-6-astra: no limit → $5.00',
    ],
    widens: false,
  });
  assert.deepEqual(limitChanges(set, none).widens, true);
  assert.deepEqual(
    limitChanges(set, { ...set, per_model: [astra('6000000000')] }),
    { lines: ['openai/gpt-6-astra: $5.00 → $6.00'], widens: true },
  );
  assert.deepEqual(limitChanges(set, set), { lines: [], widens: false });
});

test('checkout links only to Stripe-hosted test checkout pages', async () => {
  const { stripeCheckoutUrl } = await load<{
    stripeCheckoutUrl: (url: string | null) => string | null;
  }>('checkout.tsx', {
    './oversight.js': {},
    './budgets.js': {},
    './ui.js': {},
  });
  const ok = 'https://checkout.stripe.com/c/pay/cs_test_abc';
  assert.equal(stripeCheckoutUrl(ok), ok);
  for (const bad of [
    null,
    'https://checkout.invalid/fixture/cs_fx1',
    'http://checkout.stripe.com/c/pay/cs_test_abc',
    'https://checkout.stripe.com.evil.example/x',
    'javascript:alert(1)',
  ])
    assert.equal(stripeCheckoutUrl(bad), null, String(bad));
});
