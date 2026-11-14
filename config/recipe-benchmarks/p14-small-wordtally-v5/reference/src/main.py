"""Reference solution for the frozen P14 small benchmark (wordtally/1). Not shown to builders."""
import re
import sys


def parse_args(argv):
    top = 3
    i = 0
    seen = False
    while i < len(argv):
        if argv[i] != '--top' or seen or i + 1 >= len(argv):
            return None
        value = argv[i + 1]
        if not re.fullmatch(r'[0-9]+', value) or not 1 <= int(value) <= 50:
            return None
        top = int(value)
        seen = True
        i += 2
    return top


def main():
    top = parse_args(sys.argv[1:])
    if top is None:
        sys.stdout.write('invalid input\n')
        return 2
    counts = {}
    for word in re.findall(r'[A-Za-z0-9]+', sys.stdin.read()):
        word = word.lower()
        counts[word] = counts.get(word, 0) + 1
    if not counts:
        sys.stdout.write('no words\n')
        return 0
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:top]
    for word, count in ranked:
        sys.stdout.write('%s %d\n' % (word, count))
    return 0


if __name__ == '__main__':
    sys.exit(main())
