"""Targets in business minutes."""
PRIORITIES = ('p1', 'p2', 'p3')
RESPONSE = {'p1': 60, 'p2': 240, 'p3': 480}
RESOLUTION = {'p1': 480, 'p2': 1440, 'p3': 2880}


def most_urgent(priorities):
    return min(priorities)


def status(elapsed, target, done):
    if elapsed > target:
        return 'breached'
    return 'met' if done else 'pending'
