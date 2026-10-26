# Observation verifier L12/L13 repair independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25,
against the exact final prompt in
`docs/THEME_INTENT_OBSERVATION_VERIFIER_L11_REVIEW_2026-10-25.md`.

Verdict: **supported at the supplemental-guard scope; no Critical, High, Medium or
Low findings.** The successor guard rejects all seven L12/L13 forms, which the frozen
L11 guard accepts, plus 35 further loop-target and modified-constructor variants. It
keeps all 52 L11 mutants and all 6 L11 controls, admits 23 local loop and keyword
constructor controls, and still admits the unchanged classifier-v4 source. Three Info
notes follow; none changes a verdict.

| Question | Answer |
| --- | --- |
| Verifier support for the L12/L13 repair | **Supported.** Both fixes hold for every form the L11 review named and every variant I probed (65 of 65 expectation-bearing probes). L11 preservation holds. Alias writes stay a documented limit. |
| Fixture classifier correctness | **Unchanged and still supported** at the v4 review's scope. Classifier v4 source and tests are byte-identical and the new guard admits the source. No classifier test was rerun by me or by the repair. |
| Operational collector exists | **No.** No collector, operational adapter or PR-01/SH-01 inspector exists. |
| Native acceptance readiness | **Not ready; blocked.** Owner attestations, a reviewed scope manifest, the collector and its review, an operational grant and a session decision are pending. H unverified; full C54 partial. |

M3's accepted exact-bundle scheduling decision is not reopened; its bytes rehash
unchanged (`24a82ca8…0f42b`). This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This session
did **not** write the L12/L13 `verify.mjs`, `REPAIR.md` or `repair-receipt.json`, and
did not write the L11 review. The repair receipt records its author as "Authored
L12/L13 successor verifier and report; not independent support"; the project
coordinator says Codex likely prepared it. The files are untracked, so git cannot
confirm authorship. The repair implements a prompt written by the separate Claude
thread that reviewed the L11 repair. I read that thread's report and receipt only,
but it is the **same model family**, and I knew its findings and suggested fixes
before reading the repair. This is a **separate-session review, not blinded and not a
different-model-family review.**

## Exact bindings

| Input | SHA-256 |
| --- | --- |
| L12/L13 `verify.mjs` | `d613ca14074737d6c8ba48e602f03869984103566b14ace7f9d7962c6428f63c` |
| L12/L13 `REPAIR.md` | `66f16338b73f5af1c6ca795f1fc768c8da88c371253be2830ee6673e5f00679c` |
| L12/L13 `repair-receipt.json` (not self-bound) | `041a98f77eed07a9477ee6ada6ee3db7978063ffa074abea471195c0d7bcaedb` |
| L11 review report | `43d47773db99ad458858749c3d0d90f67e31a3e8ce435e60f28e64bc71ab75ff` |
| L11 review receipt | `c4f530877479813a4d43413a49ade9668507509167fa38467a766a95d4584d2e` |
| L11 `verify.mjs` (frozen guard) | `251b83c57f9a1339fcb1b1a79b06cd7f38469bcdf043127c269df2ab2596a24a` |
| L11 `repair-receipt.json` | `fb0685530527339237790aabf66d88020d07a046ffa2ff4ad158667faea88e2b` |
| Frozen v4 `verify.mjs` | `6a805bb7d88258e49263cca6cd7286b76c01713956544040257741e601f57783` |
| Classifier v4 source | `f82dc17b936ec89e430ed2ab64ffb56853981aa4731eff4e1585488742a474eb` |
| Classifier v4 tests | `74399755d407bdacdfbb30f6a6e60aaf1791e6c273b67eba2e9e96a33c574c46` |

**Rehash.** All **111** paths bound by the repair receipt match (`111/111`, zero
mismatches). I recomputed the prior bindings myself from the three maps the verifier
checks: L11 review inputs (107), L11 review report (1) and L11 repair inputs (106).
That is **214 bindings over 108 distinct paths**, zero mismatches, no path bound to
two different hashes, and every prior path present in the receipt with the same hash.
The other 3 receipt paths are new: the L11 review receipt and the L12/L13 `verify.mjs`
and `REPAIR.md`. None of the three maps binds `BUILD_STATUS.md`, `SESSION_HANDOFF.md`
or `DECISIONS.md`, so the verifier's tracking exclusion excluded nothing and the
receipt's `excluded_preupdate_tracking` is `[]`, as REPAIR.md says.

Full map: `tracking/evidence/theme-intent-observation-verifier-l12-l13-review-2026-10-25/reviewer-receipt.json`.

## Checks actually executed (Windows 11, Node 22.21.0, TypeScript 5.9.3)

1. **Rehash** (`rehash.mjs`, scratchpad, reads bytes only): 111/111 receipt inputs;
   214 bindings over 108 distinct prior paths recomputed independently.
2. **New verifier, no arguments:**
   `node tracking/evidence/theme-intent-observation-verifier-l12-l13-2026-10-25/verify.mjs`.
   Output
   `{"mode":"check_only_no_writes","prior_frozen_hash_bindings_including_overlap":214,"prior_distinct_paths":108,"mismatches":0,"historical_fixture_test_groups_passed":20,"historical_fixture_test_groups_failed":0,"anchored_unique_TAP_totals":true,"AST_source_guard":true,"guard_negative_self_checks":61,"local_positive_controls":12,"L11_baseline_reproductions":3,"L12_L13_baseline_reproductions":7,"classifier_tests_rerun":false,"baseline_missing_closure_regression":true}`,
   exit 0. Receipt SHA-256 `041a98f7…caedb` before and after; the directory still holds
   exactly the same three files with the same sizes. Never `--record`.
3. **Guard probes** (`probe-guards.mjs`, scratchpad): I sliced `purityGuard` from the
   frozen v4, frozen L11 and new `verify.mjs` texts and ran all three on **67**
   synthetic source strings with the repository's `typescript`. I also sliced the
   L11 and new mutant and control arrays (string literals only) to compare them, ran
   the new guard over the 52 L11 mutants and 6 L11 controls, and ran all three guards
   over the classifier-v4 source. Parsing and type-checker queries only; no probe
   string or mutant was executed, and no verifier entry point other than step 2 ran.
4. **Static reading:** the full diff between the L11 and new verifiers, REPAIR.md, the
   receipt, and the two tracking entries the repair added.

Read, not executed: historical `tests-final.tap` (20/20) and `baseline-probes.json`.
That TAP is v4's earlier run; neither I nor the repair reran classifier tests, so it is
not a new test result. The verifier's TAP checks parse those historical bytes only.
`record-baseline.mjs`, `--record` and older verifier entry points were not run. The new
verifier itself compiles the old and L11 `purityGuard` texts with `Function` to
reproduce the baselines; that runs guard functions over source strings, not an older
verifier or any mutant. I ran no `node --check` this time, because the L11 review
already established which L12/L13 forms are valid JavaScript.

No operational config, environment, credentials, registry, process, port, mutex or
event query, launch, SQL, installer, helper, migration, provider, workflow, recovery,
cleanup or retired checkout. Receipt-embedded operational paths were read as bytes for
hashing only.

## 1. The change

The guard diff against L11 replaces one block and adds one:

- **L13:** the L11 block that decoded a nameless `ConstructorDeclaration`'s first
  token with the scanner is replaced by one rule: reject any `ConstructorDeclaration`
  without a direct `ConstructorKeyword` child.
- **L12:** a `ForOfStatement` or `ForInStatement` whose `initializer` is not a
  `VariableDeclarationList` sets that initializer as the write target, so it goes
  through the existing `nonLocalTarget` check, including its destructuring traversal.

Everything else in the guard is unchanged. Outside the guard the verifier adds the
seven L12/L13 mutants, six controls and the L11-guard baseline reproduction, and
rebinds to the L11 review and L11 repair receipts.

## 2. L12, loop write targets: fixed

**The seven exact forms.** The verifier's `l12l13` array is identical to the seven
strings in the L11 review. In my probes the frozen L11 guard **accepts all seven** and
the new guard **rejects all seven**.

**Further loop targets rejected by the new guard (21):** a parenthesized member, a
doubly parenthesized root, `for await` inside an async function, shorthand `{Number}`,
shorthand with default `{Number=1}`, array and object rest (`[...Number.x]`,
`{...Number.x}`), defaults on members in array and object patterns, nested object and
array patterns, a hole before the target, bare `Number` for both `of` and `in`, the
imported `createHash` and `createHash.x`, `Array.isArray` in a `for…in`, a loop inside
a function, a root shadowed only in another function (scope leakage), a nested loop,
and a pattern that mixes a local with a non-local target. The L11 guard accepts 19 of
these 21; it already rejected the two default forms because the default is itself an
`=` assignment.

**Declaration and local loop controls admitted by every guard (17):** `const`, `let`
and `var` declaration heads, a destructuring `const` head, a local `let` target for
both `of` and `in`, a parenthesized local, a local object member, a local member
inside an array pattern, local array, object, shorthand, shorthand-default, renamed
and rest patterns, a parameter named `Number`, a classic `for (let i…;i++)`, and
`for await` with a local target.

These cover every syntactic place ECMAScript evaluates a left-hand side as a loop
assignment target. Together with L11's assignment, compound, logical, `delete` and
update operators, I know of no remaining write form to a lexical root that the guard
does not inspect.

## 3. L13, constructors: fixed

**Representation.** I confirmed the child tokens TypeScript 5.9.3 gives a
`ConstructorDeclaration`. The keyword forms `constructor(){}` and
`static constructor(){}` contain a `ConstructorKeyword` child after any modifier
`SyntaxList`. The quoted forms, with or without `static` or `async`, contain a
`StringLiteral` in that position and no keyword. So the new rule does not depend on
which token comes first.

**Rejected by the new guard (14 beyond the seven):** `static` with double quotes; the
`\x75`, `\u{75}` and line-continuation spellings after `static`; `static async`; a
JSDoc comment before `static 'constructor'`; a class expression; an
`export default class`; plain `'constructor'(){}` and its `\u0075` spelling; and the
generator, getter, field and computed forms after `static`. The L11 guard accepts 8 of
these 14 (all the modifier-before-quoted forms) and rejects the other 6. The plain
quoted and escaped forms, which L11's scanner block caught, are still rejected, so
replacing that block lost nothing.

**Keyword constructor controls admitted by every guard (6):** `constructor(){}`,
`static constructor(){}`, a JSDoc comment before `constructor(a){}`, a constructor
followed by a method, and `static 'safe'(){}` and `'safe'(){}`.

## 4. Preservation: holds

- **L11 mutants:** all 52 L11 mutants (26 v4 mutants plus 26 L11 mutants) appear
  verbatim in the new list, and the new guard rejects all 52. With the 7 new mutants
  that is 59 AST mutants plus the 2 kept TAP-guard self-tests: the reported **61**.
- **L11 controls:** all 6 appear verbatim and the new guard admits all 6. With the 6
  new ones that is the reported **12**.
- **Baselines:** the 3 L11 baselines are still reproduced against the frozen v4 guard,
  and the 7 L12/L13 baselines against the frozen L11 guard, as parse-only checks.
- **Other v4 checks kept:** anchored unique TAP totals 20/20/0/0, the TAP self-test,
  the baseline-probe check and the imports-exactly-one rule.
- **Unchanged bytes:** classifier v4 source and tests and every prior report, note,
  TAP, receipt and verifier rehash to their recorded values. The v4, L11 and new
  guards all admit the classifier-v4 source.

## 5. REPAIR.md and tracking accuracy

REPAIR.md describes both fixes, the retained checks, the check-only default and the
`wx` record mode accurately. Its tracking-exclusion wording is correct. The
BUILD_STATUS and SESSION_HANDOFF entries the repair added match the receipt counts.
REPAIR.md says the owner authorized the L11 review's prompt; I cannot verify that from
the repository and did not need to for this review.

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| L12 | (was Low) | `for…of`/`for…in` targets rooted in allowed intrinsics | **Resolved** for all 7 named and 21 further forms |
| L13 | (was Low) | Quoted constructor after `static`/`async` | **Resolved** for all named and 14 further forms |
| I13 | Info | `class C {static constructor(){}}` is admitted. In JavaScript it is a static method named `constructor`, not the class constructor. It shadows the inherited `C.constructor` (which is `Function`), so it reduces reach rather than adding it. The rule checks spelling, as the prompt specified | Harmless |
| I14 | Info | The prompt said "the L11 `purityGuard` plus two fixes"; the repair replaced L11's scanner block instead of keeping it. The new rule is strictly stronger and every form the old block caught is still rejected | Wording only |
| I15 | Info | An unquoted escaped keyword (`constr\u0075ctor(){}`) gives a TypeScript parse diagnostic, so all three guards reject it | Fail-closed |
| I10 | Info | Local-alias and parameter-alias writes to intrinsics accepted | Documented limit, unchanged |
| I11 | Info | `this`- and call-rooted writes refused | Fail-closed, unchanged |
| L1, L4, I1–I4, I6, I7, I9 | Low/Info | Carried | Collector scope / harmless |

No PR-01 or SH-01 false pass is possible from this change; classifier behaviour is
untouched.

## Remaining prerequisites (unchanged by this review)

No collector, operational adapter or PR-01/SH-01 inspector exists. Still pending: the
exact launch `LOCALAPPDATA` literal and `CREATOR_STUDIO_HOME` attestation, database
port, pg_bin with pg_ctl/postgres identity provenance, continuity since the historical
shutdown, workspace ID and current owner/editor role, a reviewed scope manifest, the
collector and its review, a concrete operational grant and a bounded session
decision. Reader N1–N4 and classifier L1/L4 stay future work. R is separate and H is
Jordan's alone. Native acceptance is blocked and full C54 is partial.

## Smallest precise next eligible prompt (not executed)

The verifier line needs no further repair. The smallest next step is to prepare the
owner attestations the collector needs, without reading any operational value:

> Preserving all observation-classifier, verifier and review evidence (including the
> L12/L13 verifier, REPAIR.md, receipt and this review), notes v4.1–v4.4, reader v2,
> proposal v4, checklist v5 and the M3 decision byte for byte, write
> `docs/THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_2026-10-25.md`: one blank
> field per pending prerequisite in this review (launch `LOCALAPPDATA` literal,
> `CREATOR_STUDIO_HOME` attestation, database port, pg_bin with pg_ctl/postgres
> identity provenance, continuity since the historical shutdown, workspace ID and
> owner/editor role), each with the evidence Jordan would supply and which collector
> check it unblocks. Repository text only: read no config, environment, registry,
> process, port or file outside the repository, and fill no value. No collector,
> launch or grant. Full C54 stays partial.
