"""Reviewed recipe. This file itself runs only inside Bubblewrap."""
import os
import json
import pathlib
import py_compile
import resource
import shutil
import subprocess
import sys

resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
assert os.getuid() != 0
shutil.copytree('/input', '/work/product')
os.chdir('/work/product')
for path in pathlib.Path('.').rglob('*.py'):
    py_compile.compile(str(path), doraise=True)
if not pathlib.Path('src/main.py').is_file():
    raise RuntimeError('Reviewed template requires src/main.py')
acceptance = pathlib.Path('/acceptance.json')
case = json.loads(acceptance.read_text()) if acceptance.is_file() else None
result = subprocess.run(['/usr/bin/python3', '-I', 'src/main.py', *(case['args'] if case else [])],
                        input=case['stdin'].encode() if case else None,
                        env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent'})
sys.exit(result.returncode)
