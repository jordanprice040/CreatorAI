"""Owner-run setup of the pinned headless browser for the static-web/1 recipe (ADR-0078).

Run once inside the reviewed WSL distribution as the normal user (uid 1000), never as root:

    python3 -I install_browser.py            # downloads the pinned archive
    python3 -I install_browser.py --zip FILE # or uses an archive you downloaded yourself

It checks the archive's SHA-256 before extracting anything and the extracted tree's hash after,
so only the exact reviewed build is installed. The browser's system libraries come from Ubuntu
packages; this script prints the apt command for them but never runs sudo itself. Installing
the browser is a device change: the studio never runs this script.
"""
import argparse
import hashlib
import os
import pathlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile

VERSION = '156.0.8078.47'
URL = ('https://storage.googleapis.com/chrome-for-testing-public/' + VERSION +
       '/linux64/chrome-headless-shell-linux64.zip')
ZIP_SHA256 = '0d5acc62c3e213f8c87d3c298d66ffcf9a236d12ea4b9f85318bf85dbc279daa'
TREE_SHA256 = '2f84beb636e7c730bea98f70bfff326514e82e45e14e254db7b50d8c5747d141'
TARGET = pathlib.Path.home() / '.local/share/creator-agent/browser' / ('chrome-headless-shell-' + VERSION)
APT = ('sudo apt-get install -y --no-install-recommends libnss3 libnspr4 libatk1.0-0t64 '
       'libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 '
       'libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 libdbus-1-3 libexpat1 '
       'libx11-6 libxcb1 libxext6 libudev1 fonts-liberation')


def tree_hash(root):
    """SHA-256 over every file's relative path and content hash, in path order."""
    h = hashlib.sha256()
    for p in sorted(x for x in root.rglob('*') if x.is_file()):
        rel = p.relative_to(root).as_posix()
        h.update(rel.encode() + b'\0' + hashlib.sha256(p.read_bytes()).hexdigest().encode() + b'\n')
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--zip', help='an already downloaded chrome-headless-shell-linux64.zip')
    args = parser.parse_args()
    if os.getuid() == 0:
        sys.exit('Run this as your normal WSL user, not root.')
    if (TARGET / 'chrome-headless-shell').is_file() and tree_hash(TARGET) == TREE_SHA256:
        print('Already installed and verified:', TARGET)
        print('System libraries, if the studio reports the browser will not start:\n  ' + APT)
        return
    with tempfile.TemporaryDirectory() as tmp:
        archive = pathlib.Path(args.zip) if args.zip else pathlib.Path(tmp) / 'browser.zip'
        if not args.zip:
            print('Downloading', URL)
            with urllib.request.urlopen(URL, timeout=120) as r, open(archive, 'wb') as f:
                shutil.copyfileobj(r, f)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != ZIP_SHA256:
            sys.exit(f'Archive SHA-256 {digest} is not the reviewed {ZIP_SHA256}; nothing installed.')
        staging = pathlib.Path(tmp) / 'x'
        with zipfile.ZipFile(archive) as z:
            for info in z.infolist():
                name = pathlib.PurePosixPath(info.filename)
                if name.is_absolute() or '..' in name.parts:
                    sys.exit('Unsafe path in archive; nothing installed.')
            z.extractall(staging)
        tree = staging / 'chrome-headless-shell-linux64'
        if tree_hash(tree) != TREE_SHA256:
            sys.exit('Extracted files are not the reviewed build; nothing installed.')
        for p in tree.rglob('*'):
            p.chmod(0o755 if p.is_dir() or p.name == 'chrome-headless-shell' else 0o644)
        if TARGET.exists():
            shutil.rmtree(TARGET)
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(tree), TARGET)
    TARGET.chmod(0o755)
    print('Installed and verified:', TARGET)
    print('Now install the browser\'s system libraries (asks for your WSL password; on Ubuntu 22.04 drop the t64 suffixes):\n  ' + APT)


if __name__ == '__main__':
    main()
