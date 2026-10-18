# Human oversight, assumptions, and humility

This policy design implements the October 8 feedback. It governs the future application; it does not grant the coding tool additional permissions.

## Separate the kinds of human input

| Kind | Purpose | Example |
| --- | --- | --- |
| Clarification | Resolve missing facts/preferences | Which user group and data source are intended? |
| Judgment | Resolve a value tradeoff or substantive uncertainty | Does this intervention respect the affected group's priorities? |
| Authorization | Permit an otherwise out-of-scope action | Publish this exact release under this grant |
| Feedback | Assess a concrete output | This workflow fails for my actual use case |

Do not treat these as interchangeable. A spending grant does not answer a stakeholder-value question. A favorable review does not authorize a public release.

## Modes and scopes

| Mode | Routine work | Human-needed decision | External consequences |
| --- | --- | --- | --- |
| Supervised | Proceed inside scope; ask at selected stage gates | Pause for the specific decision | Requires matching standing or one-time authority |
| Human-in-the-loop | Proceed until configured or dynamically justified intervention | Ask, wait durably, log input and ensuing changes | Same deterministic permission checks |
| Autonomous within scope | Choose and execute within an explicit initial task/grant/policy | Apply predefined low-risk default; otherwise defer/stop | Cannot expand scope, budget, or policy |
| Human-only study | Non-generative tools and the same record/artifact interface | Human makes the substantive decisions | Ordinary tool permissions still apply |

“Auto-approve” means deterministically matching an existing policy to a covered action, not a model signing its own permission. Offer a clear settings preview showing which actions the policy covers. Changing this setting is an authenticated owner action and is versioned. Never enable it by default because a model asks.

The supervisor can stop any run. For experiments, emergency/operator intervention does not disappear from the dataset; record it and apply the protocol's deviation rule.

## Admission order

1. Validate actor, workspace, action type, target/content/spec version, tools, data classification, and grant status.
2. Apply non-delegable application constraints and current revocation/cancellation state.
3. Verify budget exposure, concurrency, and bounded execution.
4. Evaluate explicit stage gates and available assumption/ethical flags. Model flags are evidence to consider, not trusted permission decisions.
5. Choose allow, request_human, deny, or defer with a reason and policy version. Bind allowed actions to exact relevant versions.

No uncertainty score alone is a sufficient authorization rule. Combine predefined triggers, structured assumptions, independent checks, and known task context.

## When intervention is useful

Ask when an unresolved assumption would materially change the selected problem, stakeholder impact, data use, acceptance criteria, or external action. Ask when affected stakeholders have conflicting interests or meaningful consent/access questions; when success requires unavailable contextual or professional judgment; when credible sources disagree about an important premise; or when a proposed action is outside the grant.

Proceed and log a provisional assumption for routine, reversible details inside scope when its consequence is small and a cheap test is available. Do not ask the same answered question again unless relevant context changes.

Use this concise request:

“Decision needed: [specific choice]. Evidence: [references]. Uncertainty/assumption: [what is missing]. Consequence of being wrong: [effect]. Options: [2–3, including defer when meaningful]. Recommendation and reason: [brief]. This blocks [specific work]; [other work] can continue. Approval, if relevant, covers [exact scope/version/expiry].”

## Decision binding and recovery

Persist request ID, reason code, affected action/spec/content hashes, alternatives, evidence, risk/reversibility, requested authority, creation/expiry, state, and blocked tasks. Persist who answered, their actual input, timestamp, chosen scope, and time spent where study measurement requires it.

Options include approve once, approve a defined recurring class, revise, request evidence, choose an alternative, reject, and defer. The UI must distinguish changing policy from approving one action.

Expired, revoked, or version-stale decisions do not authorize execution. Revalidate just before the external effect. Duplicate clicks are idempotent. Stop/cancel overrides pending approval. A reviewer cannot approve an already changed artifact by relying on an old screenshot.

## Humility gate

Before commitment to a solution, record:

- What outcome matters and whose perspective defines it?
- What is actually supported by evidence, inferred, disputed, or unknown?
- Could an existing tool or simpler process achieve it?
- Which part requires software, and which part requires a person?
- Would software shift burdens, exclude users, or automate an unresolved judgment?
- What small disconfirming test is available?
- What observation would make us change course or stop?

Output one of build, use_existing, change_process, human_led, hybrid, investigate, defer, or decline. Store rationale and dissent. Humility is observable willingness to change course; no unsupported numerical “confidence” should masquerade as calibrated probability.

A serious unresolved ethical problem is a separate gate, not a penalty that high usefulness can average away. Over-caution also has costs: log unnecessary interruptions, delay, and lost task quality for evaluation.

## Concrete examples

- A deadline organizer can continue with editable manual input rather than requesting access to private student accounts.
- A team coordination complaint may be better addressed by clearer responsibilities and a recurring meeting than by another app.
- An app intended to decide resource allocation among vulnerable groups may require stakeholder judgment; the system can research options without inventing their values.
- An unavailable source produces a gap and a research plan; it does not justify fabricated evidence.
- An autonomous benchmark requiring stakeholder approval ends as needs_human/deferred if that approval is not in the initial packet.

These examples are synthetic acceptance cases, not validated opportunities or research results.
