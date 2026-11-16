"""Reference solution for the frozen P14 extra-large benchmark (stockroom/1). Not shown to builders."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stockroom.cli import run  # noqa: E402


if __name__ == '__main__':
    sys.exit(run(sys.argv[1:], sys.stdin.read(), sys.stdout.write))
