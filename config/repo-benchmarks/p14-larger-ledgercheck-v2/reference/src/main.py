"""Reference solution for the frozen P14 larger benchmark (ledgercheck/1). Not shown to builders."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ledger.parse import parse_ledger, parse_amount, valid_month, CATEGORY  # noqa: E402
from ledger.rules import totals, apply_caps  # noqa: E402
from ledger.report import render_text, render_json  # noqa: E402


def parse_args(argv):
    caps, month, fmt = {}, None, None
    i = 0
    while i < len(argv):
        flag = argv[i]
        if flag not in ('--cap', '--month', '--format') or i + 1 >= len(argv):
            return None
        value = argv[i + 1]
        if flag == '--cap':
            if '=' not in value:
                return None
            name, amount = value.split('=', 1)
            cents = parse_amount(amount, allow_negative=False)
            if not CATEGORY.fullmatch(name) or cents is None or name in caps or len(caps) == 5:
                return None
            caps[name] = cents
        elif flag == '--month':
            if month is not None or not valid_month(value):
                return None
            month = value
        else:
            if fmt is not None or value not in ('text', 'json'):
                return None
            fmt = value
        i += 2
    return caps, month, fmt or 'text'


def main():
    parsed = parse_args(sys.argv[1:])
    if parsed is None:
        sys.stdout.write('invalid input\n')
        return 2
    caps, month, fmt = parsed
    rows, errors = parse_ledger(sys.stdin.read())
    if errors:
        for line_no, reason in errors:
            sys.stdout.write('line %d: %s\n' % (line_no, reason))
        return 1
    if month is not None:
        rows = [r for r in rows if r[0].startswith(month + '-')]
    lines = apply_caps(totals(rows), caps)
    sys.stdout.write(render_json(lines) if fmt == 'json' else render_text(lines))
    return 4 if any(status == 'over' for _, _, _, status in lines) else 0


if __name__ == '__main__':
    sys.exit(main())
