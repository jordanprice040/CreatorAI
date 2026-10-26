# Collector owner-attestations template independent review — October 25, 2026

Prompt: U02 (independent milestone review), requested by Jordan on 2026-10-26 UTC
(2026-10-25 local), against the exact final prompt in
`docs/THEME_INTENT_OBSERVATION_VERIFIER_L12_L13_REVIEW_2026-10-25.md`.

Verdict: **supported as a blank owner-input request, with three Low findings and
four Info notes; no Critical, High or Medium findings.** All nine fields are blank,
cover the nine pending prerequisites, carry evidence/currentness/uncertainty and
"Supports" text, preserve the exact-key, active-home, tool-identity, continuity and
workspace/role requirements, and grant no authority. The Lows are practicality and
completeness gaps: some fields ask for evidence the owner cannot obtain under the
template's own wording before a session, and the OneDrive key-admission rule from
note v4.2 is missing.

| Question | Answer |
| --- | --- |
| Template readiness | **Supported, with Lows L1–L3.** Usable as is; an additive clarification would make three fields easier to fill without changing any gate. |
| Owner attestations completed | **No.** Every field is blank. Nothing is attested. |
| Operational collector exists | **No.** No collector, operational adapter or PR-01/SH-01 inspector exists. |
| Native acceptance readiness | **Not ready; blocked.** Attestations, a reviewed scope manifest, the collector and its review, a concrete operational grant and a bounded session decision are pending. H unverified; full C54 partial. |

M3's accepted exact-bundle scheduling decision is not reopened; its bytes rehash
unchanged (`24a82ca8…0f42b`). This review grants no authority.

## Reviewer provenance and involvement

Claude (Anthropic), in a project thread opened for this review, working in
`C:\dev\creator_agent` on Jordan's device through the approved folder. This session
did **not** write the template or its BUILD_STATUS/SESSION_HANDOFF entries; the file is
untracked, so git cannot confirm who did, and the tracking entry names no author.
The template implements a prompt written by the separate Claude thread that reviewed
the L12/L13 repair. That is the **same model family**. I read that thread's report
and receipt, so I knew the prompt and the prerequisite list before reading the
template. This is a **separate-session review, not blinded and not a
different-model-family review.**

## Exact bindings

| Input | SHA-256 |
| --- | --- |
| Template under review | `a5f49bf0edc962ec9dc1305c0261e82b52721c03cc2a998f2e6304c69a4e3e91` |
| L12/L13 review report | `39eb1efdd0b9aacb208eb6430252fab58410abaed8106ca8ec5ca21eca904334` |
| L12/L13 reviewer receipt | `93417f2a2c20b7a29d6312e39d59d1c57701eb6ac6891f5fb1a759ec8a459996` |
| Proposal v4 | `42f447f9156e756bd10a0c7b28f54395fc2ab6d2124be84d84c0eaece1e2566d` |
| Note v4.1 | `486b6d66cc1e21c0300d993b540d547379b80a24f86c0e58a14e19aa8920cc45` |
| Note v4.2 | `f0cbfb9d8332866f16ed3fdede655df0ab2c0154d69cb2b9f7a6bc5b54fb911f` |
| Note v4.3 | `57ea5ce91796a354a3551e3711b785207c80ef327ea0f7d562ab6919edf08dda` |
| Note v4.4 | `8e16285877661423961979d436661f5d4d1787832e24f0076163d6a4dac5b618` |
| Checklist (plan) v5 | `6d27e1281a7faedfebd2d7322bcafbc1c800171430fe899ee86f260763473952` |
| M3 scheduling decision | `24a82ca8a2b1eddf82e5c4e472b99103b05c6686a4818813aef847854ff0f42b` |

The template hashed the same before and after this review. Its preparation recorded
no hash of its own (Info I17); this review binds it.

**Rehash.** I recomputed the L12/L13 reviewer receipt's `input_sha256` (112) and
`report_sha256` (1) maps from the bytes on disk: **113 bindings over 113 distinct
paths, zero mismatches, zero missing, no path bound to two hashes, no overlap between
the maps, and no absolute or parent-relative key.** That independently confirms the
template preparation's "113 distinct paths, zero mismatches". All governing documents
above except the template are among those 113 and are unchanged. The receipt's
separate `tracking_preupdate_sha256` map (BUILD_STATUS, SESSION_HANDOFF) no longer
matches, as expected: both files gained later entries. Its scratchpad-script map
points outside the repository and was not read.

Full map: `tracking/evidence/theme-intent-collector-owner-attestations-template-review-2026-10-25/reviewer-receipt.json`.

## Checks actually performed

1. **Rehash** (one Node 22.23.4 script outside the repository, reads bytes only):
   113/113 as above.
2. **Static reading** of the template, the L12/L13 report's final prompt, proposal v4,
   notes v4.1–v4.4, checklist v5, the M3 decision, AGENTS.md, PROJECT_CONTEXT.md,
   the U02 entry and the newest BUILD_STATUS/SESSION_HANDOFF entries.
3. **Text searches** of the template: 9 `###` fields, 9 blank `Owner response`
   lines, no other text on those lines, no drive-letter path, no digit run of 4+
   characters (so no port, hash, key vector or historical path is prefilled), and no
   occurrence of "OneDrive".
4. **Text search of repository evidence** for an existing pg_ctl/postgres identity
   hash (supports L3): the only repository hit is a `pg_ctl_status` code in the
   installation completion receipt; no tool hash or version is recorded. Embedded
   operational paths were not followed.

Not run: classifiers, verifiers, `--record`, `record-baseline`, runtime or fixture
tests. No operational config, environment, credentials, registry, process, port,
mutex or event query; no launch, sign-in, SQL, provider, workflow, recovery or
cleanup; no file outside the repository; no retired checkout.

## 1. Field coverage: holds

| # | Required prerequisite | Template field | Blank |
| --- | --- | --- | --- |
| 1 | Exact launch LOCALAPPDATA literal | §1 | yes |
| 2 | CREATOR_STUDIO_HOME and launch paths | §2 | yes |
| 3 | Current database port | §3 | yes |
| 4 | Exact pg_bin directory | §4 | yes |
| 5 | pg_ctl.exe identity provenance | §5 | yes |
| 6 | postgres.exe identity provenance | §6 | yes |
| 7 | Continuity since historical shutdown | §7 | yes |
| 8 | Selected existing workspace ID | §8 | yes |
| 9 | Current owner/editor role | §9 | yes |

This matches the L12/L13 report's prerequisite list (lines 206–210) and its prompt
(lines 222–226). The template splits pg_ctl and postgres identity into two fields,
as proposal v4 does (table rows for pg_bin/pg_ctl and process images).

## 2. Evidence, currentness, uncertainty and "Supports": holds

The preamble (template lines 8–10) requires for every field the nonsecret value,
its evidence/source locator, when that evidence was current with timezone, and any
uncertainty. Each field then names the specific evidence and a "Supports" line. The
mapping is accurate: §1 to active-home and desktop key binding (v4 lines 52, 155–177);
§2 to active home and the cluster/lease/mutex scope (v4 lines 42–51, 163–169); §3 to
the scoped listener set (v4 line 44, 77); §4–§6 to PR-01 tool and image identity
(v4 lines 45–46, 71, 77–80); §7 to A0 and other-producer limits (plan v5 lines 52–56,
70–72; v4 lines 88–101); §8–§9 to the session decision (plan v5 lines 30–33). The
§7 phrase "launch-exclusion prerequisites" is loose (Info I16).

## 3. Faithfulness to the governing sources: holds, except L2

- **Exact path/key.** §1 keeps v4's admitted spelling (ASCII, drive-rooted,
  backslash-only, no dot/dotdot/empty segments, at most one trailing backslash), says
  other spellings need separate review rather than normalization, rejects a resolved
  directory or the historical plan path, and keeps "unattested key means unavailable
  even if not-found". It derives no key. It omits note v4.2's OneDrive rule (L2).
- **Active-home uncertainty.** §2 lists every launch path v4 names (shortcuts, direct
  launches/scripts/terminals, HKCU/HKLM Run and RunOnce, per-user/common Startup,
  scheduled tasks), says the list grants no inspection, "do not presume unset", and
  a present override needs a separately reviewed root/key scope.
- **Tool identity.** §4–§6 keep "owner location alone does not establish runtime
  identity", independent review, "a status code alone is insufficient", "a basename
  alone does not establish ownership" and "ambiguous shared executable use blocks".
- **Continuity and quiet launch.** §7 covers intervening and quiet launches, sign-ins,
  override/installation/config changes, helpers, other users/sessions and producers,
  the A0 ordering, "current Run-value absence cannot prove past absence", "unknown
  intervals block A0", continuity through the first authorized launch, and that it is
  not SQL quiescence, prevention, whole-database equality or zero dispatch.
- **Workspace/role.** §8–§9 require an existing ID (name insufficient), owner or
  editor (viewer insufficient), and say creation and sign-in are not authorized.

## 4. No prefill; unknown stays blocking: holds

No field contains a value, example, default, fixture vector or historical path (check
3). The preamble says unknown "remains a blocker, not an affirmative attestation";
§2, §7 and the closing section repeat that unknown blocks. Owner statements are not
presented as verified: §4 says so explicitly, the closing section says responses are
"inputs for review, not satisfy every gate", and the next-step text says answers must
be evaluated with their uncertainty.

## 5. No authority granted: holds

Preamble lines 11–12 and per-field text exclude inspection, config/environment and
registry reads, PATH search, port observation, SQL, hashing or executing tools,
sign-in, launch and workspace creation; the closing section keeps native acceptance
blocked. Filling the template authorizes nothing. L3 concerns the reverse problem:
the wording does not say what the owner may do personally to obtain evidence.

## 6. Separate prerequisites, M3 and limits: holds

Template lines 128–141 keep the reviewed scope manifest (schema/version, exact bytes/
hash, independent review), collector implementation/review, concrete operational
grant and bounded session decision separate and uncreated; current installed identity
and tool bindings still need authorized checks; reader N1–N4 and classifier L1/L4 stay
future work; R separate, H Jordan's. M3 is stated as configuration evidence that "is
not live scheduler-state or zero-dispatch evidence", with worker and continuity limits.

## 7. Practicality, minimality and nonsecrecy

Requested items are nonsecret (paths, a port, hashes, versions, IDs, a role and a
timeline) and none exceeds the governing sources: each traces to v4 or plan v5. The
template excludes credentials, config bodies, command lines and sign-in codes. Three
fields are hard to fill as worded (L1, L3).

## Findings by severity

| ID | Severity | Area | Reproduction | Recommendation |
| --- | --- | --- | --- | --- |
| L1 | Low | §8–§9 currentness before a session | Template lines 110–111 and 121–123 ask for evidence of the workspace ID's and role's *currentness* and forbid sign-in. Plan v5 lines 30–31 have the session decision *name* workspace and role in advance and line 153 (NI-01) *confirm* them after authorized sign-in. Pre-session, current role/ID evidence can only come from a launch or a database read, both gated. Read literally, §8–§9 cannot be completed, or invite an out-of-order launch. | Say the owner supplies the intended ID and role with the date and source of their last knowledge; currentness is confirmed at NI-01, and a mismatch there stops the session. |
| L2 | Low | §1 omits note v4.2 OneDrive admission | Note v4.2 lines 61–63: key admission rejects any path component beginning with `onedrive` (ASCII case-insensitive), e.g. `OneDrive-work`. Template lines 23–25 present v4's spelling rule as "the reviewed bounded derivation" without it; the template cites none of notes v4.1–v4.4 (lines 145–148). A OneDrive-containing literal looks admissible from the template alone. Fail-closed later (classifier and native check reject it), so no false pass. | Add the OneDrive rule to §1 and cite notes v4.1–v4.4. |
| L3 | Low | §3, §5, §6 owner-side evidence path | Template line 72 asks for an "existing evidence locator" for pg_ctl's SHA-256 and version and says it "does not authorize hashing or executing an operational tool"; line 11–12 says the requests are not "permission to inspect systems". Proposal v4 line 45 expects Jordan to *supply* the hash and version. Check 4 found no existing repository record of either. So the only route is an owner-side hash or version read, which the wording appears to forbid. §3's port has the same issue (v4 line 35 forbids *agents* from reading studio.json; the owner needs some source). | State that these limits bind agents and the template, not Jordan's own actions on their own machine; say what owner-produced evidence is acceptable (e.g. their own hash and file-properties version with date and method) and that agent-run hashing still needs a scoped grant. |
| I16 | Info | §7 wording | "launch-exclusion prerequisites" (line 101) could be read as covering the per-window `launch_during_sampling:false` attestation of notes v4.1–v4.3, which is a separate session-time attestation, not historical continuity. | Name the window attestation as later and separate. |
| I17 | Info | Preparation provenance | The template's tracking entry records the 113-path rehash but neither the template's own hash nor its author. | This review binds the hash `a5f49bf0…3e91`. |
| I18 | Info | Observer effects not mentioned | Notes v4.1/v4.2 say open-only mutex/event observation can suppress or trigger a concurrent quiet launch. That is collector/session scope, not an owner input. | Optional pointer in "What remains separate". |
| I19 | Info | §7 minimality | "other users/sessions" could prompt naming other accounts; v4 line 104 omits usernames from evidence. | Optional: ask only whether others can act on the home, not who. |

No finding allows a field to be prefilled, an unknown to pass, or any inspection,
launch or session to be authorized. All three Lows fail closed.

## Bounded verdict

The blank template is **supported** for its purpose: a nonsecret, non-authorizing
request for the nine collector/session prerequisites. Lows L1–L3 are worth an
additive clarification before Jordan fills it, but none is a safety defect. This
review does not establish any owner value, collector, operational read or session.
No collector or operational adapter exists. Native acceptance remains blocked, H is
unverified and full C54 is partial. M3 is unchanged.

## Smallest next eligible prompt (not executed)

> Preserving the template, this review and its receipt, the L12/L13 review and
> receipt, proposal v4, notes v4.1–v4.4, checklist v5 and the M3 decision byte for
> byte, write an additive note
> `docs/THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_V1_1_NOTE_2026-10-25.md`
> resolving L1–L3 (and optionally I16–I19): intended workspace/role with date of last
> knowledge confirmed at NI-01; note v4.2's OneDrive admission rule for §1 and
> citations to notes v4.1–v4.4; and which owner-side actions may produce port, hash
> and version evidence, without granting any agent inspection. Repository text only;
> fill no field; no collector, launch or grant. Full C54 stays partial.

Alternatively Jordan may fill the template as is, accepting L1–L3, with any
unknown answer left as a blocker.
