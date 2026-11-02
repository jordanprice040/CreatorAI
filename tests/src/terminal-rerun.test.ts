import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// ADR-0059 review L-3: the bridge's rerun prompt, driven on a real pseudo-terminal with
// stand-ins for systemd-run/systemctl (tests/worker/rerun_check.py). Linux with python3 only;
// nothing runs in a sandbox and no generated code runs.
test(
  'the rerun prompt repeats, takes new arguments, quits, stops, idles and records a closed window',
  {
    skip:
      process.platform !== 'linux' ? 'needs a Linux pseudo-terminal' : false,
  },
  async () => {
    const run = promisify(execFile);
    let out = '';
    try {
      ({ stdout: out } = await run(
        'python3',
        ['-I', 'tests/worker/rerun_check.py'],
        { timeout: 120000 },
      ));
    } catch (e) {
      const err = e as { code?: string; stdout?: string };
      if (err.code === 'ENOENT') return;
      assert.fail(err.stdout ?? String(e));
    }
    assert.match(out, /rerun check: all passed/);
  },
);
