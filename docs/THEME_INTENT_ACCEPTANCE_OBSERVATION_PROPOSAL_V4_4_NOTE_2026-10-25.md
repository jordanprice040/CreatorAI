# Observation proposal v4.4 additive correction

This note supersedes only the overly broad uncertain-attempt sentence in v4.3.
Explicit launch=true anywhere still wins as LAUNCH_DURING_SAMPLING. Next, uncertain
window exclusion blocks. Next, any sample for which classifySample returns
LAUNCH_NOT_EXCLUDED blocks the whole window with that same reason, before restart,
contradiction, shape, cap, closure, planned-Quit, deadline or sequence rejection.
This retains classifySample's existing availability split: missing availability,
invalid time/binding or a contradiction in that same sample need not be classified
as launch uncertainty. Those inputs still cannot pass. Uncertainty is not proof of
an attempted launch. The loop preserves the sample incident reason too.

All other v4/v4.1-v4.3 contracts remain: restart exclusion, uniform query-start
at_ms, closed_ms=now_ms within the original deadline, handle-closure and no-launch
attestations, mutex/event observer effects, and sampled rather than continuous
observations. No collector exists. Inputs must be ordinary fixture data; this is
not a sandbox for hostile getters, proxies or mutated JavaScript intrinsics.

The successor verifier uses TypeScript lexical symbol resolution to admit local
bindings plus free Number, Array and createHash, rejects computed property names,
and retains structural restrictions. L10 mutants are parsed, never executed.
This supplemental guard checks this reviewed source; it is not a general purity
proof or an operational admission boundary. Exact-byte review remains required.
M3 is unchanged. Native acceptance stays blocked, H unverified and full C54 partial.
