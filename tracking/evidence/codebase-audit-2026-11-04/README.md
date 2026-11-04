# Audit evidence — November 4, 2026

Candidate: `171430b639b4dbd4170292894444cf2c01f3f27b`.

See [the audit](../../../docs/CODEBASE_AUDIT_2026-11-04.md) and
[the verification receipt](receipt.json). Source and full-log SHA-256 hashes are in the
receipt; large logs remain in ignored `.verification/audit-2026-11-04/`.

`signout-race.mjs` is a reproduction of the reported defect, not a passing acceptance test.
It asserts the observed wrong result (`signed_in` after Disconnect and an older callback).
It uses the real connection store, an in-memory vault and a loopback fake identity provider.
No external provider, real login, personal studio database or model call is involved.

To reproduce from the repository root after building, point `CREATOR_TEST_DATABASE_URL`
at a disposable PostgreSQL server whose synthetic test role can create databases, then run:

```powershell
node tracking/evidence/codebase-audit-2026-11-04/signout-race.mjs
```

The helper creates/migrates one randomly named test database and drops it afterward.
The audit's own temporary PostgreSQL 18.6 server has been stopped and its two temporary
cluster directories removed; only reports, logs and reproduction evidence were retained.
Windows-native compilation passed; installation, real WSL execution and live behavior
were not accepted by this audit. The failed/omitted checks in the receipt remain explicit.
