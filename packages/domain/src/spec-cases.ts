import {
  pickHeldOut,
  readSpecDraft,
  specCaseProblems,
  SPEC_DRAFT_INSTRUCTIONS_VERSION,
  type BenchmarkCheck,
  type ObjectiveSignal,
} from '@creator/contracts';
import { canonicalHash } from './rules.js';

// ADR-0107 (B2): the programs behind the frozen `spec-cases-v1` benchmark. Each is a small
// command-line program the studio knows exactly (a reference) and a few known-broken versions
// of it (mutants, each with one plausible mistake). A drafted spec's cases are graded by
// running them against these programs in process: a good case set passes the reference and
// catches the broken versions. The programs are the studio's own code; a drafted case is only
// arguments and input text, so nothing the model wrote is ever executed.
//
// The programs are frozen with the benchmark: changing one changes what a qualification means,
// so a change needs a new benchmark version (spec-cases-v2) and new qualifications. Each case
// of spec-cases-v1 carries its program's fingerprint (specCasesFingerprint below); a changed
// program or grader no longer matches it, so the old benchmark stops grading and stops
// admitting drafts.

export type CaseRun = (
  args: readonly string[],
  stdin: string,
) => { stdout: string; exit_code: number };

export interface SpecBenchmarkProgram {
  title: string;
  affected_group: string;
  statement: string;
  option: { title: string; rationale: string; tradeoffs: string[] };
  run: CaseRun;
  mutants: Record<string, CaseRun>;
}

const out = (stdout: string, exit_code = 0) => ({ stdout, exit_code });
/** Lines split on \n; a final line without \n counts; the empty piece after a final \n does not. */
const inputLines = (s: string) => {
  if (!s) return [];
  const l = s.split('\n');
  if (l.at(-1) === '') l.pop();
  return l;
};
const OPTION = {
  title: 'A small command-line tool',
  rationale:
    'A single Python script the person runs in a terminal. It needs nothing else installed, and the rules below say exactly what it must print.',
  tradeoffs: ['Terminal only, no graphical interface'],
};

// ---- wordtally (development) --------------------------------------------------------------

const wordtally =
  (
    o: {
      words?: (s: string) => number;
      lines?: (s: string) => number;
      strict?: boolean;
    } = {},
  ): CaseRun =>
  (args, stdin) => {
    const strict = o.strict ?? true;
    const flag = args[0] === '--lines';
    if (strict && (args.length > 1 || (args.length === 1 && !flag)))
      return out('usage: wordtally [--lines]\n', 2);
    const words = (
      o.words ?? ((s) => s.split(/[ \t\r\n]+/).filter(Boolean).length)
    )(stdin);
    const lines = (o.lines ?? ((s) => s.split('\n').length - 1))(stdin);
    return out(`words: ${words}\n${flag ? `lines: ${lines}\n` : ''}`);
  };

// ---- slug (development) -------------------------------------------------------------------

const slug =
  (
    o: {
      lower?: boolean;
      collapse?: boolean;
      trim?: boolean;
      emptyOk?: boolean;
    } = {},
  ): CaseRun =>
  (args) => {
    if (args.length !== 1) return out('usage: slug TITLE\n', 2);
    let t = args[0]!;
    if (o.lower ?? true) t = t.replace(/[A-Z]/g, (c) => c.toLowerCase());
    t = t.replace((o.collapse ?? true) ? /[^a-z0-9]+/g : /[^a-z0-9]/g, '-');
    if (o.trim ?? true) t = t.replace(/^-+|-+$/g, '');
    if (!t && !o.emptyOk) return out('empty\n', 1);
    return out(`${t}\n`);
  };

// ---- roman (development) ------------------------------------------------------------------

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
const ADDITIVE = ROMAN.filter(([, s]) => s.length === 1);
const roman =
  (
    o: {
      additive?: boolean;
      max?: number;
      zero?: boolean;
      zeros?: boolean;
    } = {},
  ): CaseRun =>
  (args) => {
    if (args.length !== 1) return out('usage: roman N\n', 2);
    const a = args[0]!;
    const ok = /^[0-9]+$/.test(a) && ((o.zeros ?? true) ? true : !/^0/.test(a));
    const n = ok ? Number(a) : NaN;
    if (o.zero && n === 0) return out('\n');
    if (!ok || !(n >= 1 && n <= (o.max ?? 3999)))
      return out('out of range\n', 1);
    let r = '';
    let left = n;
    for (const [v, s] of o.additive ? ADDITIVE : ROMAN)
      while (left >= v) {
        r += s;
        left -= v;
      }
    return out(`${r}\n`);
  };

// ---- csvsum (held out) --------------------------------------------------------------------

const csvsum =
  (
    o: {
      negative?: boolean;
      blankOk?: boolean;
      offset?: number;
      missingZero?: boolean;
    } = {},
  ): CaseRun =>
  (args, stdin) => {
    if (args.length !== 1) return out('usage: csvsum COLUMN\n', 2);
    const lines = inputLines(stdin);
    const header = lines.length ? lines[0]!.split(',') : [];
    const col = header.indexOf(args[0]!);
    if (col < 0 && !o.missingZero) return out(`no column ${args[0]}\n`, 1);
    let sum = 0n;
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i]!;
      const n = i + 1 + (o.offset ?? 0);
      if (!l && (o.blankOk ?? true)) continue;
      if (col < 0) continue;
      const v = l.split(',')[col];
      const re = (o.negative ?? true) ? /^-?[0-9]+$/ : /^[0-9]+$/;
      if (v === undefined || !re.test(v))
        return out(`line ${n}: not a number\n`, 1);
      sum += BigInt(v);
    }
    return out(`${sum}\n`);
  };

// ---- dedupe (held out) --------------------------------------------------------------------

const dedupe =
  (
    o: {
      sorted?: boolean;
      lastSpelling?: boolean;
      dropOpen?: boolean;
      alwaysFold?: boolean;
    } = {},
  ): CaseRun =>
  (args, stdin) => {
    const flags = new Set(args);
    if (
      flags.size !== args.length ||
      args.some((a) => a !== '-i' && a !== '-c')
    )
      return out('usage: dedupe [-i] [-c]\n', 2);
    const fold = flags.has('-i') || !!o.alwaysFold;
    let lines = inputLines(stdin);
    if (o.dropOpen && stdin && !stdin.endsWith('\n'))
      lines = lines.slice(0, -1);
    const seen = new Map<string, { text: string; n: number }>();
    for (const l of lines) {
      const k = fold ? l.replace(/[A-Z]/g, (c) => c.toLowerCase()) : l;
      const prior = seen.get(k);
      if (prior) {
        prior.n += 1;
        if (o.lastSpelling) prior.text = l;
      } else seen.set(k, { text: l, n: 1 });
    }
    let rows = [...seen.values()];
    if (o.sorted)
      rows = rows.sort((a, b) =>
        a.text < b.text ? -1 : a.text > b.text ? 1 : 0,
      );
    return out(
      rows
        .map((r) => `${flags.has('-c') ? `${r.n} ` : ''}${r.text}\n`)
        .join(''),
    );
  };

// ---- rle (held out) -----------------------------------------------------------------------

const rle =
  (
    o: {
      ones?: boolean;
      splitNine?: boolean;
      digitsOk?: boolean;
      fold?: boolean;
    } = {},
  ): CaseRun =>
  (args) => {
    if (args.length !== 1) return out('usage: rle TEXT\n', 2);
    const chars = Array.from(args[0]!);
    if (!o.digitsOk && chars.some((c) => /[0-9]/.test(c)))
      return out('digits not allowed\n', 1);
    const same = (a: string, b: string) =>
      o.fold ? a.toLowerCase() === b.toLowerCase() : a === b;
    let r = '';
    for (let i = 0; i < chars.length;) {
      let j = i;
      while (j < chars.length && same(chars[j]!, chars[i]!)) j++;
      let n = j - i;
      const c = chars[i]!;
      const piece = (k: number) => (k === 1 && !o.ones ? c : `${k}${c}`);
      if (o.splitNine)
        while (n > 9) {
          r += piece(9);
          n -= 9;
        }
      r += piece(n);
      i = j;
    }
    return out(`${r}\n`);
  };

// ---- grade (held out) ---------------------------------------------------------------------

const grade =
  (
    o: {
      aAbove90?: boolean;
      noHundred?: boolean;
      blankInvalid?: boolean;
      noCount?: boolean;
    } = {},
  ): CaseRun =>
  (args, stdin) => {
    if (args.length) return out('usage: grade < scores\n', 2);
    let text = '';
    let count = 0;
    const lines = inputLines(stdin);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!.replace(/^[ \t]+|[ \t]+$/g, '');
      if (!l && !o.blankInvalid) continue;
      const v = /^[0-9]+$/.test(l) ? Number(l) : NaN;
      if (!(v <= (o.noHundred ? 99 : 100)))
        return out(`${text}line ${i + 1}: invalid\n`, 1);
      text += `${v > 90 || (!o.aAbove90 && v === 90) ? 'A' : v >= 80 ? 'B' : v >= 70 ? 'C' : v >= 60 ? 'D' : 'F'}\n`;
      count += 1;
    }
    return out(`${text}${o.noCount ? '' : `count: ${count}\n`}`);
  };

// ---- brackets (held out) ------------------------------------------------------------------

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const brackets =
  (
    o: {
      kindBlind?: boolean;
      zeroBased?: boolean;
      atOpener?: boolean;
      strictChars?: boolean;
    } = {},
  ): CaseRun =>
  (args) => {
    if (args.length !== 1) return out('usage: brackets TEXT\n', 2);
    const chars = Array.from(args[0]!);
    const stack: { c: string; at: number }[] = [];
    const bad = (at: number) =>
      out(`unbalanced at ${o.zeroBased ? at - 1 : at}\n`, 1);
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i]!;
      if ('([{'.includes(c)) stack.push({ c, at: i + 1 });
      else if (PAIRS[c]) {
        const top = stack.pop();
        if (!top || (!o.kindBlind && top.c !== PAIRS[c])) return bad(i + 1);
      } else if (o.strictChars) return bad(i + 1);
    }
    if (stack.length) return bad(o.atOpener ? stack[0]!.at : chars.length + 1);
    return out('ok\n');
  };

/** The benchmark's programs, by id. Frozen with spec-cases-v1. */
export const SPEC_BENCHMARK_PROGRAMS: Record<string, SpecBenchmarkProgram> = {
  wordtally: {
    title: 'Counting words in pasted text',
    affected_group: 'Volunteers who paste text into a terminal',
    statement:
      'Volunteers need a quick word count of text they paste. The tool reads all of standard input. A word is a maximal run of characters other than space, tab, carriage return and newline. It prints exactly "words: N" followed by a newline, where N is the number of words (0 for empty input). With the single argument --lines it also prints a second line "lines: L" followed by a newline, where L is the number of newline characters in the input. Any other argument, or more than one argument, makes it print exactly "usage: wordtally [--lines]" followed by a newline and exit with status 2. Otherwise it exits 0.',
    option: OPTION,
    run: wordtally(),
    mutants: {
      'wordtally/spaces-only': wordtally({
        words: (s) => s.split(/ +/).filter(Boolean).length,
      }),
      'wordtally/empty-is-one': wordtally({
        words: (s) => s.trim().split(/[ \t\r\n]+/).length,
      }),
      'wordtally/line-pieces': wordtally({
        lines: (s) => s.split('\n').length,
      }),
      'wordtally/ignores-arguments': wordtally({ strict: false }),
    },
  },
  slug: {
    title: 'Making URL slugs from post titles',
    affected_group: 'Bloggers who publish posts by hand',
    statement:
      'Bloggers want a URL slug made from a post title. The tool takes exactly one argument, the title, and does not read standard input. It changes the ASCII letters A to Z to lowercase, then replaces every run of characters that are not a to z or 0 to 9 with a single hyphen, and removes hyphens at the start and end. It prints the slug followed by a newline and exits 0. Letters outside ASCII, such as é, count as other characters. If the slug is empty (the title has no ASCII letters or digits), it prints exactly "empty" followed by a newline and exits 1. With no argument or more than one argument it prints exactly "usage: slug TITLE" followed by a newline and exits 2.',
    option: OPTION,
    run: slug(),
    mutants: {
      'slug/no-collapse': slug({ collapse: false }),
      'slug/no-trim': slug({ trim: false }),
      'slug/no-lowercase': slug({ lower: false }),
      'slug/empty-ok': slug({ emptyOk: true }),
    },
  },
  roman: {
    title: 'Checking Roman numeral homework',
    affected_group: 'Students practising Roman numerals',
    statement:
      'Students want to check their Roman numeral homework. The tool takes exactly one argument and does not read standard input. The argument is a whole number written with ASCII digits only: leading zeros are allowed (007 is 7) and there is no sign, space or decimal point. For a value from 1 to 3999 it prints the Roman numeral in standard form, uppercase, using the subtractive pairs IV, IX, XL, XC, CD and CM (so 4 is IV and 1994 is MCMXCIV), followed by a newline, and exits 0. For any other value, or an argument that is not only digits, it prints exactly "out of range" followed by a newline and exits 1. With no argument or more than one it prints exactly "usage: roman N" followed by a newline and exits 2.',
    option: OPTION,
    run: roman(),
    mutants: {
      'roman/additive': roman({ additive: true }),
      'roman/no-upper-bound': roman({ max: Number.MAX_SAFE_INTEGER }),
      'roman/zero-empty': roman({ zero: true }),
      'roman/no-leading-zeros': roman({ zeros: false }),
    },
  },
  csvsum: {
    title: 'Summing one column of a CSV export',
    affected_group: 'Club treasurers who export payments as CSV',
    statement:
      'A club treasurer sums one column of a CSV export. The tool takes exactly one argument, a column name. It reads standard input as lines split on newline characters; a final line without a newline still counts, and the empty piece after a final newline is not a line. The first line is the header: column names separated by commas, compared exactly. Every later line that is empty is skipped; every other later line holds values separated by commas. The value in the named column must be an integer: an optional minus sign followed by one or more ASCII digits, with no spaces. The tool prints the sum of those values followed by a newline and exits 0 (it prints 0 when there are no data lines). If the header has no such column, including when the input is empty, it prints exactly "no column NAME" with the argument in place of NAME, followed by a newline, and exits 1. If a data line has no value in that column or its value is not an integer, it prints exactly "line N: not a number", where N is that line\'s number counting the header as line 1, followed by a newline, and exits 1, stopping at the first such line. With no argument or more than one, it prints exactly "usage: csvsum COLUMN" followed by a newline and exits 2.',
    option: OPTION,
    run: csvsum(),
    mutants: {
      'csvsum/no-negative': csvsum({ negative: false }),
      'csvsum/blank-lines': csvsum({ blankOk: false }),
      'csvsum/line-offset': csvsum({ offset: -1 }),
      'csvsum/missing-is-zero': csvsum({ missingZero: true }),
    },
  },
  dedupe: {
    title: 'Removing repeated names from a list',
    affected_group: 'Teachers who paste class lists',
    statement:
      'A teacher removes repeated names from a pasted list. The tool reads standard input as lines split on newline characters; a final line without a newline still counts, and the empty piece after a final newline is not a line. It prints each distinct line once, in the order it first appears, each followed by a newline, and exits 0. Empty input prints nothing. Lines are compared exactly, including spaces. With the argument -i, lines are compared ignoring the case of ASCII letters, and the first spelling seen is printed. With the argument -c, each printed line starts with the number of times it appeared and one space, such as "2 Ann". Both -i and -c may be given, in either order, each at most once. Any other argument, or a repeated one, makes it print exactly "usage: dedupe [-i] [-c]" followed by a newline and exit 2.',
    option: OPTION,
    run: dedupe(),
    mutants: {
      'dedupe/sorted': dedupe({ sorted: true }),
      'dedupe/last-spelling': dedupe({ lastSpelling: true }),
      'dedupe/drops-unterminated': dedupe({ dropOpen: true }),
      'dedupe/always-ignores-case': dedupe({ alwaysFold: true }),
    },
  },
  rle: {
    title: 'Run-length encoding puzzle answers',
    affected_group: 'Puzzle site editors',
    statement:
      'A puzzle site writes answers in run-length encoding. The tool takes exactly one argument and does not read standard input; it treats the argument as a sequence of Unicode code points and compares them exactly (A and a differ). Each run of the same character becomes the run\'s length followed by the character, except that a run of length 1 is written as the character alone, so aaab becomes 3ab. A run longer than 9 is written with its full length, so twelve a characters become 12a. The tool prints the result followed by a newline and exits 0; an empty argument prints just a newline. If the argument contains an ASCII digit, it prints exactly "digits not allowed" followed by a newline and exits 1. With no argument or more than one, it prints exactly "usage: rle TEXT" followed by a newline and exits 2.',
    option: OPTION,
    run: rle(),
    mutants: {
      'rle/writes-ones': rle({ ones: true }),
      'rle/splits-at-nine': rle({ splitNine: true }),
      'rle/allows-digits': rle({ digitsOk: true }),
      'rle/ignores-case': rle({ fold: true }),
    },
  },
  grade: {
    title: 'Turning test scores into letter grades',
    affected_group: 'Tutors who mark tests by hand',
    statement:
      'A tutor turns test scores into letter grades. The tool reads standard input as lines split on newline characters; a final line without a newline still counts, and the empty piece after a final newline is not a line. Spaces and tabs at either end of a line are ignored, and a line that is then empty is skipped. Every other line must be a whole number from 0 to 100 written with ASCII digits only (leading zeros allowed). For each score, in order, it prints one letter followed by a newline: A for 90 to 100, B for 80 to 89, C for 70 to 79, D for 60 to 69 and F below 60. After the last line it prints "count: K" followed by a newline, where K is the number of scores, and exits 0 ("count: 0" when there are none). At the first line that is not a valid score, it prints exactly "line N: invalid" followed by a newline, where N counts every line from 1 including skipped ones, after the letters it already printed, and exits 1 without printing the count. The tool takes no arguments: any argument makes it print exactly "usage: grade < scores" followed by a newline and exit 2.',
    option: OPTION,
    run: grade(),
    mutants: {
      'grade/ninety-is-b': grade({ aAbove90: true }),
      'grade/rejects-hundred': grade({ noHundred: true }),
      'grade/blank-is-invalid': grade({ blankInvalid: true }),
      'grade/no-count': grade({ noCount: true }),
    },
  },
  brackets: {
    title: 'Checking brackets in formulas',
    affected_group: 'Students typing formulas',
    statement:
      'Students check that brackets in a formula balance. The tool takes exactly one argument and does not read standard input. It looks only at the characters ( ) [ ] { } and ignores every other character. Brackets must close in the reverse order they were opened, each with its matching kind. If they balance, it prints "ok" followed by a newline and exits 0. Otherwise it prints "unbalanced at N" followed by a newline and exits 1. N is the 1-based position, counting every Unicode code point of the argument, of the first closing bracket that does not match the most recent unclosed opening bracket or has no opening bracket left; when every closing bracket matched but some opening brackets were never closed, N is the length of the argument plus 1. With no argument or more than one, it prints exactly "usage: brackets TEXT" followed by a newline and exits 2.',
    option: OPTION,
    run: brackets(),
    mutants: {
      'brackets/any-kind': brackets({ kindBlind: true }),
      'brackets/zero-based': brackets({ zeroBased: true }),
      'brackets/points-at-opener': brackets({ atOpener: true }),
      'brackets/rejects-other-characters': brackets({ strictChars: true }),
    },
  },
};

/** A run of the studio's own program on one drafted case; never throws. */
function runCase(
  run: CaseRun,
  c: { args: string[]; stdin: string },
): { stdout: string; exit_code: number } | null {
  try {
    return run(c.args, c.stdin);
  } catch {
    return null;
  }
}

/** Why a spec-cases grade is what it is, in one sentence (F10 detail). */
export interface SpecCasesGrade {
  signal: ObjectiveSignal;
  detail: string | null;
  cases: number;
  caught: string[];
}

/**
 * Grades a drafted spec on a `spec_cases_contract` check (ADR-0107). The reply must read as a
 * spec draft; after a fixed held-out pick the studio's case checks must find no error; there
 * must be at least `min_cases` command-line cases; every case must pass the reference program;
 * and at least `min_caught` broken versions must fail at least one case.
 */
export function gradeSpecCases(
  check: SpecCasesCheck,
  text: string,
): SpecCasesGrade {
  if (check.fingerprint !== specCasesFingerprint(check.program))
    return {
      signal: 'acceptance_check_failed',
      detail:
        'This benchmark was frozen with other programs or grading; it needs a new version.',
      cases: 0,
      caught: [],
    };
  return gradeCases(check, text);
}

type SpecCasesCheck = Extract<BenchmarkCheck, { kind: 'spec_cases_contract' }>;

function gradeCases(check: SpecCasesCheck, text: string): SpecCasesGrade {
  const program = SPEC_BENCHMARK_PROGRAMS[check.program];
  const fail = (signal: ObjectiveSignal, detail: string, cases = 0) => ({
    signal,
    detail: detail.slice(0, 200),
    cases,
    caught: [],
  });
  if (!program) return fail('acceptance_check_failed', 'Unknown program.');
  const read = readSpecDraft(text, {
    owner: 'Benchmark',
    obligations: ['Check that the acceptance checks still pass'],
    review_interval: 'Every 3 months',
  });
  if (!read.ok) return fail('schema_invalid', read.reason);
  // A fixed pick, so the grade does not depend on chance.
  const picked = pickHeldOut(read.content, () => 0.5).content;
  const errors = specCaseProblems(picked).filter((p) => p.level === 'error');
  if (errors.length) return fail('acceptance_check_failed', errors[0]!.text);
  const cases = picked.acceptance_checks.flatMap((a) => a.cases ?? []);
  if (cases.length < check.min_cases)
    return fail(
      'acceptance_check_failed',
      `Only ${cases.length} command-line cases; ${check.min_cases} are needed.`,
      cases.length,
    );
  const passes = (run: CaseRun, c: (typeof cases)[number]) => {
    const r = runCase(run, c);
    return !!r && r.stdout === c.stdout && r.exit_code === c.exit_code;
  };
  const wrong = cases.findIndex((c) => !passes(program.run, c));
  if (wrong >= 0) {
    const c = cases[wrong]!;
    const r = runCase(program.run, c);
    return fail(
      'acceptance_check_failed',
      `Case ${wrong + 1} (${JSON.stringify(c.args)}) expects ${JSON.stringify(c.stdout)} exit ${c.exit_code}; the program gives ${JSON.stringify(r?.stdout ?? '')} exit ${r?.exit_code ?? '?'}.`,
      cases.length,
    );
  }
  const caught = check.mutants.filter((m) => {
    const run = program.mutants[m];
    return !!run && cases.some((c) => !passes(run, c));
  });
  if (caught.length < check.min_caught)
    return {
      signal: 'acceptance_check_failed',
      detail:
        `The cases caught ${caught.length} of ${check.mutants.length} broken programs; ${check.min_caught} are needed (missed: ${check.mutants
          .filter((m) => !caught.includes(m))
          .join(', ')}).`.slice(0, 200),
      cases: cases.length,
      caught,
    };
  return { signal: 'accepted', detail: null, cases: cases.length, caught };
}

type ProbeInput = { args: string[]; stdin: string };

/**
 * Probe inputs per program, in acceptance-check groups. Run through the reference they make a
 * case set that catches every broken version (the tests check it); the fingerprint also runs
 * them through every broken version.
 */
export const SPEC_CASES_PROBES: Record<string, ProbeInput[][]> = {
  wordtally: [
    [
      { args: [], stdin: 'one two\tthree\n' },
      { args: [], stdin: '' },
      { args: ['--lines'], stdin: 'a\nb\n' },
    ],
    [
      { args: ['-x'], stdin: '' },
      { args: ['--lines', '--lines'], stdin: '' },
    ],
  ],
  slug: [
    [
      { args: ['Hello,  World!'], stdin: '' },
      { args: ['--Hi--'], stdin: '' },
      { args: ['ABC 123'], stdin: '' },
    ],
    [
      { args: ['!!!'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
  roman: [
    [
      { args: ['4'], stdin: '' },
      { args: ['1994'], stdin: '' },
      { args: ['007'], stdin: '' },
    ],
    [
      { args: ['4000'], stdin: '' },
      { args: ['0'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
  csvsum: [
    [
      { args: ['b'], stdin: 'a,b\n1,-2\n\n3,4\n' },
      { args: ['a'], stdin: 'a\nx\n' },
      { args: ['b'], stdin: 'a,b\n1\n' },
    ],
    [
      { args: ['z'], stdin: 'a,b\n' },
      { args: [], stdin: '' },
    ],
  ],
  dedupe: [
    [
      { args: [], stdin: 'b\na\nb\n' },
      { args: ['-i'], stdin: 'Ann\nann\n' },
      { args: [], stdin: 'x\ny' },
    ],
    [
      { args: [], stdin: 'Ann\nann\n' },
      { args: ['-c'], stdin: 'a\na\n' },
      { args: ['-z'], stdin: '' },
    ],
  ],
  rle: [
    [
      { args: ['abc'], stdin: '' },
      { args: ['aaaaaaaaaaaa'], stdin: '' },
    ],
    [
      { args: ['a1'], stdin: '' },
      { args: ['aA'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
  grade: [
    [
      { args: [], stdin: '90\n' },
      { args: [], stdin: '100\n' },
      { args: [], stdin: '80\n\n70\n' },
    ],
    [
      { args: [], stdin: '50\n' },
      { args: [], stdin: 'abc\n' },
      { args: ['x'], stdin: '' },
    ],
  ],
  brackets: [
    [
      { args: ['(]'], stdin: '' },
      { args: ['a)'], stdin: '' },
      { args: ['(('], stdin: '' },
    ],
    [
      { args: ['f(x)'], stdin: '' },
      { args: ['{[()]}'], stdin: '' },
      { args: [], stdin: '' },
    ],
  ],
};

/** A whole draft_spec reply whose cases are `groups`, with outputs from `run`. */
export function specCasesProbeReply(groups: ProbeInput[][], run: CaseRun) {
  return JSON.stringify({
    title: 'Drafted tool',
    notes: 'Assumed ASCII input.',
    spec: {
      audience: 'Volunteers',
      problem_statement: 'They need the tool.',
      user_flows: [{ key: 'F1', name: 'Run it', steps: ['Run the tool'] }],
      scope: ['Exactly the rules in the request'],
      non_goals: ['A graphical interface'],
      acceptance_checks: groups.map((g, i) => ({
        key: `A${i + 1}`,
        flow: 'F1',
        statement: `Behaviour ${i + 1}`,
        measure: 'Exact output and exit code',
        method: 'automated_test',
        cases: g.map((x) => ({ ...x, ...run(x.args, x.stdin) })),
      })),
      risks: [],
      tasks: [
        {
          key: 'T1',
          title: 'Write the tool',
          role: 'builder',
          file_scope: ['src'],
          depends_on: [],
          acceptance: groups.map((_, i) => `A${i + 1}`),
          deliverable: 'src/main.py',
        },
      ],
    },
  });
}

/** Inputs every program also runs for the fingerprint: empty, unknown flags, odd input. */
const COMMON_PROBES: ProbeInput[] = [
  { args: [], stdin: '' },
  { args: ['--help'], stdin: '' },
  { args: ['a', 'b'], stdin: 'x y\n\nz' },
  { args: ['-'], stdin: '1\n2\n' },
  { args: [''], stdin: '\n' },
];

/** Bump with any change to how drafted cases are read, checked, picked or graded. */
export const SPEC_CASES_GRADER_VERSION = 'spec-cases-grader/1' as const;

const fingerprints = new Map<string, string | null>();

/**
 * The frozen behaviour behind one spec-cases-v1 program (review 1 of PR #206, L-2): its
 * request text, the outputs of the reference and every broken version on the probe inputs,
 * the studio's held-out pick of a probe reply, and the grades of fixed probe replies (good,
 * too few, one wrong output, a broken version's outputs, unreadable). Null for an unknown
 * program. Computed once per process.
 */
export function specCasesFingerprint(program: string): string | null {
  if (fingerprints.has(program)) return fingerprints.get(program)!;
  const p = SPEC_BENCHMARK_PROGRAMS[program];
  const groups = SPEC_CASES_PROBES[program];
  let value: string | null = null;
  if (p && groups) {
    const inputs = [...groups.flat(), ...COMMON_PROBES];
    const runs = Object.fromEntries(
      [
        ['reference', p.run] as const,
        ...Object.keys(p.mutants)
          .sort()
          .map((m) => [m, p.mutants[m]!] as const),
      ].map(([name, run]) => [name, inputs.map((c) => runCase(run, c))]),
    );
    const mutants = Object.keys(p.mutants).sort();
    const check: SpecCasesCheck = {
      kind: 'spec_cases_contract',
      role_version: SPEC_DRAFT_INSTRUCTIONS_VERSION,
      program,
      request: {
        problem: {
          title: p.title,
          statement: p.statement,
          affected_group: p.affected_group,
        },
        option: p.option,
      },
      mutants,
      min_cases: 4,
      min_caught: mutants.length - 1,
      fingerprint: '0'.repeat(64),
    };
    const good = specCasesProbeReply(groups, p.run);
    const wrong = JSON.parse(good) as {
      spec: { acceptance_checks: { cases: { stdout: string }[] }[] };
    };
    wrong.spec.acceptance_checks[0]!.cases[0]!.stdout += 'x';
    const read = readSpecDraft(good, {
      owner: 'Benchmark',
      obligations: ['Check that the acceptance checks still pass'],
      review_interval: 'Every 3 months',
    });
    const graded = (text: string) => {
      const g = gradeCases(check, text);
      return { signal: g.signal, cases: g.cases, caught: g.caught };
    };
    value = canonicalHash({
      grader: SPEC_CASES_GRADER_VERSION,
      program,
      request: check.request,
      runs,
      picked: read.ok
        ? pickHeldOut(read.content, () => 0.5).content.acceptance_checks.map(
            (a) => (a.cases ?? []).map((c) => !!c.held_out),
          )
        : null,
      grades: {
        good: graded(good),
        few: graded(specCasesProbeReply([groups[0]!.slice(0, 3)], p.run)),
        wrong: graded(JSON.stringify(wrong)),
        broken: graded(specCasesProbeReply(groups, p.mutants[mutants[0]!]!)),
        unreadable: graded('No.'),
      },
    });
  }
  fingerprints.set(program, value);
  return value;
}
