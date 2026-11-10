#!/usr/bin/env python3
"""Run this bundle's visible command-line acceptance cases against your program.

Usage, from the project root (the folder that holds src/):
    python3 path/to/checks/run_checks.py [--task T1] [--check A1]
        [--cmd "python3 -I src/main.py"] [--root .]

Each case runs the command plus the case's arguments with the case's standard input.
A case passes when standard output and the exit code both match exactly.
Browser and manual checks are listed but not run. Exit status: 0 all run cases
passed, 1 a case failed, 2 nothing could be run.
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--task")
    ap.add_argument("--check")
    ap.add_argument("--cmd", default=None)
    ap.add_argument("--root", default=".")
    ap.add_argument("--timeout", type=float, default=10.0)
    args = ap.parse_args()
    with open(os.path.join(HERE, "acceptance.json"), encoding="utf-8") as f:
        data = json.load(f)
    cmd = shlex.split(args.cmd) if args.cmd else [sys.executable, "-I", "src/main.py"]
    wanted = None
    if args.task:
        tasks = [t for t in data["tasks"] if t["key"] == args.task]
        if not tasks:
            print("No task %s in this bundle." % args.task)
            return 2
        wanted = set(tasks[0]["acceptance"])
    ran = failed = skipped = 0
    for check in data["checks"]:
        key = check["key"]
        if wanted is not None and key not in wanted:
            continue
        if args.check and key != args.check:
            continue
        cases = check.get("cases") or []
        if not cases:
            skipped += 1
            print("SKIP %s (%s): %s" % (key, check["method"], check["not_run_reason"]))
            continue
        for i, case in enumerate(cases, 1):
            ran += 1
            label = "%s case %d" % (key, i)
            try:
                p = subprocess.run(
                    cmd + case["args"],
                    input=case["stdin"].encode("utf-8"),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=args.root,
                    timeout=args.timeout,
                )
            except subprocess.TimeoutExpired:
                failed += 1
                print("FAIL %s: no result after %s s" % (label, args.timeout))
                continue
            except OSError as e:
                failed += 1
                print("FAIL %s: could not start the command: %s" % (label, e))
                continue
            out = p.stdout.decode("utf-8", "replace")
            if out == case["stdout"] and p.returncode == case["exit_code"]:
                print("PASS %s" % label)
                continue
            failed += 1
            print("FAIL %s" % label)
            print("  arguments:        %r" % (case["args"],))
            if p.returncode != case["exit_code"]:
                print("  exit code:        expected %d, got %d" % (case["exit_code"], p.returncode))
            if out != case["stdout"]:
                print("  expected output:  %r" % case["stdout"])
                print("  actual output:    %r" % out)
            err = p.stderr.decode("utf-8", "replace").strip()
            if err:
                print("  standard error:   %r" % err[-600:])
    held = data.get("held_out_cases_withheld", 0)
    print("")
    print("%d run, %d failed, %d check(s) not run by this script." % (ran, failed, skipped))
    if held:
        print(
            "%d held-out case(s) are not in this bundle; the owner runs them. "
            "Passing here does not show they pass." % held
        )
    if failed:
        return 1
    return 0 if ran else 2


if __name__ == "__main__":
    sys.exit(main())
