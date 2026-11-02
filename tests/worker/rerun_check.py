"""ADR-0059 rerun prompt check (review L-3): drives bridge.interactive() through a real
pseudo-terminal with stand-ins for systemd-run and systemctl. Nothing runs in a sandbox and no
generated code runs: each "run" is a one-line stand-in program. Linux only.

Usage: python3 -I tests/worker/rerun_check.py      (exits non-zero on the first failure)
"""
import json
import os
import pathlib
import pty
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import types

sys.dont_write_bytecode = True  # keep the reviewed worker folder free of caches

BRIDGE = pathlib.Path(__file__).resolve().parents[2] / 'packages' / 'executor' / 'worker'


def child(job, idle):
    """The window side: bridge.interactive() with its unit tooling replaced."""
    sys.path.insert(0, str(BRIDGE))
    import bridge
    job = pathlib.Path(job)
    lease = job / 'lease.json'

    # The studio's lease heartbeat, from another process: the bridge itself stays single-
    # threaded, as in the window, so SIGALRM reaches the thread waiting in readline.
    lease.write_text(json.dumps({'execution_id': 'x', 'heartbeat_ms': time.time() * 1000}))
    subprocess.Popen([sys.executable, '-I', '-c', '''
import json, os, pathlib, sys, time
job = pathlib.Path(sys.argv[1])
while job.exists() and os.getppid() != 1:
    tmp = job / 'lease.tmp'
    tmp.write_text(json.dumps({'execution_id': 'x', 'heartbeat_ms': time.time() * 1000,
                               'cancelled': (job / 'cancel').exists()}))
    os.replace(tmp, job / 'lease.json')
    time.sleep(0.2)
''', str(job)], stdin=subprocess.DEVNULL)
    real_popen = subprocess.Popen

    def fake_popen(cmd, *a, **k):
        assert cmd[0] == '/usr/bin/systemd-run' and '--pty' in cmd, cmd
        limit = [c for c in cmd if c.startswith('RuntimeMaxSec=')][0]
        assert 1 <= int(limit.split('=')[1]) <= 900, limit
        args = json.loads((job / 'launch.json').read_text())['args']
        code = 3 if args == ['--fail'] else 0
        return real_popen([sys.executable, '-c',
                           'import sys; print("PROGRAM RAN", sys.argv[1:]); sys.exit(%d)' % code, *args])
    bridge.subprocess.Popen = fake_popen
    bridge.command = lambda c: 'inactive' if 'ActiveState' in c else ''
    bridge.subprocess.run = lambda c, **k: None
    bridge.TERMINAL_POLICY['idle_seconds'] = idle
    bridge.interactive(types.SimpleNamespace(execution_id='x'), job, lease, job, job / 'r.py',
                       'creator-term-x', {})


def session(name, steps, idle=600.0):
    """Runs one window; each step waits for text, then sends keys or an action."""
    job = pathlib.Path(tempfile.mkdtemp(prefix='rerun-'))
    (job / 'launch.json').write_text(json.dumps({'args': ['--practice']}))
    pid, fd = pty.fork()
    if pid == 0:
        try:
            child(str(job), idle)
        finally:
            os._exit(0)
    out = b''
    seen = 0

    def read_until(token, wait=10):
        """Waits for `token` after the previous match, so each step waits for its own prompt."""
        nonlocal out, seen
        end = time.time() + wait
        while token.encode() not in out[seen:] and time.time() < end:
            if select.select([fd], [], [], 0.1)[0]:
                try:
                    out += os.read(fd, 4096)
                except OSError:
                    break
        at = out.find(token.encode(), seen)
        if at < 0:
            return False
        seen = at + len(token)
        return True
    for expect, action in steps:
        if not read_until(expect):
            fail(name, f'never saw {expect!r}', out)
        if action == 'STOP':
            (job / 'cancel').write_text('1')
        elif action == 'HUP':
            os.kill(pid, signal.SIGHUP)
        elif action is not None:
            os.write(fd, action.encode())
    end = time.time() + 15
    while time.time() < end:
        if (job / 'result.json').exists():
            break
        time.sleep(0.05)
    read_until('\x00never', 2.5)
    shown = out.decode(errors='replace').replace('\r', '')
    if 'Press Enter to close' in shown:
        os.write(fd, b'\r')
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
    result = json.loads((job / 'result.json').read_text()) if (job / 'result.json').exists() else None
    shutil.rmtree(job, ignore_errors=True)
    if result is None:
        fail(name, 'no result.json', out)
    return result, shown


def fail(name, why, out=b''):
    print(f'FAIL {name}: {why}\n---\n{out.decode(errors="replace")[-3000:]}', flush=True)
    sys.exit(1)


def check(name, cond, why, shown=''):
    if not cond:
        fail(name, why, shown.encode())


def main():
    sys.path.insert(0, str(BRIDGE))
    import bridge
    # Typed lines become argument lists without a shell.
    c = bridge.rerun_choice
    check('choice', c('', ['--a']) == ('run', ['--a']), 'Enter repeats')
    check('choice', c('q', ['--a']) == ('quit', None), 'q quits')
    check('choice', c("'q'", []) == ('run', ['q']), 'quoted q is an argument')
    check('choice', c('.', ['--a']) == ('run', []), '. runs with none')
    check('choice', c('python3 src/main.py --x "a b"', []) == ('run', ['--x', 'a b']), 'prefix dropped')
    check('choice', c('$(reboot) ; rm -rf /', []) == ('run', ['$(reboot)', ';', 'rm', '-rf', '/']),
          'no shell meaning')
    check('choice', c('"open', [])[0] == 'error', 'bad quotes refused')
    check('choice', c(' '.join(['a'] * 13), [])[0] == 'error', 'at most 12 arguments')
    # Emoji count as two UTF-16 units, like the studio's contract (review L-1).
    check('choice', c('\U0001F600' * 250, [])[0] == 'run', '250 emoji fit')
    check('choice', c('\U0001F600' * 251, [])[0] == 'error', '251 emoji do not')

    r, shown = session('rerun', [
        ('> ', '\r'), ('> ', '--fps 30\r'), ('> ', '"open\r'), ('Check the quotes', None),
        # Up twice: past the refused line to --fps 30.
        ('> ', '\x1b[A\x1b[A\r'), ('PROGRAM RAN', None), ('> ', '.\r'), ('> ', '--fail\r'), ('exit code 3', 'q\r')])
    check('rerun', [x['args'] for x in r['runs']] ==
          [['--practice'], ['--practice'], ['--fps', '30'], ['--fps', '30'], [], ['--fail']],
          f"runs {r['runs']}", shown)
    check('rerun', r['reason'] is None and r['exit_code'] == 3 and r['run_count'] == 6, str(r), shown)
    check('rerun', 'Press Enter to close' not in shown, 'q closes at once', shown)

    r, shown = session('stop', [('> ', 'STOP')])
    check('stop', r['reason'] == 'stopped', str(r), shown)
    check('stop', 'stopped from Creator Agent' in shown and 'Press Enter to close' not in shown,
          'Stop closes the window at once', shown)

    r, shown = session('ctrl-c', [('> ', '\x03')])
    check('ctrl-c', r['reason'] is None and r['run_count'] == 1, str(r), shown)

    r, shown = session('hangup', [('> ', 'HUP')])
    check('hangup', r['reason'] == 'window_closed', str(r), shown)

    r, shown = session('idle', [('> ', None)], idle=1.0)
    check('idle', r['reason'] is None and 'Press Enter to close' in shown, str(r), shown)
    print('rerun check: all passed', flush=True)


if __name__ == '__main__':
    main()
