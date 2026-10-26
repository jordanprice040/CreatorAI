# Discovery output-contract audit and revision

Follow-up preparation: [fresh v3 packets, frozen manifests and candidate](DISCOVERY_QUALIFICATION_V3.md)
are now complete. The v3-design statements below retain their original audit scope.

October20 local time. Implemented in checkout only; no installation, saved settings,
provider request, schema migration, qualification rewrite or study-protocol change.
The installed transport-repair bundle remains
`b59212cfe661723e6a150ca5f1d02658ccb069bbd94dcbb2664f69b26255a048`.
The failed v1/v2 results and all three run locks remain intact.

## Root cause and implementation

The production validators specify exact nested types, lengths, counts, enums and
reference formats. Earlier prompts showed field-name sketches that omitted many
of these constraints. The revision role referred to the proposal shape without
actually supplying it. The shared runtime contract also requested a generic
TaskResult wrapper and auxiliary status/usage/checks, although the role schemas
reject extra fields. That mismatch affected all discovery roles, not only the two
fields observed in the last failed locator response.

packages/domain/src/discovery.ts now derives a model-facing JSON Schema from the
existing Zod output validators for locate, propose, revise and skeptic. No dependency
was added and the validators were not relaxed. Optional fixture metadata is excluded
from the model-facing projection; it remains available only for the existing test
adapter path. Instructions require one JSON object, all required nullable keys,
trimmed bounded strings, correct array item types and no Markdown or extra keys.
The revision receives the full proposal schema rather than an undefined reference.

The discovery-specific serialization instructions identify this JSON object as the
complete role payload. Trusted application records retain lifecycle, provenance,
checks and observed usage outside it. The model is told to combine related limitations
within the allowed fields, preserve consequential uncertainty and defer within that
schema when necessary. It must not invent extra status/usage fields or discard
uncertainty merely to fit a count. General permission/evidence rules are unchanged.
The shared runtime contract itself and other roles' prompt hashes are unchanged.

The discovery role version is `r02-discovery/1.2`. Its hash includes the generated
schemas and serialization instructions as well as the role text:
`01ef4e7c37ab9c6c50abe0d4c3ef25a22484daa8d3d1490672bc60e8007c0f00`.
Schema changes therefore affect prompt binding automatically. Current-version and
exact-system-prompt admission reject historical v1/v2 qualifications for this candidate.
Historical tests now verify frozen bytes and original grades; current workflow tests
use explicitly test-only fixture rebindings, not altered historical manifests.

## Constraint coverage

All objects are strict. References use the actual C1..C99 and K1..K99 formats and
bounded arrays of at most30 claim refs. Required strings are trimmed/nonempty.
The complete machine-readable inventory and exact model-facing prompts are retained
under tracking/evidence/discovery-output-contract.

| Role              | Principal schema constraints supplied to the model                                                                                                                                                                      | Rules still enforced separately                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locator           | Problem text1–1200; affected-users/observation/frequency1–300; severity enum; workaround/alternative arrays0–8; nullable hypothesis; cross-field text30–800 with1–30 refs; evidence enum; gaps0–8 of1–300 characters    | Exactly one cross-field mechanism or absence reason; brief field names must match; mechanism must describe more than the field names; supplied refs only |
| First designer    | Perspective enum; title1–200; mechanism/smallest-version/feasibility/reason1–1200; user/outcome/maintenance1–300; software/recommendation enums; assumptions0–6 with1–300 strings; nullable novelty and response fields | Assigned perspective only; response_to_findings null; no sibling proposal access                                                                         |
| Revision designer | Full proposal schema, including response_to_findings string/null and its1–1200 length when present                                                                                                                      | Same perspective; nonnull response addressing every supplied finding; required fields retained                                                           |
| Skeptic           | Summary1–1200; reviews1–5; P1..P5 labels; verdict/finding enums; findings0–8 per review; detail1–1200; catalog ref or null; cheaper-test1–300 or null                                                                   | Review each supplied proposal exactly once; no invented references; contrary evidence and disagreement retained                                          |

This is prompt guidance plus deterministic application validation. The existing
ChatGPT-plan request builder sends instructions and text input, not a provider-enforced
structured-output schema. No provider capability was assumed or activated. JSON
Schema also cannot represent every Zod refinement, trimming behavior, packet reference
or substantive evidence relationship; those rules remain in the production parser
and discovery checker. A schema-valid response can still make unsupported claims.
These changes do not establish live compliance, entailment or usefulness.

## Executed checks

- TypeScript and web typechecks plus the production web build passed. The existing
  large-chunk warning remains.
  -52 affected tests passed, zero failed/skipped, on disposable PostgreSQL and loopback
  stand-ins (tests.tap). This includes workflow admission, cancellation, authenticated
  HTTP creation, current-role fixture qualification, and rejection of both historical
  versions. No paid/live provider was substituted for stand-ins.
  -189 nested wrong-type, length, array-count, enum and reference-format mutations were
  rejected across all four task kinds (locator70, proposal45, revision48, skeptic26).
- Relational tests retain mutual exclusion, field pairing, revision/first-proposal
  response rules and complete skeptic coverage beyond the generated JSON Schema.
- The exact retained v2 response hash is unchanged and still fails on affected_users
  and gaps. No coercion, truncation, schema relaxation or retroactive passing grade.
- Current-production **fixture** manifest POST sizes are101,668/83,535/88,740bytes;
  maximum combined model-input lengths12,173/10,748/10,939characters. All fit128KiB
  ingress and24,000-character input caps and were exercised through HTTP. These are
  test fixtures, not prepared v3 manifests or guarantees about future larger packets.
- Offline audit checked original manifest bytes, run locks, installed bundle identity
  and the v3 proposal's counts/splits/version. It made zero provider calls.

Evidence: tracking/evidence/discovery-output-contract/result.json, tests.tap,
schema-inventory.json and model-facing-contracts.json. The local PostgreSQL test
cluster is stopped after verification. No new installer or native acceptance is
claimed for role1.2; the installed app still runs the preceding role version.

## Fresh qualification proposal and next eligible work

config/connections/benchmarks/discovery-synthetic-v3/proposal.json contains18 fresh
scenario designs: two development and four held-out per class, including revision
and multi-proposal coverage. It tests missing/contrary/stale evidence, source and
proposal formatting injections, proper authority, software alternatives and complete
bounded uncertainty. The new labels are author-visible prospective checks; they are
not independent or thesis holdouts. Prior exposed model output remains development
diagnostic evidence and is not relabeled fresh qualification.

This proposal is not an executable benchmark, frozen run, installation or live-call
authorization. Next eligible prompt: author complete fresh v3 evidence packets,
production-bound manifests and positive/negative/semantic controls; freeze prospective
criteria and reviewer checklists; verify actual HTTP body/input limits before building
a concrete candidate and hash-bound execution packet. Retain at most18 sequential
plan requests, no retries/new metered spend and current timeout/data/credits caps in
that proposal; review actual remaining quota before any dispatch. Do not silently
reuse earlier installation/run approval for this prompt version.

Discovery remains unqualified and C54 partial. No search, workflow, build or pilot
activation follows from this offline contract revision.
