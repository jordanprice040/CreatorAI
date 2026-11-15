/** Synthetic Python checklist fixture only; no model reasoning or empirical validation. */
import type { SpecContent } from '@creator/contracts';
import { frozenCases } from './selection.js';
export const BUILD_FIXTURE_SPEC: SpecContent = {
  audience: 'Synthetic local checklist operator',
  problem_statement:
    'Exercise bounded task implementation and independent acceptance gates on synthetic data.',
  user_flows: [
    {
      key: 'F1',
      name: 'Print checklist',
      steps: ['Run with no arguments', 'Read four checklist steps'],
    },
    {
      key: 'F2',
      name: 'Invalid input',
      steps: ['Run with an unexpected argument', 'Read error and exit status'],
    },
  ],
  scope: ['Offline Python stdlib CLI checklist with deterministic output'],
  non_goals: [
    'Persistence',
    'Web UI',
    'Public release',
    'Real customer validation',
  ],
  data_contracts: [
    {
      name: 'checklist/1',
      description: 'Synthetic JSON template marker and four items',
      data_class: 'synthetic',
    },
  ],
  acceptance_checks: [
    {
      key: 'A1',
      flow: 'F1',
      statement: 'Print inspect, build, review, verify as JSON checklist/1',
      measure: 'Exact stdout and zero exit for no arguments',
      method: 'automated_test',
      cases: [
        {
          args: [],
          stdin: '',
          stdout:
            '{"template": "checklist/1", "items": ["inspect", "build", "review", "verify"]}\n',
          exit_code: 0,
          held_out: false,
        },
      ],
    },
    {
      key: 'A2',
      flow: 'F2',
      statement:
        'Reject an unexpected argument with invalid input and exit two',
      measure: 'Exact stdout invalid input followed by newline and exit code 2',
      method: 'automated_test',
      // Held out: QA runs it, but neither fixture role sees its expected output.
      cases: [
        {
          args: ['unexpected'],
          stdin: '',
          stdout: 'invalid input\n',
          exit_code: 2,
          held_out: true,
        },
      ],
    },
  ],
  risks: [
    {
      risk: 'Correlated fixture roles do not establish model quality',
      mitigation: 'Label synthetic results and execute independent assertions',
    },
  ],
  maintenance: {
    owner: 'Local owner',
    obligations: ['Retain exact candidate and logs'],
    review_interval: 'On change',
  },
  tasks: [
    {
      key: 'T1',
      title: 'Implement synthetic checklist',
      role: 'builder',
      file_scope: ['src'],
      depends_on: [],
      acceptance: ['A1', 'A2'],
      deliverable: 'Committed Python checklist and invalid-input behavior',
    },
  ],
};
/** Plan cases are the frozen cases without the held-out flag, which the spec keeps. */
const planCases = (spec: SpecContent) =>
  frozenCases(spec).map(({ held_out: _, ...c }) => c);
export const BUILD_FIXTURE_CASES = planCases(BUILD_FIXTURE_SPEC);
export const BUILD_FIXTURE_SOURCE =
  'import json\nimport sys\nif len(sys.argv) > 1:\n    print("invalid input")\n    sys.exit(2)\nprint(json.dumps({"template": "checklist/1", "items": ["inspect", "build", "review", "verify"]}))\n';
/** builder/2, or builder/1 for a frozen study build (ADR-0109); both get the one-part answer. */
const isBuilder = (system: string | undefined) =>
  !!system &&
  (system.startsWith('builder/2:') || system.startsWith('builder/1:'));
export function buildFixtureAnswer(
  input: { role: string; text: string }[],
): string | null {
  if (
    !isBuilder(input[0]?.text) &&
    !input[0]?.text.startsWith('independent-reviewer/2:')
  )
    return null;
  const packet = JSON.parse(input[1]!.text) as {
    format: string;
    acceptance?: { key: string }[];
    candidate: string;
    spec_hash: string;
    task_hash: string;
    files: { path: string; hash: string; content: string }[];
  };
  if (packet.format !== 'build-task/1') return null;
  const main = packet.files.find((f) => f.path === 'src/main.py');
  // The feedback revision adds A3; the fixture answers each spec version with its fixed source.
  const source = packet.acceptance?.some((a) => a.key === 'A3')
    ? BUILD_FIXTURE_REVISION_SOURCE
    : BUILD_FIXTURE_SOURCE;
  if (isBuilder(input[0]!.text))
    return JSON.stringify({
      summary:
        'FIXTURE: fixed synthetic checklist implementation; no model reasoning.',
      submission: {
        expected_commit: packet.candidate,
        changes: [
          {
            path: 'src/main.py',
            before_hash: main?.hash ?? null,
            content: source,
          },
        ],
      },
      blocker: null,
    });
  const findings =
    main?.content === source
      ? []
      : ['Synthetic candidate differs from the fixed reviewed fixture'];
  return JSON.stringify({
    candidate: packet.candidate,
    spec_hash: packet.spec_hash,
    task_hash: packet.task_hash,
    verdict: findings.length ? 'changes_requested' : 'approve',
    findings,
  });
}

/**
 * Synthetic owner feedback and the spec revision it leads to (T13). Fixed text, not a real
 * user's request: it exercises feedback-to-revision bookkeeping only.
 */
export const BUILD_FIXTURE_FEEDBACK =
  'Synthetic feedback: I want a plain list, one step per line, to paste into notes.';
export const BUILD_FIXTURE_REVISION_SPEC: SpecContent = {
  ...BUILD_FIXTURE_SPEC,
  user_flows: [
    ...BUILD_FIXTURE_SPEC.user_flows,
    {
      key: 'F3',
      name: 'Plain list',
      steps: ['Run with --plain', 'Read one checklist step per line'],
    },
  ],
  acceptance_checks: [
    ...BUILD_FIXTURE_SPEC.acceptance_checks,
    {
      key: 'A3',
      flow: 'F3',
      statement: 'Print the four steps one per line with --plain',
      measure: 'Exact stdout of four lines and zero exit for --plain',
      method: 'automated_test',
      cases: [
        {
          args: ['--plain'],
          stdin: '',
          stdout: 'inspect\nbuild\nreview\nverify\n',
          exit_code: 0,
          held_out: false,
        },
      ],
    },
  ],
  tasks: [
    {
      ...BUILD_FIXTURE_SPEC.tasks[0]!,
      acceptance: ['A1', 'A2', 'A3'],
      deliverable: 'Committed checklist with a --plain list mode',
    },
  ],
};
export const BUILD_FIXTURE_REVISION_CASES = planCases(
  BUILD_FIXTURE_REVISION_SPEC,
);
export const BUILD_FIXTURE_REVISION_SOURCE =
  'import json\nimport sys\nITEMS = ["inspect", "build", "review", "verify"]\nif sys.argv[1:] == ["--plain"]:\n    print("\\n".join(ITEMS))\n    sys.exit(0)\nif len(sys.argv) > 1:\n    print("invalid input")\n    sys.exit(2)\nprint(json.dumps({"template": "checklist/1", "items": ITEMS}))\n';
