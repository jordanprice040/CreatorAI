"""The report lines."""
from sla.clock import business_minutes
from sla.policy import RESOLUTION, RESPONSE, most_urgent, status


def ticket_line(ticket, t, at):
    p = most_urgent(t['priorities'])
    r_end = t['responded'] if t['responded'] is not None else at
    r_elapsed = business_minutes(t['opened'], r_end)
    r_status = status(r_elapsed, RESPONSE[p], t['responded'] is not None)
    c_end = t['closed'] if t['closed'] is not None else at
    c_elapsed = business_minutes(t['opened'], c_end)
    c_status = status(c_elapsed, RESOLUTION[p], t['closed'] is not None)
    line = '%s %s response %d/%d %s, resolution %d/%d %s' % (
        ticket, p, r_elapsed, RESPONSE[p], r_status, c_elapsed, RESOLUTION[p], c_status)
    return line, 'breached' in (r_status, c_status)


def report(tickets, at, only):
    out = []
    shown = breached = 0
    for ticket in sorted(tickets, key=lambda i: int(i[1:])):
        t = tickets[ticket]
        if only is not None and most_urgent(t['priorities']) != only:
            continue
        line, bad = ticket_line(ticket, t, at)
        out.append(line)
        shown += 1
        breached += bad
    out.append('tickets %d, breached %d' % (shown, breached))
    return '\n'.join(out) + '\n'
