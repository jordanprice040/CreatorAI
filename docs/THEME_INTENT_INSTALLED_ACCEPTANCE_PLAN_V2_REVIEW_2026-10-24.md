# Exact checklist v2 independent review — October 24, 2026

Verdict: **partial checklist support; blocked for execution**. The checklist and
proposed session are not currently executable. Full C54 remains partial.

Reviewer provenance: Codex primary agent in this user-requested review conversation.
No prior implementation involvement appears in the available conversation, and this
review changed no feature, helper or frozen checklist. This is an independent review
of that implementation within this conversation, not a blinded review, a claim of a
different model family, or Jordan's human acceptance. Unavailable conversations were
not inspected.

Exact checklist SHA-256:
`754a9873965c6d223fae3126d6d1b8cf8fbddb913190d9c93c7543615e67c592`.
Candidate: `7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc`.
Installation plan: `27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1`.

## Findings by severity

**M1 — Live scheduling and prelaunch continuity remain blocked.** V2 correctly
stops on unknown scheduling. `apps/api/src/studio.ts:528` constructs the service
environment without a scheduler override; `apps/api/src/index.ts:363` defaults it
off, while `:400` defaults the worker on and `:468` starts it. Native spawning clears
inherited environment (`studio.rs:316`). These strengthen source-based expectations
but do not observe a live process or establish continuity since the historical stop.
Startup ensures actors, sweeps broker/retrieval state and drains outbox before work.
Historical quiescence cannot continuously prohibit future producers or dispatch.
Operations has no identified scheduler indicator. `/api/health` includes scheduler
state, but querying it after starting the service cannot satisfy a prelaunch gate.
No already authorized observation path resolving this gap was established.

Smallest separate proposal: scope a read-only prelaunch identity/continuity and
effective-launch-configuration inspection, with redacted boolean results and no
secret output, then independently review whether its evidence satisfies the stop
rule. If actual runtime observation or continuous prevention is required, design
an explicit startup admission/control path before launching; bind its changed
candidate and re-review. Do not launch simply to discover scheduling state. No
inspection or control activation is authorized by this report.

**M2 — NI-04 requires a stopped control state that Quit does not expose.**
`apps/desktop/src-tauri/src/studio.rs:866–896` sets `stopping`, stops the child,
attempts cluster shutdown, logs any error, then exits the app. There is no final
visible stopped state. A cluster stop error also reaches app exit. Reproduce by
source inspection of `quit`; no native execution was needed. Therefore window
closure cannot establish successful shutdown before NI-04 relaunch. Prepare a
versioned checklist correction that records visible stopping/exit honestly and
uses a separately scoped, reviewed read-only shutdown observation before relaunch;
otherwise leave shutdown unknown and stop. Do not invent a UI indicator or infer
shutdown success from app exit. Preserve frozen v2.

## Per-gate assessment

All native cases remain **not-run**. Supported below means the planned observation
matches inspected source, not a native pass.

| Gate | Verdict and basis |
| --- | --- |
| A0 | Historically supported schema29/pre-UI preservation; blocked for present continuity. Reviewed v4 state asserts zero active/uncertain work before returning hashes. Hashes alone do not serialize query counts. |
| I-01 | Supported by actual installer/migration/verification chain; historical, no fresh installed-file inspection. |
| R-01/R-02 | Unverified; separate exact-user metadata read scope needed. `/NS` skips shortcut creation; no prior shortcut comparison can be invented. |
| NI-00 | Conditional design supported; running required and migration/setup/retry/adopt/connect states stop. M1 blocks launch. |
| NI-01 | Conditional; existing workspace ID/current owner-editor and bounded local authentication authority pending. Native local-owner/restored session and optional loopback challenge flows are distinct from provider login. |
| NI-02 | Supported design: theme becomes title, single create, active v1 and Activity identity; require empty all-status Catalog baseline. |
| NI-03 | Supported declaration wiring and indirect schema/hash binding only. Client compares prepared content hash; literal zero prose is not measured dispatch. |
| NI-04 | Blocked by M2; no-op save skips mutation when clean. Version/Activity, not saved notice, establishes absence of revision. |
| NI-05 | Supported design: B v1 optional fields, proposed URL retained; UI cannot establish zero retrieval. |
| NI-06 | Supported design: dirty open sets pending target each time; last clicked target wins and marker remains. |
| NI-07 | Supported design: Keep editing clears pending; ordinary Reload still invokes guarded open. |
| NI-08 | Supported design: explicit Resume B then confirmed discard re-reads B; intentional unsaved-marker loss is bounded. |
| NI-09 | Supported design: one dirty revision, pending prompt cleared, prepared plan checked against saved hash. |
| NI-10 | Partial observation scope only; same workspace/filter/pagination baseline required. No whole-database post-UI equality or exhaustive zero-dispatch proof. |
| H | Unverified; Jordan's own dated explicit statement required independently of N. |

Session scope must name tester, existing workspace/role, local sign-in, initial
launch plus NI-04 relaunch and final Quit, maximum A v1–2/B v1, default retention,
evidence limits and stops. No workspace creation, archival, provider qualification,
new execution, settings changes or blind retry. Uncertain commitment requires
visible ID/version/Activity reconciliation; missing coverage stays unverified.
Quit failure/unknown status must be preserved, not converted into a pass.

## Reconciliation and checks

Read U01/U02, project/context requirements, current tracking, owner decisions,
original checklist/review, v2 revision, readiness assessment, v4 helper report/review
and receipts, installation/before completions and referenced run-01 receipts.
Inspected theme UI save/open/guards, Catalog/Activity/Operations, intake contracts
and domain, API startup/studio, native supervisor/sign-in/main and control HTML,
and v4 state/preservation assertions. Exact-input hashes and repository-only check
results are recorded in the accompanying reviewer receipt and verifier.

Supported v4 review and actual successful installation/migration supersede v2's
pending helper/install prerequisites. Schema29 was observed after migration and
before recorded verification completion. The historical shutdown receipt is not a
fresh process check. No repeat backup/preparation/install is indicated. Keep frozen
history, helper bytes and matching schema28 recovery materials unchanged.

No application launch, sign-in, helper execution, operational path/credential read,
registry/shortcut inspection, acceptance writes, provider/workflow activation,
recovery, cleanup or retired-checkout access occurred. No native tests or runtime
test suites were executed; this is document/source/receipt review.

## Next eligible prompt

Prepare a versioned correction for M2 and a concrete bounded prelaunch
scheduling/continuity inspection/control proposal for M1, preserving frozen v2 and
all helper/package bytes. Independently review the resulting observation path
before any operational execution. Then resolve existing workspace/current role
and the separate bounded session decision. Do not execute native acceptance yet.
