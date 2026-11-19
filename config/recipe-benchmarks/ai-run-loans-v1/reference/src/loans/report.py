"""Text and JSON reports."""
import json

from loans.money import show


def by_number(ids):
    return sorted(ids, key=lambda i: int(i[1:]))


def book_status(b):
    if b['member'] is not None:
        return 'on_loan'
    if b['held'] is not None:
        return 'held'
    return 'available'


def text_report(desk, refused):
    out = ['line %d: refused: %s' % r for r in refused]
    out.append('day %d' % desk.day)
    for book in by_number(desk.books):
        b = desk.books[book]
        status = book_status(b)
        if status == 'on_loan':
            line = '%s %s: on loan to %s due %d' % (book, b['title'], b['member'], b['due'])
            if desk.day > b['due']:
                line += ' (overdue %d)' % (desk.day - b['due'])
        elif status == 'held':
            line = '%s %s: held for %s' % (book, b['title'], b['held'])
        else:
            line = '%s %s: available' % (book, b['title'])
        if b['queue']:
            line += '; queue %s' % ', '.join(b['queue'])
        out.append(line)
    for member in by_number(desk.members):
        m = desk.members[member]
        out.append('%s %s: loans %d, owes %s' % (member, m['name'], desk.loans(member), show(m['owes'])))
    return '\n'.join(out) + '\n'


def json_report(desk, refused):
    value = {
        'day': desk.day,
        'books': [
            {
                'id': book,
                'title': desk.books[book]['title'],
                'status': book_status(desk.books[book]),
                'member': desk.books[book]['member'] or desk.books[book]['held'],
                'due': desk.books[book]['due'],
                'queue': list(desk.books[book]['queue']),
            }
            for book in by_number(desk.books)
        ],
        'members': [
            {
                'id': member,
                'name': desk.members[member]['name'],
                'loans': desk.loans(member),
                'owes': show(desk.members[member]['owes']),
            }
            for member in by_number(desk.members)
        ],
        'refused': [{'line': line, 'reason': reason} for line, reason in refused],
    }
    return json.dumps(value, indent=2) + '\n'
