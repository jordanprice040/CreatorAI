"""Arguments, the run and its exit status."""
from loans.desk import Desk
from loans.report import json_report, text_report
from loans.script import Malformed, parse_script


def run(argv, text, out):
    if argv not in ([], ['--json']):
        out.write('invalid arguments\n')
        return 2
    try:
        commands = parse_script(text)
    except Malformed as e:
        out.write('error: line %d: malformed\n' % e.line)
        return 1
    desk = Desk()
    refused = []
    for number, command in commands:
        reason = desk.apply(command)
        if reason is not None:
            refused.append((number, reason))
    out.write(json_report(desk, refused) if argv else text_report(desk, refused))
    return 0
