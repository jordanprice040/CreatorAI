# Local product execution (T11)

October 20 audit repair (ADR-0040): the runtime QA mount contains only argv/stdin. Expected stdout, exit status and case labels stay outside the sandbox; the bridge rejects legacy/full QA records. This changes its hash and invalidates old execution-profile evidence. See [audit repairs](AUDIT_FIXES_2026-10-20.md).

The owner CLI now manages separate product repositories and executes the reviewed
`checklist/1` Python standard-library template. Run commands from the studio root.
This does not add an AI builder, independent QA, a preview server, or study-arm
implementation execution. Those remain T12–T13 work. A successful recipe means
Python compilation and the entry point exited successfully; it is not a product
acceptance verdict.

## Reviewed environment

Verified October 18, 2026 on Windows, Node 22.21.0, Git for Windows and the existing
Ubuntu WSL2 distribution: kernel 6.18.33.2, Bubblewrap 0.11.1, systemd 259 and
Python 3.14.4. The bridge records the full versions, OS release, executable hashes,
network namespace, effective cgroup properties, recipe hash and policy. No Docker
daemon, paid service, package installation, or personal browser is needed.

The installed distribution must provide `/usr/bin/bwrap`, `/usr/bin/python3`,
`/usr/bin/systemd-run`, `/usr/bin/systemctl`, user namespaces and a working user
systemd manager with cgroup v2 controls. Its non-root user must have UID 1000.
`CREATOR_WORKER_DISTRO` chooses the reviewed local distribution (default `Ubuntu`),
not a remote worker. Other hosts or missing controls produce a blocked record.
There is no host execution or fixture fallback.

The trusted Node supervisor and Python bridge perform management only. Generated
Python runs exclusively within Bubblewrap under a systemd user unit in the WSL2
VM. The worker has a fresh mount, user, PID, IPC, network, UTS and cgroup namespace;
UID/GID 1000, no capabilities, no new privileges, no further user namespaces and
a new session. Only read-only `/usr`, an exact committed input snapshot and the
reviewed recipe are bound in. Root, `/proc` and `/dev` are remounted read-only.
No home, Windows mount, studio directory, Git metadata, session file, D-Bus socket,
cloud credential or host container socket is mounted. The environment is cleared.
The bridge's management D-Bus connection stays outside the sandbox.

Limits are fixed by trusted recipes: 256 MiB memory, no swap, 32 processes/threads,
half of one CPU, 20 seconds runtime, 16 MiB writable work tmpfs, 1 MiB temporary
tmpfs, 8 MiB per file, 64 open files, and 64 KiB captured output. Inputs are at most
100 plain UTF-8 files / 512 KiB. No outbound network, package installation or build
scripts supplied as commands are accepted. Source can spawn children, but those
remain in the same restricted namespaces and cgroup. The supervisor admits one
worker at a time per studio products root.

This is a reviewed local-template boundary in the existing WSL2 VM, not a newly
provisioned dedicated appliance. It shares that VM's kernel and read-only runtime;
it has no seccomp syscall allowlist. Privileged host users and simultaneous manual
tampering with supervisor files are outside the boundary. T17 must audit broader
hostile workloads before expanding this recipe or enabling a persistent service.

## Owner workflow

Start the normal authenticated API with PostgreSQL and sign in with `pnpm cli
login`. Freeze a specification through T08's selection/authorization path first.
The CLI rechecks owner membership, active spec version, content hash, freeze and
task hashes before creating, editing, building or integrating. A changed spec
requires a new bound product. It cannot silently widen an existing file scope.

```text
pnpm cli product-init <workspace> <frozen-spec-id>
pnpm cli product-task <product-id> <Tn> <expected-integration-commit>
pnpm cli product-patch <product-id> <task-id> <changes.json>
pnpm cli product-build <product-id> <task-id> <expected-task-commit>
pnpm cli product-integrate <product-id> <task-id> <expected-integration-commit> <expected-task-commit>
pnpm cli product-status <product-id>
pnpm cli product-cancel <product-id> <execution-id>
pnpm cli product-reconcile <product-id> <execution-id>
```

`changes.json` is a typed, bounded file-change request, not a shell command or Git
patch script. Every change has `path`, `before_hash` (SHA-256, or null for a new
file), and `content` (text, or null for deletion), plus the enclosing
`expected_commit`. Paths use a small lowercase portable dialect and must lie in
the frozen task's `file_scope`. Traversal, hidden/config paths, backslashes, drive
paths, alternate streams, reserved Windows names, symlinks/junctions and hardlinks
are refused. All paths and preimages are checked before any write.

The CLI and the API both use `CREATOR_PRODUCTS_ROOT` when it is set (default
`.creator/products`). The dev studio launcher sets it to `.creator/studio/products`,
so run CLI product commands from the same shell, or set it the same way.

Products live in ignored `.creator/products/<product-id>/`: `repo/` is a distinct
Git repository, `worktrees/<task-id>/` is a task branch at the exact base commit,
and immutable product/task manifests bind the frozen spec. Git uses typed argument
arrays, disabled global/system configuration and hooks, no prompt, and no network
protocols. Product code never runs in this management Git process.

Dirty worktrees and stale heads are refused. Integration belongs to the recorded
owner and is serialized by an exclusive product lock. A merge first runs in a
separate `integration-review/...` worktree. Real conflicts and markers stay there;
the integration checkout and task checkout remain intact. A clean result fast
forwards integration only if its head is still the expected one. No reset, clean,
discard, or automatic conflict resolution is used. Review/resolve a conflict in
the reported workspace; automatic model conflict resolution is not implemented.

## Interactive terminal sessions (ADR-0058)

Try's "Run in a terminal…" opens a console window on the studio's own Windows
computer and runs one verified package there, inside this same sandbox: no
network, read-only package copy, private work area, no studio files, 256 MiB, 32
tasks, half a CPU, 15 minutes at most. The program's terminal is the window
itself (`systemd-run --user --pty`), so key presses do not pass through the
studio. Only the confirmed argument list crosses (`launch.json`); the reviewed
recipe is `worker/terminal.py`. Nothing the program prints is captured. Records
live in `<product>/terminals/<session-id>/` (`intent.json`, `outcome.json`);
these are the owner's own tries, never QA or isolation evidence.

The session ends on Stop, at 15 minutes, when the window closes, or within 5
seconds of the studio stopping (its lease heartbeat). After the program ends the
window waits for Enter so the last screen can be read. A window closed before the
worker reported is reaped through the bridge; an unconfirmed stop is recorded as
`cleanup_required` and its package copy is kept. Start Creator Agent yourself
(Start menu or shortcut): a studio started inside another app's container (for
example Claude desktop) has redirected folders, and the start is refused.
The program owns the window: it can clear the banner, set the title and print
anything, as any terminal program can. Bubblewrap's `--new-session` (kept as the
terminal-injection guard) leaves it without a controlling terminal, so Ctrl+C may
end it at once instead of reaching the program; quit with the program's own keys.

## Provenance and recovery

`events/` contains immutable intent/outcome records with IDs, timestamps and hashes;
Git retains commits and changed files. `executions/<id>/` records exact commit,
input/recipe/policy/bridge hashes, environment, bounded logs, exit and cleanup
status. These local owner-controlled files are distinct from the PostgreSQL audit
chain; they are not yet indexed by the web catalog. T12 can consume these typed
interfaces and must rebind independent review/QA to its exact candidate. Build
evidence for a task commit does not certify a later integration merge commit.

A 750 ms heartbeat renews a five-second worker lease. Cancellation writes a durable
request; the bridge stops the whole cgroup, including detached children that
ignore termination. The hard systemd runtime cap survives supervisor failure.
Temporary execution work is removed only after the unit is observed inactive or
failed. No generated artifacts are copied back as executables; only bounded logs
return at T11. Local CPU is bounded but not monetarily metered by the studio;
unknown electricity/host costs are not reported as a zero-dollar provider charge.

If the supervisor dies, status exposes its unresolved intent. The exclusive lock
is never stolen based only on age. After the recorded process is absent and the
lease expires, `product-reconcile` stops and checks the derived worker unit, records
`lost`, cleans its staging directory and releases its dispatch fence. It never
redispatches the task. PID reuse or unavailable cleanup leaves recovery blocked.
An uncertain bridge outcome also fences new work until reconciliation. For a
management Git crash, inspect the immutable intent, Git heads, worktree status
and any conflict workspace before manually removing a dead lock; no automatic
destructive repair is supplied. The owner's Recover action (Build page, ADR-0046)
releases a product's build and management locks only when their recorded process is
gone and not this one, the management lock only once the integration repo is clean; it
keeps the released lock file and records an event. Do not delete user edits to make a gate pass.

## Executed checks

`CREATOR_TEST_ISOLATION=wsl2 pnpm test:db` with the disposable test database runs the
real WSL isolation gate. Ordinary CI explicitly skips that gate if not configured;
its Git/scope checks still run. `scripts/verify-executor.mjs` exercises the compiled
CLI against a synthetic authenticated API and executes the real constrained build.
Results and source binding are in `tracking/evidence/t11/`. No live model calls,
empirical participant results, public release or remote integration are implied.

References checked October 18, 2026: [Bubblewrap security and namespace policy](https://github.com/containers/bubblewrap/blob/main/README.md),
[systemd resource controls](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html),
and [Git worktree documentation](https://git-scm.com/docs/git-worktree).
