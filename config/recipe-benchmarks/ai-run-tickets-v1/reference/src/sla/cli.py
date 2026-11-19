"""Arguments, the run and its exit status."""
from sla.clock import parse_time
from sla.events import BadLine, parse_events
from sla.policy import PRIORITIES
from sla.report import report
from sla.tickets import build


def parse_args(argv):
    opts = {'--at': None, '--priority': None}
    seen = set()
    i = 0
    while i < len(argv):
        flag = argv[i]
        if flag not in opts or flag in seen or i + 1 >= len(argv):
            return None
        value = argv[i + 1]
        if flag == '--at':
            value = parse_time(value)
            if value is None:
                return None
        elif value not in PRIORITIES:
            return None
        opts[flag] = value
        seen.add(flag)
        i += 2
    return opts


def run(argv, text, out):
    opts = parse_args(argv)
    if opts is None:
        out.write('invalid arguments\n')
        return 2
    try:
        events, last = parse_events(text)
        tickets = build(events)
    except BadLine as e:
        out.write('error: line %d\n' % e.line)
        return 1
    if not tickets:
        out.write('no tickets\n')
        return 0
    at = opts['--at'] if opts['--at'] is not None else last
    if at < last:
        out.write('error: --at is before the last event\n')
        return 1
    out.write(report(tickets, at, opts['--priority']))
    return 0
