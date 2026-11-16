"""Field rules for skus, order ids and quantities."""
import re

_SKU = re.compile(r'[A-Z][A-Z0-9-]{0,11}')
_ORDER_ID = re.compile(r'[a-z][a-z0-9]{0,9}')
_QUANTITY = re.compile(r'[1-9][0-9]{0,5}')
MAX_QUANTITY = 100000


def valid_sku(text):
    """1 to 12 of A-Z, 0-9 or hyphen, starting with A-Z."""
    return _SKU.fullmatch(text) is not None


def valid_order_id(text):
    """1 to 10 of a-z or 0-9, starting with a-z."""
    return _ORDER_ID.fullmatch(text) is not None


def parse_quantity(text):
    """A whole number from 1 to 100000 with no leading zero, or None."""
    if not _QUANTITY.fullmatch(text):
        return None
    value = int(text)
    if value > MAX_QUANTITY:
        return None
    return value
