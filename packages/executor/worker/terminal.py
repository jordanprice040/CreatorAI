"""Reviewed interactive recipe (ADR-0058). This file itself runs only inside Bubblewrap.

It copies the read-only package into the private work tmpfs, checks it compiles, and then
replaces itself with the product's entry point, attached to the session's terminal.
Only the owner-confirmed argument list crosses in, through /launch.json.
"""
import json
import os
import pathlib
import py_compile
import resource
import shutil

resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
# An interactive program mostly waits for keys; ten CPU minutes bounds a busy loop.
resource.setrlimit(resource.RLIMIT_CPU, (600, 600))
assert os.getuid() != 0
launch = json.loads(pathlib.Path('/launch.json').read_text())
if not isinstance(launch, dict) or set(launch) != {'args'}:
    raise RuntimeError('Only the confirmed argument list may enter the sandbox')
args = launch['args']
if not isinstance(args, list) or len(args) > 12 or not all(
        isinstance(a, str) and len(a) <= 500 and '\0' not in a for a in args):
    raise RuntimeError('Invalid argument list')
shutil.copytree('/input', '/work/product')
os.chdir('/work/product')
for path in pathlib.Path('.').rglob('*.py'):
    py_compile.compile(str(path), doraise=True)
if not pathlib.Path('src/main.py').is_file():
    raise RuntimeError('Reviewed template requires src/main.py')
os.execve('/usr/bin/python3', ['/usr/bin/python3', '-I', 'src/main.py', *args],
          {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'TERM': 'xterm-256color',
           'LANG': 'C.UTF-8'})
