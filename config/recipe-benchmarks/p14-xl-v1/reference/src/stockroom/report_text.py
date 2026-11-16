"""The text report printed after the script."""
from .customers import customer_summary
from .money import format_money


def shipped_totals(book):
    """Revenue and cost summed over shipped orders."""
    shipped = [order for order in book.orders if order.revenue is not None]
    return sum(o.revenue for o in shipped), sum(o.cost for o in shipped)


def render_text(state):
    lines = ['== report ==']
    for sku in state.catalog.skus():
        lines.append('item %s price %s on_hand %d reserved %d value %s' % (
            sku,
            format_money(state.catalog.price(sku)),
            state.stock.on_hand(sku),
            state.book.reserved(sku),
            format_money(state.stock.value(sku)),
        ))
    for order in state.book.orders:
        lines.append('order %s %s %s' % (order.id, order.customer, order.state))
    for name in state.customers.names():
        placed, shipped, spent = customer_summary(name, state.book.orders)
        lines.append('customer %s orders %d shipped %d spent %s' % (
            name, placed, shipped, format_money(spent)))
    revenue, cost = shipped_totals(state.book)
    lines.append('totals revenue %s cost %s profit %s' % (
        format_money(revenue), format_money(cost), format_money(revenue - cost)))
    return lines
