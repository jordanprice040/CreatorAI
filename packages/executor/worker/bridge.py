"""Trusted WSL management bridge. No product imports, eval, shell or command input.

The input/job directories are created by the TypeScript supervisor. Only /usr,
the immutable input snapshot and the reviewed recipe cross into the sandbox.
"""
import argparse
import hashlib
import json
import os
import pathlib
import selectors
import shlex
import signal
import subprocess
import sys
import time

POLICY = {
    'format': 'isolation/1', 'backend': 'wsl2-bwrap-systemd', 'network': 'none',
    'memory_bytes': 268435456, 'swap_bytes': 0, 'tasks': 32, 'cpu_percent': 50,
    'runtime_seconds': 20, 'lease_seconds': 5, 'disk_bytes': 16777216,
    'log_bytes': 65536, 'file_bytes': 8388608, 'uid': 1000,
}
# ADR-0058: an owner-started interactive session on the same sandbox. Only the runtime and
# the terminal differ: the program's terminal is the owner's console window, so nothing it
# prints is captured, and the session ends at 15 minutes, on Stop, or when the window closes.
# ADR-0059: the same window can run the program again (Enter, or new arguments) until the
# owner quits; each run gets a fresh unit and sandbox, and the window as a whole is bounded.
# ADR-0078: the static-web/1 recipe runs the pinned headless browser inside the same sandbox.
# It needs more memory, threads and time; the sandbox still has no network beyond its own
# loopback (bwrap gives the new namespace only `lo`), and the same uid, lease and log bounds.
BROWSER_VERSION = '156.0.8078.47'
BROWSER_PINNED_ON = '2026-11-06'  # ADR-0078 N-4: re-check against security releases at least monthly
BROWSER_TREE_SHA256 = '2f84beb636e7c730bea98f70bfff326514e82e45e14e254db7b50d8c5747d141'
WEB_POLICY = {**POLICY, 'recipe': 'static-web/1', 'network': 'loopback-only',
              'memory_bytes': 1073741824, 'tasks': 512, 'cpu_percent': 100,
              'runtime_seconds': 60, 'disk_bytes': 67108864, 'tmp_bytes': 268435456,
              'browser': 'chrome-headless-shell ' + BROWSER_VERSION}
TERMINAL_POLICY = {**POLICY, 'format': 'isolation-terminal/2', 'runtime_seconds': 900,
                   'session_seconds': 3600, 'idle_seconds': 600, 'max_runs': 50, 'max_args': 12,
                   'log_bytes': 0, 'terminal': 'pty'}


def command(args, **kwargs):
    return subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=10, check=True, **kwargs).stdout.decode().strip()


def emit(value):
    print(json.dumps(value), flush=True)


def environment():
    if os.getuid() != 1000:
        raise RuntimeError('Reviewed worker requires non-root WSL uid 1000')
    if 'microsoft' not in os.uname().release.lower():
        raise RuntimeError('Reviewed backend requires WSL2 VM')
    for binary in ('/usr/bin/bwrap', '/usr/bin/systemd-run', '/usr/bin/systemctl', '/usr/bin/python3'):
        if not pathlib.Path(binary).is_file():
            raise RuntimeError('Missing isolation capability: ' + binary)
    return {'kernel': os.uname().release,
            'bwrap': command(['/usr/bin/bwrap', '--version']),
            'systemd': command(['/usr/bin/systemd-run', '--version']).splitlines()[0],
            'python': sys.version.split()[0], 'policy': POLICY,
            'os_release': pathlib.Path('/etc/os-release').read_text(),
            'binary_hashes': {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
                              for p in ('/usr/bin/bwrap', '/usr/bin/python3', '/usr/bin/systemd-run')},
            'host_network_namespace': os.readlink('/proc/self/ns/net')}


def browser_dir():
    """The owner-installed pinned browser (install_browser.py), verified before every web run."""
    return verify_browser(pathlib.Path.home() / '.local/share/creator-agent/browser' /
                          ('chrome-headless-shell-' + BROWSER_VERSION))


def verify_browser(root):
    """Owned by this user, not writable by others, no symlinks, and the pinned tree hash.
    Also used by scripts/p15-web-benchmark.mjs, so benchmark scores use the same check."""
    root = pathlib.Path(root)
    hint = ' Run install_browser.py in WSL (see docs/STATIC_WEB_RECIPE.md).'
    if not (root / 'chrome-headless-shell').is_file():
        raise RuntimeError('Missing isolation capability: reviewed headless browser ' + BROWSER_VERSION + '.' + hint)
    for p in [root, *root.rglob('*')]:
        st = p.lstat()
        if st.st_uid != os.getuid() or st.st_mode & 0o022 or p.is_symlink():
            raise RuntimeError('Reviewed browser files must be owned by this user and not writable by others.' + hint)
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob('*') if x.is_file()):
        h.update(p.relative_to(root).as_posix().encode() + b'\0' +
                 hashlib.sha256(p.read_bytes()).hexdigest().encode() + b'\n')
    if h.hexdigest() != BROWSER_TREE_SHA256:
        raise RuntimeError('Reviewed headless browser files changed.' + hint)
    return root


def sandbox_args(policy, source, recipe, browser=None, acceptance=None):
    """The Bubblewrap command for one QA run. scripts/p15-web-benchmark.mjs runs this exact list
    (without the systemd unit), so benchmark scores and studio QA share one sandbox."""
    sandbox = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--uid', '1000', '--gid', '1000',
               '--disable-userns', '--new-session', '--die-with-parent', '--cap-drop', 'ALL',
               '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
               '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
               '--proc', '/proc', '--dev', '/dev',
               '--size', str(policy['disk_bytes']), '--tmpfs', '/work',
               '--size', str(policy.get('tmp_bytes', 1048576)), '--tmpfs', '/tmp',
               '--ro-bind', str(source), '/input', '--ro-bind', str(recipe), '/recipe.py',
               *(['--ro-bind', str(browser), '/opt/browser'] if browser else []),
               '--remount-ro', '/', '--remount-ro', '/dev', '--remount-ro', '/proc',
               '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/nonexistent',
               '--chdir', '/work', '/usr/bin/python3', '-I', '/recipe.py']
    if acceptance:
        sandbox[1:1] = ['--ro-bind', str(acceptance), '/acceptance.json']
    return sandbox


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('job')
    parser.add_argument('execution_id')
    parser.add_argument('--reap', action='store_true')
    parser.add_argument('--recipe-hash', required=True)
    parser.add_argument('--interactive', action='store_true')
    parser.add_argument('--recipe', choices=('python-build/1', 'static-web/1'), default='python-build/1')
    args = parser.parse_args()
    web = args.recipe == 'static-web/1'
    if web and args.interactive:
        raise RuntimeError('Interactive sessions run Python packages only')
    policy = WEB_POLICY if web else POLICY
    import uuid
    if str(uuid.UUID(args.execution_id)) != args.execution_id:
        raise RuntimeError('Invalid execution id')
    job = pathlib.Path(args.job).resolve(strict=True)
    lease = job / 'lease.json'
    source = job / 'input'
    recipe = pathlib.Path(__file__).with_name(
        'terminal.py' if args.interactive else 'web_recipe.py' if web else 'recipe.py').resolve(strict=True)
    identity = environment()
    identity['policy'] = policy
    identity['recipe_hash'] = hashlib.sha256(recipe.read_bytes()).hexdigest()
    if identity['recipe_hash'] != args.recipe_hash:
        raise RuntimeError('Reviewed recipe hash changed before dispatch')
    unit = ('creator-term-' if args.interactive else 'creator-exec-') + args.execution_id
    identity['unit'] = unit
    if args.interactive and not args.reap:
        identity['policy'] = TERMINAL_POLICY
        return interactive(args, job, lease, source, recipe, unit, identity)
    browser = None
    if web and not args.reap:
        browser = browser_dir()
        identity['browser'] = {'version': BROWSER_VERSION, 'tree_sha256': BROWSER_TREE_SHA256}
    emit({'type': 'environment', 'value': identity})
    if args.reap:
        subprocess.run(['/usr/bin/systemctl', '--user', 'stop', unit], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        state = command(['/usr/bin/systemctl', '--user', 'show', unit, '-p', 'ActiveState', '--value'])
        emit({'type': 'result', 'value': {'exit_code': -1, 'reason': 'lease_lost', 'log': '',
              'cleaned': state in ('inactive', 'failed'), 'unit_state': state}})
        return
    acceptance = job / 'acceptance.json'
    if web and not acceptance.is_file():
        raise RuntimeError('A static web run needs a frozen browser case')
    if acceptance.is_file():
        # Refuse legacy/full QA records before exposing any bytes to generated code.
        runtime_input = json.loads(acceptance.read_text())
        allowed = {'page', 'steps'} if web else {'args', 'stdin'}
        if not isinstance(runtime_input, dict) or set(runtime_input) != allowed:
            raise RuntimeError('Only runtime argv and stdin (or a browser case\'s page and steps) may enter the sandbox')
    sandbox = sandbox_args(policy, source, recipe, browser, acceptance if acceptance.is_file() else None)
    launch = ['/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + unit,
              '-p', 'MemoryMax=' + str(policy['memory_bytes']), '-p', 'MemorySwapMax=0',
              '-p', 'TasksMax=' + str(policy['tasks']), '-p', 'CPUQuota=' + str(policy['cpu_percent']) + '%',
              '-p', 'RuntimeMaxSec=' + str(policy['runtime_seconds']), '-p', 'KillMode=control-group',
              '-p', 'TimeoutStopSec=1', '-p', 'SendSIGKILL=yes', '-p', 'UMask=0077', *sandbox]
    child = subprocess.Popen(launch, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ)
    log = bytearray()
    reason = None
    started = time.monotonic()
    observed_limits = False
    try:
        while True:
            if not observed_limits and child.poll() is None:
                # This is management-observed identity, not a claim made by generated output.
                try:
                    properties = command(['/usr/bin/systemctl', '--user', 'show', unit,
                                          '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'TasksMax',
                                          '-p', 'CPUQuotaPerSecUSec', '-p', 'RuntimeMaxUSec', '-p', 'KillMode'])
                    if 'MemoryMax=' + str(policy['memory_bytes']) in properties:
                        emit({'type': 'limits', 'value': properties})
                        observed_limits = True
                except subprocess.SubprocessError:
                    pass
            try:
                value = json.loads(lease.read_text())
                if value.get('cancelled'):
                    reason = 'cancelled'
                elif value.get('execution_id') != args.execution_id or time.time() * 1000 - value.get('heartbeat_ms', 0) > 5000:
                    reason = 'lease_lost'
            except (OSError, ValueError):
                reason = 'lease_lost'
            if time.monotonic() - started > policy['runtime_seconds'] + 3:
                reason = reason or 'deadline'
            if reason:
                break
            for key, _ in selector.select(0.1):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if chunk:
                    if len(log) + len(chunk) > policy['log_bytes']:
                        reason = 'log_limit'
                        break
                    log.extend(chunk)
                else:
                    selector.unregister(key.fileobj)
            if reason or (child.poll() is not None and not selector.get_map()):
                break
    finally:
        # Always stop the entire unit, even after a successful parent exit.
        subprocess.run(['/usr/bin/systemctl', '--user', 'stop', unit], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
        selector.close()
    state = command(['/usr/bin/systemctl', '--user', 'show', unit, '-p', 'ActiveState', '--value'])
    cleaned = state in ('inactive', 'failed')
    # A service that completed too quickly to observe is still bounded by the
    # fixed launch properties; effective properties are reported when observed.
    emit({'type': 'result', 'value': {'exit_code': child.returncode, 'reason': reason,
          'log': log.decode('utf-8', errors='replace'), 'cleaned': cleaned,
          'unit_state': state, 'limits_observed': observed_limits}})


def write_record(path, value):
    """Management record beside the job; generated code never sees the job directory."""
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(value))
    os.replace(tmp, path)


class _StopWaiting(Exception):
    """Raised from the SIGALRM watcher to end a prompt that is waiting for a line."""


def rerun_choice(line, last):
    """What a line typed at the rerun prompt asks for: ('run', args), ('quit', None) or
    ('error', message). The owner types it in their own window; nothing reaches a shell."""
    text = line.strip()
    if not text:
        return 'run', list(last)
    if text in ('q', 'quit', 'exit'):
        return 'quit', None
    if text == '.':
        return 'run', []
    try:
        words = shlex.split(text)
    except ValueError as error:
        return 'error', 'Could not read that line (' + str(error) + '). Check the quotes.'
    # A pasted full command line runs the same program.
    for prefix in (['python3', 'src/main.py'], ['python', 'src/main.py'], ['src/main.py']):
        if words[:len(prefix)] == prefix:
            words = words[len(prefix):]
            break
    if len(words) > TERMINAL_POLICY['max_args']:
        return 'error', f"At most {TERMINAL_POLICY['max_args']} arguments."
    # Counted in UTF-16 units like the studio's contract, so an emoji counts as two (review L-1).
    if any(len(w.encode('utf-16-le', 'surrogatepass')) // 2 > 500 or '\0' in w for w in words):
        return 'error', 'An argument is longer than 500 characters.'
    return 'run', words


def wait_for_line(text, check, idle_seconds):
    """input() with line editing and history (Up arrow) when readline is available. check()
    runs every quarter second and ends the wait with its reason (Stop, studio gone, window
    closed, deadline); so does idle_seconds without a line."""
    began = time.monotonic()

    def tick(_number, _frame):
        reason = check() or ('idle' if time.monotonic() - began > idle_seconds else None)
        if reason:
            raise _StopWaiting(reason)
    previous = signal.signal(signal.SIGALRM, tick)
    signal.setitimer(signal.ITIMER_REAL, 0.25, 0.25)
    try:
        return input(text), None
    except _StopWaiting as stop:
        return None, stop.args[0]
    except EOFError:
        return None, 'eof'
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def interactive(args, job, lease, source, recipe, unit, identity):
    """Runs the package attached to this console window, and again on request, until the owner
    quits. Records go to files, not stdout."""
    launch_file = job / 'launch.json'
    value = json.loads(launch_file.read_text())
    if not isinstance(value, dict) or set(value) != {'args'}:
        raise RuntimeError('Only the confirmed argument list may enter the sandbox')
    write_record(job / 'environment.json', identity)
    sandbox = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--uid', '1000', '--gid', '1000',
               '--disable-userns', '--new-session', '--die-with-parent', '--cap-drop', 'ALL',
               '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
               '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
               '--proc', '/proc', '--dev', '/dev',
               '--size', str(POLICY['disk_bytes']), '--tmpfs', '/work',
               '--size', '1048576', '--tmpfs', '/tmp',
               '--ro-bind', str(source), '/input', '--ro-bind', str(recipe), '/recipe.py',
               '--ro-bind', str(launch_file), '/launch.json',
               '--remount-ro', '/', '--remount-ro', '/dev', '--remount-ro', '/proc',
               '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/nonexistent',
               '--chdir', '/work', '/usr/bin/python3', '-I', '/recipe.py']
    signalled = []

    def on_signal(number, _frame):
        signalled.append(number)
    for number in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(number, on_signal)
    session_started = time.monotonic()

    def remaining():
        return TERMINAL_POLICY['session_seconds'] - (time.monotonic() - session_started)

    def check():
        """Why the session must end now, from outside the program; None to carry on."""
        if any(n != signal.SIGINT for n in signalled):
            return 'window_closed'
        try:
            current = json.loads(lease.read_text())
            if current.get('cancelled'):
                return 'stopped'
            if current.get('execution_id') != args.execution_id or \
                    time.time() * 1000 - current.get('heartbeat_ms', 0) > 5000:
                return 'lease_lost'
        except (OSError, ValueError):
            return 'lease_lost'
        # Ahead of the unit's RuntimeMaxSec backstop, so the limit is recorded as the deadline
        # rather than as an ordinary end.
        if remaining() < 5:
            return 'deadline'
        return None

    def run(run_args):
        """One run in a fresh unit and sandbox. Returns (exit code, reason, unit stopped)."""
        nonlocal observed_limits
        write_record(launch_file, {'args': run_args})
        # A collected unit is gone, but a failed one keeps its name until it is reset.
        try:
            subprocess.run(['/usr/bin/systemctl', '--user', 'reset-failed', unit], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        except subprocess.SubprocessError:
            pass
        # Never 0: RuntimeMaxSec=0 would mean no limit.
        limit = max(1, int(min(TERMINAL_POLICY['runtime_seconds'], remaining())))
        launch = ['/usr/bin/systemd-run', '--user', '--quiet', '--pty', '--wait', '--collect', '--unit=' + unit,
                  '-p', 'MemoryMax=268435456', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=32',
                  '-p', 'CPUQuota=50%', '-p', 'RuntimeMaxSec=' + str(limit), '-p', 'KillMode=control-group',
                  '-p', 'TimeoutStopSec=1', '-p', 'SendSIGKILL=yes', '-p', 'UMask=0077', *sandbox]
        print('Running: ' + ' '.join(shlex.quote(w) for w in ['python3', 'src/main.py', *run_args]) + '\n',
              flush=True)
        reason = None
        child = subprocess.Popen(launch)
        started = time.monotonic()
        try:
            while child.poll() is None:
                if not observed_limits:
                    try:
                        properties = command(['/usr/bin/systemctl', '--user', 'show', unit,
                                              '-p', 'MemoryMax', '-p', 'MemorySwapMax', '-p', 'TasksMax',
                                              '-p', 'CPUQuotaPerSecUSec', '-p', 'RuntimeMaxUSec', '-p', 'KillMode'])
                        if 'MemoryMax=268435456' in properties and 'RuntimeMaxUSec=' in properties:
                            identity['effective_limits'] = properties
                            write_record(job / 'environment.json', identity)
                            observed_limits = True
                    except subprocess.SubprocessError:
                        pass
                reason = check() or ('deadline' if time.monotonic() - started > limit - 5 else None)
                if reason:
                    break
                time.sleep(0.1)
        finally:
            subprocess.run(['/usr/bin/systemctl', '--user', 'stop', unit], stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        state = command(['/usr/bin/systemctl', '--user', 'show', unit, '-p', 'ActiveState', '--value'])
        return child.returncode, reason, state

    print('Creator Agent: isolated terminal. No network, no studio files. Each run may take up to '
          f"{TERMINAL_POLICY['runtime_seconds'] // 60} minutes; the window closes after "
          f"{TERMINAL_POLICY['session_seconds'] // 60} minutes in all, on Stop, or when you close it.\n",
          flush=True)
    try:
        import readline  # noqa: F401  Line editing and Up-arrow history at the rerun prompt.
    except ImportError:
        readline = None
    try:
        import termios
        saved_tty = termios.tcgetattr(sys.stdin.fileno())
    except Exception:
        termios = saved_tty = None
    observed_limits = False
    runs = []
    run_args = value['args']
    reason = None
    exit_code = None
    state = 'inactive'
    while True:
        started = time.monotonic()
        exit_code, reason, state = run(run_args)
        runs.append({'args': run_args, 'exit_code': exit_code,
                     'seconds': int(time.monotonic() - started)})
        if readline and len(runs) == 1 and run_args:
            # Lines typed at the prompt join the history by themselves; the confirmed first
            # arguments did not come through it.
            readline.add_history(shlex.join(run_args))
        if reason or state not in ('inactive', 'failed') or len(runs) >= TERMINAL_POLICY['max_runs']:
            break
        if termios and saved_tty:
            # The program may leave the window in raw mode; give the prompt a normal line.
            try:
                termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, saved_tty)
            except Exception:
                pass
        shown = ' '.join(shlex.quote(w) for w in ['python3', 'src/main.py', *run_args])
        print(f'\nThe program ended with exit code {exit_code}. Run it again in this window:\n'
              f'  Enter          same again: {shown}\n'
              '  new arguments  type them and press Enter (Up arrow recalls earlier ones; . for none)\n'
              "  q              close this window ('q' in quotes passes q as an argument)\n", flush=True)
        choice = None
        while True:
            signalled[:] = [n for n in signalled if n != signal.SIGINT]
            # Ctrl+C at the prompt closes the session like q.
            line, reason = wait_for_line(
                '> ', lambda: check() or ('quit' if signal.SIGINT in signalled else None),
                TERMINAL_POLICY['idle_seconds'])
            if reason in ('quit', 'eof'):
                if reason == 'eof':
                    # A closing window may deliver end of input just before its hangup signal.
                    time.sleep(0.5)
                reason, choice = 'quit', None
                break
            if reason:
                break
            kind, choice = rerun_choice(line, run_args)
            if kind == 'error':
                print(choice, flush=True)
                continue
            if kind == 'quit':
                reason, choice = 'quit', None
            break
        if reason == 'idle':
            print('\nNo input for ' + str(TERMINAL_POLICY['idle_seconds'] // 60) + ' minutes.', flush=True)
        if choice is None:
            break
        run_args = choice
    closed_by_owner = reason == 'quit'
    # An idle prompt or a quit ends the session normally.
    if reason in ('idle', 'quit'):
        reason = None
    # A hangup seen at any point means the window was closed (review L-2).
    if any(n != signal.SIGINT for n in signalled):
        reason = 'window_closed'
    write_record(job / 'result.json', {
        'exit_code': exit_code, 'reason': reason, 'cleaned': state in ('inactive', 'failed'),
        'unit_state': state, 'limits_observed': observed_limits, 'runs': runs[-50:],
        'run_count': len(runs)})
    if reason == 'window_closed':
        return
    if closed_by_owner or reason == 'stopped':
        # The owner asked for the end (q here, or Stop in the studio): close at once.
        print('\nSession ended' + (' (stopped from Creator Agent)' if reason else '') + '.', flush=True)
        if reason:
            time.sleep(1.5)
        return
    if len(runs) >= TERMINAL_POLICY['max_runs']:
        print(f"\nThis window has run the program {TERMINAL_POLICY['max_runs']} times, its limit.", flush=True)
    # Keep the program's last screen (for example a practice report) until the owner is done.
    print('\nSession ended' + (' (' + reason + ')' if reason else '') +
          '. Press Enter to close this window.', flush=True)
    try:
        ready = selectors.DefaultSelector()
        ready.register(sys.stdin, selectors.EVENT_READ)
        ready.select(600)
    except (OSError, ValueError):
        pass

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'type': 'blocked', 'value': str(error)})
        if '--interactive' in sys.argv and '--reap' not in sys.argv:
            # The console window is the only output: leave the reason for the studio and
            # keep the window open long enough to read it.
            try:
                write_record(pathlib.Path(sys.argv[1]).resolve(strict=True) / 'blocked.json',
                             {'reason': str(error)[:2000]})
            except Exception:
                pass
            print('Press Enter to close this window.', flush=True)
            try:
                ready = selectors.DefaultSelector()
                ready.register(sys.stdin, selectors.EVENT_READ)
                ready.select(120)
            except (OSError, ValueError):
                pass
        sys.exit(2)
