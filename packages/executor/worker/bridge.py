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
import subprocess
import sys
import time

POLICY = {
    'format': 'isolation/1', 'backend': 'wsl2-bwrap-systemd', 'network': 'none',
    'memory_bytes': 268435456, 'swap_bytes': 0, 'tasks': 32, 'cpu_percent': 50,
    'runtime_seconds': 20, 'lease_seconds': 5, 'disk_bytes': 16777216,
    'log_bytes': 65536, 'file_bytes': 8388608, 'uid': 1000,
}


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('job')
    parser.add_argument('execution_id')
    parser.add_argument('--reap', action='store_true')
    parser.add_argument('--recipe-hash', required=True)
    args = parser.parse_args()
    import uuid
    if str(uuid.UUID(args.execution_id)) != args.execution_id:
        raise RuntimeError('Invalid execution id')
    job = pathlib.Path(args.job).resolve(strict=True)
    lease = job / 'lease.json'
    source = job / 'input'
    recipe = pathlib.Path(__file__).with_name('recipe.py').resolve(strict=True)
    identity = environment()
    identity['recipe_hash'] = hashlib.sha256(recipe.read_bytes()).hexdigest()
    if identity['recipe_hash'] != args.recipe_hash:
        raise RuntimeError('Reviewed recipe hash changed before dispatch')
    unit = 'creator-exec-' + args.execution_id
    identity['unit'] = unit
    emit({'type': 'environment', 'value': identity})
    if args.reap:
        subprocess.run(['/usr/bin/systemctl', '--user', 'stop', unit], stdin=subprocess.DEVNULL,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        state = command(['/usr/bin/systemctl', '--user', 'show', unit, '-p', 'ActiveState', '--value'])
        emit({'type': 'result', 'value': {'exit_code': -1, 'reason': 'lease_lost', 'log': '',
              'cleaned': state in ('inactive', 'failed'), 'unit_state': state}})
        return
    sandbox = ['/usr/bin/bwrap', '--unshare-all', '--unshare-user', '--uid', '1000', '--gid', '1000',
               '--disable-userns', '--new-session', '--die-with-parent', '--cap-drop', 'ALL',
               '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin',
               '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
               '--proc', '/proc', '--dev', '/dev',
               '--size', str(POLICY['disk_bytes']), '--tmpfs', '/work',
               '--size', '1048576', '--tmpfs', '/tmp',
               '--ro-bind', str(source), '/input', '--ro-bind', str(recipe), '/recipe.py',
               '--remount-ro', '/', '--remount-ro', '/dev', '--remount-ro', '/proc',
               '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/nonexistent',
               '--chdir', '/work', '/usr/bin/python3', '-I', '/recipe.py']
    acceptance = job / 'acceptance.json'
    if acceptance.is_file():
        # Refuse legacy/full QA records before exposing any bytes to generated code.
        runtime_input = json.loads(acceptance.read_text())
        if not isinstance(runtime_input, dict) or set(runtime_input) != {'args', 'stdin'}:
            raise RuntimeError('Only runtime argv and stdin may enter the sandbox')
        sandbox[1:1] = ['--ro-bind', str(acceptance), '/acceptance.json']
    launch = ['/usr/bin/systemd-run', '--user', '--quiet', '--pipe', '--wait', '--collect', '--unit=' + unit,
              '-p', 'MemoryMax=268435456', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=32',
              '-p', 'CPUQuota=50%', '-p', 'RuntimeMaxSec=20', '-p', 'KillMode=control-group',
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
                    if 'MemoryMax=268435456' in properties:
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
            if time.monotonic() - started > 23:
                reason = reason or 'deadline'
            if reason:
                break
            for key, _ in selector.select(0.1):
                chunk = os.read(key.fileobj.fileno(), 4096)
                if chunk:
                    if len(log) + len(chunk) > POLICY['log_bytes']:
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


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        emit({'type': 'blocked', 'value': str(error)})
        sys.exit(2)
