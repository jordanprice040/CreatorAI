"""Parse and validate ledger rows into (date, category, cents)."""
import datetime
import re

CATEGORY = re.compile(r'[a-z0-9_]{1,20}')
_AMOUNT = re.compile(r'(-?)([0-9]+)(?:\.([0-9]{1,2}))?')
_DATE = re.compile(r'([0-9]{4})-([0-9]{2})-([0-9]{2})')


def parse_amount(text, allow_negative=True):
    m = _AMOUNT.fullmatch(text)
    if not m or (m.group(1) and not allow_negative):
        return None
    cents = int(m.group(2)) * 100 + int((m.group(3) or '0').ljust(2, '0'))
    return -cents if m.group(1) else cents


def valid_date(text):
    m = _DATE.fullmatch(text)
    if not m:
        return False
    try:
        datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return False
    return True


def valid_month(text):
    return valid_date(text + '-01')


def parse_ledger(text):
    rows, errors = [], []
    for number, line in enumerate(text.split('\n'), start=1):
        if line.endswith('\r'):
            line = line[:-1]
        if line.strip() == '' or line.startswith('#'):
            continue
        fields = line.split(',')
        if len(fields) != 3:
            errors.append((number, 'bad field count'))
        elif not valid_date(fields[0]):
            errors.append((number, 'bad date'))
        elif not CATEGORY.fullmatch(fields[1]):
            errors.append((number, 'bad category'))
        elif parse_amount(fields[2]) is None:
            errors.append((number, 'bad amount'))
        else:
            rows.append((fields[0], fields[1], parse_amount(fields[2])))
    return rows, errors
