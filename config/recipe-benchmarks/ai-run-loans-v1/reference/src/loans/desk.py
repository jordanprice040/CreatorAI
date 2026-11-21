"""The library desk: books, members, loans, holds and fines."""
from loans.money import OWES_LIMIT, late_fine

LOAN_DAYS = 14
LOAN_LIMIT = 3


def new_book(title):
    return {'title': title, 'member': None, 'due': None, 'held': None, 'queue': []}


class Desk:
    def __init__(self):
        self.day = 1
        self.books = {}
        self.members = {}

    def apply(self, command):
        """Returns None when the command took effect, else the refusal reason."""
        handler = getattr(self, 'do_' + command[0].lower())
        return handler(*command[1:])

    def do_book(self, book, title):
        if book in self.books:
            return 'duplicate'
        self.books[book] = new_book(title)
        return None

    def do_member(self, member, name):
        if member in self.members:
            return 'duplicate'
        self.members[member] = {'name': name, 'owes': 0}
        return None

    def do_day(self, day):
        if day < self.day:
            return 'day-backwards'
        self.day = day
        return None

    def loans(self, member):
        return sum(1 for b in self.books.values() if b['member'] == member)

    def do_lend(self, book, member):
        if book not in self.books:
            return 'unknown-book'
        if member not in self.members:
            return 'unknown-member'
        b = self.books[book]
        if b['member'] is not None:
            return 'not-available'
        if b['held'] is not None and b['held'] != member:
            return 'held'
        if self.loans(member) >= LOAN_LIMIT:
            return 'limit'
        if self.members[member]['owes'] > OWES_LIMIT:
            return 'owes-fines'
        b['member'], b['due'], b['held'] = member, self.day + LOAN_DAYS, None
        return None

    def do_return(self, book):
        if book not in self.books:
            return 'unknown-book'
        b = self.books[book]
        if b['member'] is None:
            return 'not-on-loan'
        self.members[b['member']]['owes'] += late_fine(self.day, b['due'])
        b['member'], b['due'] = None, None
        if b['queue']:
            b['held'] = b['queue'].pop(0)
        return None

    def do_reserve(self, book, member):
        if book not in self.books:
            return 'unknown-book'
        if member not in self.members:
            return 'unknown-member'
        b = self.books[book]
        if b['member'] is None and b['held'] is None:
            return 'not-on-loan'
        if member in (b['member'], b['held']):
            return 'already-yours'
        if member in b['queue']:
            return 'duplicate'
        b['queue'].append(member)
        return None

    def do_pay(self, member, amount):
        if member not in self.members:
            return 'unknown-member'
        if amount > self.members[member]['owes']:
            return 'overpay'
        self.members[member]['owes'] -= amount
        return None
