# Accepted runbook decisions — October 20, 2026

Owner: Jordan Price. Status: accepted design and operating defaults; implementation
and activation remain separately evidenced. This register preserves the chat IDs
1–52 and RD1–RD10 so later work can cite a specific decision.

## Authority and interpretation

Source: Jordan accepted the recommendation list with exceptions #1, #2, #4, #5,
#10 and #34; accepted the revised recommendations except #10; then accepted #10's
clarification that users control their spending ceiling. Jordan subsequently asked
that all decisions be recorded in project files.

These choices supersede conflicting proposed defaults in the completion runbook,
older handoffs and context. They do not establish implemented behavior, model
eligibility, institution/committee approval, protocol adoption, account identities
or successful acceptance tests. Recommended deferrals were accepted as deferrals.
Implementation is still selected one bounded milestone at a time. No public
release, purchase, outbound message, recruitment, paid dispatch or external account
activation follows solely from this register. Honor existing matching grants.

The current studio runtime ceiling remains $20 in `config/spending.json`; the
separate $20 total T15 cap counts inside it. Neither amount was raised here.
Product spending settings must let authorized users explicitly change their own
ceiling, including above $20. Until that feature is implemented and verified, use
the existing reviewed configuration route; do not claim the Settings control exists.

## Desktop and connections

| ID  | Accepted decision                                                                                                                                                                                                                                                                                                                                                                | Remaining gate                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | First run offers Create new studio, Restore studio backup, or Connect to existing authorized studio. Recommend empty new studio on a new device. Offer Jordan adoption of the approved `creator_studio`; preserve source data and verify backup/restore. Product/source archives are not complete studio backups. Never silently merge/overwrite studios.                        | Verify portable backup format, secure identity reauthorization and target ownership. Remote connection requires supported hosted mode; no implicit cross-device sync. |
| 2   | Default close behavior is continue in tray, with first-close explanation, user-changeable Close to tray / Quit on close, and explicit Quit.                                                                                                                                                                                                                                      | Native lifecycle acceptance.                                                                                                                                          |
| 3   | Launch-at-login off initially; separate explicit opt-in setting.                                                                                                                                                                                                                                                                                                                 | Owner setting change before OS registration.                                                                                                                          |
| 4   | Inspect hardware and installed models; use one only if suitable. Otherwise recommend a compatible model with capabilities, size, hardware needs and license, allow alternatives, confirm exact download, then test/qualify roles. Explain insufficient hardware and offer supported connections.                                                                                 | Exact model/tag and download decision after inspection; bounded inference limits.                                                                                     |
| 5   | Prefer permitted qualified local fallback on subscription quota exhaustion; otherwise pause. Paid API fallback setting is off by default and manually enabled with eligible providers/models, task scope, caps and privacy rules. Matching configured grants avoid repeated prompts.                                                                                             | Verified routes, bounded exposure and explicit fallback configuration; no silent paid calls.                                                                          |
| 6   | Default Economy with measured task-quality floor and qualified model/effort configurations; project overrides for Quality, Local-only and fixed model.                                                                                                                                                                                                                           | Real task-class qualification, capability/privacy filters and honest uncertainty.                                                                                     |
| 7   | Local and supported subscription connections first; metered API support available but disabled until configured and budgeted.                                                                                                                                                                                                                                                    | Actual eligibility, local authentication and verification.                                                                                                            |
| 8   | Qualify existing research adapter first; replace only if coverage, source fidelity or cost is unsuitable.                                                                                                                                                                                                                                                                        | Runtime provider selected after adapter inspection; coding-tool access is separate.                                                                                   |
| 9   | Task-specific approved source domains, initially relevant official/primary sources such as government, universities and official docs.                                                                                                                                                                                                                                           | Exact allowlist prepared with each brief.                                                                                                                             |
| 10  | Users may set/change overall, provider, model, project/run and task spending limits, including an overall ceiling above $20; offer recurring limits. Every applicable parent limit is enforced. Only an authorized user can raise limits, never an agent. Show spent, reserved, uncertain and remaining exposure; distinguish API money, subscription quota and local resources. | Implement authenticated, audited, versioned changes with atomic admission/conservation and concurrent-update checks. Existing $20 current allowance is unchanged.     |

## Files, privacy and everyday use

| ID  | Accepted decision                                                                                                                                                        | Remaining gate                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 11  | Bounded local OCR with visible uncertainty and exact-original links; no automatic cloud OCR.                                                                             | Tested adapter and declared limits.                                                        |
| 12  | Text/Markdown, inert code, JSON and CSV editors first; richer office/image editing follows reliable preview/save/version recovery.                                       | Supported-operation matrix and executed fidelity checks.                                   |
| 13  | Initial conversions: text/Markdown to PDF, DOCX to text/Markdown, CSV/JSON with mapping, common raster conversions. Preserve originals and disclose losses.              | Verify actual supported pairs/libraries; no universal conversion promise.                  |
| 14  | Project-scoped provider-sharing rules show destinations/selected content. Sensitive or uncovered data stays local pending authority.                                     | Enforce grants/data classification and context selection.                                  |
| 15  | 30-day Trash and explicit permanent deletion; disclose backup-retention limits.                                                                                          | Reconcile originals/derivatives/indexes/backups and applicable retention duties.           |
| 16  | Local relationship neighborhood and related-file list before broad graph.                                                                                                | Distinguish provenance from similarity and verify access/performance.                      |
| 17  | Remappable shortcuts, command palette and optional hold-modifier hints.                                                                                                  | Choose chords after native/browser/accessibility conflict testing.                         |
| 18  | Restore last workspace/views/recoverable drafts; provide Start at Home preference; reauthorize content.                                                                  | Recovery, retention, sign-out and access tests.                                            |
| 19  | In-app notifications by default; opt-in OS notifications for completion/failure/decisions with sensitive detail hidden.                                                  | Platform consent and actionable, deduplicated delivery.                                    |
| 20  | Dependable core first: startup, connections, files, qualified routing, search, basic editing, navigation, undo/recovery and exports; richer editors/map expansion later. | Bounded milestone selection and exact-candidate acceptance.                                |
| 21  | Owner usability walkthrough first, then a small explicitly authorized tester group.                                                                                      | Applicable consent/privacy decisions and recruitment authority; no invitations authorized. |

## Real workflow and owner pilot

| ID  | Accepted decision                                                                                                                                                                              | Remaining gate                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 22  | First example: research-team CSV quality checker for missing values, duplicates and inconsistent columns, producing readable reports. Compare existing tools/processes before custom building. | Concrete brief and builder-path scope.                              |
| 23  | Public/synthetic clean, empty and malformed CSVs; correct findings, original preservation, useful errors and isolated exported startup.                                                        | Freeze concrete expected results before execution.                  |
| 24  | One observed defect/improvement against exact release, one bounded revision, repeat affected checks.                                                                                           | Actual owner use/feedback, not fabricated feedback.                 |
| 25  | Jordan runs a seven-day pilot after installed acceptance, America/New_York.                                                                                                                    | Exact start/end timestamps at pilot gate.                           |
| 26  | $0 new metered/API spending for initial pilot; local inference and verified subscription access.                                                                                               | Separate concrete grant for any later paid pilot.                   |
| 27  | Stop after three consecutive failures or 120 total owner intervention minutes; record ordinary voluntary use separately.                                                                       | Versioned pilot stop-rule configuration.                            |
| 28  | Installed Windows studio and verified isolated worker; local and verified subscription connection; no hosted first pilot.                                                                      | Native acceptance and connection verification.                      |
| 29  | Manual runs initially; schedules later after recovery/cancel/stop verification.                                                                                                                | No schedule activation here.                                        |
| 30  | Permit private research, alternatives, isolated build/review, file workflows and exports. Exclude publication, messages, payments, ads and unrelated repositories.                             | Concrete scope and matching grants.                                 |
| 31  | One active model job and one build; 30-minute maximum pilot run with bounded task timeouts. Preserve stricter worker limits.                                                                   | Hardware-derived RAM/VRAM bounds and exact policy before execution. |
| 32  | Pause on unknown cost or no qualified route; only already authorized qualified fallback.                                                                                                       | Exposure reconciliation and route verification.                     |

## GitHub and distribution

| ID  | Accepted decision                                                                                                                                                                                                                                                                                                                              | Remaining gate                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 33  | Existing personal GitHub account for bounded private trial unless a dedicated organization already exists.                                                                                                                                                                                                                                     | Confirm exact owner identity and scoped installation.                                                          |
| 34  | No universal three-repository limit. User selects accessible repositories and creation authority, with configurable per-run/project creation limits and rate limits. Initial verification is one new private test repository; existing repositories require explicit selection by immutable ID. Prefix `creator-agent-` for the initial trial. | Confirm account/target and scoped grant; broader routine allowance is user-selected, not implicitly unlimited. |
| 35  | Prepare PRs; owner approves merges. Require applicable build/typecheck, meaningful tests and independent review.                                                                                                                                                                                                                               | Exact reviewed head and checks before authorized merge.                                                        |
| 36  | Small private beta, then public beta after release gates.                                                                                                                                                                                                                                                                                      | Exact recipients/package and separate publication authority.                                                   |
| 37  | Evaluate Microsoft Artifact Signing first; trusted-certificate alternative if unsuitable.                                                                                                                                                                                                                                                      | Eligibility, current costs, identity enrollment and explicit purchase decision.                                |
| 38  | GitHub Releases initially in a deliberately chosen distribution repository, authenticated update verification; development source need not become public.                                                                                                                                                                                      | Exact repository, update trust and publication approval.                                                       |
| 39  | First public scope: local Windows studio, user-owned model connections, documented worker prerequisites/formats; hosted accounts/payments/campaigns excluded.                                                                                                                                                                                  | Release acceptance on supported systems.                                                                       |
| 40  | Source private for private beta; public license decision deferred until before public release.                                                                                                                                                                                                                                                 | Review actual license/third-party obligations and distribution terms.                                          |
| 41  | Public nonsensitive bug tracking plus a separate private vulnerability channel.                                                                                                                                                                                                                                                                | Owner supplies/approves real contacts/accounts.                                                                |
| 42  | Automatic diagnostics off; previewable local redacted diagnostics export.                                                                                                                                                                                                                                                                      | No telemetry activation implicit.                                                                              |
| 43  | Owner approves exact signed package and publication destination after acceptance.                                                                                                                                                                                                                                                              | This register does not authorize publication.                                                                  |

## Deferred integrations and commerce

| ID  | Accepted decision                                                                                                         | Remaining gate                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 44  | Defer hosted activation; prepare configuration and use a concrete remote need to justify staging.                         | Reviewed staging proposal.                                                    |
| 45  | Hosting account/provider/domain/region/IdP decided at staging gate using a costed comparison.                             | All exact identities remain unset; no resource purchase/creation.             |
| 46  | $0 hosted spending until approved staging plan; decide cap, data-specific retention and owner alert destination together. | Concrete costs, retention and account/destination.                            |
| 47  | Defer live commerce; qualify existing payment adapter in test mode when needed.                                           | Confirm actual processor/business account before activation.                  |
| 48  | Free beta using users' own model access; pricing/refunds/entitlements deferred until value/support costs measured.        | Concrete commerce policy before charging.                                     |
| 49  | Automatic reinvestment disabled. Decide percentages/reserves/holdback/caps against reconciled earnings later.             | Explicit finance policy and activation.                                       |
| 50  | Owner-controlled message test only after separate authorization.                                                          | Exact provider, recipient, content, cap and dates; no send granted here.      |
| 51  | Real campaigns use explicit opt-in audience, suppression/unsubscribe and reviewed claims.                                 | Campaign-specific recipients/content/cap/dates and send authority.            |
| 52  | Paid advertising disabled until useful public product and evidence.                                                       | Supported adapter, concrete account/campaign/cap and explicit spend decision. |

## Research choices — accepted direction, not a protocol freeze

| ID   | Accepted decision                                                                                                         | Remaining gate                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| RD1  | RQ1 three-arm comparison primary, RQ2 discovery secondary.                                                                | Applicable committee agreement and freeze.                                                   |
| RD2  | Independent anchored decision-quality ratings and held-out implementation acceptance results as primary outcomes.         | Exact measures/analysis frozen before final collection.                                      |
| RD3  | Jordan single-participant case study with matched variants and explicit familiarity/sample limits.                        | Confirm participation details and applicable review.                                         |
| RD4  | Two independent blinded reviewers, calibrated on non-study examples.                                                      | Actual names, availability and applicable consent/review.                                    |
| RD5  | Obtain and record applicable institutional/committee determination before recruitment/collection.                         | Actual determination; no ruling, contact or recruitment invented.                            |
| RD6  | Preserve recorded GPT-6 Astra preference and $20 total T15 cap inside current overall ceiling; no silent substitution.    | Actual accessible ID/pricing verification, matching dispatch grant and other protocol gates. |
| RD7  | Provisionally retain four decision and two implementation tasks across three arms plus smaller discovery comparison.      | Reviewer feasibility, exact counts/caps and protocol adoption.                               |
| RD8  | Low-risk NAE-derived final tasks selected independently of pilot success; prepare candidate set for owner approval.       | Actual final task identities and held-out cases remain unresolved.                           |
| RD9  | Verify source packets through broker and freeze exact snapshots.                                                          | Execute verification and freeze versions.                                                    |
| RD10 | One infrastructure retry only before any output; exclude generative search summaries in human-only work; retain failures. | Freeze exact retry/search rules and reconcile protocol wording.                              |

## Follow-through

Owner-requested final UX/UI pass: after the selected release functionality is
integrated, review complete user journeys for friction, accessibility, consistency,
draft/context continuity and truthful running/completed/changed/error feedback.
Runbook §5.6.1 requires reproducible findings, repairs, post-repair checks and
exact-candidate evidence before §5.6.2 final acceptance. This is a planned release
gate, not evidence of completed UX validation or publication authority.

Owner-requested app-wide drag/drop: files dropped anywhere in the signed-in
management app go to the current workspace's Sources/Library without navigating
or discarding drafts. Provide destination overlay, transfer tray and global picker
alternative. Specific attachment targets store once and link to their indicated
record. Bind workspace at drop time, preserve authorization and validation, and
do not infer provider sharing or verified evidence. Explicit acceptance cases are
in runbook §2.7. Planned functionality; no upload implementation asserted here.

Owner-confirmed recovery clarification: durable drafts should survive sign-out
under the retention policy but remain inaccessible while signed out. Recovery after
sign-in is limited to the same authenticated owner with current studio/workspace/
record access; other accounts and revoked access cannot expose them. Explicit
discard/expiry remains available. Runbook §2.16A includes acceptance checks; the
current session-memory repair does not implement durable recovery.

Additional owner feedback: page navigation must retain unsubmitted text until
successful submission or deliberate clearing; failed submissions retain it. Provide
a scoped clear/reset-all-fields control with protection against accidental loss.
The October 20 bounded repair covers session memory within one workspace; durable
reload/restart and workspace-switch recovery remain planned under #18/§2.16 and
must not be described as implemented. See `docs/UX_UI.md` and page-drafts evidence.

Implementation prompts remain in `docs/COMPLETION_RUNBOOK.md`; this register is the
source for owner choices. Update relevant integration/protocol configuration only
at its implementation gate, with actual identities and evidence. Leave unresolved
configuration fields unset rather than turning accepted direction into false
activation/verification. Research freeze still requires the complete adopted
version/hash and remaining external determinations. Current §2.1 implementation
continues; selecting preferences does not automatically select the next milestone.
