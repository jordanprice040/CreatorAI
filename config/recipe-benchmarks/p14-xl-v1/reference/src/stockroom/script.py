"""Reading the command script on stdin into numbered token lists."""


def script_lines(text):
    """Yield (line number, tokens) for every line that holds a command.

    Lines are split on newline and numbered from 1, counting every line. One trailing carriage
    return is removed. A line with no tokens, or whose first token starts with #, is skipped.
    """
    for number, line in enumerate(text.split('\n'), start=1):
        if line.endswith('\r'):
            line = line[:-1]
        tokens = line.split()
        if not tokens or tokens[0].startswith('#'):
            continue
        yield number, tokens


def pairs(tokens):
    """Group a flat token list into (first, second) pairs; the caller checks the length."""
    return [(tokens[i], tokens[i + 1]) for i in range(0, len(tokens) - 1, 2)]
