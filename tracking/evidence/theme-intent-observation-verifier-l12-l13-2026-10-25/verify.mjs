// Default mode verifies only. --record creates exactly one new immutable receipt.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
const root = 'C:/dev/creator_agent';
const dir =
  'tracking/evidence/theme-intent-observation-verifier-l12-l13-2026-10-25';
const evidence =
  'tracking/evidence/theme-intent-observation-classifier-v4-2026-10-25';
const output = dir + '/repair-receipt.json';
const inputs = {},
  excluded = [],
  priorPaths = new Set();
let checked = 0;
function local(p) {
  if (path.isAbsolute(p) || p.split(/[\\/]/).includes('..'))
    throw Error('Nonrepository input');
  return path.join(root, p);
}
function hash(p) {
  const h = crypto
    .createHash('sha256')
    .update(fs.readFileSync(local(p)))
    .digest('hex');
  inputs[p] = h;
  return h;
}
function read(p) {
  hash(p);
  return JSON.parse(fs.readFileSync(local(p), 'utf8'));
}
function check(map) {
  for (const [p, h] of Object.entries(map)) {
    if (
      [
        'tracking/BUILD_STATUS.md',
        'tracking/SESSION_HANDOFF.md',
        'tracking/DECISIONS.md',
      ].includes(p)
    ) {
      excluded.push({
        path: p,
        recorded_preupdate_sha256: h,
        reason: 'historical mutable tracking',
      });
      continue;
    }
    if (hash(p) !== h) throw Error('Changed frozen input ' + p);
    checked++;
    priorPaths.add(p);
  }
}
function purityGuard(source) {
  const filename = 'fixture.mjs';
  const tree = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (tree.parseDiagnostics.length) return false;
  const host = {
    getSourceFile: (f) => (f === filename ? tree : undefined),
    getDefaultLibFileName: () => '',
    writeFile: () => {},
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    fileExists: (f) => f === filename,
    readFile: (f) => (f === filename ? source : undefined),
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
  };
  const program = ts.createProgram(
    [filename],
    { allowJs: true, noLib: true, noResolve: true },
    host,
  );
  const checker = program.getTypeChecker();
  const allowed = new Set(['Number', 'Array', 'createHash']);
  let ok = true,
    imports = 0;
  // Resolve actual lexical bindings; imported bindings are not mutable local state.
  function lexicalDeclaration(d) {
    return (
      d.getSourceFile() === tree &&
      (ts.isVariableDeclaration(d) ||
        ts.isParameter(d) ||
        ts.isBindingElement(d) ||
        ts.isFunctionDeclaration(d) ||
        ts.isFunctionExpression(d) ||
        ts.isClassDeclaration(d) ||
        ts.isClassExpression(d))
    );
  }
  function isLocalTarget(n) {
    return (
      checker.getSymbolAtLocation(n)?.declarations?.some(lexicalDeclaration) ===
      true
    );
  }
  function nonLocalTarget(n) {
    if (ts.isParenthesizedExpression(n)) return nonLocalTarget(n.expression);
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n))
      return nonLocalTarget(n.expression);
    if (ts.isIdentifier(n)) return !isLocalTarget(n);
    // Destructuring assignment targets can contain member writes too.
    if (ts.isArrayLiteralExpression(n)) return n.elements.some(nonLocalTarget);
    if (ts.isObjectLiteralExpression(n))
      return n.properties.some((p) =>
        ts.isPropertyAssignment(p)
          ? nonLocalTarget(p.initializer)
          : ts.isShorthandPropertyAssignment(p)
            ? !checker
                .getShorthandAssignmentValueSymbol(p)
                ?.declarations?.some(lexicalDeclaration)
            : ts.isSpreadAssignment(p)
              ? nonLocalTarget(p.expression)
              : true,
      );
    if (ts.isSpreadElement(n)) return nonLocalTarget(n.expression);
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      return nonLocalTarget(n.left);
    return !ts.isOmittedExpression(n);
  }
  function visit(n) {
    // Inspect the declaration's own keyword token, not its first modifier token.
    if (
      ts.isConstructorDeclaration(n) &&
      !n
        .getChildren(tree)
        .some((child) => child.kind === ts.SyntaxKind.ConstructorKeyword)
    )
      ok = false;
    if (
      ts.isStringLiteral(n) &&
      ['constructor', '__proto__', 'prototype'].includes(n.text) &&
      (n.parent.name === n || n.parent.propertyName === n)
    )
      ok = false;
    let target;
    if (
      (ts.isForOfStatement(n) || ts.isForInStatement(n)) &&
      !ts.isVariableDeclarationList(n.initializer)
    )
      target = n.initializer;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      target = n.left;
    if (ts.isDeleteExpression(n)) target = n.expression;
    if (
      (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken ||
        n.operator === ts.SyntaxKind.MinusMinusToken)
    )
      target = n.operand;
    if (target && nonLocalTarget(target)) ok = false;

    if (ts.isImportDeclaration(n)) {
      imports++;
      const names = n.importClause?.namedBindings;
      if (
        n.moduleSpecifier.text !== 'node:crypto' ||
        n.importClause?.name ||
        !names ||
        !ts.isNamedImports(names) ||
        names.elements.length !== 1 ||
        names.elements[0].name.text !== 'createHash' ||
        names.elements[0].propertyName
      )
        ok = false;
    }
    if (
      (ts.isExportDeclaration(n) && n.moduleSpecifier) ||
      ts.isImportEqualsDeclaration(n) ||
      ts.isNewExpression(n) ||
      ts.isElementAccessExpression(n) ||
      ts.isComputedPropertyName(n) ||
      ts.isMetaProperty(n) ||
      (ts.isCallExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ImportKeyword)
    )
      ok = false;
    if (ts.isIdentifier(n)) {
      if (
        n.text === 'constructor' ||
        n.text === '__proto__' ||
        n.text === 'prototype'
      )
        ok = false;
      const p = n.parent;
      const property =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n);
      if (!property) {
        const symbol = ts.isShorthandPropertyAssignment(p)
          ? checker.getShorthandAssignmentValueSymbol(p)
          : checker.getSymbolAtLocation(n);
        const local = symbol?.declarations?.some(
          (d) => d.getSourceFile() === tree,
        );
        if (!local && !allowed.has(n.text)) ok = false;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(tree);
  return ok && imports === 1;
}
const review = read(
  'tracking/evidence/theme-intent-observation-verifier-l11-review-2026-10-25/reviewer-receipt.json',
);
check(review.input_sha256);
check(review.report_sha256);
const old = read(
  'tracking/evidence/theme-intent-observation-verifier-l11-2026-10-25/repair-receipt.json',
);
check(old.input_sha256);
for (const p of [
  'scripts/theme-intent-observation-classifier-fixture-v4.mjs',
  'tests/theme-intent-observation-classifier-fixture-v4.test.mjs',
  'docs/THEME_INTENT_OBSERVATION_CLASSIFIER_V4_REPAIR_2026-10-25.md',
  'docs/THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_4_NOTE_2026-10-25.md',
  evidence + '/tests-final.tap',
  evidence + '/baseline-probes.json',
  evidence + '/record-baseline.mjs',
  dir + '/verify.mjs',
  dir + '/REPAIR.md',
])
  hash(p);
const source = fs.readFileSync(
  local('scripts/theme-intent-observation-classifier-fixture-v4.mjs'),
  'utf8',
);
if (!purityGuard(source)) throw Error('AST source guard');
const prefix = "import {createHash} from 'node:crypto'; ";
const l11 = [
  "const {'constructor':F}=()=>0; F('return 1')();",
  'Number.isSafeInteger=()=>true;',
  'Array.isArray=()=>false;',
  ...['constructor', '__proto__', 'prototype'].flatMap((key) => [
    "const {'" + key + "':x}={};",
    "const o={'" + key + "':1};",
    "const o={'" + key + "'(){}};",
    "class C {'" + key + "'(){}}",
  ]),
  'Number.isSafeInteger += 1;',
  'Number.isSafeInteger ||= 1;',
  'delete Array.isArray;',
  '++Number.isSafeInteger;',
  'Array.isArray--;',
  '(Number).isSafeInteger=()=>true;',
  'Number.deep.field=0;',
  '({x:Number.isSafeInteger}={x:1});',
  '[Array.isArray]=[1];',
  'function hidden(){const Number={};} Number.isSafeInteger=0;',
  'createHash.field=1;',
];
const l12l13 = [
  'for (Number.isSafeInteger of [() => true]);',
  'for (Number.isSafeInteger in {a:1});',
  'for ([Number.isSafeInteger] of [[() => true]]);',
  'for ({a:Array.isArray} of [{a:()=>false}]);',
  "class C {static 'constructor'(){}}",
  "class C {static 'constr\\u0075ctor'(){}}",
  "class C {async 'constructor'(){}}",
];
const mutants = [
  ...l12l13.map((s) => prefix + s),
  ...l11.map((s) => prefix + s),
  "import fs from 'node:fs';",
  ...[
    "const {['constr'+'uctor']:F}=()=>0; F('return 1')();",
    "Object.getOwnPropertyDescriptor(Object.getPrototypeOf(()=>0),'constr'+'uctor').value('return 1')();",
    "Intl.DateTimeFormat('en',{timeStyle:'full'}).format();",
    'Intl.DateTimeFormat().resolvedOptions().timeZone;',
    "console.log('x');",
    "Object.defineProperty(Object.prototype,'x',{});",
    'structuredClone({});',
    'WebAssembly;',
    'Atomics;',
    'Promise;',
    'function hidden(){const Intl=0;} Intl.DateTimeFormat();',
    'const leaked={console};',
    'globalThis.process;',
    "require('fs');",
    "import('node:fs');",
    'performance.now();',
    "({}).constructor('return 0')();",
    "(()=>0)['constr'+'uctor']('return 0')();",
    "(()=>0)[`constructor`]('return 0')();",
    'Math.random();',
    'crypto.randomUUID();',
    'Reflect.ownKeys({});',
    'Proxy;',
    'import.meta.url;',
    "const o={};o['key'];",
  ].map((s) => prefix + s),
];
for (const mutant of mutants)
  if (purityGuard(mutant)) throw Error('AST guard mutant accepted: ' + mutant);
const controls = [
  'for (const x of [1]) {}',
  'for (let x in {a:1}) {}',
  'let x; for (x of [1]) {} for (x in {a:1}) {}',
  'const o={}; for (o.x of [1]) {}',
  'class C {constructor(){}}',
  'class C {static constructor(){}}',
  'let n=0; n++; --n; n+=1;',
  'const o={x:1}; o.x=2; delete o.x;',
  'function f(Number){Number.x=1;}',
  'const Array={}; Array.x ||= 1;',
  "const o={'safe':1}; const {'safe':x}=o;",
  "const text='constructor';",
];
for (const control of controls)
  if (!purityGuard(prefix + control)) throw Error('Local control refused');
// Parse-only reproduction: extract the old guard, never run its verifier entry point.
const oldVerifier = fs.readFileSync(local(evidence + '/verify.mjs'), 'utf8');
const oldGuardText = oldVerifier.slice(
  oldVerifier.indexOf('function purityGuard('),
  oldVerifier.indexOf('const review ='),
);
const oldGuard = Function('ts', oldGuardText + '; return purityGuard;')(ts);
for (const snippet of l11.slice(0, 3))
  if (!oldGuard(prefix + snippet)) throw Error('L11 baseline not reproduced');
const l11Verifier = fs.readFileSync(
  local(
    'tracking/evidence/theme-intent-observation-verifier-l11-2026-10-25/verify.mjs',
  ),
  'utf8',
);
const l11GuardText = l11Verifier.slice(
  l11Verifier.indexOf('function purityGuard('),
  l11Verifier.indexOf('const review ='),
);
const l11Guard = Function('ts', l11GuardText + '; return purityGuard;')(ts);
for (const snippet of l12l13)
  if (!l11Guard(prefix + snippet))
    throw Error('L12/L13 baseline not reproduced');
const tap = fs.readFileSync(local(evidence + '/tests-final.tap'), 'utf8');
function total(name, n, text = tap) {
  const matches = [
    ...text.matchAll(new RegExp('^# ' + name + ' ([0-9]+)\\r?$', 'gm')),
  ];
  return matches.length === 1 && Number(matches[0][1]) === n;
}
for (const [name, n] of [
  ['tests', 20],
  ['pass', 20],
  ['fail', 0],
  ['skipped', 0],
])
  if (!total(name, n)) throw Error('Anchored unique TAP total');
if (
  total('pass', 18, '# pass 180\n') ||
  total('pass', 18, '# pass 18\n# pass 18\n')
)
  throw Error('TAP guard self-test');
const probes = read(evidence + '/baseline-probes.json');
if (
  probes.v3.reason !== 'INVALID_CLOSURE_TIMING' ||
  probes.v4.reason !== 'LAUNCH_NOT_EXCLUDED' ||
  probes.v4.status !== 'blocked'
)
  throw Error('L9 probe mismatch');
const value = {
  format: 'theme-intent-observation-verifier-l12-l13/1',
  status: 'verifier_repair_verified_independent_review_pending',
  independent_review: false,
  author_involvement:
    'Authored L12/L13 successor verifier and report; not independent support',
  checks: {
    prior_frozen_hash_bindings_including_overlap: checked,
    prior_distinct_paths: priorPaths.size,
    mismatches: 0,
    historical_fixture_test_groups_passed: 20,
    historical_fixture_test_groups_failed: 0,
    anchored_unique_TAP_totals: true,
    AST_source_guard: true,
    guard_negative_self_checks: mutants.length + 2,
    local_positive_controls: controls.length,
    L11_baseline_reproductions: 3,
    L12_L13_baseline_reproductions: l12l13.length,
    classifier_tests_rerun: false,
    baseline_missing_closure_regression: true,
  },
  excluded_preupdate_tracking: excluded,
  operational_access: false,
  OS_observations_executed: 0,
  config_reads: 0,
  native_cases_executed: 0,
  provider_calls: 0,
  workflows_activated: 0,
  collector_implemented: false,
  operational_adapter_implemented: false,
  reader_N1_N4: 'unchanged_out_of_scope',
  classifier_L1_L4: 'future_collector_scope',
  M3_scheduling_decision: 'unchanged',
  retired_checkout_accessed: false,
  full_C54: 'partial',
  input_sha256: inputs,
};
if (process.argv.length === 3 && process.argv[2] === '--record') {
  fs.writeFileSync(
    local(output),
    JSON.stringify(
      { ...value, recorded_at: new Date().toISOString() },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(value.checks));
} else if (process.argv.length === 2) {
  const saved = JSON.parse(fs.readFileSync(local(output), 'utf8'));
  delete saved.recorded_at;
  if (JSON.stringify(saved) !== JSON.stringify(value))
    throw Error('Receipt mismatch');
  console.log(
    JSON.stringify({ mode: 'check_only_no_writes', ...value.checks }),
  );
} else throw Error('Usage: node verify.mjs [--record]');
