"""Reads trip lines; any problem is reported by line number."""
import re

from fares.network import ZONES

CARD = re.compile(r'[AC][0-9]{3}')
DAY = re.compile(r'[1-9]|1[0-9]|2[0-8]')
TIME = re.compile(r'([01][0-9]|2[0-3]):([0-5][0-9])')


class BadLine(Exception):
    def __init__(self, line):
        super().__init__(line)
        self.line = line


def parse_trips(text):
    trips = []
    last = None
    for number, line in enumerate(text.split('\n'), start=1):
        fields = line.split()
        if not fields or fields[0].startswith('#'):
            continue
        if len(fields) != 5 or not CARD.fullmatch(fields[0]) or not DAY.fullmatch(fields[1]):
            raise BadLine(number)
        m = TIME.fullmatch(fields[2])
        a, b = fields[3], fields[4]
        if not m or a not in ZONES or b not in ZONES or a == b:
            raise BadLine(number)
        day, minute = int(fields[1]), int(m.group(1)) * 60 + int(m.group(2))
        if last is not None and (day, minute) < last:
            raise BadLine(number)
        last = (day, minute)
        trips.append({'card': fields[0], 'day': day, 'minute': minute, 'from': a, 'to': b})
    return trips
