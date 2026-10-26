# Owner-authorized v5 test capacity amendment — October 21, 2026

Final outcome: [provider quota stop](DISCOVERY_V5_LIVE_RESULT.md), after10 accepted
answers and one provider failure. Temporary studio cap restored to40; quota remains
exhausted. No retry or paid fallback occurred.

Jordan explicitly authorized “I approve you adding more slots to do the testing.”
The smallest increase needed was two slots: daily studio cap40→42 with24 requests
already in the rolling window and18 required for the approved suite. Updated settings
and accepted the exact new caps through authenticated local owner commands. All other
settings, permission/data classes, credits-off confirmation and per-run limits remain
unchanged. This is a temporary studio admission change, not purchased provider quota.

Original frozen execution plan remains
`68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d`.
The source candidate, eighteen frozen cases, gold controls, grading floor,120-second
deadline,36-minute limit, no retries and zero new metered spend are unchanged.
No historical source hash or criterion was rewritten to admit this run.

The separate amendment hash is
`19c60ab6762bc631bbb012c8651c304723ced25e2324a64da4ec730139a34a1d`.
Settings hash at42/day:
`8f453458ee32682d7713aa1d5384c8a0863c90a61e1be80bd9d0681c5c7f3fdc`.
The supplemental runner checks its own exact hash, the original plan, original183
source bindings, frozen cases and installed candidate, plus the exact authorized
settings delta. It uses the same exclusive v5 run.lock and stops on the first
unsuccessful/unknown outcome. It cannot be used to rerun a started suite.

Receipts under `tracking/evidence/discovery-qualification-v5/` include cap-increase
intent/receipt/lock and capacity-authorization.json. The original credits-off statement
was retained; no provider settings were changed. The daily cap is to return to40
after the bounded attempt. Any restored cap lower than current rolling usage blocks
further work normally; it does not remove historical usage or create new allowance.

This amendment authorizes no automatic workflow/search/build/pilot or later request
sequence. Operational grades remain separate from independent substantive review.
The final live result and restoration receipt must describe actual observed outcomes.
