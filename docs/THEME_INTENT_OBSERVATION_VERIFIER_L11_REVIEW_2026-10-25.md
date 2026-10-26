# Observation verifier L11 repair independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25.

Verdict: **partial; two Low findings, no Critical, High or Medium.** The successor
verifier implements both L11 rules for every form the v4 review named and every
form the final repair prompt lists, keeps all 26 v4 mutants and every v4 check, and
still admits the unchanged classifier-v4 source. Two residual forms fall inside the
literal wording of the rules but are not rejected:

- **L12 (Low):** `for…of` / `for…in` targets rooted in a non-local identifier, for
  example `for (Number.isSafeInteger of [() => true]);`. This is the same harm as L11
  (it overwrites an allowed intrinsic) through an assignment form the guard does not
  inspect.
- **L13 (Low):** a quoted class constructor with a modifier, for example
  `class C {static 'constructor'(){}}`. TypeScript represents it as a nameless
  `ConstructorDeclaration` whose first token is `static`, so the first-token check
  misses it. It defines a harmless static method and does not reach `Function`.

The classifier-v4 source contains neither form, so fixture-classifier support is
unaffected. Four separate answers, none of which implies another:

| Question | Answer |
| --- | --- |
| Verifier support for the L11 repair | **Partial.** Rules 1 and 2 hold for every named and listed form (138 of 141 expectation-bearing probes; the 3 misses are L13); rule 3 holds. L12 and L13 remain. |
| Fixture classifier correctness | **Unchanged and still supported** at the v4 review's scope. Classifier v4 and its tests are byte-identical; the new guard admits them. No classifier test was rerun by me or by the repair. |
| Operational collector exists | **No.** No collector, operational adapter or PR-01/SH-01 inspector exists. |
| Native acceptance readiness | **Not ready; blocked.** H unverified; full C54 partial. |

M3's accepted exact-bundle scheduling decision is not reopened; its bytes rehash
unchanged (`24a82ca8…0f42b`). This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This session
did **not** write the L11 `verify.mjs`, `REPAIR.md` or `repair-receipt.json`. The
receipt records its author as "Authored L11 successor verifier and report; not
independent support"; the project coordinator says Codex likely prepared it. The
files are untracked, so git cannot confirm authorship. The repair implements a prompt
written by the separate Claude thread that reviewed classifier v4. I have none of that
thread's context beyond its report and receipt, but it is the **same model family**.
An earlier attempt at this review (thread "Review verifier L11 repair") left no output
files; I did not read its transcript. This is a **separate-session review, not blinded
and not a different-model-family review.**

## Exact bindings

| Input | SHA-256 |
| --- | --- |
| L11 `verify.mjs` | `251b83c57f9a1339fcb1b1a79b06cd7f38469bcdf043127c269df2ab2596a24a` |
| L11 `REPAIR.md` | `12bbf3231a1ae043943ba2d2e8e9419c70d40e7a7b89929cd51ad88fb287ae33` |
| L11 `repair-receipt.json` (not self-bound) | `fb0685530527339237790aabf66d88020d07a046ffa2ff4ad158667faea88e2b` |
| v4 review report | `32d922e1a50818c100343fe98c6f17eb060d79d0660cc4cf0a519d0abe38ef28` |
| v4 review receipt | `278e80352f771891148880f57995b642055bc9635532f7e15014266d5c0fd55d` |
| v4 repair receipt | `4e70e4007dc2b08834604e91246b69e4cd2601f3cdab539e23226d589bed7bd0` |
| Frozen v4 `verify.mjs` | `6a805bb7d88258e49263cca6cd7286b76c01713956544040257741e601f57783` |
| Classifier v4 source | `f82dc17b936ec89e430ed2ab64ffb56853981aa4731eff4e1585488742a474eb` |
| Classifier v4 tests | `74399755d407bdacdfbb30f6a6e60aaf1791e6c273b67eba2e9e96a33c574c46` |

**Rehash.** All **106** paths bound by the L11 receipt match (`106/106`, zero
mismatches). I recomputed the prior bindings myself from the three maps the verifier
checks: v4 review inputs (102), v4 review report (1) and v4 repair inputs (101). That
is **204 bindings over 103 distinct paths**, zero mismatches, and no path bound to two
different hashes. The other 3 receipt paths are new: the v4 review receipt, the L11
`verify.mjs` and `REPAIR.md`. Every prior path appears in the receipt.

**Overlap versus distinct paths.** The 101 overlapping bindings are the same path
appearing in more than one map with the same hash. Separately, two *distinct* paths
have identical bytes: `scripts/theme-intent-upgrade-v3-mutex.ps1` and
`scripts/theme-intent-upgrade-v4-mutex.ps1` (`7a1ddc01…1a1f`). They count as two paths.

**Tracking exclusions.** The verifier's exclusion of `BUILD_STATUS.md`,
`SESSION_HANDOFF.md` and `DECISIONS.md` **excluded nothing**: none of the three maps
binds them, and the receipt's `excluded_preupdate_tracking` is `[]`. The v4 review
receipt does carry `tracking_preupdate_sha256` for `BUILD_STATUS.md` and
`SESSION_HANDOFF.md`, but the verifier never reads that field, which is correct for
mutable files. REPAIR.md's wording ("listed individually; the count is not implied to
be nonzero") is accurate and fixes the I8 wording issue.

Full map: `tracking/evidence/theme-intent-observation-verifier-l11-review-2026-10-25/reviewer-receipt.json`.

## Checks actually executed (Windows 11, Node 22.21.0, TypeScript 5.9.3)

1. **Rehash** (`rehash.mjs`, scratchpad, reads bytes only): 106/106 receipt inputs;
   204 bindings over 103 distinct prior paths recomputed independently.
2. **New verifier, no arguments:**
   `node tracking/evidence/theme-intent-observation-verifier-l11-2026-10-25/verify.mjs`.
   Output
   `{"mode":"check_only_no_writes","prior_frozen_hash_bindings_including_overlap":204,"prior_distinct_paths":103,"mismatches":0,"historical_fixture_test_groups_passed":20,"historical_fixture_test_groups_failed":0,"anchored_unique_TAP_totals":true,"AST_source_guard":true,"guard_negative_self_checks":54,"local_positive_controls":6,"L11_baseline_reproductions":3,"classifier_tests_rerun":false,"baseline_missing_closure_regression":true}`,
   exit 0. Receipt SHA-256 `fb068553…8e2b` before and after; directory still holds
   exactly three files with the same sizes. Never `--record`.
3. **Guard probes** (`probe-guards.mjs`, scratchpad): I sliced `purityGuard` from the
   frozen v4 and the new `verify.mjs` texts and ran both on **151** synthetic source
   strings with the repository's `typescript`. Parsing and type-checker queries only;
   no mutant program was executed and no verifier entry point other than step 2 ran.
4. **Syntax checks only:** `node --check` on six scratch files holding the forms
   behind L12/L13, plus one known-invalid control, to establish which are valid
   JavaScript. `--check` parses without running.
5. **Static reading:** both guards (the change is 78 inserted lines and **zero removed
   lines**), the v4 mutant list against the new one, REPAIR.md and the receipt.

Read, not executed: historical `tests-final.tap` (20/20) and `baseline-probes.json`.
That TAP is v4's earlier run; neither I nor the repair reran classifier tests, so it is
not counted as a new test. `record-baseline.mjs`, `--record` and older verifiers were
not run. The new verifier itself compiles the old `purityGuard` text with `Function`
to reproduce the three baselines; that runs the guard function over source strings,
not the old verifier's entry point or any mutant.

No operational config, environment, credentials, registry, process, port, mutex or
event query, launch, SQL, installer, helper, migration, provider, workflow, recovery,
cleanup or retired checkout. Receipt-embedded operational paths were read as bytes for
hashing only.

## 1. Rule 1, quoted property names: implemented, one residual (L13)

The new rule rejects any `StringLiteral` whose decoded text is `constructor`,
`__proto__` or `prototype` and that is its parent's `name` or `propertyName`, plus a
nameless `ConstructorDeclaration` whose first token decodes to `constructor`.

**Rejected by the new guard, accepted by the old guard,** for each of the three names:
binding patterns (single and double quotes, nested, parameters, `catch`), assignment
patterns, object properties, methods, getters, setters, generator and async methods,
class methods, class generators, class getters, class fields, static fields, class
expressions and `export {x as '…'}`. Escaped spellings (`\u0075`, `\x5f`, `\u{6f}`, a
line continuation) and a JSDoc comment before a quoted constructor are rejected too.
Benign quoted keys (`{'safe':1}`) and a `'constructor'` string value stay admitted.

**ConstructorDeclaration representation and decoding.** I confirmed that TypeScript
5.9.3 parses `class C {'constructor'(){}}` and its `\u0075` spelling as `Constructor`
with no name child and a `StringLiteral` first token, as REPAIR.md says. Decoding that
token's spelling with the TypeScript scanner gives `constructor` for both, so both are
rejected.

**L13 (Low): a modifier hides the quoted constructor.** With `static` or `async`
before the literal, TypeScript still produces a nameless `ConstructorDeclaration`, but
its first token is the modifier.

| Source (after the `createHash` import) | Old | New | `node --check` |
| --- | --- | --- | --- |
| `class C {static 'constructor'(){}}` | accept | **accept** | valid |
| `class C {static 'constr\u0075ctor'(){}}` | accept | **accept** | valid |
| `class C {async 'constructor'(){}}` | accept | **accept** | SyntaxError at load |

The static form is valid JavaScript and defines a static method named `constructor`;
it does not obtain `Function`. The async form cannot load. Neither is in the
classifier. The rule's text says "every property-name position", so this is a gap in
the letter of rule 1 with no reachable harm I could construct. *Fix:* check the
constructor's first token after its modifiers, or reject any `ConstructorDeclaration`
that is not spelled with the `constructor` keyword.

## 2. Rule 2, non-local write roots: implemented, one residual (L12)

The new rule finds the target of every assignment operator from `=` through `^=`
(TypeScript's `FirstAssignment`..`LastAssignment`, which includes `||=`, `&&=`,
`??=` and `**=`), `delete`, and prefix/postfix `++`/`--`. It strips parentheses and
member accesses down to the root and requires that root to be an identifier with a
genuine lexical declaration in the file. Array and object assignment patterns, spread,
shorthand and defaults are traversed.

**Rejected by the new guard, all accepted by the old guard (48 forms):** plain and
all 15 compound/logical operators on `Number.isSafeInteger`; `Number = 1`;
`createHash = 1` and `createHash.x = 1` (imported binding); single, double and
JSDoc-cast parentheses; deep members; `delete` direct, parenthesized and doubly
parenthesized; all four update forms including parenthesized; object and array
destructuring with members, defaults, nesting, rest/spread, holes and shorthand
(`({Number}=…)`, `({Number=1}={})`); writes nested in an initializer, a default
parameter, a static class field and an arrow body; and roots shadowed only in an inner
block or function (scope leakage).

**Lexical locality versus synthesized declarations.** I confirmed REPAIR.md's
statement. For `Number.isSafeInteger=()=>true`, the checker returns a symbol for the
free `Number` whose only declaration is the `Identifier` node itself, synthesized by
TypeScript's JavaScript binder from the assignment. The new rule ignores that
declaration because it accepts only variable, parameter, binding-element, function and
class declarations. This also closes a broader v4 gap the v4 review did not name: the
old guard's identifier rule treated any declaration in the file as local, so it
accepted `Intl.x=1; Intl.DateTimeFormat();` and `console.x=1; console.log(1);`. The
new guard rejects both because the write is non-local.

**Positive controls (16, all admitted by both guards):** local `let` with plain,
update, compound and logical writes; local object member writes and `delete`; a
parameter, `const`, `catch` parameter, class or function named `Number`; a hoisted
`var Number` used before its declaration; local array and object destructuring with
shorthand and defaults; `for (let i…;i++)`; `for (v of …)` and `for (v in …)` with a
local `v`; and nested local member writes.

**L12 (Low): `for…of` and `for…in` targets are not inspected.**

| Source (after the `createHash` import) | Old | New | `node --check` |
| --- | --- | --- | --- |
| `for (Number.isSafeInteger of [() => true]);` | accept | **accept** | valid |
| `for (Number.isSafeInteger in {a:1});` | accept | **accept** | valid |
| `for ([Number.isSafeInteger] of [[() => true]]);` | accept | **accept** | valid |
| `for ({a:Array.isArray} of [{a:()=>false}]);` | accept | **accept** | valid |

A `for…in`/`for…of` head with a non-declaration left side assigns each value to that
target (ECMAScript ForIn/OfBodyEvaluation, assignment `lhsKind`). These lines would
replace `Number.isSafeInteger` or `Array.isArray`, which is the exact L11 harm, and
they are valid JavaScript. I did not execute them. A free non-allowed root such as
`for (Intl.x of [1]);` is still rejected by the identifier rule. Neither form is in the
classifier. *Fix:* treat the `initializer` of a `ForOfStatement`/`ForInStatement` that
is not a `VariableDeclarationList` as a write target.

## 3. Rule 3, preservation: holds

- **All 26 v4 mutants** appear verbatim in the new list, with the same prefix mapping,
  and the new guard rejects them (step 2 would throw otherwise). The new list adds 26
  L11 mutants, for 52 AST mutants plus the 2 kept TAP-guard self-tests: the reported
  **54** negative checks.
- **v4 checks kept:** anchored unique TAP totals 20/20/0/0, the TAP self-test, the
  baseline-probe check, the imports-exactly-one rule and every v4 node rejection. The
  guard diff removes nothing.
- **Six positive controls** run by the verifier match the receipt, and my 16 controls
  include equivalents.
- **Three parse-only baselines** reproduce in my probes: the old guard accepts the
  quoted-constructor destructuring, `Number.isSafeInteger=…` and `Array.isArray=…`; the
  new guard rejects all three.
- **Unchanged bytes:** classifier v4 source and tests, the v4 report, notes, TAP,
  receipts and verifiers all rehash to their recorded values, and both guards admit
  the classifier-v4 source.

## 4. Implementation history in REPAIR.md

REPAIR.md records three pre-receipt failures: a mutant accepted because of TypeScript's
synthesized assignment declaration; the nameless `ConstructorDeclaration`; and a
synthetic token with no text value. My probes confirm each cause and that the final
code handles it. All three stopped before the receipt was created. They are history,
not final defects.

## 5. Honest limits: stated correctly

REPAIR.md says the guard is supplemental and is not purity, alias or side-effect
analysis. My probes confirm the limit is real and disclosed:
`const N = Number; N.isSafeInteger = () => true;`, a parameter alias
(`function f(o){o.isSafeInteger=…} f(Number)`) and a local object holding `isArray`
are all accepted, because their write roots are genuinely local. Rule 2 as written
covers lexical roots only, so these are documented limits (I10), not defects. The new
guard also refuses some harmless local writes, such as `this.x = 1` in a class method
and `f().x = 1`. That is fail-closed and does not affect the classifier (I11).

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| L12 | Low | `for…of`/`for…in` targets rooted in allowed intrinsics accepted (valid JS; same harm as L11) | Open; source clean |
| L13 | Low | Quoted class constructor after `static`/`async` accepted (harmless or unloadable) | Open; source clean |
| I10 | Info | Local-alias and parameter-alias writes to intrinsics accepted | Documented limit |
| I11 | Info | `this`- and call-rooted writes refused | Fail-closed |
| I12 | Info | Old guard accepted expando-declared free names (`console.x=1; console.log(1)`) | Closed by rule 2 |
| L11 | (was Low) | Named quoted-key and intrinsic-write forms | **Resolved for every named and listed form**; L12/L13 remain |
| I8 | (was Info) | Exclusion wording | **Resolved** in REPAIR.md |
| L1, L4, I1–I4, I6, I7, I9 | Low/Info | Carried | Collector scope / harmless |

No PR-01 or SH-01 false pass is possible from this change; classifier behaviour is
untouched.

## Remaining prerequisites (unchanged by this review)

No collector, operational adapter or PR-01/SH-01 inspector exists. Owner attestations,
a reviewed scope manifest, the collector and its review, a concrete operational grant
and a bounded session decision remain pending. Reader N1–N4 and classifier L1/L4 stay
future work. Native acceptance is blocked, H is unverified and full C54 is partial.

## Smallest precise next eligible prompt (not executed)

> Preserving classifiers v1–v4, their tests, reports, TAP, receipts and verifiers,
> notes v4.1–v4.4, reader v2, proposal v4, checklist v5, the M3 decision and the L11
> verifier, report and receipt byte for byte, add in a new evidence directory a
> check-only verifier that applies the L11 `purityGuard` plus two fixes: treat a
> non-declaration `for…of`/`for…in` initializer as a write target (L12), and reject a
> `ConstructorDeclaration` not spelled with the `constructor` keyword, including after
> modifiers (L13). Self-test the seven L12/L13 forms in this review and keep every L11
> mutant and control. Run it against the unchanged classifier-v4 bytes, record a new
> receipt with `wx`, and then commission a separate uninvolved review of those exact
> bytes. No collector, OS, registry, process, mutex, event, config read or launch.
> Full C54 stays partial.

Alternatively, Jordan may accept L12 and L13 as documented limits of a supplemental
guard, since the classifier source uses neither, and move to the owner attestations
the collector needs. That choice is Jordan's.
