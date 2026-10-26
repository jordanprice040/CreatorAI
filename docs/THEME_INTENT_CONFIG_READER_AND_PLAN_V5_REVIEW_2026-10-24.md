# Config reader, checklist v5 and proposal v3 independent review — October 24, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-24.

Verdict: **partial; changes required.** Four separate answers, none of which
implies another:

| Question | Answer |
| --- | --- |
| Fixture-only reader (projection, redaction, bounds, confinement) | **Partial.** Projection, redaction, mismatch, size and symlink/junction guards are supported. Confinement has one Medium gap (F1: hard links). |
| Ready as the core of a future operational adapter | **Not yet.** Usable as a basis after F1 is repaired. The adapter itself does not exist, needs its own scope, path/home binding, owner read grant and review (see "Remaining prerequisites"). |
| PR-01/SH-01 inspector | **Does not exist.** Contract is partial: S1, S3, S4 supported; S2 correct about event vs mutex and open-only calls, but the key input string is unbound (F2). |
| Native/installed acceptance | **Not executed; blocked.** No observation, launch or session was made or is authorized. |

The accepted M3 exact-bundle configuration standard is preserved faithfully and is
not reopened. Full C54 remains partial. This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, reading
`C:\dev\creator_agent` through the approved device folder. This thread did **not**
write the config reader, its tests, checklist v5, proposal v3 or the M3 decision.
Codex wrote them (the v5 revision receipt records `independent_review:false` for
its author). Separate Claude threads reviewed exact-v3 and exact-v4; the S1–S4 and
L-A–L-G findings checked here come from the exact-v4 Claude review. This thread has
none of those threads' conversation context, but it is the same model family
assessing repairs to a Claude review. It is a **separate-session review, not
blinded**, and not a different-model-family review.

## Exact bindings

| Input | SHA-256 |
| --- | --- |
| scripts/theme-intent-config-reader-fixture.mjs | `6f22955b35d77728060a6dbc80a52b5354d58566f4597c2406ce9740f2fe0ac8` |
| tests/theme-intent-config-reader-fixture.test.mjs | `300a86b6e5e82548a7c7598f54ffc60ef0f57556897b6c7be1e4bf1ab34df916` |
| Checklist v5 | `6d27e1281a7faedfebd2d7322bcafbc1c800171430fe899ee86f260763473952` |
| Observation proposal v3 | `ea9a4a5ccb478677922705526494873b2b5fca29fc6f60fcabf67e283b198a5a` |
| Reader preparation report | `96aba84cfc5ec020943dc407873997a2f77487b8c1b246e1bb60c10a119df0da` |
| Scheduling decision (M3) | `24a82ca8a2b1eddf82e5c4e472b99103b05c6686a4818813aef847854ff0f42b` |
| v5 revision receipt | `d873cb991efad1afff69d8f0b117f15e04e3e2f9c105c33fecb8bd889b5d54b5` |
| v5 verify.mjs | `64197247e0c51692e02d2e180f4ee6e80a2e8a86155ba34786258c6828509602` |
| Exact-v4 review report / receipt | `37000f16…eb5` / `a6c6115a…1ec` |
| Bundle manifest | `5b38b43e6153202073b03f49db66e3a0a0fb01e36364d2d3bab9d9b6ba54eba6` |

All inputs that the v5 receipt binds equal the rehashed bytes, including main.rs,
home.rs, winsys.rs, studio.rs and postgres.rs, so the source locators below refer
to the same bytes the author cited. The full map is in
`tracking/evidence/theme-intent-config-reader-v5-review-2026-10-24/reviewer-receipt.json`.

## Checks actually executed

1. **v5 check-only verifier**, exact bytes, no arguments, never `--record`. It
   hard-codes `C:/dev/creator_agent`, so it ran from a scratch directory outside the
   repository in which that relative path is a symlink to the mounted folder; no
   script byte changed. Output: `{"mode":"check_only_no_writes","preserved_review_inputs":36,"mismatches":0,"fixture_tests_passed":6,"fixture_tests_failed":0}`,
   exit 0. Receipt and verifier size, mtime and SHA-256 identical before and after.
   No older verifier was run. Note: `fixture_tests_passed` is read from the author's
   TAP text; the verifier does not run tests.
2. **Fixture tests**, exact copied bytes (hashes above) in a scratch tree outside
   the repository, so all fixtures were created under the scratch `.verification/`
   and none under the repository: Node 22.23.4 on the device's Linux VM, 6/6 pass.
   On Linux, `fs.symlink(..., 'junction')` creates an ordinary symlink, so test 5
   there is a symlink test, not a Windows junction test. The Windows junction pass
   rests on the author's TAP only.
3. **Reviewer probes** (16 cases, source in the appendix, same scratch tree and
   copied bytes, disposable fixtures only). Results are cited per finding.
4. Source inspection of the native desktop and helper code at the locators below.

Not done: reading any saved `studio.json` or operational state, credentials,
registry, processes, ports, mutexes/events; launch or sign-in; helpers,
installers, migrations, SQL; activation, recovery, cleanup; retired checkout.

## 1. Reader: projection, redaction, inputs, bounds, confinement

Supported (code + tests + probes):

- **Projection.** Output is exactly `fixture`, `status`, `database.{mode,port}`,
  `pg_bin`, `config_hash_matches` (reader:63-70). Test 1 asserts deep equality and
  no `SENTINEL` leakage.
- **Mismatch.** Hash is checked on raw bytes before parsing; mismatch returns
  `blocked` with no fields (reader:31-32). Uppercase hex is refused (probe P15). A
  non-string hash cannot match (P14 → blocked).
- **Redaction on failure.** Every refusal is a bare `Error('CONFIG_READER_REFUSED')`
  with no cause, no own keys and no value in the stack (P16). Unknown top-level or
  database keys, `__proto__` (P11), malformed JSON, wrong format, non-managed mode,
  out-of-range/non-integer port, relative or `..` pg_bin all refuse.
- **Size.** 32,768 bytes accepted, 32,769 refused (P13); lstat size is checked
  before open and read is capped at limit+1.
- **Path confinement.** Root must be a direct child of `.verification/` named
  `theme-config-reader-*`; traversal, nested child (P5) and operational-looking
  roots refuse before any I/O. Symlinked root, `studio.json` (P2) and marker (P3)
  refuse; a directory at `studio.json` refuses (P4). Fixture bytes are unchanged.
- **Direct invocation** writes nothing to stdout, does not echo arguments, exits 2.
  Nothing else in scripts, tests, apps, packages or package.json imports the
  module; it is not wired into `pnpm test` (tests/dist only), so it does not run in CI.

### F1 (Medium) — a hard link bypasses fixture confinement and is labelled fixture

`readFixtureConfig` confines by **path**, not by **file identity**. It never
checks `nlink`. Probe P1 placed a config file outside the fixture root, hard-linked
it as `<fixture root>/studio.json` (lstat `nlink: 2`) and the reader returned a
full projection with `fixture: true`. On Windows, a standard user can hard-link a
file on the same NTFS volume; the operational home in the installation plan and
this repository are both on `C:`. So the preparation report's "The fixture library
cannot read an operational path" is overstated: it cannot be *pointed at* one, but
it will read and project operational bytes through a linked fixture name and label
them as fixture output. It needs a deliberate same-user act, which is why this is
Medium, not High. The Windows behavior is inferred from NTFS semantics; only the
Linux reproduction was executed.

*Smallest fix:* refuse unless `nlink === 1` on the pre-open lstat and the open
handle stat (and the post-read stat); add a hard-link negative test. For the
operational adapter, also refuse any reparse-point attribute, not only
`isSymbolicLink()`.

### Lower findings on the reader

- **F3 (Low) — native-parse divergence.** The reader projects inputs that the
  desktop's `serde_json` + `deny_unknown_fields` loader (home.rs:9-35, 130-139)
  would refuse: duplicate keys with last-wins (P6), invalid UTF-8 inside an
  unprojected string (P7), missing required fields such as `products_root` (P9) and
  an exponent-form port (P12). This only matters if the expected hash is not of a
  file the desktop already accepted. Binding the adapter to the historical
  `fedcbce7…` hash recorded by the reviewed helper's run-01 largely neutralises it,
  because the desktop rewrites the file only on setup or a preference change
  (studio.rs:1108, 1133); that the desktop accepted those exact bytes is inferred,
  not observed. *Fix:* state that
  projection is meaningful only under hash equality to a natively accepted file, or
  add strict-parse checks.
- **F4 (Low) — pg_bin character set.** Accepted: Unicode bidi override, DEL 0x7f,
  trailing space, an extra `:` (alternate data stream form) and empty segments
  (P10a–e). pg_bin is not an approved executable, but a human comparing a displayed
  value can be misled. *Fix:* printable ASCII only, no colon after the drive, no
  trailing space or dot, no empty segment.
- **F5 (Low) — guard coverage.** The before/open/after identity, size and mtime
  checks have no test (no seam to change the file mid-read). Windows `ino` is a
  Number, not BigInt, so very large file IDs can lose precision. Non-symlink
  reparse points are not detected. Same-user namespace races are disclosed as not
  protected; I agree that is a limit, not a pass.

## 2. Exported functions and operational reach

`projectConfig` is a pure, path-agnostic function: any caller can hand it bytes
from anywhere. That is acceptable by design, but it means the reader's only path
guard lives in `readFixtureConfig`, and a future adapter that calls
`projectConfig` directly inherits no confinement. Neither function reads the
environment, discovers paths or touches the network. Apart from F1, neither can
reach an operational path.

## 3. S1–S4 and L-A–L-G against native source

| Item | Verdict | Evidence |
| --- | --- | --- |
| S1 active home | **Supported** (proposal v3:142-148) | main.rs:155-164: `CREATOR_STUDIO_HOME` if set and non-empty, else `LOCALAPPDATA` joined with `com.creatoragent.studio` (main.rs:25). Correctly stays attestation, pending if uncertain. |
| S2 event vs mutex | **Supported** | winsys.rs:42-56: `CreateMutexW` for `Local\CreatorAgentStudio-{key}`, `CreateEventW` for `Local\CreatorAgentStudioShow-{key}`. OpenEventW vs OpenMutexW, SYNCHRONIZE only, never Set/Wait, is correct. |
| S2 key derivation | **Partial (F2)** | home.rs:124-128: first 16 hex of SHA-256 of `root.to_string_lossy().to_lowercase()`, no resolve(). Formula correct; input string unbound. |
| S2 open-only semantics | **Supported** | Not-found → absent; denied/other (including wrong-type `ERROR_INVALID_HANDLE`) → unavailable. |
| S3 Run value | **Supported** | winsys.rs:126-140 uses `RRF_RT_REG_SZ` + `is_ok()`; v3:162-165 correctly requires type-agnostic existence and maps only `ERROR_FILE_NOT_FOUND` to absent. |
| S4 allowlist source | **Supported** | Manifest `5b38b43e…` lists 71 files including `node/node.exe` and `service/app/dist/studio.mjs` (rehashed and parsed here). |
| L-A | **Resolved** | v5:70-72 cites the 12:34:49.022Z helper assertion plus attestation; PR-01 does not refresh it. |
| L-D | **Resolved** | v5:234-240, 258-261: do not close either window; explicit Quit only. |
| L-F | **Resolved** | v5 receipt lists both excluded tracking paths with pre-update hashes. |
| L-G | **Resolved** | v5:209 heading stands on its own line. |

### F2 (Medium) — the desktop key's input string is not bound

The desktop key hashes the **exact** root string the process built. With no
override that is the desktop process's `LOCALAPPDATA` value, joined by
`PathBuf::join` with a backslash. The only recorded home spelling,
`installation-plan.json` `studio_home`, uses forward slashes. The two spellings
give different keys. Illustration only, computed from strings, not observed:
`c:/users/jorda/appdata/local/com.creatoragent.studio` → `93553bda48f70dd2`;
`c:\users\jorda\appdata\local\com.creatoragent.studio` → `d8c7860557013e56`.
An inspector keyed from the plan string would open a name that does not exist,
get not-found, and report "absent" while the desktop runs. That is the same
false-stopped failure M-A was about. v3 says "preserve the exact root spelling used
by the native launch", but S1 only asks Jordan to attest that `LOCALAPPDATA`
*resolves to the parent of* the plan home, which does not fix the string.
*Fix:* bind the key input as the attested exact `LOCALAPPDATA` string plus
`\com.creatoragent.studio` under `PathBuf::join` rules (trailing separator, case
kept until lowercasing), forbid deriving it from the plan's forward-slash value,
add a reviewed test vector, and if the string is not attested treat desktop-object
absence as unavailable, not absent.

Also noted (no change required): probe launches (`--smoke-probe` and similar) skip
the single-instance objects entirely (main.rs:488-492), so object absence never
proves no desktop process; the plan already requires process-image checks.

### F6 (Low) — proposal v3 body contradicts its own addendum

S1–S4 were appended as "implementation constraints" with no precedence statement,
while the body still says the older thing: the studio-home row still says
"disclose override/uncertainty" (v3:39); the mutex row and PR-01 text name only
V3/V4 helper mutexes (v3:48, 76); v3:56-58 says a field-limited reader "is not
introduced here" while the companion preparation report introduces one; v5:82 says
the bundle hash is "named in proposal v2". An implementer reading the table first
will miss S1/S2. *Fix:* fold S1–S4 into the table and PR-01 text, or add one line
saying the S-section supersedes conflicting body text.

### F7 (Low) — launch paths are not fully enumerated

S1's "every launch path (Start menu, desktop shortcut or Run entry)" and the M5
quiet-launch reconciliation omit the per-user Startup folder, HKLM Run, RunOnce and
scheduled tasks. The app only writes HKCU Run (winsys.rs:94-124), so these exist
only if someone created them; the general attestation covers them in principle.
*Fix:* name them in the attestation wording.

## 4. M3 exact-bundle configuration standard

Preserved faithfully. The decision file still hashes to `24a82ca8…`. v5:80-86 and
209-221 and proposal v3:8-26 say fresh installed identity matching studio.mjs
`9d5ddac3…` may satisfy the scheduler-**configuration** gate only, worker stays
on, continuity and UI-only limits remain, nothing is live observation or
prevention, and nothing grants a session. Not reopened here.

## 5. Remaining prerequisites (unchanged by this review)

- **Operational adapter:** does not exist. Needs a separately selected scope; exact
  config path from attested active home (S1, F2); exact expected hash; F1 repair;
  approved output fields and exclusive evidence destination; a concrete owner read
  grant; its own independent review. Alternatively Jordan supplies the port and
  pg_bin from his own reading.
- **PR-01/SH-01:** not implemented. Needs F2 and F6 folded in, then a fixture-only
  implementation with injected OS observations and its own review.
- **Pending owner inputs:** active-home attestation, database port, pg_bin plus
  pg_ctl/postgres identity provenance, continuity attestation since 12:35:23Z
  including Run-value reconciliation, existing workspace ID and current
  owner/editor role, bounded session decision.
- R-01/R-02 separate scope; H is Jordan's own dated statement only.

## Per-area verdicts

| Area | Verdict |
| --- | --- |
| Reader projection/redaction/mismatch/size | Supported |
| Reader confinement | Partial (F1 Medium) |
| Reader as basis for an operational adapter | Supported after F1, plus F3/F4 for adapter use |
| Operational adapter readiness | Not ready (does not exist; scope/grant/review missing) |
| S1, S3, S4 | Supported |
| S2 | Partial (F2 Medium) |
| L-A, L-D, L-F, L-G | Resolved |
| Proposal v3 consistency | Partial (F6 Low) |
| M3 preservation | Supported |
| v5 check-only verifier | Supported (no writes observed) |
| PR-01/SH-01 implementation | Does not exist |
| Native acceptance / H | Not executed / unverified |
| Full C54 | Partial |

## Precise next eligible bounded implementation prompt

> Preserving the reader, its tests, checklist v5, proposal v3, the M3 decision and
> all receipts byte-for-byte, prepare in new files: (1) a fixture-only reader v2
> that refuses `nlink !== 1` on lstat, open handle and post-read stat, refuses any
> reparse-point attribute on Windows, restricts pg_bin to printable ASCII with no
> colon after the drive, no trailing space/dot and no empty segment, and documents
> that projection is meaningful only under hash equality to a natively accepted
> file; with negative tests for hard link, file and marker symlinks, and the
> pg_bin cases, run on Windows; (2) a proposal v4 that folds S1–S4 into the table
> and PR-01 text and binds the desktop key input as the attested exact
> `LOCALAPPDATA` string joined with `\com.creatoragent.studio`, with a reviewed
> test vector and "unattested key input = unavailable", and names Startup folder,
> HKLM Run, RunOnce and scheduled tasks in the launch-path attestation. Produce a
> new check-only receipt. No operational read, studio.json, registry, process,
> mutex or launch. Then commission a separate uninvolved review of those exact
> bytes. Full C54 stays partial.

## Appendix: reviewer probe source

`probe.mjs` (SHA-256 `107774741df4e2fa89279c9b9159660de1c05c0e2c86764fb3cc591eb711d143`),
run as `node probe.mjs <scratch tree>` against copied exact reader bytes. It builds
disposable roots under the scratch `.verification/` and runs these cases: P1 hard
link to a file outside the root; P2 symlinked studio.json; P3 symlinked marker; P4
directory at studio.json; P5 nested root; P6 duplicate `port`; P7 invalid UTF-8 in
`label`; P8 UTF-8 BOM; P9 only format/database/pg_bin; P10a–e pg_bin with U+202E,
trailing space, `:stream`, 0x7f, `//`; P11 `__proto__` in database; P12 `5.5455e4`
port; P13 32,768 and 32,769 bytes; P14 array hash; P15 uppercase hash; P16 error
object shape. Results: P2–P5, P8, P11, P13b, P15 refused; P14 blocked; P1, P6, P7,
P9, P10a–e, P12, P13a projected; P16 bare message, no cause, no keys, no sentinel in
stack. The full output is recorded in the receipt.
