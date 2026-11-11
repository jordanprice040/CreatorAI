# Requirements — Word tally (synthetic)

Spec 00000000-0000-4000-8000-000000000001, version 3, frozen on 2026-11-11 (freeze 00000000). Content hash `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`.

These requirements are fixed. Do not change them; report a requirement that looks wrong.

## Who it is for

Writers who want a quick count from the command line (synthetic).

## Problem

```text
Writers paste text into web pages to count words, which is slow and sends drafts to a third party.
A local command would count without the text leaving the computer.
```

## User flows

### F1 — Count words

1. Pipe text into the command
2. Read the number it prints

### F2 — Count lines

1. Pipe text into the command with --lines
2. Read the number

## In scope

- Count whitespace-separated words read from standard input
- Count non-empty lines with the --lines option
- Refuse an unknown option with exit code 2 and no output

## Not in scope

Do not build these, even if they seem helpful.

- No reading from files or folders
- No network access
- No character or byte counts

## Data

- **standard input** (synthetic data): UTF-8 text typed or piped by the user; made-up in tests.

## Acceptance checks

Each check has a key (A1, A2, ...). A check passes only when it is run and observed to pass.
What a case expects is exact. Where it differs from the general measure of its check (a refusal case, for example), the case governs; report the mismatch, do not change either.

### A1 — The number of whitespace-separated words is printed.

- Method: automated test
- What is measured: Standard output is the count and a line end; exit code 0. An unknown option gives no output and exit code 2.
- Flow: F1
- 1 more case for this check is held by the owner and not shown here.

Case 1: arguments `[]`, expected exit code 0.

Standard input:

```text
one two three
```

Expected standard output (exact):

```text
3
```

Case 2: arguments `[]`, expected exit code 0.

Expected standard output (exact):

```text
0
```

Case 3: arguments `["--bogus"]`, expected exit code 2.

Standard input:

```text
one two
```

Expected standard output: empty.

### A2 — With --lines, the number of non-empty lines is printed.

- Method: automated test
- What is measured: Standard output is the count and a line end; exit code 0.
- Flow: F2
- 1 more case for this check is held by the owner and not shown here.

Case 1: arguments `["--lines"]`, expected exit code 0.

Standard input:

```text
a b

c
```

Expected standard output (exact):

```text
2
```

### A3 — The program does nothing the scope does not list.

- Method: manual review
- What is measured: A reviewer reads the source and finds no reading or writing of files and no network use. Finding the program’s own folder to import its modules does not count as file use.

No executable case: a person judges this check against the statement and measure above.

## Risks

- Counts differ from a writer’s word processor — mitigation: The README states how words are counted and how lines are counted, in one sentence each.

## Maintenance

- Owner: The writer who installed it (synthetic)
- Review interval: Yearly
- Re-run the checks after any change
