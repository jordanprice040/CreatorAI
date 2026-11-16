"""Text and JSON reports."""
import json


def money(cents):
    sign = '-' if cents < 0 else ''
    cents = abs(cents)
    return '%s%d.%02d' % (sign, cents // 100, cents % 100)


def render_text(lines):
    out = []
    for name, total, cap, status in lines:
        if cap is None:
            out.append('%s %s' % (name, money(total)))
        else:
            out.append('%s %s / %s %s' % (name, money(total), money(cap), status))
    out.append('total %s' % money(sum(line[1] for line in lines)))
    return '\n'.join(out) + '\n'


def render_json(lines):
    body = {
        'categories': [
            {'name': n, 'total': money(t), 'cap': None if c is None else money(c), 'status': s}
            for n, t, c, s in lines
        ],
        'total': money(sum(line[1] for line in lines)),
    }
    return json.dumps(body, sort_keys=True) + '\n'
