"""Fares in cents, before caps."""
from fares.network import AIRPORT, zones_crossed

BASE = 200
PER_ZONE = 75
SURCHARGE = 150
TRANSFER_WINDOW = 60


def concession(card):
    return card.startswith('C')


def half_up(cents):
    return (cents + 1) // 2


def base_fare(trip):
    fare = BASE + PER_ZONE * zones_crossed(trip['from'], trip['to'])
    return half_up(fare) if concession(trip['card']) else fare


def surcharge(trip):
    return SURCHARGE if AIRPORT in (trip['from'], trip['to']) else 0


def is_transfer(trip, window_start):
    """window_start: (day, minute) of the card's last trip that was not a transfer."""
    return (window_start is not None and window_start[0] == trip['day']
            and trip['minute'] - window_start[1] <= TRANSFER_WINDOW)
