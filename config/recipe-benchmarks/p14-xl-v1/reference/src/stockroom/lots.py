"""Stock held in lots, oldest first, each with its own unit cost."""


class Stock:
    """Each item's lots as [quantity left, unit cost in cents], oldest first."""

    def __init__(self):
        self._lots = {}

    def receive(self, sku, quantity, cost):
        self._lots.setdefault(sku, []).append([quantity, cost])

    def on_hand(self, sku):
        return sum(lot[0] for lot in self._lots.get(sku, []))

    def value(self, sku):
        """The summed cost of the units left in the item's lots."""
        return sum(lot[0] * lot[1] for lot in self._lots.get(sku, []))

    def take(self, sku, quantity):
        """Remove units from the oldest lots first; return the cost of the units taken."""
        cost = 0
        lots = self._lots.get(sku, [])
        while quantity > 0:
            lot = lots[0]
            used = min(quantity, lot[0])
            cost += used * lot[1]
            lot[0] -= used
            quantity -= used
            if lot[0] == 0:
                lots.pop(0)
        return cost


def new_stock():
    """Stock with no lots."""
    return Stock()
