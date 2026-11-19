"""Reads the script into commands; a malformed line stops everything."""
import re

from loans.money import parse_amount

BOOK = re.compile(r'B[1-9][0-9]{0,3}')
MEMBER = re.compile(r'M[1-9][0-9]{0,3}')
NAME = re.compile(r'[A-Za-z]{1,20}')
DAY = re.compile(r'[1-9][0-9]{0,3}')


class Malformed(Exception):
    def __init__(self, line):
        super().__init__(line)
        self.line = line


def parse_line(fields):
    op, args = fields[0], fields[1:]
    if op == 'BOOK' and len(args) >= 2 and BOOK.fullmatch(args[0]):
        return ('BOOK', args[0], ' '.join(args[1:]))
    if op == 'MEMBER' and len(args) == 2 and MEMBER.fullmatch(args[0]) and NAME.fullmatch(args[1]):
        return ('MEMBER', args[0], args[1])
    if op == 'DAY' and len(args) == 1 and DAY.fullmatch(args[0]):
        return ('DAY', int(args[0]))
    if op in ('LEND', 'RESERVE') and len(args) == 2 and BOOK.fullmatch(args[0]) and MEMBER.fullmatch(args[1]):
        return (op, args[0], args[1])
    if op == 'RETURN' and len(args) == 1 and BOOK.fullmatch(args[0]):
        return ('RETURN', args[0])
    if op == 'PAY' and len(args) == 2 and MEMBER.fullmatch(args[0]):
        amount = parse_amount(args[1])
        if amount is not None:
            return ('PAY', args[0], amount)
    return None


def parse_script(text):
    commands = []
    for number, line in enumerate(text.split('\n'), start=1):
        fields = line.split()
        if not fields or fields[0].startswith('#'):
            continue
        command = parse_line(fields)
        if command is None:
            raise Malformed(number)
        commands.append((number, command))
    return commands
