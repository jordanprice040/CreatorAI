"""Money held as integer cents: reading a money field and printing an amount."""
import re

_MONEY = re.compile(r'([0-9]{1,7})(?:\.([0-9]{1,2}))?')


def parse_money(text):
    """The cents a money field stands for, or None when the field is not money."""
    match = _MONEY.fullmatch(text)
    if not match:
        return None
    whole = int(match.group(1))
    fraction = (match.group(2) or '').ljust(2, '0')
    return whole * 100 + int(fraction)


def format_money(cents):
    """Optional minus sign, whole part, dot, two digits; zero is 0.00."""
    sign = '-' if cents < 0 else ''
    cents = abs(cents)
    return '%s%d.%02d' % (sign, cents // 100, cents % 100)


def line_total(quantity, unit_cents):
    """The cents for a quantity of units at one unit price or cost."""
    return quantity * unit_cents
