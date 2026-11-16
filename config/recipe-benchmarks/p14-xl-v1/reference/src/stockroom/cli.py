"""Arguments, the run over the script and the exit status."""
from .catalog import new_catalog
from .commands import execute, waiting_left
from .customers import Customers
from .lots import new_stock
from .orders import OrderBook
from .report_json import render_json
from .report_text import render_text
from .script import script_lines


class State:
    """Everything a script changes."""

    def __init__(self):
        self.catalog = new_catalog()
        self.stock = new_stock()
        self.customers = Customers()
        self.book = OrderBook()


def parse_args(argv):
    """(format, quiet), or None for arguments the CLI does not accept."""
    fmt, quiet = None, False
    i = 0
    while i < len(argv):
        flag = argv[i]
        if flag == '--quiet':
            if quiet:
                return None
            quiet = True
            i += 1
        elif flag == '--format':
            if fmt is not None or i + 1 >= len(argv) or argv[i + 1] not in ('text', 'json'):
                return None
            fmt = argv[i + 1]
            i += 2
        else:
            return None
    return fmt or 'text', quiet


def run(argv, text, write):
    parsed = parse_args(argv)
    if parsed is None:
        write('invalid input\n')
        return 2
    fmt, quiet = parsed
    state = State()
    errors = 0
    for number, tokens in script_lines(text):
        lines, reason = execute(state, tokens)
        if reason is not None:
            errors += 1
            write('line %d: %s\n' % (number, reason))
        elif not quiet:
            for line in lines:
                write(line + '\n')
    for line in render_json(state) if fmt == 'json' else render_text(state):
        write(line + '\n')
    if errors:
        return 1
    return 3 if waiting_left(state) else 0
