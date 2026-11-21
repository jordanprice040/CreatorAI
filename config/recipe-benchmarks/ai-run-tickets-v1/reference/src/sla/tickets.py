"""Applies events to tickets."""
from sla.events import BadLine


def build(events):
    tickets = {}
    for number, ticket, when, kind, value in events:
        t = tickets.get(ticket)
        if kind == 'open':
            if t is not None:
                raise BadLine(number)
            tickets[ticket] = {'opened': when, 'priorities': [value], 'responded': None, 'closed': None}
            continue
        if t is None or t['closed'] is not None:
            raise BadLine(number)
        if kind == 'escalate':
            t['priorities'].append(value)
        elif kind == 'respond':
            if t['responded'] is None:
                t['responded'] = when
        else:
            t['closed'] = when
            if t['responded'] is None:
                t['responded'] = when
    return tickets
