import type { SpecContent } from '@creator/contracts';
import type { SoftwareRunbookInput } from './runbook.js';

// ADR-0080 (P16): one synthetic project for the runbook export's tests and for the committed
// example bundle that an independent implementer consumes. Everything here is made up.

/** A small command-line program with a dependent task, a held-out case per check and a review. */
export const RUNBOOK_FIXTURE_SPEC: SpecContent = {
  audience: 'Writers who want a quick count from the command line (synthetic).',
  problem_statement:
    'Writers paste text into web pages to count words, which is slow and sends drafts to a third party.\nA local command would count without the text leaving the computer.',
  user_flows: [
    {
      key: 'F1',
      name: 'Count words',
      steps: ['Pipe text into the command', 'Read the number it prints'],
    },
    {
      key: 'F2',
      name: 'Count lines',
      steps: ['Pipe text into the command with --lines', 'Read the number'],
    },
  ],
  scope: [
    'Count whitespace-separated words read from standard input',
    'Count non-empty lines with the --lines option',
    'Refuse an unknown option with exit code 2 and no output',
  ],
  non_goals: [
    'No reading from files or folders',
    'No network access',
    'No character or byte counts',
  ],
  data_contracts: [
    {
      name: 'standard input',
      description: 'UTF-8 text typed or piped by the user; made-up in tests.',
      data_class: 'synthetic',
    },
  ],
  acceptance_checks: [
    {
      key: 'A1',
      flow: 'F1',
      statement: 'The number of whitespace-separated words is printed.',
      measure:
        'Standard output is the count and a line end; exit code 0. An unknown option gives no output and exit code 2.',
      method: 'automated_test',
      cases: [
        {
          args: [],
          stdin: 'one two three\n',
          stdout: '3\n',
          exit_code: 0,
          held_out: false,
        },
        { args: [], stdin: '', stdout: '0\n', exit_code: 0, held_out: false },
        {
          args: ['--bogus'],
          stdin: 'one two\n',
          stdout: '',
          exit_code: 2,
          held_out: false,
        },
        {
          args: [],
          stdin: '  alpha\tbeta\n\ngamma  \n',
          stdout: '3\n',
          exit_code: 0,
          held_out: true,
        },
      ],
    },
    {
      key: 'A2',
      flow: 'F2',
      statement: 'With --lines, the number of non-empty lines is printed.',
      measure: 'Standard output is the count and a line end; exit code 0.',
      method: 'automated_test',
      cases: [
        {
          args: ['--lines'],
          stdin: 'a b\n\nc\n',
          stdout: '2\n',
          exit_code: 0,
          held_out: false,
        },
        {
          args: ['--lines'],
          stdin: 'only-held-out-line-zq7',
          stdout: '1\n',
          exit_code: 0,
          held_out: true,
        },
      ],
    },
    {
      key: 'A3',
      flow: null,
      statement: 'The program does nothing the scope does not list.',
      measure:
        'A reviewer reads the source and finds no reading or writing of files and no network use. Finding the program’s own folder to import its modules does not count as file use.',
      method: 'manual_review',
    },
  ],
  risks: [
    {
      risk: 'Counts differ from a writer’s word processor',
      mitigation:
        'The README states how words are counted and how lines are counted, in one sentence each.',
    },
  ],
  maintenance: {
    owner: 'The writer who installed it (synthetic)',
    obligations: ['Re-run the checks after any change'],
    review_interval: 'Yearly',
  },
  tasks: [
    {
      key: 'T1',
      title: 'Count words from standard input',
      role: 'builder',
      file_scope: ['src/main.py', 'src/tally.py'],
      depends_on: [],
      acceptance: ['A1'],
      deliverable:
        'src/main.py prints the word count and refuses unknown options.',
    },
    {
      key: 'T3',
      title: 'Review against the scope',
      role: 'reviewer',
      file_scope: ['review'],
      depends_on: ['T1', 'T2'],
      acceptance: ['A3'],
      deliverable: 'A written review of the source against the scope.',
    },
    {
      key: 'T2',
      title: 'Add the --lines option',
      role: 'builder',
      file_scope: ['src'],
      depends_on: ['T1'],
      acceptance: ['A2'],
      deliverable: 'src/main.py accepts --lines and prints the line count.',
    },
  ],
};

const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HASH = (c: string) => c.repeat(64);

/** The whole input of the synthetic software runbook, with fixed ids, dates and hashes. */
export const RUNBOOK_FIXTURE_INPUT: SoftwareRunbookInput = {
  spec: {
    id: ID(1),
    version: 2,
    title: 'Word tally (synthetic)',
    content_hash: HASH('a'),
    saved_at: '2026-11-10T08:00:00.000Z',
    content: RUNBOOK_FIXTURE_SPEC,
  },
  freeze: {
    id: ID(2),
    frozen_at: '2026-11-10T08:05:00.000Z',
    content_hash: HASH('a'),
  },
  latest_frozen_version: 2,
  problem: {
    id: ID(3),
    version: 1,
    title: 'Counting words means pasting drafts into web pages',
    statement:
      'Writers paste unpublished drafts into web word counters several times a day.',
    affected_group: 'Writers working on unpublished drafts (synthetic).',
  },
  option: {
    id: ID(4),
    version: 1,
    kind: 'build',
    title: 'A local word-count command',
    rationale:
      'A small local tool removes the paste step and keeps drafts private.',
    tradeoffs: ['Writers must open a terminal'],
    uncertainty: 'Whether writers will use a terminal at all is not known.',
    current_version: 1,
  },
  selection: {
    id: ID(5),
    created_at: '2026-11-10T07:30:00.000Z',
    current: true,
    rationale: 'Build the small local tool (synthetic selection).',
    disposition: 'select_for_build',
    reasons: ['Highest suitability among the options scored'],
    reverse_if: 'Writers say they will not use a terminal.',
  },
  humility: {
    id: ID(6),
    version: 1,
    subject_version: 2,
    disposition: 'build',
    software_part: 'Counting words and lines.',
    human_part: 'Deciding what the count means for the draft.',
    burden_risks: ['One more tool to keep installed'],
    disconfirming_test:
      'Three writers try it for a week and go back to the web page.',
    change_course_trigger: 'The writing app gains a built-in private counter.',
    rationale: 'Small, local and reversible (synthetic review).',
    ethical_status: 'none_identified',
    ethical_note: '',
    dissent: [],
    build_admissible: true,
    needs_judgment: false,
    gate_reasons: [],
  },
  references: [
    {
      label: 'R1',
      claim: { id: ID(7), version: 1 },
      current_version: 1,
      statement:
        'Writers in the sample pasted drafts into a web counter daily.',
      relation: 'supports',
      status: 'supported',
      sources: [
        {
          title: 'Synthetic interview notes',
          url: 'https://example.org/notes',
          stance: 'supports',
          freshness: 'current',
          quote: 'I paste it into a counter page maybe five times a day.',
        },
      ],
    },
    {
      label: 'R2',
      claim: { id: ID(8), version: 1 },
      current_version: 1,
      statement: 'Most writing apps already show a word count.',
      relation: 'contradicts',
      status: 'contested',
      sources: [],
    },
  ],
  references_omitted: 0,
};
