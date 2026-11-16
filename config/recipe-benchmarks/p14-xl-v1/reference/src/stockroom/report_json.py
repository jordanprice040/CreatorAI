"""The JSON report printed after the script with --format json."""
import json

from .customers import customer_summary
from .money import format_money
from .report_text import shipped_totals


def report_data(state):
    revenue, cost = shipped_totals(state.book)
    customers = []
    for name in state.customers.names():
        placed, shipped, spent = customer_summary(name, state.book.orders)
        customers.append({
            'name': name,
            'orders': placed,
            'shipped': shipped,
            'spent': format_money(spent),
        })
    return {
        'customers': customers,
        'items': [
            {
                'sku': sku,
                'price': format_money(state.catalog.price(sku)),
                'on_hand': state.stock.on_hand(sku),
                'reserved': state.book.reserved(sku),
                'value': format_money(state.stock.value(sku)),
            }
            for sku in state.catalog.skus()
        ],
        'orders': [
            {
                'id': order.id,
                'customer': order.customer,
                'state': order.state,
                'revenue': None if order.revenue is None else format_money(order.revenue),
            }
            for order in state.book.orders
        ],
        'revenue': format_money(revenue),
        'cost': format_money(cost),
        'profit': format_money(revenue - cost),
    }


def render_json(state):
    return [json.dumps(report_data(state), sort_keys=True)]
