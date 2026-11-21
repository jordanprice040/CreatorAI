"""Reads event lines; any problem is reported by line number."""
import re

from sla.clock import parse_time
from sla.policy import PRIORITIES

TICKET = re.compile(r'T[1-9][0-9]{0,3}')


class BadLine(Exception):
    def __init__(self, line):
        super().__init__(line)
        self.line = line


def parse_events(text):
    events = []
    last = None
    for number, line in enumerate(text.split('\n'), start=1):
        fields = line.split()
        if not fields or fields[0].startswith('#'):
            continue
        ok = len(fields) >= 3 and TICKET.fullmatch(fields[0])
        when = parse_time(fields[1]) if ok else None
        kind = fields[2] if ok else None
        if when is None or (last is not None and when < last):
            raise BadLine(number)
        if kind in ('open', 'escalate') and len(fields) == 4 and fields[3] in PRIORITIES:
            value = fields[3]
        elif kind in ('respond', 'close') and len(fields) == 3:
            value = None
        else:
            raise BadLine(number)
        last = when
        events.append((number, fields[0], when, kind, value))
    return events, last
