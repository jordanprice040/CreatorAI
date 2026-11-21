"""Arguments, the run and its exit status."""
from fares.report import report
from fares.taps import CARD, BadLine, parse_trips


def run(argv, text, out):
    only = None
    if argv:
        if len(argv) != 2 or argv[0] != '--card' or not CARD.fullmatch(argv[1]):
            out.write('invalid arguments\n')
            return 2
        only = argv[1]
    try:
        trips = parse_trips(text)
    except BadLine as e:
        out.write('error: line %d\n' % e.line)
        return 1
    if not trips:
        out.write('no trips\n')
        return 0
    out.write(report(trips, only))
    return 0
