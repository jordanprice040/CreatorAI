# X05 PR candidate

The PR selects X05 changes from the accepted local workspace. Existing unrelated
audit repairs, maintenance-health changes, research adapter fixes, session/actor
UI repairs and broad documentation rewrites remain local. Mixed API/UI and
tracking files were staged by selecting X05 hunks while preserving other edits.

The exact staged tree was exported to a fresh disposable directory and installed
with the frozen lockfile offline. TypeScript, repository formatting and PostgreSQL
tests were executed there; see pr-typecheck.log, pr-format.log and pr-tests.log.
Native Rust source/configuration and paired-execution implementation match the
locally accepted source. Historical acceptance candidate hashes include the wider
dirty workspace and are not hashes of this PR tree. Native release binaries remain
local unsigned artifacts; they are not uploaded to the PR.

Native observations and earlier full-suite results keep their recorded candidate
scope. New PR checks verify the selection independently. Log terminal whitespace
was normalized when staging; test outcomes and failure text were retained.
Live OIDC, signing and automatic updates are not activated by this PR.

The initial full run recorded 217 passes, 15 opt-in skips and 2 failures. The
selection initially omitted the migration assertion's expected version 17; that
X05 test change is now included. The nested export also exceeded Windows Git's
path limit in the study test. A retry with process-local core.longpaths did not
resolve it; copied source timestamps also required a forced rebuild. Both
failures remain in pr-tests.log and pr-repair-tests.log. A fresh staged export
to a shorter path, frozen offline install and forced TypeScript build passed the
affected storage/study test files: 10 passed, 0 failed, 1 real-WSL opt-in skip
(pr-short-tests.log). No test assertions were weakened. The remaining full-suite
results were not rerun because their source and behavior were unchanged.
