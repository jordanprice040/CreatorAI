import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEnv, runCapabilityCheck } from '@creator/api';
import {
  assessmentRoleInput,
  checkedTeamProfile,
  packetTeam,
  readCapabilityCheck,
  savedTeamProfile,
  EMPTY_TEAM_PROFILE,
} from '@creator/domain';

// ADR-0090: the team profile's pure rules and the built-in checks, without a database.

const check = {
  command: 'java -version',
  detail: 'Java 21.0.2',
  output_hash: 'a'.repeat(64),
  machine: 'JORDAN-PC',
  checked_at: '2026-11-11T23:00:00.000Z',
};

test('a check passes only on exit 0 with a version printed; a Windows Python alias stub does not pass', () => {
  assert.deepEqual(
    readCapabilityCheck('python', { exit_code: 0, output: 'Python 3.12.1\n' }),
    { passed: true, detail: 'Python 3.12.1' },
  );
  // The Microsoft Store alias prints a message and exits 9009.
  assert.deepEqual(
    readCapabilityCheck('python', {
      exit_code: 9009,
      output:
        'Python was not found; run without arguments to install from the Microsoft Store',
    }),
    { passed: false },
  );
  assert.deepEqual(
    readCapabilityCheck('python', { exit_code: 0, output: 'something else' }),
    { passed: false },
  );
  assert.deepEqual(
    readCapabilityCheck('java', {
      exit_code: 0,
      output: 'openjdk version "21.0.2" 2024-01-16\n',
    }),
    { passed: true, detail: 'Java 21.0.2' },
  );
  // A capability with no built-in check never passes one.
  assert.deepEqual(
    readCapabilityCheck('installs_allowed', { exit_code: 0, output: 'x' }),
    { passed: false },
  );
});

test('a check tries its fixed programs in order, with a bare environment and nothing else', async () => {
  const calls: string[][] = [];
  const ran = await runCapabilityCheck(
    'python',
    async (file, args) => {
      calls.push([file, ...args]);
      return file === 'python3'
        ? { exit_code: 0, output: 'Python 3.11.9' }
        : { exit_code: 9009, output: 'not found' };
    },
    () => new Date('2026-11-11T23:00:00.000Z'),
  );
  assert.deepEqual(calls, [
    ['python', '--version'],
    ['python3', '--version'],
  ]);
  assert.ok(ran.passed);
  if (ran.passed) {
    assert.equal(ran.check.detail, 'Python 3.11.9');
    assert.equal(ran.check.command, 'python3 --version');
    assert.equal(ran.check.checked_at, '2026-11-11T23:00:00.000Z');
    assert.match(ran.check.output_hash, /^[a-f0-9]{64}$/);
  }
  const missing = await runCapabilityCheck('docker', async () => ({
    exit_code: null,
    output: '',
  }));
  assert.equal(missing.passed, false);
  if (!missing.passed) assert.match(missing.detail, /Docker was not found/);
  // The studio's credentials and settings never reach a checked program.
  const env = checkEnv({
    PATH: '/usr/bin',
    HOME: '/home/x',
    CREATOR_DATABASE_URL: 'postgres://secret',
    CREATOR_SESSION_SECRET: 'secret',
    OPENAI_API_KEY: 'sk-secret',
  });
  assert.deepEqual(env, { PATH: '/usr/bin', HOME: '/home/x' });
});

test('saving keeps a passing check while the answer stays yes; changing the answer makes it declared', () => {
  const checked = checkedTeamProfile(EMPTY_TEAM_PROFILE, 'java', check);
  assert.equal(checked.capabilities[0]!.basis, 'check');
  const kept = savedTeamProfile(checked, {
    capabilities: [
      { key: 'java', status: 'yes', note: 'Lab machines too' },
      { key: 'pip', status: 'unknown', note: null },
      { key: 'python', status: 'yes' },
    ],
    notes: ' Data never leaves the lab. ',
  });
  // Ordered as the catalogue lists them; an unknown without a note is dropped.
  assert.deepEqual(
    kept.capabilities.map((c) => [c.key, c.basis, c.status]),
    [
      ['python', 'declared', 'yes'],
      ['java', 'check', 'yes'],
    ],
  );
  assert.equal(kept.capabilities[1]!.note, 'Lab machines too');
  assert.equal(kept.notes, 'Data never leaves the lab.');
  const changed = savedTeamProfile(kept, {
    capabilities: [{ key: 'java', status: 'no', note: null }],
    notes: '',
  });
  assert.deepEqual(changed.capabilities[0], {
    key: 'java',
    status: 'no',
    basis: 'declared',
    note: null,
    check: null,
  });
});

test('the packet says how each answer is known without naming the computer, and the assessor is told to use it', () => {
  const profile = savedTeamProfile(
    checkedTeamProfile(EMPTY_TEAM_PROFILE, 'java', check),
    {
      capabilities: [
        { key: 'java', status: 'yes' },
        { key: 'installs_allowed', status: 'yes' },
      ],
      notes: 'Small team.',
    },
  );
  assert.equal(packetTeam(profile, 0), undefined);
  const team = packetTeam(profile, 3)!;
  assert.equal(team.version, 3);
  assert.deepEqual(
    team.capabilities.map((c) => c.basis),
    [
      "checked on the studio's computer on 2026-11-11 (Java 21.0.2)",
      'declared by the owner',
    ],
  );
  assert.ok(!JSON.stringify(team).includes('JORDAN-PC'));
  const system = assessmentRoleInput({
    packet_version: 'assessment-packet/1',
    kind: 'untrusted_evidence/1',
    authority: 'none',
    problem: {
      id: '00000000-0000-4000-8000-000000000001',
      version: 1,
      title: 't',
      statement: 's',
      affected_group: null,
      outcome_measure: null,
    },
    options: [],
    claims: [],
    rubrics: [],
    notes: [],
    team,
    assessed_at: '2026-11-11T23:00:00.000Z',
  })[0]!.text;
  assert.match(system, /team block/);
  assert.match(system, /r08-assessor\/1\.1/);
});
