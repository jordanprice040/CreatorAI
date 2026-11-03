"""Trusted WSL bridge for the ChatGPT-plan Codex builder (ADR-0042, Path B).

Starts `codex app-server` inside a bubblewrap jail that holds only the two pinned
static Codex binaries, an empty Codex home, /proc, a minimal /dev and the
disposable workspace. The jail has its own network namespace with loopback only.
A listening socket is created inside that namespace by a short-lived helper and
handed back to this bridge, which tunnels each connection over stdout/stdin to
the studio relay on the supervisor side. The real ChatGPT token never enters
WSL: the jail only sees a per-session relay capability.

Protocol: the first stdin line is the job; every later line is a frame
{"t": "codex"|"data"|"close"|"finish"|"kill", ...}. Stdout carries frames
{"t": "ready"|"codex"|"open"|"data"|"close"|"log"|"result"|"error", ...}.
No eval, shell or command input; the job names no executable.
"""
import base64
import json
import os
import pathlib
import selectors
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time

MAX_FILES = 200
MAX_FILE_BYTES = 256 * 1024
MAX_TOTAL_BYTES = 1024 * 1024
MAX_LOG_BYTES = 16 * 1024
MAX_TIMEOUT_S = 35_791 * 60 + 5  # PLAN_BUILD_TIMEOUT_MAX_MS / 1000 + 5 (ADR-0062)
HELPER = (
    'import socket,sys\n'
    's=socket.socket(socket.AF_INET,socket.SOCK_STREAM)\n'
    "s.bind(('127.0.0.1',int(sys.argv[2])))\n"
    's.listen(8)\n'
    "socket.send_fds(socket.socket(fileno=int(sys.argv[1])),[b'L'],[s.fileno()])\n"
)


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def safe_rel(path):
    p = pathlib.PurePosixPath(path)
    if p.is_absolute() or not p.parts or any(x in ('', '.', '..') for x in p.parts) or '\\' in path:
        raise RuntimeError('Invalid workspace path')
    return p


def check_job(job):
    if job.get('format') != 'codex-bridge-job/1':
        raise RuntimeError('Unknown job format')
    for key in ('codex', 'code_mode_host', 'bwrap'):
        if not pathlib.Path(job[key]).is_file() or not os.path.isabs(job[key]):
            raise RuntimeError('Missing pinned binary: ' + key)
    if not isinstance(job['port'], int) or not 1024 <= job['port'] <= 65535:
        raise RuntimeError('Invalid relay port')
    if not isinstance(job['capability'], str) or not 32 <= len(job['capability']) <= 128:
        raise RuntimeError('Invalid relay capability')
    for c in job['config']:
        if not isinstance(c, str) or '\n' in c or len(c) > 300:
            raise RuntimeError('Invalid config item')
    # ADR-0062: the owner's Codex build timeout has no maximum beyond the JavaScript timer
    # bound (35,791 minutes); the host sends ceil(timeout_ms / 1000) + 5 seconds.
    if not isinstance(job['timeout_s'], int) or not 10 <= job['timeout_s'] <= MAX_TIMEOUT_S:
        raise RuntimeError('Invalid timeout')


def write_workspace(root, files):
    if len(files) > MAX_FILES:
        raise RuntimeError('Too many workspace files')
    for f in files:
        rel = safe_rel(f['path'])
        target = root.joinpath(*rel.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f['content'], encoding='utf-8')


def read_workspace(root):
    files, problems, total = [], [], 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for name in sorted(dirnames):
            full = pathlib.Path(dirpath, name)
            if full.is_symlink():
                problems.append('symlink:' + str(full.relative_to(root)))
        for name in sorted(filenames):
            full = pathlib.Path(dirpath, name)
            rel = str(full.relative_to(root))
            st = full.lstat()
            if not (st.st_mode & 0o170000) == 0o100000:
                problems.append('not_regular:' + rel)
                continue
            if st.st_size > MAX_FILE_BYTES or total + st.st_size > MAX_TOTAL_BYTES or len(files) >= MAX_FILES:
                problems.append('too_large:' + rel)
                continue
            total += st.st_size
            try:
                files.append({'path': rel, 'content': full.read_bytes().decode('utf-8')})
            except UnicodeDecodeError:
                problems.append('not_utf8:' + rel)
    return files, problems


def jail_argv(job, ws, info_w):
    argv = [job['bwrap'], '--unshare-all', '--die-with-parent', '--new-session',
            '--ro-bind', job['codex'], '/opt/codex/bin/codex',
            '--ro-bind', job['code_mode_host'], '/opt/codex/bin/codex-code-mode-host',
            '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
            '--tmpfs', '/home/codex', '--dir', '/home/codex/.codex',
            '--bind', str(ws), '/work', '--chdir', '/work',
            '--setenv', 'HOME', '/home/codex', '--setenv', 'CODEX_HOME', '/home/codex/.codex',
            '--setenv', 'PATH', '/opt/codex/bin', '--setenv', 'RELAY_CAPABILITY', job['capability'],
            '--info-fd', str(info_w)]
    if os.getuid() == 0:
        argv += ['--cap-drop', 'ALL']
    argv += ['--', '/opt/codex/bin/codex', 'app-server', '--listen', 'stdio://', '--strict-config']
    for c in job['config']:
        argv += ['-c', c]
    return argv


def listener_in(pid, port):
    """Create the relay listener inside the jail's network namespace and return it."""
    parent, child = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
    args = ['/usr/bin/nsenter', '--target', str(pid), '--net']
    if os.readlink('/proc/%d/ns/user' % pid) != os.readlink('/proc/self/ns/user'):
        args += ['--user', '--preserve-credentials']
    args += [sys.executable, '-I', '-c', HELPER, str(child.fileno()), str(port)]
    subprocess.run(args, pass_fds=[child.fileno()], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.PIPE, timeout=10, check=True, env={})
    child.close()
    _, fds, _, _ = socket.recv_fds(parent, 4, 1)
    parent.close()
    if not fds:
        raise RuntimeError('Relay listener was not created inside the jail')
    return socket.socket(fileno=fds[0])


def main():
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    job = json.loads(sys.stdin.buffer.readline())
    check_job(job)
    work = pathlib.Path(tempfile.mkdtemp(prefix='creator-codex-'))
    ws = work / 'ws'
    ws.mkdir(mode=0o700)
    proc = None
    try:
        write_workspace(ws, job['files'])
        info_r, info_w = os.pipe()
        proc = subprocess.Popen(jail_argv(job, ws, info_w), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, pass_fds=[info_w], env={}, start_new_session=True)
        os.close(info_w)
        info = b''
        deadline = time.monotonic() + 10
        while b'child-pid' not in info or b'}' not in info:
            if time.monotonic() > deadline:
                raise RuntimeError('Jail did not report its process')
            chunk = os.read(info_r, 4096)
            if not chunk:
                break
            info += chunk
        os.close(info_r)
        pid = json.loads(info.decode())['child-pid']
        listener = listener_in(pid, job['port'])
        listener.setblocking(False)
        emit({'t': 'ready', 'environment': {
            'kernel': os.uname().release, 'uid': os.getuid(), 'python': sys.version.split()[0],
            'bwrap': subprocess.run([job['bwrap'], '--version'], capture_output=True, timeout=5).stdout.decode().strip(),
            'jail_network_namespace': os.readlink('/proc/%d/ns/net' % pid),
            'host_network_namespace': os.readlink('/proc/self/ns/net')}})
        serve(job, proc, listener, ws)
    except Exception as e:  # reported to the supervisor, which treats it as a blocked build
        emit({'t': 'error', 'message': str(e)[:500]})
    finally:
        if proc and proc.poll() is None:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=10)
        shutil.rmtree(work, ignore_errors=True)


def serve(job, proc, listener, ws):
    sel = selectors.DefaultSelector()
    os.set_blocking(0, False)
    sel.register(0, selectors.EVENT_READ, 'stdin')
    sel.register(proc.stdout, selectors.EVENT_READ, 'codex')
    sel.register(proc.stderr, selectors.EVENT_READ, 'stderr')
    sel.register(listener, selectors.EVENT_READ, 'accept')
    conns, next_id, buffers, logged = {}, 0, {'stdin': b'', 'codex': b''}, 0
    deadline = time.monotonic() + int(job['timeout_s'])
    while True:
        if time.monotonic() > deadline:
            emit({'t': 'error', 'message': 'bridge_timeout'})
            return
        for key, _ in sel.select(timeout=0.5):
            kind = key.data
            if kind == 'accept':
                conn, _ = listener.accept()
                next_id += 1
                conns[next_id] = conn
                sel.register(conn, selectors.EVENT_READ, next_id)
                emit({'t': 'open', 'c': next_id})
            elif isinstance(kind, int):
                try:
                    data = key.fileobj.recv(65536)
                except OSError:
                    data = b''
                if data:
                    emit({'t': 'data', 'c': kind, 'b': base64.b64encode(data).decode()})
                else:
                    sel.unregister(key.fileobj)
                    key.fileobj.close()
                    conns.pop(kind, None)
                    emit({'t': 'close', 'c': kind})
            elif kind == 'stderr':
                data = os.read(key.fileobj.fileno(), 4096)
                if not data:
                    sel.unregister(key.fileobj)
                elif logged < MAX_LOG_BYTES:
                    logged += len(data)
                    emit({'t': 'log', 'text': data.decode('utf-8', 'replace')[:2000]})
            elif kind == 'codex':
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    emit({'t': 'error', 'message': 'codex_exited:%s' % proc.poll()})
                    return
                buffers['codex'] += data
                while b'\n' in buffers['codex']:
                    line, buffers['codex'] = buffers['codex'].split(b'\n', 1)
                    if line.strip():
                        emit({'t': 'codex', 'line': line.decode('utf-8', 'replace')})
            elif kind == 'stdin':
                data = os.read(0, 65536)
                if not data:
                    return
                buffers['stdin'] += data
                while b'\n' in buffers['stdin']:
                    line, buffers['stdin'] = buffers['stdin'].split(b'\n', 1)
                    frame = json.loads(line)
                    t = frame.get('t')
                    if t == 'codex':
                        proc.stdin.write(frame['line'].encode() + b'\n')
                        proc.stdin.flush()
                    elif t == 'data' and frame.get('c') in conns:
                        conns[frame['c']].setblocking(True)
                        conns[frame['c']].sendall(base64.b64decode(frame['b']))
                        conns[frame['c']].setblocking(False)
                    elif t == 'close' and frame.get('c') in conns:
                        conn = conns.pop(frame['c'])
                        sel.unregister(conn)
                        conn.close()
                    elif t == 'kill':
                        return
                    elif t == 'finish':
                        os.killpg(proc.pid, signal.SIGKILL)
                        proc.wait(timeout=10)
                        files, problems = read_workspace(ws)
                        emit({'t': 'result', 'files': files, 'problems': problems})
                        return


if __name__ == '__main__':
    main()
