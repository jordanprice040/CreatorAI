"""Stations and their zones."""
ZONES = {
    'central': 1, 'market': 1, 'harbor': 1,
    'north': 2, 'east': 2, 'mill': 2,
    'airport': 3, 'lakeside': 3,
    'ridge': 4,
}
AIRPORT = 'airport'


def zones_crossed(a, b):
    return abs(ZONES[a] - ZONES[b])
