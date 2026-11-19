"""Charges every trip and writes the report."""
from fares.caps import Caps
from fares.pricing import base_fare, is_transfer, surcharge


def money(cents):
    return '%d.%02d' % (cents // 100, cents % 100)


def charge_all(trips):
    caps = Caps()
    windows = {}
    charged = []
    for trip in trips:
        card = trip['card']
        transfer = is_transfer(trip, windows.get(card))
        if not transfer:
            windows[card] = (trip['day'], trip['minute'])
        fare = 0 if transfer else base_fare(trip)
        part = caps.charge(card, trip['day'], fare)
        extra = surcharge(trip)
        charged.append(dict(trip, charge=part + extra, transfer=transfer,
                            capped=part < fare, airport=extra > 0))
    return charged


def report(trips, only):
    charged = [c for c in charge_all(trips) if only is None or c['card'] == only]
    out = []
    grand = 0
    cards = sorted({c['card'] for c in charged})
    for card in cards:
        rows = [c for c in charged if c['card'] == card]
        total = sum(c['charge'] for c in rows)
        grand += total
        out.append('%s: %d trip%s, total %s' % (card, len(rows), '' if len(rows) == 1 else 's', money(total)))
        for c in rows:
            tags = ''.join(' ' + t for t in ('transfer', 'capped', 'airport') if c[t])
            out.append('  %d %02d:%02d %s>%s %s%s' % (
                c['day'], c['minute'] // 60, c['minute'] % 60, c['from'], c['to'], money(c['charge']), tags))
    out.append('cards %d, total %s' % (len(cards), money(grand)))
    return '\n'.join(out) + '\n'
