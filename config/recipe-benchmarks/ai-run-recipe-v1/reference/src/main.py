"""Reference solution for the frozen AI-only run task ai-run-recipe-v1. Not shown to builders."""
import re
import sys
from fractions import Fraction

UNITS = ('tsp', 'tbsp', 'cup', 'g', 'kg', 'ml', 'l', 'pc')
# (from, to, how many of from make one to): applied in this order, repeatedly.
UPGRADES = (('tsp', 'tbsp', 3), ('tbsp', 'cup', 16), ('g', 'kg', 1000), ('ml', 'l', 1000))
WHOLE = re.compile(r'[1-9][0-9]{0,3}')
FRACTION = re.compile(r'([1-9][0-9]{0,3})/([1-9][0-9]{0,3})')
NAME = re.compile(r'[a-z]+(-[a-z]+)*')


def quantity(tokens):
    """Returns (value, tokens used) or None. Forms: 2, 3/4, 1 1/2 (a proper fraction after a whole)."""
    if not tokens:
        return None
    m = FRACTION.fullmatch(tokens[0])
    if m:
        return Fraction(int(m.group(1)), int(m.group(2))), 1
    if not WHOLE.fullmatch(tokens[0]):
        return None
    whole = int(tokens[0])
    if len(tokens) > 1:
        m = FRACTION.fullmatch(tokens[1])
        if m:
            part = Fraction(int(m.group(1)), int(m.group(2)))
            if part >= 1:
                return None
            return whole + part, 2
    return Fraction(whole), 1


def show(value):
    whole = value.numerator // value.denominator
    rest = value - whole
    if rest == 0:
        return str(whole)
    if whole == 0:
        return '%d/%d' % (rest.numerator, rest.denominator)
    return '%d %d/%d' % (whole, rest.numerator, rest.denominator)


def parse_scale(argv):
    if not argv:
        return Fraction(1)
    if len(argv) != 2 or argv[0] != '--scale':
        return None
    got = quantity([argv[1]])
    return got[0] if got else None


def main():
    scale = parse_scale(sys.argv[1:])
    if scale is None:
        sys.stdout.write('invalid arguments\n')
        return 2
    out = []
    for number, line in enumerate(sys.stdin.read().split('\n'), start=1):
        tokens = line.split()
        if not tokens:
            continue
        got = quantity(tokens)
        rest = tokens[got[1]:] if got else []
        if not got or len(rest) != 2 or rest[0] not in UNITS or not NAME.fullmatch(rest[1]):
            sys.stdout.write('invalid line %d\n' % number)
            return 1
        value, unit = got[0] * scale, rest[0]
        for frm, to, size in UPGRADES:
            if unit == frm and value >= size:
                value, unit = value / size, to
        out.append('%s %s %s\n' % (show(value), unit, rest[1]))
    if not out:
        sys.stdout.write('no ingredients\n')
        return 0
    sys.stdout.write(''.join(out))
    sys.stdout.write('%d ingredient%s\n' % (len(out), '' if len(out) == 1 else 's'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
