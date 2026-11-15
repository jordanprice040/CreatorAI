import sys


def parse_args(argv):
    minimum = 1
    seen = False
    i = 0
    while i < len(argv):
        if argv[i] != '--min' or seen or i + 1 >= len(argv):
            return None
        value = argv[i + 1]
        if not (1 <= len(value) <= 2 and all('0' <= ch <= '9' for ch in value)):
            return None
        minimum = int(value)
        if minimum < 1:
            return None
        seen = True
        i += 2
    return minimum


def parse_score(text):
    if not (1 <= len(text) <= 3 and all('0' <= ch <= '9' for ch in text)):
        return None
    value = int(text)
    return value if value <= 100 else None


def average_text(total, count):
    # Tenths, rounded half up, in integers: floor((10 * total / count) + 1/2).
    tenths = (20 * total + count) // (2 * count)
    return '%d.%d' % (tenths // 10, tenths % 10)


def main():
    minimum = parse_args(sys.argv[1:])
    if minimum is None:
        sys.stdout.write('invalid input\n')
        return 2
    people = {}
    order = []
    for number, line in enumerate(sys.stdin.read().split('\n'), start=1):
        if line.endswith('\r'):
            line = line[:-1]
        bare = line.strip(' \t')
        if bare == '' or bare.startswith('#'):
            continue
        parts = line.split(',')
        name = parts[0].strip(' \t') if len(parts) == 2 else ''
        score = parse_score(parts[1].strip(' \t')) if len(parts) == 2 else None
        if name == '' or score is None:
            sys.stdout.write('line %d: invalid\n' % number)
            return 2
        key = name.lower()
        if key not in people:
            people[key] = [name, 0, 0]
            order.append(key)
        people[key][1] += score
        people[key][2] += 1
    rows = [p for p in people.values() if p[2] >= minimum]
    if not rows:
        sys.stdout.write('no scores\n')
        return 0
    # Average descending (compared exactly as fractions), then lowercase name ascending.
    rows.sort(key=lambda p: p[0].lower())
    rows.sort(key=lambda p: _Fraction(p[1], p[2]), reverse=True)
    for name, total, count in rows:
        sys.stdout.write('%s %s (%d)\n' % (name, average_text(total, count), count))
    return 0


class _Fraction:
    def __init__(self, total, count):
        self.total = total
        self.count = count

    def __lt__(self, other):
        return self.total * other.count < other.total * self.count


if __name__ == '__main__':
    sys.exit(main())
