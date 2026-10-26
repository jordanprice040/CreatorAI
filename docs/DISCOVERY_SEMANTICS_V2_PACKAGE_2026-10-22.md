# Role1.4 exact package and prospective bindings — October 22, 2026

Packaged and archived locally; not installed or live-tested. The supported v2 packet
and reviewed role1.4 prompt are unchanged. Candidate canonical hash:
d009f0e1364eb71c3db8be8a0ddc9a78079e91b75df90f88771fb53519c7b0cf.

| Exact artifact | SHA256 |
| --- | --- |
| Runtime manifest | 621e6f12e37db3baf883c30d76d27a39bbdcba71a8df3a72c32fdfe22ddaa448 |
| Archived installer | 57cc5d923ba9ef62d052f788fd0e38c77c124d8b2d9e4b596cf7cb700affed27 |
| Extracted packaged desktop | 6c841ec4725726e0626612704abb1ca2b6e631f62733230e61ddab46140e2e46 |
| Loose build desktop (distinct identity) | 227b9c86d24a02a0e8af28e0adf8eb22663d7461ba484f94a7d3d4d83f32918c |

The candidate snapshots 219 source/artifact bindings and all67 runtime
resources. Files are archived under .verification/discovery-semantics-v2-artifacts/.
The extracted installer contains exactly the staged manifest and every listed
resource hash matches. The native executable identity is taken from the actual
NSIS payload, not assumed equal to the loose build executable. The bundle service
contains role1.4 and its finding semantics. This is byte/source verification, not
an executed installed-service or model behavior test.

Executed: pinned build-studio script (TypeScript, UI typecheck/build, service bundle,
resource staging), native Tauri/NSIS build, installer extraction, resource/hash
checks, packet checker108controls,23targeted compiled-entry tests (0fail/skip).
An initial sandbox native build compiled successfully but could not fetch pinned
NSIS due DNS; the authorized host build completed using the existing toolchain.
The UI retained its known chunk-size warning. No dependency/config change was made.
Original staged bundle and prior installer were archived before replacement;
prior installer hash matches its frozen receipt. Installed manifest remains the
previous82fa93... identity and installed role1.3 is unchanged.

Installation-plan hash:
01c84b292084bd989383d541a259cff2f9001cace7155e600b66b9389cfdc464.
It binds the exact installer, target directory and predecessor/target manifest,
requires fully quit app and idle state, program rollback plus supported backup,
and before/after record-preservation checks. Required schema remains28; no migration,
settings/credits change or provider request is planned. No backup/restore rehearsal,
new backup or installed service check is claimed at this preparation stage.

Prospective execution-binding hash:
d4efe785220f2c1c4f084720e4af481995b857fdfcb0ee184280a8cbc3a036a6.
It binds v2 freeze b6da3adc6061627b81036dcacee83884d6c8fe40c539368cead1f63fb139e5fa,
the candidate/install plans, existing connection/model/settings and review plan.
Limits remain12 sequential requests,0retries,120seconds each,24minutes total,
16000output/24000input characters,1concurrent,credits off,studio cap40. Require
4/4held-out per class and availability observed within15minutes, sufficient slots,
no active/unknown/leased work and no prior attempt. No implicit quota refresh.

This is a declarative prospective binding, not a runnable execution plan or owner
live decision. A versioned runner with bound static/admission checks, independent
review, installed-resource/state verification, and fresh exact-plan approval remain
required. No old live approval is reused; no dispatch, quota probe or retry occurs.
The old frozen suites/criteria/failures/locks remain unchanged. C54 remains partial.

Next eligible U02: independent review of exact archived package and prospective
installation/execution bindings. Then implement/review the bound runner and perform
the supported local upgrade under applicable scope before any live suite decision.
Do not treat this preparation as installation or live authorization.

[Candidate](../tracking/evidence/discovery-semantics-v2-package/candidate-plan.json),
[installation plan](../tracking/evidence/discovery-semantics-v2-package/installation-plan.json),
[execution binding](../tracking/evidence/discovery-semantics-v2-package/execution-binding.json),
[result](../tracking/evidence/discovery-semantics-v2-package/preparation-result.json).
