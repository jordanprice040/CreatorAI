# Development artifact retention

`scripts/dev-artifact-retention.mjs` bounds disk use from synthetic test runs
under `.verification/` without risking evidence, recovery material or
operational data. It is a development tool only; it is not part of the studio
runtime and changes no product milestone.

## Scope

Cleanup is **opt-in per run**. It considers only direct children of the
verification root that carry a valid `.creator-dev-run.json` marker naming that
exact directory. Everything else is kept, including:

- every existing `theme-helper-v2-*`, `theme-helper-v3-*`, `theme-helper-v4-*`,
  `theme-v*-guards-*` and `theme-v*-review-probe-*` directory. Those runners and
  tests are frozen reviewed files and do not write markers, so these directories
  stay until someone removes them deliberately by hand;
- loose files, links and junctions, and directories whose marker is missing,
  unparseable, of another schema, or copied from a different run;
- interrupted deletions (`.creator-dev-deleting-*`), kept for manual inspection.

There is no automatic or scheduled deletion. Nothing is removed without
`--apply`.

## Marking a new run

New test code that creates synthetic directories should create them through the
library so the run is identifiable and has a lifecycle state:

```js
import { createOwnedRun, ROOT } from '../scripts/dev-artifact-retention.mjs';
import { join } from 'node:path';

const run = await createOwnedRun({
  root: join(ROOT, '.verification'),
  prefix: 'my-fixture', // lowercase letters, digits and '-'
  owner: 'tests/my-fixture.test.mjs',
});
// run.dir is <root>/my-fixture-<epochMs>-<random>; the marker is written first.
await run.heartbeat(); // optional, during long runs
await run.protect('recovery material'); // pins the run permanently
await run.finish(passed ? 'passed' : 'failed');
```

Do not retrofit markers into frozen reviewed runners; that would change their
hash bindings. A new version of a helper can adopt `createOwnedRun` as part of
its own reviewed source.

## Retention policy

| Run state                                                      | Kept                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| `active`, owner process alive or heartbeat under 24h           | always                                                       |
| `active`, local owner process gone and heartbeat stale         | treated as failed diagnostics, aged from last heartbeat      |
| `passed`                                                       | 24h after `finishedAt`, and the latest passed run per prefix |
| `failed`                                                       | 14 days after `finishedAt`, and the latest two per prefix    |
| `protected` (via `protect(reason)`)                            | always                                                       |
| run name appears in any text file under `tracking/` or `docs/` | always (referenced evidence)                                 |

An `active` run from another host is always treated as alive.

## Usage

```powershell
node scripts/dev-artifact-retention.mjs            # dry run of .verification
node scripts/dev-artifact-retention.mjs --apply    # delete expired marked runs
node scripts/dev-artifact-retention.mjs --root <absolute dir> [--apply]
```

Output is JSON with one decision and reason per entry plus counts.

## Safety

- The root must be an existing real directory (not a link or junction, and its
  real path must match). It may not be, or contain, a drive root, the checkout,
  the home folder or the temp folder, and may not sit inside `APPDATA`,
  `LOCALAPPDATA`, `PROGRAMDATA` or Program Files (temp subfolders excepted for
  tests). Operational studio data and credentials are therefore out of reach.
- Only direct children are candidates; names are re-checked to stay inside
  the root.
- A run containing any symlink or junction anywhere in its tree is kept, so
  deletion never traverses a reparse point. Reparse points that Node does not
  report as links (for example cloud placeholders) are not detected; do not
  point the tool at synced folders.
- `--apply` holds an exclusive `.creator-dev-cleanup.lock` in the root, plans
  afresh, re-reads each marker just before removal, renames the run to a
  tombstone (Windows refuses while files are open), re-validates and then
  deletes. Any change or doubt keeps the directory.

## Checks

`node --test tests/dev-artifact-retention.test.mjs` covers unmarked, foreign,
linked and copied-marker entries; live and abandoned active runs; passed and
failed retention windows; protected, evidence-referenced and link-containing
runs; the cleanup lock; unsafe roots; and dry run versus `--apply`. All tests
use disposable roots in the temp folder.
