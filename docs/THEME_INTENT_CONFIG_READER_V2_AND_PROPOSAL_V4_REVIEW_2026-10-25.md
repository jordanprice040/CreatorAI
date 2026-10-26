# Config reader v2 and observation proposal v4 independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-25.

Verdict: **pass for the fixture-only repair milestone, with Low findings; no Medium
or higher.** F1 and F2 (both Medium in the prior review) are resolved. Five
separate answers, none of which implies another:

| Question | Answer |
| --- | --- |
| Fixture-reader v2 support | **Supported** (fixture scope). F1 repaired and attributed by mutation; one Low regression (N1, BOM). |
| Suitable as a basis for a separately scoped operational adapter | **Supported as a basis, conditionally.** The adapter must pin native-accepted hash identity, add its own confinement, and settle N1–N4 in its own reviewed scope. |
| Proposal-v4 contract support | **Supported** with Lows (N5 vector-test tautology, N6 undisclosed open-handle side effect). |
| Operational adapter or PR-01/SH-01 inspector exists | **No.** Neither exists; nothing imports the reader except its test. |
| Native acceptance readiness | **Not ready; blocked.** Owner attestations, scope manifest, inspector implementation/review and a session decision are all pending. |

The accepted M3 exact-bundle configuration standard is preserved and not reopened.
Full C54 remains partial. Native acceptance and Jordan's human acceptance remain
unverified. This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This thread
did **not** write reader v2, its tests, the repair report, proposal v4, the new
`verify.mjs` or the repair receipt. The repair receipt records its author as
`"Authored reader/proposal repairs; not independent support"`; the project
coordinator states Codex prepared the material. These files are untracked, so git
cannot confirm authorship. The F1–F7 findings being checked came from a separate
Claude thread's v5 review; this thread has none of that thread's conversation
context, but it is the same model family checking repairs to a Claude review. It is
a **separate-session review, not blinded, not a different-model-family review**.

## Exact bindings

All reviewed inputs were rehashed before any check and equal the repair receipt's
`input_sha256` values; the full map is in
`tracking/evidence/theme-intent-config-reader-v2-review-2026-10-25/reviewer-receipt.json`.

| Input | SHA-256 |
| --- | --- |
| scripts/theme-intent-config-reader-fixture-v2.mjs | `dd19a47b0d2fc6b154583f745b72580412e5b27a3cc0f084fa6c84201b0b47a7` |
| tests/theme-intent-config-reader-fixture-v2.test.mjs | `f3c5dad2bff802438fd84cbb0cff7abe8a116d161438c7c1d0ae4d1d399df8a7` |
| Proposal v4 | `42f447f9156e756bd10a0c7b28f54395fc2ab6d2124be84d84c0eaece1e2566d` |
| Repair report | `2d1e59dbe44e492fac630867a58e47cf70f33a411e792569a924508c6dfaf0fe` |
| Repair verify.mjs / receipt | `e3d88ea3…2572` / `86ed6849…247e` |
| Prior v5 review / receipt | `b4c619e8…bc0f4` / `b9099f47…2f36` |
| Checklist v5 | `6d27e1281a7faedfebd2d7322bcafbc1c800171430fe899ee86f260763473952` |
| M3 scheduling decision | `24a82ca8a2b1eddf82e5c4e472b99103b05c6686a4818813aef847854ff0f42b` |
| main.rs / home.rs / winsys.rs | `33d629aa…246c` / `a8bc8f23…223b` / `4881b525…95c6d4` |

## Checks actually executed (Windows 11, Node 22.21.0)

1. **Repair verifier, check-only.** `node tracking/evidence/theme-intent-config-reader-v2-2026-10-24/verify.mjs`,
   no arguments, never `--record`, from the repository root (its hard-coded root is
   this checkout). Output `{"mode":"check_only_no_writes","prior_frozen_hash_bindings":72,"mismatches":0,"windows_fixture_tests_passed":12,"fixture_tests_failed":0}`,
   exit 0. Receipt hash and mtime and verifier hash identical before and after. The
   verifier reads the author's TAP text; it does not run tests. No older verifier ran.
2. **Fixture tests on Windows**, exact repository bytes:
   `node --test tests/theme-intent-config-reader-fixture-v2.test.mjs` → 12/12 pass,
   0 skipped, first attempt. Real junction, file symlinks and hard links were
   created (no EPERM here). Fixtures under `.verification/` were removed by the
   tests; none remain. TAP: `reviewer-tests-windows.tap`.
3. **Reviewer probes** (`probe.mjs`, SHA-256 in the receipt) in a scratch tree
   outside the repository, against the exact reader bytes and three mutants:
   all `nlink` guards removed; only the pre-open `nlink` guard removed; only the
   `lstat().isSymbolicLink()` guard removed. Results in `probe-output.json`.
4. **Actual Rust `PathBuf::join` + `to_string_lossy().to_lowercase()`**, rustc
   1.99.1 on Windows, scratch program (`rust-pathbuf-join.rs`), with SHA-256
   computed separately by .NET. This executes the join/lowercase steps, not the
   desktop binary or its `sha2` call.
5. **serde_json parity** with the native `StudioConfig`/`DatabaseConfig` shape and
   `deny_unknown_fields`, serde_json 1.0.154 (same as the desktop `Cargo.lock`),
   built offline in scratch (`serde-parity-main.rs`).
6. Source inspection of main.rs, home.rs, winsys.rs at the locators below.

**Failed/inconclusive attempt preserved:** a probe setting `SystemRoot` to a
nonexistent directory could not test the reader, because Node itself aborts at
startup without a valid `SystemRoot` (`Assertion failed: ncrypto::CSPRNG`, exit 134).
That item rests on source reading only.

No Linux run was made in this review; every link result above is Windows behavior.
The prior review's Linux runs (where `'junction'` creates an ordinary symlink) are
not re-used as Windows evidence.

Not done: reading any saved `studio.json` or operational state, credentials,
registry, processes, ports, mutexes/events; launch or sign-in; helpers, installers,
migrations, SQL; activation, recovery, cleanup; following operational paths in
receipts; the retired checkout.

## 1. F1 — `nlink === 1` enforcement: resolved

- Code: pre-open `lstat` (reader:139), open-handle `stat` (reader:146), and
  `sameFileSnapshot` requiring `nlink === 1n` on before/opened/after/final
  (reader:122-135, 157). The same `readSingleFile` reads the marker (64-byte cap)
  and `studio.json`.
- Windows execution: test 7 creates real hard links for each file (asserts `nlink 2n`)
  and is refused. Probe attribution: with all `nlink` guards removed the same hard
  link **projects** (`projected_not_operationally_verified`) for both config and
  marker; with only the pre-open guard removed it is still refused by the handle
  and snapshot checks. So the `nlink` checks are the operative and layered guard.
- Windows file identity is meaningful here: BigInt `ino`, `dev` and `ctimeNs` are
  non-zero for a scratch NTFS file.
- Residual (disclosed, accepted as a limit): `nlink` cannot detect a file that was
  moved or copied into a fixture root, and pre/post checks cannot exclude hostile
  same-user namespace races. A fixture path is not synthetic provenance.

## 2. Windows reparse-point attribute check

Supported, with limits:

- **Ancestry scope.** `noReparse` walks the target and every ancestor to the drive
  root (reader:91-98). Root confinement (direct child of `.verification/`, fixed
  name pattern) is checked before any I/O (reader:166-170); traversal and
  operational-looking roots refuse (test 4). Paths sent to PowerShell are the
  fixture path plus its fixed repository ancestors, not caller-chosen paths.
- **Fixed command, stdin paths.** The command string is constant; paths go as JSON
  on stdin. A directory named `pstest-'$(Write-Output x)[a]` returned `clear` with
  no evaluation; `[IO.File]::GetAttributes` does no wildcard expansion.
- **Bounded, redacted, fail-closed.** `-NoProfile -NonInteractive`, `windowsHide`,
  5 s timeout, 1 KiB buffer; any error, non-zero status or output other than
  exactly `clear` refuses with the bare `CONFIG_READER_REFUSED`. Measured: plain
  0/`clear` ~280 ms; junction exit 3; missing path exit 4.
- **Tested vs untested tags.** With the `lstat` symlink guard removed, the attribute
  query alone refuses a junction root and file symlinks for both files, and the
  positive control still projects. So symlink (`IO_REPARSE_TAG_SYMLINK`) and
  junction (`MOUNT_POINT`) tags are executed. Other tags (AppExecLink, cloud-file
  placeholders, dedup, WCI and similar) were not manufactured; their coverage rests
  on the `ReparsePoint` attribute logic only, as the repair report says.

**N2 (Low) — stdin encoding is not pinned.** An existing scratch directory named
`pstest-é中` returned exit 4 (refused). Windows PowerShell decodes redirected stdin
with the console code page, not UTF-8. For the fixture this only fails closed
(the root pattern is ASCII). An operational adapter on a non-ASCII profile path
would always be unavailable, and in principle a mis-decoded name could resolve to
a different existing path. *Fix for the adapter:* set `[Console]::InputEncoding`
to UTF-8 inside the fixed command, or pass base64 JSON, and add a non-ASCII test.

**N3 (Low) — executable chosen from `process.env.SystemRoot`.** reader:105-108 falls
back to `C:\Windows` only when unset. The repair report discloses that host
`SystemRoot` and system PowerShell are trusted. For an operational adapter, a
same-user environment change selects which program prints `clear`. *Fix for the
adapter:* derive the system directory independently of inherited environment, or
validate the resolved executable's identity. (Probe inconclusive; see above.)

## 3. F3–F5

- **F3 provenance and fatal UTF-8: supported as stated.** Decoding uses
  `TextDecoder('utf-8', { fatal: true })` (reader:56-58); invalid UTF-8 in an
  unprojected field refuses (test 11). The code comment and repair report say
  projection is meaningful only when `expectedHash` identifies a natively accepted
  file. Measured parity with serde_json 1.0.154: native **rejects** a duplicate
  `port`, an exponent-form port and a UTF-8 BOM; the reader **projects** all three
  and also a config missing `products_root`. The reader refuses `pg_bin: null`,
  which native accepts (`Option<String>`, home.rs:27): fail-closed divergence.
  Complete serde parsing parity is **not** established and is not claimed.

  **N1 (Low) — BOM regression.** v1 refused a BOM-prefixed file (prior probe P8).
  v2 accepts it, because `TextDecoder` strips a leading BOM unless
  `ignoreBOM: true`. Native rejects it. The repair report lists duplicate-key,
  lexical-number and required-field divergence but not this new one. Under
  hash equality to a natively accepted file it cannot occur. *Fix:* pass
  `ignoreBOM: true` (so `JSON.parse` fails) or refuse `EF BB BF` explicitly, and
  list it with the other divergences.
- **F4 pg_bin: resolved as specified.** Printable ASCII only, no colon or
  `<>"|?*` after the drive, no empty, `.`/`..`, or trailing space/dot segments
  (reader:25-41); test 9 covers bidi, DEL, ADS, trailing and repeated separators.

  **N4 (Low, adapter display) — residual spellings accepted:** Windows device names
  (`C:/NUL/bin`, `C:/x/CON`, `C:/x/com1.txt`), mixed separators, `%TEMP%`,
  8.3 short names, a leading-space segment and a lowercase drive. pg_bin is a
  proposed display value, not tool identity or execution authority (stated), so
  this matters only for human comparison. *Fix for the adapter:* define one
  canonical spelling and refuse reserved device names.
- **F5 BigInt metadata guards: supported as unit checks.** Test 10 changes each of
  `nlink`, `ino` (2^53+1 vs 2^53), `size`, `mtimeNs`, `ctimeNs` and `isFile` in
  each later snapshot, plus a short read. These are deterministic metadata-guard
  tests, not a concurrent attack simulation; hostile same-user race prevention is
  not claimed and is not inferred here.
- **Redaction:** every refusal is a bare `Error('CONFIG_READER_REFUSED')`, no
  `cause`, no own keys, no sentinel in the stack; uppercase hash refuses.

## 4. F2 — exact LOCALAPPDATA spelling and desktop key: resolved

Native source: `studio_home()` uses `CREATOR_STUDIO_HOME` when set and non-empty,
otherwise `PathBuf::from(std::env::var("LOCALAPPDATA")).join("com.creatoragent.studio")`
(main.rs:155-164, identifier main.rs:25). `Home::new` keeps the root as built
(home.rs:97-103, no canonicalisation). The key is the first 16 hex of SHA-256 of
`root.to_string_lossy().to_lowercase()` (home.rs:124-128). Probe launches skip
the objects (main.rs:488-492), so absence never proves no desktop process; v4 says so.

Actual Rust join + lowercase, hashed by .NET:

| LOCALAPPDATA literal | Rust root (lowercased) | key16 |
| --- | --- | --- |
| `C:\Users\jorda\AppData\Local` | `c:\users\jorda\appdata\local\com.creatoragent.studio` | `d8c7860557013e56` |
| `C:\Users\jorda\AppData\Local\` | same | `d8c7860557013e56` |
| `c:\users\JORDA\appdata\local` | same | `d8c7860557013e56` |
| `C:\Users\jorda\AppData\Local\\` | `…local\\com.creatoragent.studio` | `681853bc5104874f` |
| `C:\Users\jorda\AppData\Local/` | `…local/com.creatoragent.studio` | `cf2a5fe779f2e38c` |
| `C:/Users/jorda/AppData/Local` | `c:/users/…/local\com.creatoragent.studio` | `b552bb84152dcde0` |

Both documented v4 rows are confirmed. v4's admission rule (ASCII, drive-rooted,
backslash-only, no empty/dot segments, at most one trailing backslash) excludes
exactly the rows whose Rust result the emulation would get wrong; anything else is
unavailable, never absent. `93553bda48f70dd2` is the key for the plan's
forward-slash string used verbatim (for example as `CREATOR_STUDIO_HOME`), **not**
for a forward-slash `LOCALAPPDATA` (`b552bb84…`). v4 only calls it the plan root's
value and forbids it as an alternative key, which is accurate.

Source notes, no change required: `std::env::var` treats a non-Unicode
`CREATOR_STUDIO_HOME` like unset and falls back; v4's stricter "attested unset"
covers that. These are computed vectors, not observed native objects.

**N5 (Low) — tautological vector test.** Test 12 line 266 compares
`local + '\\' + 'com.creatoragent.studio'` with `joined`, which is the same string.
No code emulates the trailing-backslash rule, so that row is documented, not
tested. Acceptable while no inspector exists. *Fix in the inspector:* implement
the join emulation and test it against the Rust rows above, including the
double-backslash and forward-slash negatives.

## 5. F6/F7 and event versus mutex

- **F6: resolved.** v4:7-9 states it supersedes proposal v3's binding/observation
  text and the frozen checklist's proposal references; S1–S4 are in the table
  (rows "Studio home", "Mutex identities", "Desktop object key", "Desktop objects",
  "Launch at login", manifest row) and in the PR-01 body (v4:82-98). The reader-v2
  row (v4:61-65) labels it fixture-only and keeps the `studio.json` prohibition.
- **F7: resolved.** v4:163-169 names shortcuts, direct/script/terminal launches,
  HKCU and HKLM Run and RunOnce, per-user and common Startup and scheduled tasks,
  with "Unknown paths … still block". That catch-all covers autostart locations the
  list does not name (for example policy or WOW64 Run keys). Attestation only;
  no inspection granted.
- **Event vs mutex and open-only: supported.** winsys.rs:42-56 creates
  `Local\CreatorAgentStudio-{key}` with `CreateMutexW(initial owner)` and
  `Local\CreatorAgentStudioShow-{key}` with `CreateEventW`. v4's
  `OpenMutexW(SYNCHRONIZE)` / `OpenEventW(SYNCHRONIZE)`, close immediately, never
  wait/set, not-found = absent only with a bound key, everything else unavailable,
  is correct against that source.

**N6 (Low) — open-only is not side-effect free.** While the inspector holds its
opened mutex handle, the named object exists even if the desktop has just exited.
A desktop launch in that window gets `ERROR_ALREADY_EXISTS` from `CreateMutexW`,
treats itself as the second instance and exits silently (winsys.rs:45-53). v4 does
not disclose this. The window is short, but PR-01 runs before a launch and SH-01
after Quit, where a quiet login launch could coincide. *Fix in v4 successor text:*
disclose it, require no launch during sampling, and treat a launch during
sampling as an incident.

## 6. Projection, confinement and entry points: supported

Output is exactly `fixture`, `status`, `database.{mode,port}`, `pg_bin`,
`config_hash_matches` (reader:83-89); test 1 asserts deep equality and no sentinel.
Hash mismatch returns `blocked` with no fields before parsing (reader:52-53).
Confinement lives only in `readFixtureConfig`; `projectConfig` is pure, accepts
caller bytes and inherits no path confinement, as reader:42-43 and the repair report
say. Direct invocation exits 2 with no stdout and no echoed argument (test 6). Only
`tests/theme-intent-config-reader-fixture-v2.test.mjs` imports the module; the
package `test` script runs `tests/dist/*.test.js` only, so it is not in CI and has
no operational entry point.

Retained author attempts check out: initial 8/11 (EPERM on junction/hard link plus
the positive-control failure), unrestricted 10/11 (positive control only), final
12/12. Note that in the first two runs the negative tests could pass vacuously
because every read was refused; the mutation probes above supply the attribution
those runs could not.

## 7. M3 exact-bundle standard: preserved

The decision file still hashes to `24a82ca8…`. v4:11-29 restates it narrowly: fresh
installed identity matching studio.mjs `9d5ddac3…` may satisfy the
scheduler-configuration gate for this UI-only session; worker stays on; not live
scheduler state, prevention or zero-dispatch evidence; no session or inspection
grant. Not reopened or relabelled here.

## Findings by severity

| ID | Severity | Area | Status |
| --- | --- | --- | --- |
| F1 | (was Medium) | Hard-link confinement | Resolved, Windows-executed and mutation-attributed |
| F2 | (was Medium) | Desktop key input | Resolved; vectors confirmed with real Rust join |
| F3–F7 | (were Low) | Provenance, pg_bin, guards, consistency, launch paths | Resolved as specified |
| N1 | Low | BOM accepted (v1 regression; native rejects) | Open |
| N2 | Low | PowerShell stdin encoding unpinned (fails closed) | Open, adapter |
| N3 | Low | PowerShell path from inherited `SystemRoot` | Open, adapter (disclosed) |
| N4 | Low | pg_bin device names / non-canonical spellings | Open, adapter display |
| N5 | Low | Key test tautology; no join emulation | Open, inspector |
| N6 | Low | Open handle can suppress a concurrent launch | Open, contract text |

## Remaining prerequisites (unchanged by this review)

Operational adapter and PR-01/SH-01 do not exist. Pending owner inputs: exact
launch `LOCALAPPDATA` literal and `CREATOR_STUDIO_HOME` attestation, database port,
pg_bin with pg_ctl/postgres identity provenance, continuity since the historical
shutdown, workspace ID and current owner/editor role, bounded session decision,
and a reviewed scope manifest. An operational adapter also needs a concrete owner
read grant and its own independent review. R-01/R-02 separate; H is Jordan's only.

## Smallest precise next eligible implementation prompt

> Preserving reader v2, its tests, proposal v4, checklist v5, the M3 decision and all
> receipts byte-for-byte, in new files: (1) a fixture-only, pure PR-01/SH-01
> classification core with no OS, file, registry or network calls, taking injected
> observations only: desktop key from an attested `LOCALAPPDATA` literal under v4's
> admission rule with PathBuf::join emulation (unadmitted = unavailable), tested
> against the Rust-executed vectors in this review including `681853bc…`,
> `cf2a5fe7…` and `b552bb84…` as refusals; open-result mapping (not-found = absent
> only with a bound key; denied, wrong-type and other errors = unavailable);
> type-agnostic Run-value mapping; the two-sample stability rule; and output
> redaction; (2) a proposal v4.1 note disclosing N6 and requiring no launch during
> sampling. Record a new check-only receipt. No operational read, studio.json,
> registry, process, mutex, event or launch. Then commission a separate uninvolved
> review of those exact bytes. Full C54 stays partial.

Reader-side N1–N4 belong in the separately scoped operational adapter, not this step.
