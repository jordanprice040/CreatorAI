"""Daily and weekly caps per card; the airport surcharge is outside them."""
from fares.pricing import concession

DAILY = 700
WEEKLY = 2500


def week(day):
    return (day - 1) // 7


class Caps:
    def __init__(self):
        self.daily = {}
        self.weekly = {}

    def charge(self, card, day, fare):
        """Returns the part of fare charged after the caps, and records it."""
        divisor = 2 if concession(card) else 1
        d_key, w_key = (card, day), (card, week(day))
        room = min(DAILY // divisor - self.daily.get(d_key, 0),
                   WEEKLY // divisor - self.weekly.get(w_key, 0))
        part = max(0, min(fare, room))
        self.daily[d_key] = self.daily.get(d_key, 0) + part
        self.weekly[w_key] = self.weekly.get(w_key, 0) + part
        return part
