# T11 self-review

What this change does: The owner CLI binds a frozen studio specification to a
separate local Git product and a bounded offline Python build in WSL2. Generated
code cannot choose management commands, mounts, resource limits or credentials.

Reviewed the CLI/auth/spec path, supervisor contracts, Git recipes, file helpers,
bridge and build recipe, their callers and executed tests for one local owner.
Used the installed Ponytail review checklist. This is self-review, not independent
review or security certification; T12's independent product review is still absent.

Must-fix findings repaired before the final gate:

1. Writable namespace roots could bypass the intended work-disk location. Root,
   proc and dev are now read-only; work and tmp retain their explicit bounded mounts.
2. Snapshotting workspace text without checking the committed blob could certify
   edited bytes. Every plain file now matches the exact Git blob and UTF-8 bytes;
   links/submodules/executable modes and excess files/bytes are refused.
3. A bridge outcome without verified cleanup could allow a second dispatch. A
   durable pending-worker fence now blocks new work until explicit reconciliation.
   Reconciliation checks an absent supervisor, an expired lease and a stopped unit.
4. A single transient Windows lease-file replacement error incorrectly reported
   a lost worker even when its lease remained valid. Write errors are counted;
   the trusted bridge's actual lease expiry remains the deterministic stop/status.
5. Two pre-existing broker tests released a provider gate after a fixed 300 ms
   sleep. Under full-suite load this admitted queued requests after settlement and
   produced 4 instead of 3 budget dispatches, or 4 instead of 2 concurrent dispatches.
   Tests now await all over-limit decisions before release and keep their original
   counts, balance assertions and direct overspend rejection.

Other verification corrections: non-root setuid denial can be EINVAL for an unmapped
UID, so the probe checks OSError plus unchanged UID instead of requiring EPERM.
Restricted Windows tool execution refused a harmless hardlink fixture and loopback
smoke connection; the real tests were rerun with scoped unsandboxed tool access.
CLI acceptance initially passed an object instead of its workspace ID and filenames
to older inline-JSON spec commands; those script errors were fixed before the final
successful acceptance. No acceptance assertion was removed to pass the gate.

Verdict: Ship the reviewed local-template scope for owner review. The final full
gate passed 140/140, including real isolation, resource exhaustion, process-tree
cancellation, supervisor crash, lease expiry and Git conflict preservation.

Not checked: independent security review, kernel exploit resistance, other OS or
UID configurations, syscall allowlists, remote workers, persistent previews, AI
builder behavior or empirical participant outcomes. Those are not claimed.
