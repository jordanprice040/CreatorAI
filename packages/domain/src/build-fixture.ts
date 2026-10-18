/** Synthetic Python checklist fixture only; no model reasoning or empirical validation. */
import type { SpecContent } from '@creator/contracts';
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
    },
    {
      key: 'A2',
      flow: 'F2',
      statement:
        'Reject an unexpected argument with invalid input and exit two',
      measure: 'Exact stdout invalid input followed by newline and exit code 2',
      method: 'automated_test',
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
export const BUILD_FIXTURE_CASES = [
  {
    check_key: 'A1',
    args: [],
    stdin: '',
    stdout:
      '{"template": "checklist/1", "items": ["inspect", "build", "review", "verify"]}\n',
    exit_code: 0,
  },
  {
    check_key: 'A2',
    args: ['unexpected'],
    stdin: '',
    stdout: 'invalid input\n',
    exit_code: 2,
  },
];
export const BUILD_FIXTURE_SOURCE =
  'import json\nimport sys\nif len(sys.argv) > 1:\n    print("invalid input")\n    sys.exit(2)\nprint(json.dumps({"template": "checklist/1", "items": ["inspect", "build", "review", "verify"]}))\n';
export function buildFixtureAnswer(
  input: { role: string; text: string }[],
): string | null {
  if (
    !input[0]?.text.startsWith('builder/1:') &&
    !input[0]?.text.startsWith('independent-reviewer/1:')
  )
    return null;
  const packet = JSON.parse(input[1]!.text) as {
    format: string;
    candidate: string;
    spec_hash: string;
    task_hash: string;
    files: { path: string; hash: string; content: string }[];
  };
  if (packet.format !== 'build-task/1') return null;
  const main = packet.files.find((f) => f.path === 'src/main.py');
  if (input[0]!.text.startsWith('builder/1:'))
    return JSON.stringify({
      summary:
        'FIXTURE: fixed synthetic checklist implementation; no model reasoning.',
      submission: {
        expected_commit: packet.candidate,
        changes: [
          {
            path: 'src/main.py',
            before_hash: main?.hash ?? null,
            content: BUILD_FIXTURE_SOURCE,
          },
        ],
      },
      blocker: null,
    });
  const findings =
    main?.content === BUILD_FIXTURE_SOURCE
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
