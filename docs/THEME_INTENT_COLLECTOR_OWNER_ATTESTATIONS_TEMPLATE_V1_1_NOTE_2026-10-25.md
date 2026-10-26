# Collector owner-attestations template v1.1 clarification

Prepared October 26, 2026 by Codex, the template author; not an independent review.
The filename retains the October 25 review's exact requested artifact name.

Read this note with the [original blank template](THEME_INTENT_COLLECTOR_OWNER_ATTESTATIONS_TEMPLATE_2026-10-25.md).
It supersedes only the interpretations clarified below. The original template,
review, evidence and governing contracts remain unchanged. No field is filled and
no owner statement, system observation or grant is supplied by this note.

## L1: intended workspace and last-known role before the session

For template §8 and §9, Jordan supplies the intended existing workspace ID and
last-known owner/editor role, with the source and date of that knowledge and any
uncertainty. These are pre-session inputs to the session decision, not a demand for
a fresh sign-in or database read. Label historical knowledge as such; do not claim
it is independently confirmed current state.

The bounded session decision still names the operator, selected workspace and role.
Current workspace and role are confirmed at NI-01, after separately authorized
launch and local sign-in if needed, as specified by plan v5. A mismatch, unavailable
confirmation or viewer role stops the session before NI-02 or any test write; it
does not authorize switching workspaces, creating one or escalating access.
An unknown intended workspace or unsupported role remains unresolved. Deferring
current confirmation to NI-01 neither satisfies it early nor bypasses A0, PR-01,
the session decision or any other prelaunch gate. This note authorizes no sign-in.

Source: [plan v5](THEME_INTENT_INSTALLED_ACCEPTANCE_PLAN_V5_2026-10-24.md), session
decision and NI-01.

## L2: complete key-admission rule and successor notes

In addition to template §1's spelling restrictions, key admission rejects any path
component beginning with `onedrive`, ASCII case-insensitively. Such an input is
unavailable under the reviewed derivation. Do not normalize, rename or substitute
another literal to make it pass, and do not infer an actual path from this rule.

Read proposal v4 with all four additive notes, with later corrections taking
precedence where stated:

- [v4.1](THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_1_NOTE_2026-10-25.md): open-handle effects and no launch attempt during observation.
- [v4.2](THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2_NOTE_2026-10-25.md): OneDrive admission, incident and shutdown rules, and show-event effects.
- [v4.3](THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_3_NOTE_2026-10-25.md): restart exclusion and query-start timestamps with separate bounded closure time; supersedes v4.2's earlier timestamp wording.
- [v4.4](THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_4_NOTE_2026-10-25.md): corrects uncertainty precedence and preserves the sample availability split.

These citations do not change the accepted classifier or verifier.

## L3: owner-produced evidence and the separate agent boundary

The template's inspection restrictions limit what the template authorizes agents
to do. They do not prohibit Jordan from personally obtaining information on their
own machine. Jordan may choose to supply newly produced evidence rather than an
already-existing repository record. This note requests no such action immediately
and performs none.

For §3, acceptable owner-supplied evidence is the exact nonsecret port with its
source, date/time and method of identification—for example Jordan's own reading
of the relevant setting or configuration. Supply only the needed value and its
basis, not a configuration file, secrets or an unrelated screenshot. Distinguish
configured/intended port evidence from an observation of a current listener.

For §5 and §6, Jordan may supply a personally obtained SHA-256 of each exact
executable and its file-properties version, with exact path, date/time, method and
installation/distribution provenance. A file-properties version is reported as
that source, not proof that the executable was run or that its identity has been
independently verified. A missing version or ambiguous identity stays pending;
do not infer it from a folder name. Neither launching the app nor executing the
database tools is required by this evidence route.

For all these fields, unavailable evidence may be explicitly left pending. A later
agent-run read or hash would require a concrete scoped grant specifying the target,
operation and permitted nonsecret output, plus any required reviewed reader or
collector. There is no implicit permission to read operational config, search PATH,
inspect the environment or registry, hash tools or execute them. Owner-produced
evidence still needs the binding and independent validation required by
[proposal v4](THEME_INTENT_ACCEPTANCE_OBSERVATION_PROPOSAL_V4_2026-10-24.md); it is
not automatic proof of current runtime configuration or tool identity.

## Related clarifications and unchanged boundaries

Template §7's historical continuity is distinct from the later per-window
no-launch-attempt attestation. That attestation must cover sampling, intervals and
all handle closure, and cannot be completed in advance by this blank template.
For other users/sessions, state whether they can act on the home and any uncertainty;
do not identify accounts or supply usernames.

Open-only mutex/event observation has the observer effects documented in v4.1 and
v4.2. Collector implementation/review and the bounded session must account for
them; this note performs no observation or handle operation.

The reviewed scope manifest, collector implementation/review, concrete operational
grant and bounded session decision remain separate and pending. No collector or
operational adapter exists. M3's accepted exact-bundle scheduler-configuration
evidence standard is unchanged, including worker and continuity limitations; it
is not live-state or zero-dispatch evidence. R remains separate, H unverified and
Jordan's alone, native acceptance blocked and full C54 partial.

Next eligible step: Jordan may supply the template's nonsecret owner inputs using
these clarifications, marking missing evidence and uncertainty explicitly. Evaluate
those inputs against the existing gates; do not treat a completed template as
execution authority or automatically begin collector implementation or acceptance.
