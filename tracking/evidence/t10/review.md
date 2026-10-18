What this change does: T10 adds a synthetic study runner over the existing API, broker and worker. It preserves assigned conditions and records human entries, interventions, failures and exports.

Self-review used the project Ponytail review skill against the local single-owner fixture workload. This is not an independent reviewer certification.

Must fix (resolved):

1. Late outputs could complete an expired assignment.
   - What this is: provider output can arrive after the assignment wall limit.
   - Problem: the earlier result path recorded submitted without checking the original deadline.
   - Fix: retain output and charges but record failed/deadline_exceeded. A test advances the clock after a settled broker call.
   - If skipped: overtime attempts could count as completed within their envelope.
2. Manual stop and terminal-event ordering could race admission.
   - What this is: broker reservation and manual outcome writes use separate transactions.
   - Problem: the earlier stop did not share the run lock; terminal insertion could also conflict with the audit lock and parent foreign keys.
   - Fix: lock the run before mutable attempt admission, serialize terminal checks with the audit lock, and use no-key-update parent locks. Tests preserve one concurrent outcome and deny dispatch after a stop.
   - If skipped: a closed attempt could admit later work or deadlock with completion.
3. Hidden grading could be granted to agent principals.
   - What this is: hidden-test access is distinct from workspace membership.
   - Problem: the first grant path did not restrict the reviewer's actor kind.
   - Fix: require separate human graders and reject overlap with participants. Tests execute the agent-grader and participant denials.
   - If skipped: an agent identity could be admitted to private grading data.
4. Seed retries reused one key for different commands; invalid manifests escaped contract error mapping.
   - What this is: one HTTP seed creates a study and three assignments.
   - Problem: a repeated key described different nested commands; direct schema parsing returned an internal error for invalid input.
   - Fix: derive command-specific keys and use the shared parser. Retry and HTTP tests cover both paths.
   - If skipped: a valid retry could fail and malformed input could produce HTTP 500.
5. Structured input could lose snapshot text or use a different problem/outcome.
   - What this is: structured execution adapts a shared packet to T07 contracts.
   - Problem: the initial adapter truncated long text and accepted an independently worded brief.
   - Fix: bound snapshots before admission, preserve their bytes, require equal problem/outcome fields, and include shared background in neutral contexts.
   - If skipped: discovery workflows could receive different substantive information.

Verdict: Ship the synthetic T10 milestone for owner review. No open must-fix findings remain from this self-review.

Not checked: live providers, real participant independence/consent, arbitrary code execution, PostgreSQL 16 on Windows, screen-reader and comprehensive contrast behavior. PostgreSQL 18.6 fixture and browser checks are recorded in verification.json.
