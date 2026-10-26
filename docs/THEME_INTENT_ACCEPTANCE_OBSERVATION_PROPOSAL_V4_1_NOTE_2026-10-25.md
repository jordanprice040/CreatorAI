# Observation proposal v4.1 note: open-handle effects — October 25, 2026

Status: contract note accompanying frozen proposal v4. It adds N6's concurrency
constraint without editing v4, checklist v5, reader v2, decisions or prior evidence.
No operational read, OS-object operation, launch or session is authorized here.
M3's exact-bundle configuration evidence standard is unchanged.

Open-only observation is not entirely side-effect free. An opened handle can keep
the desktop's named mutex object alive briefly after its owner exits. A concurrent
desktop launch can then see ERROR_ALREADY_EXISTS and treat itself as a second
instance, quietly exiting (winsys.rs:45–53). Never describe open-only as having no
observable effects. The future collector must close handles immediately and may
not wait/acquire/create/release/set/reset objects; it must not hold them across
sample intervals. No such collector or handle operation is implemented now.

Require no launch attempt during the entire sampling window, including both
samples, intervals and handle closure, not merely no successful launch. Include
quiet/at-login and other launch paths in that attestation. Any observed, reported,
suspected or uncertain attempted launch is an incident: stop sampling, preserve
coded evidence, invalidate the window and block acceptance/relaunch pending a
separate scoped reconciliation. Do not silently retry the suppressed launch to
obtain a clean sample. Object/process absence cannot prove no suppressed attempt.
The Local namespace and all continuity/other-producer limitations remain.

The new fixture-only classification core takes an injected launch_during_sampling
flag. false means the collector/operator has affirmatively excluded ANY launch
attempt for the relevant window, not that a process count was zero. true, missing
or unknown blocks as an incident. The core does not observe or substantiate that
flag, close real handles or monitor the machine.

Operational adapter reader-side N1–N4 remain outside this step. No config read,
operational reader, PR-01/SH-01 collector, worker prevention or native acceptance
has been implemented by this note or the pure classifier.
