"""The item catalog: each sku and its current price in cents."""


class Catalog:
    """Items in the order they were defined, with their current prices."""

    def __init__(self):
        self._prices = {}

    def has(self, sku):
        return sku in self._prices

    def add(self, sku, price):
        self._prices[sku] = price

    def set_price(self, sku, price):
        self._prices[sku] = price

    def price(self, sku):
        return self._prices[sku]

    def skus(self):
        """Every sku in ascending order."""
        return sorted(self._prices)


def new_catalog():
    """An empty catalog."""
    return Catalog()
