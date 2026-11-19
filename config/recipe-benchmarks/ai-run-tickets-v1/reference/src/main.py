"""Reference solution for the frozen AI-only run task ai-run-tickets-v1. Not shown to builders."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sla.cli import run  # noqa: E402

if __name__ == '__main__':
    sys.exit(run(sys.argv[1:], sys.stdin.read(), sys.stdout))
