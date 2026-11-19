"""Reference solution for the frozen AI-only run task ai-run-grades-v1. Not shown to builders."""
import re
import sys
from fractions import Fraction

WEIGHTS = {'quiz': Fraction(3, 10), 'exam': Fraction(5, 10), 'project': Fraction(2, 10)}
STUDENT = re.compile(r'[a-z][a-z0-9_]{0,19}')
SCORE = re.compile(r'0|[1-9][0-9]?|100')
LETTERS = ((90, 'A'), (80, 'B'), (70, 'C'), (60, 'D'))


def tenths(value):
    """Rounds a non-negative Fraction half up to a whole number of tenths."""
    scaled = value * 10
    whole = scaled.numerator // scaled.denominator
    if scaled - whole >= Fraction(1, 2):
        whole += 1
    return whole


def show(t):
    return '%d.%d' % (t // 10, t % 10)


def parse_curve(argv):
    if not argv:
        return 0
    if len(argv) != 2 or argv[0] != '--curve' or not re.fullmatch(r'[0-9]|10', argv[1]):
        return None
    return int(argv[1])


def main():
    curve = parse_curve(sys.argv[1:])
    if curve is None:
        sys.stdout.write('invalid arguments\n')
        return 2
    lines = sys.stdin.read().split('\n')
    if lines and lines[-1] == '':
        lines.pop()
    if not lines or lines[0].strip() != 'student,kind,score':
        sys.stdout.write('error: line 1\n')
        return 1
    scores = {}
    for number, line in enumerate(lines[1:], start=2):
        text = line.strip()
        if not text:
            continue
        cells = [c.strip() for c in text.split(',')]
        if (len(cells) != 3 or not STUDENT.fullmatch(cells[0])
                or cells[1] not in WEIGHTS or not SCORE.fullmatch(cells[2])):
            sys.stdout.write('error: line %d\n' % number)
            return 1
        scores.setdefault(cells[0], {}).setdefault(cells[1], []).append(int(cells[2]))
    if not scores:
        sys.stdout.write('no students\n')
        return 0
    rows = []
    for student, kinds in scores.items():
        total = Fraction(0)
        for kind, weight in WEIGHTS.items():
            got = sorted(kinds.get(kind, []))
            if kind == 'quiz' and len(got) >= 3:
                got = got[1:]
            if got:
                total += weight * Fraction(sum(got), len(got))
        final = tenths(total)
        incomplete = any(kind not in kinds for kind in WEIGHTS)
        rows.append((final, student, incomplete))
    rows.sort(key=lambda r: (-r[0], r[1]))
    for final, student, incomplete in rows:
        curved = min(final + curve * 10, 1000)
        letter = next((l for floor, l in LETTERS if curved >= floor * 10), 'F')
        sys.stdout.write('%s %s %s%s\n' % (student, show(curved), letter, ' incomplete' if incomplete else ''))
    average = tenths(Fraction(sum(min(r[0] + curve * 10, 1000) for r in rows), 10 * len(rows)))
    sys.stdout.write('class average %s\n' % show(average))
    return 0


if __name__ == '__main__':
    sys.exit(main())
