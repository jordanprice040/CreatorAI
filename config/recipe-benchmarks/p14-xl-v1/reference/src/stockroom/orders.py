"""Orders, their states and the units they reserve."""

RESERVED = 'reserved'
WAITING = 'waiting'
SHIPPED = 'shipped'
CANCELLED = 'cancelled'


class Order:
    """An order: its customer, discount, lines as (sku, quantity, unit price when ordered)."""

    def __init__(self, order_id, customer, percent, lines):
        self.id = order_id
        self.customer = customer
        self.percent = percent
        self.lines = lines
        self.state = WAITING
        self.revenue = None
        self.cost = None

    def total(self):
        return sum(quantity * price for _, quantity, price in self.lines)


class OrderBook:
    """Every order in placement order, and the units reserved per sku."""

    def __init__(self):
        self.orders = []
        self._by_id = {}
        self._reserved = {}

    def has(self, order_id):
        return order_id in self._by_id

    def get(self, order_id):
        return self._by_id[order_id]

    def reserved(self, sku):
        return self._reserved.get(sku, 0)

    def add(self, order):
        self.orders.append(order)
        self._by_id[order.id] = order

    def fits(self, order, stock):
        """Whether every line fits the available stock (on hand less reserved)."""
        return all(
            quantity <= stock.on_hand(sku) - self.reserved(sku)
            for sku, quantity, _ in order.lines
        )

    def reserve(self, order):
        for sku, quantity, _ in order.lines:
            self._reserved[sku] = self.reserved(sku) + quantity
        order.state = RESERVED

    def release(self, order):
        for sku, quantity, _ in order.lines:
            self._reserved[sku] = self.reserved(sku) - quantity


def allocate(book, stock):
    """Try waiting orders in placement order; reserve each that fits. Returns their ids."""
    done = []
    for order in book.orders:
        if order.state == WAITING and book.fits(order, stock):
            book.reserve(order)
            done.append(order.id)
    return done
