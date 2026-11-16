"""The script's commands: checks in their fixed order, then the change and its response."""
from .customers import discounted, parse_percent, valid_customer
from .fields import parse_quantity, valid_order_id, valid_sku
from .money import format_money, parse_money
from .orders import CANCELLED, RESERVED, SHIPPED, WAITING, Order, allocate
from .script import pairs


class Refused(Exception):
    """A command that fails a check; its reason is printed and nothing changes."""

    def __init__(self, reason):
        super().__init__(reason)
        self.reason = reason


def _argc(args, count):
    if len(args) != count:
        raise Refused('bad arguments')


def _sku(text):
    if not valid_sku(text):
        raise Refused('bad sku')
    return text


def _quantity(text):
    quantity = parse_quantity(text)
    if quantity is None:
        raise Refused('bad quantity')
    return quantity


def _known_item(state, sku):
    if not state.catalog.has(sku):
        raise Refused('unknown item')


def _order_id(text):
    if not valid_order_id(text):
        raise Refused('bad order id')
    return text


def _known_order(state, order_id):
    if not state.book.has(order_id):
        raise Refused('unknown order')
    return state.book.get(order_id)


def _allocation_lines(state):
    return ['order %s reserved' % order_id for order_id in allocate(state.book, state.stock)]


def cmd_item(state, args):
    _argc(args, 2)
    sku = _sku(args[0])
    price = parse_money(args[1])
    if price is None or price == 0:
        raise Refused('bad price')
    if state.catalog.has(sku):
        raise Refused('duplicate item')
    state.catalog.add(sku, price)
    return ['item %s added' % sku]


def cmd_price(state, args):
    _argc(args, 2)
    sku = _sku(args[0])
    price = parse_money(args[1])
    if price is None or price == 0:
        raise Refused('bad price')
    _known_item(state, sku)
    state.catalog.set_price(sku, price)
    return ['item %s price %s' % (sku, format_money(price))]


def cmd_receive(state, args):
    _argc(args, 3)
    sku = _sku(args[0])
    quantity = _quantity(args[1])
    cost = parse_money(args[2])
    if cost is None:
        raise Refused('bad cost')
    _known_item(state, sku)
    state.stock.receive(sku, quantity, cost)
    return ['received %s %d' % (sku, quantity)] + _allocation_lines(state)


def cmd_customer(state, args):
    _argc(args, 2)
    if not valid_customer(args[0]):
        raise Refused('bad customer')
    percent = parse_percent(args[1])
    if percent is None:
        raise Refused('bad percent')
    if state.customers.has(args[0]):
        raise Refused('duplicate customer')
    state.customers.add(args[0], percent)
    return ['customer %s added' % args[0]]


def cmd_order(state, args):
    if len(args) < 4 or len(args) > 12 or len(args) % 2 == 1:
        raise Refused('bad arguments')
    order_id = _order_id(args[0])
    if state.book.has(order_id):
        raise Refused('duplicate order')
    customer = args[1]
    if not valid_customer(customer):
        raise Refused('bad customer')
    if not state.customers.has(customer):
        raise Refused('unknown customer')
    lines, seen = [], set()
    for sku_text, quantity_text in pairs(args[2:]):
        sku = _sku(sku_text)
        quantity = _quantity(quantity_text)
        _known_item(state, sku)
        if sku in seen:
            raise Refused('repeated item')
        seen.add(sku)
        lines.append((sku, quantity, state.catalog.price(sku)))
    order = Order(order_id, customer, state.customers.percent(customer), lines)
    state.book.add(order)
    if state.book.fits(order, state.stock):
        state.book.reserve(order)
    return ['order %s %s' % (order_id, order.state)]


def cmd_ship(state, args):
    _argc(args, 1)
    order = _known_order(state, _order_id(args[0]))
    if order.state != RESERVED:
        raise Refused('order not reserved')
    state.book.release(order)
    order.cost = sum(state.stock.take(sku, quantity) for sku, quantity, _ in order.lines)
    order.revenue = discounted(order.total(), order.percent)
    order.state = SHIPPED
    return ['order %s shipped revenue %s cost %s' % (
        order.id, format_money(order.revenue), format_money(order.cost))]


def cmd_cancel(state, args):
    _argc(args, 1)
    order = _known_order(state, _order_id(args[0]))
    if order.state in (SHIPPED, CANCELLED):
        raise Refused('order closed')
    if order.state == RESERVED:
        state.book.release(order)
    order.state = CANCELLED
    return ['order %s cancelled' % order.id] + _allocation_lines(state)


def cmd_writeoff(state, args):
    _argc(args, 2)
    sku = _sku(args[0])
    quantity = _quantity(args[1])
    _known_item(state, sku)
    if quantity > state.stock.on_hand(sku) - state.book.reserved(sku):
        raise Refused('not enough stock')
    cost = state.stock.take(sku, quantity)
    return ['wrote off %s %d cost %s' % (sku, quantity, format_money(cost))]


COMMANDS = {
    'CUSTOMER': cmd_customer,
    'ITEM': cmd_item,
    'PRICE': cmd_price,
    'RECEIVE': cmd_receive,
    'ORDER': cmd_order,
    'SHIP': cmd_ship,
    'CANCEL': cmd_cancel,
    'WRITEOFF': cmd_writeoff,
}


def execute(state, tokens):
    """Run one command; return (response lines, None) or (None, reason)."""
    handler = COMMANDS.get(tokens[0])
    if handler is None:
        return None, 'unknown command'
    try:
        return handler(state, tokens[1:]), None
    except Refused as refused:
        return None, refused.reason


def waiting_left(state):
    """Whether any order is still waiting."""
    return any(order.state == WAITING for order in state.book.orders)
