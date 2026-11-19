"""Times are minutes since day 1 00:00; day 1 is a Monday. Business hours: Mon-Fri 09:00-17:00."""
import re

TIME = re.compile(r'([1-9][0-9]?)\.([01][0-9]|2[0-3]):([0-5][0-9])')
DAY = 24 * 60
OPEN, CLOSE = 9 * 60, 17 * 60


def parse_time(text):
    m = TIME.fullmatch(text)
    if not m:
        return None
    return (int(m.group(1)) - 1) * DAY + int(m.group(2)) * 60 + int(m.group(3))


def business_minutes(start, end):
    """Minutes in [start, end) that fall in business hours."""
    total = 0
    day = start // DAY
    while day * DAY < end:
        if day % 7 < 5:
            lo = max(start, day * DAY + OPEN)
            hi = min(end, day * DAY + CLOSE)
            if hi > lo:
                total += hi - lo
        day += 1
    return total
