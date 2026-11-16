"""Customers and the discount each one gets on its orders."""
import re

_NAME = re.compile(r'[a-z][a-z_]{0,15}')
_PERCENT = re.compile(r'0|[1-9][0-9]?')
MAX_PERCENT = 50


def valid_customer(text):
    """1 to 16 of a-z or underscore, starting with a-z."""
    return _NAME.fullmatch(text) is not None


def parse_percent(text):
    """A whole percent from 0 to 50 with no leading zero, or None."""
    if not _PERCENT.fullmatch(text):
        return None
    value = int(text)
    return value if value <= MAX_PERCENT else None


def discounted(total, percent):
    """The total less its discount, the discount rounded down to a whole cent."""
    return total - total * percent // 100


class Customers:
    """Each customer's discount percent."""

    def __init__(self):
        self._percent = {}

    def has(self, name):
        return name in self._percent

    def add(self, name, percent):
        self._percent[name] = percent

    def percent(self, name):
        return self._percent[name]

    def names(self):
        """Every customer name in ascending order."""
        return sorted(self._percent)


def customer_summary(name, orders):
    """(orders placed, orders shipped, shipped revenue) for one customer."""
    mine = [order for order in orders if order.customer == name]
    shipped = [order for order in mine if order.revenue is not None]
    return len(mine), len(shipped), sum(order.revenue for order in shipped)
