"""Totals per category and cap rules."""


def totals(rows):
    out = {}
    for _, category, cents in rows:
        out[category] = out.get(category, 0) + cents
    return out


def apply_caps(by_category, caps):
    """Return sorted (name, total, cap or None, status or None); capped absent categories are 0."""
    names = sorted(set(by_category) | set(caps))
    lines = []
    for name in names:
        total = by_category.get(name, 0)
        cap = caps.get(name)
        status = None if cap is None else ('over' if total > cap else 'ok')
        lines.append((name, total, cap, status))
    return lines
