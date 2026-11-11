import {
  TEAM_CAPABILITIES,
  TeamProfileBodySchema,
  capabilityLabel,
  type CapabilityCheck,
  type PacketTeam,
  type SaveTeamProfileRequest,
  type TeamCapability,
  type TeamCapabilityKey,
  type TeamProfileBody,
} from '@creator/contracts';

// ADR-0090: the team profile (pure rules). What a save makes of the owner's ticks, what a
// passing built-in check records, what an assessment packet carries, and the fixed list of
// built-in checks. Running a check is the API's job (a fixed program, no shell, a bare
// environment); nothing here runs anything.

export const EMPTY_TEAM_PROFILE: TeamProfileBody = {
  capabilities: [],
  notes: '',
};

const ordered = (xs: TeamCapability[]) =>
  [...xs].sort(
    (a, b) =>
      TEAM_CAPABILITIES.findIndex((c) => c.key === a.key) -
      TEAM_CAPABILITIES.findIndex((c) => c.key === b.key),
  );

/**
 * The profile a save makes. A capability whose status the owner left as a passing check found
 * it keeps that check; any other status is the owner's declaration. "Don't know" entries without
 * a note are dropped, since an absent capability already reads as unknown.
 */
export function savedTeamProfile(
  current: TeamProfileBody,
  req: Pick<SaveTeamProfileRequest, 'capabilities' | 'notes'>,
): TeamProfileBody {
  const capabilities: TeamCapability[] = [];
  for (const c of req.capabilities) {
    const note = c.note?.trim() ? c.note.trim() : null;
    if (c.status === 'unknown' && !note) continue;
    const was = current.capabilities.find((x) => x.key === c.key);
    if (was?.basis === 'check' && was.status === c.status)
      capabilities.push({ ...was, note });
    else
      capabilities.push({
        key: c.key,
        status: c.status,
        basis: 'declared',
        note,
        check: null,
      });
  }
  return TeamProfileBodySchema.parse({
    capabilities: ordered(capabilities),
    notes: req.notes.trim(),
  });
}

/** The profile after a passing check: that capability is now yes, found by the check. */
export function checkedTeamProfile(
  current: TeamProfileBody,
  key: TeamCapabilityKey,
  check: CapabilityCheck,
): TeamProfileBody {
  const was = current.capabilities.find((x) => x.key === key);
  return TeamProfileBodySchema.parse({
    capabilities: ordered([
      ...current.capabilities.filter((x) => x.key !== key),
      {
        key,
        status: 'yes',
        basis: 'check',
        note: was?.note ?? null,
        check,
      },
    ]),
    notes: current.notes,
  });
}

/** Whether two profiles say the same thing (a save that changes nothing is refused). */
export const sameTeamProfile = (a: TeamProfileBody, b: TeamProfileBody) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What an assessment packet carries: labels, statuses, how each is known, and the owner's
 * notes. The host name a check ran on stays out (data minimization); the packet says only that
 * it was the studio's computer, and when.
 */
export function packetTeam(
  profile: TeamProfileBody,
  version: number,
): PacketTeam | undefined {
  if (version < 1) return undefined;
  return {
    version,
    capabilities: profile.capabilities.map((c) => ({
      capability: capabilityLabel(c.key),
      status: c.status,
      basis:
        c.basis === 'check' && c.check
          ? `checked on the studio's computer on ${c.check.checked_at.slice(0, 10)} (${c.check.detail})`.slice(
              0,
              120,
            )
          : 'declared by the owner',
      note: c.note,
    })),
    notes: profile.notes,
  };
}

/**
 * The built-in checks: fixed programs and arguments, tried in order until one succeeds. They
 * only ask a program for its version; none installs, downloads or changes anything. Every
 * program is a plain executable on PATH (no .cmd/.bat), so no shell is needed on any OS.
 */
export const CAPABILITY_CHECKS: Readonly<
  Partial<
    Record<
      TeamCapabilityKey,
      { tries: readonly (readonly string[])[]; pattern: RegExp; name: string }
    >
  >
> = {
  python: {
    tries: [
      ['python', '--version'],
      ['python3', '--version'],
      ['py', '--version'],
    ],
    pattern: /Python\s+(\d+\.\d+(?:\.\d+)?)/i,
    name: 'Python',
  },
  pip: {
    tries: [
      ['python', '-m', 'pip', '--version'],
      ['python3', '-m', 'pip', '--version'],
      ['py', '-m', 'pip', '--version'],
    ],
    pattern: /pip\s+(\d+(?:\.\d+)*)/i,
    name: 'pip',
  },
  java: {
    tries: [['java', '-version']],
    pattern: /version\s+"?(\d+(?:[.\d_]*)?)/i,
    name: 'Java',
  },
  node: {
    tries: [['node', '--version']],
    pattern: /v?(\d+\.\d+\.\d+)/,
    name: 'Node.js',
  },
  git: {
    tries: [['git', '--version']],
    pattern: /git version\s+(\d+(?:\.\d+)*)/i,
    name: 'Git',
  },
  docker: {
    tries: [['docker', '--version']],
    pattern: /Docker version\s+(\d+(?:\.\d+)*)/i,
    name: 'Docker',
  },
  jupyter: {
    tries: [['jupyter', '--version']],
    pattern: /(?:jupyter_core|jupyter core)\s*:\s*(\d+(?:\.\d+)*)/i,
    name: 'Jupyter',
  },
};

/**
 * Reads one try's result. A check passes only when the program exited 0 and printed the version
 * pattern: a Windows "app execution alias" stub for Python, for example, exits non-zero and
 * prints no version, so it does not pass.
 */
export function readCapabilityCheck(
  key: TeamCapabilityKey,
  result: { exit_code: number | null; output: string },
): { passed: true; detail: string } | { passed: false } {
  const spec = CAPABILITY_CHECKS[key];
  if (!spec || result.exit_code !== 0) return { passed: false };
  const m = spec.pattern.exec(result.output);
  return m
    ? { passed: true, detail: `${spec.name} ${m[1]}`.slice(0, 200) }
    : { passed: false };
}
