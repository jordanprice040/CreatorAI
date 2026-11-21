"""Reference solution for the frozen AI-only run task ai-run-shifts-v1. Not shown to builders."""
import re
import sys

TIME = re.compile(r'([01][0-9]|2[0-3]):([0-5][0-9])')
NAME = re.compile(r'[a-z]{1,20}')


def minutes(text):
    m = TIME.fullmatch(text)
    if not m:
        return None
    return int(m.group(1)) * 60 + int(m.group(2))


def clock(total):
    return '%02d:%02d' % (total // 60, total % 60)


def parse_args(argv):
    opts = {'--open': 9 * 60, '--close': 17 * 60, '--min-staff': 1}
    seen = set()
    i = 0
    while i < len(argv):
        flag = argv[i]
        if flag not in opts or flag in seen or i + 1 >= len(argv):
            return None
        value = argv[i + 1]
        if flag == '--min-staff':
            if not re.fullmatch(r'[1-9]', value):
                return None
            opts[flag] = int(value)
        else:
            t = minutes(value)
            if t is None:
                return None
            opts[flag] = t
        seen.add(flag)
        i += 2
    if opts['--open'] >= opts['--close']:
        return None
    return opts


def main():
    opts = parse_args(sys.argv[1:])
    if opts is None:
        sys.stdout.write('invalid arguments\n')
        return 2
    staff = {}
    for number, line in enumerate(sys.stdin.read().split('\n'), start=1):
        text = line.strip()
        if not text or text.startswith('#'):
            continue
        parts = text.split()
        ok = len(parts) == 3 and NAME.fullmatch(parts[0])
        start = minutes(parts[1]) if ok else None
        end = minutes(parts[2]) if ok else None
        if start is None or end is None or start >= end:
            sys.stdout.write('error: line %d: invalid shift\n' % number)
            return 1
        staff.setdefault(parts[0], set()).update(range(start, end))
    open_, close = opts['--open'], opts['--close']
    need = opts['--min-staff']
    covered = 0
    gaps = []
    for minute in range(open_, close):
        count = sum(1 for mins in staff.values() if minute in mins)
        if count >= need:
            covered += 1
        elif gaps and gaps[-1][1] == minute:
            gaps[-1][1] = minute + 1
        else:
            gaps.append([minute, minute + 1])
    if not gaps:
        sys.stdout.write('no gaps\n')
    for start, end in gaps:
        sys.stdout.write('gap %s-%s (%d min)\n' % (clock(start), clock(end), end - start))
    sys.stdout.write('covered %d of %d min\n' % (covered, close - open_))
    return 0


if __name__ == '__main__':
    sys.exit(main())
