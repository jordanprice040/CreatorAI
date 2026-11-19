"""Amounts are whole cents."""
import re

AMOUNT = re.compile(r'(0|[1-9][0-9]{0,5})\.([0-9]{2})')
FINE_PER_DAY = 25
FINE_CAP = 500
OWES_LIMIT = 500


def parse_amount(text):
    m = AMOUNT.fullmatch(text)
    return int(m.group(1)) * 100 + int(m.group(2)) if m else None


def show(cents):
    return '%d.%02d' % (cents // 100, cents % 100)


def late_fine(day, due):
    return min(max(0, day - due) * FINE_PER_DAY, FINE_CAP)
