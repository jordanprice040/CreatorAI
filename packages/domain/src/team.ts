import {
  CHECKABLE_CAPABILITIES,
  TEAM_CAPABILITIES,
  TeamProfileBodySchema,
  capabilityLabel,
  type CapabilityCheck,
  type GateChecklistItem,
  type PacketChecklist,
  type PacketTeam,
  type SaveTeamProfileRequest,
  type TeamCapability,
  type TeamCapabilityKey,
  type TeamProfileBody,
} from '@creator/contracts';
import { canonicalHash } from './rules.js';

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

/**
 * What a passing check means for the profile now. `same`: it found what is already recorded on
 * this computer, so nothing changes (assessments stay current). `kept_no`: the owner declared No
 * (for example as a policy), and a check does not overrule the owner. `record`: save it.
 */
export function checkOutcome(
  current: TeamProfileBody,
  key: TeamCapabilityKey,
  check: CapabilityCheck,
): 'same' | 'kept_no' | 'record' {
  const was = current.capabilities.find((x) => x.key === key);
  if (was?.status === 'no' && was.basis === 'declared') return 'kept_no';
  if (
    was?.basis === 'check' &&
    was.status === 'yes' &&
    was.check?.detail === check.detail &&
    was.check.machine === check.machine
  )
    return 'same';
  return 'record';
}

/**
 * The profile after a passing check: that capability is now yes, found by the check. A check that
 * changes nothing (see checkOutcome) leaves the profile as it is, so the save is refused as
 * unchanged.
 */
export function checkedTeamProfile(
  current: TeamProfileBody,
  key: TeamCapabilityKey,
  check: CapabilityCheck,
): TeamProfileBody {
  if (checkOutcome(current, key, check) !== 'record') return current;
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
 * notes. The host name a check ran on stays out (data minimization); the packet says only
 * whether the check ran on the computer the studio runs on now or on another one (after a
 * restore or a move, a check from elsewhere may not hold here). No dates: re-checking and
 * finding the same thing must not change what the model reads.
 */
export function packetTeam(
  profile: TeamProfileBody,
  version: number,
  machine: string,
): PacketTeam | undefined {
  if (version < 1) return undefined;
  return {
    version,
    capabilities: profile.capabilities.map((c) => ({
      key: c.key,
      capability: capabilityLabel(c.key),
      status: c.status,
      basis: (c.basis === 'check' && c.check
        ? c.check.machine === machine
          ? `found by a built-in check on the studio's computer (${c.check.detail})`
          : `found by a built-in check on another computer, so it may not hold here (${c.check.detail})`
        : 'declared by the owner'
      ).slice(0, 120),
      note: c.note,
    })),
    notes: profile.notes,
  };
}

/**
 * A hash of what the model reads from the team block (everything but its version). An
 * assessment is stale only when this changes, so a save that changes nothing material (or a
 * new version number alone) keeps every assessment current. '' when the packet has no block.
 */
export const teamHash = (team: PacketTeam | undefined): string =>
  team
    ? canonicalHash({
        // The key (ADR-0097) only names the label's capability, so it is left out: adding it
        // does not make earlier assessments stale.
        capabilities: team.capabilities.map(({ key: _key, ...c }) => c),
        notes: team.notes,
      })
    : '';

/**
 * ADR-0097: the capabilities the app itself can vouch for now: Yes in the current profile and,
 * for one a built-in check can test, found by a check on this computer (a declared Yes or a
 * check on another computer does not count); for one no check can test, declared Yes by the
 * owner. The checklist gate rule clears access only when every needed capability is here.
 */
export function verifiedCapabilities(
  profile: TeamProfileBody,
  machine: string,
): TeamCapabilityKey[] {
  return profile.capabilities
    .filter((c) => {
      if (c.status !== 'yes') return false;
      const checkable = CHECKABLE_CAPABILITIES.includes(c.key as never);
      return checkable
        ? c.basis === 'check' && !!c.check && c.check.machine === machine
        : c.basis === 'declared';
    })
    .map((c) => c.key);
}

/** The checklist block a packet carries: undefined when no item is saved. */
export function packetChecklist(
  items: readonly GateChecklistItem[],
  version: number,
): PacketChecklist | undefined {
  if (version < 1 || !items.length) return undefined;
  return {
    version,
    items: items.map((x, i) => ({
      ref: `K${i + 1}`,
      gate: x.gate,
      text: x.text,
    })),
  };
}

/** A hash of the checklist items the model reads ('' for none); a change makes cards stale. */
export const checklistHash = (c: PacketChecklist | undefined): string =>
  c ? canonicalHash(c.items) : '';

/** How many capabilities the block answers (yes or no); the auto-clear rule needs at least one. */
export const teamAnswers = (team: PacketTeam | undefined): number =>
  team?.capabilities.filter((c) => c.status !== 'unknown').length ?? 0;

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
  // The engine's version, not the client's: it fails when Docker is installed but its engine is
  // stopped, since the capability is running containers. Read-only.
  docker: {
    tries: [['docker', 'version', '--format', '{{.Server.Version}}']],
    pattern: /^\s*v?(\d+\.\d+(?:\.\d+)*)/m,
    name: 'Docker engine',
  },
  // A notebook server (Notebook or JupyterLab), not jupyter_core alone, which any Jupyter
  // package such as an editor's kernel installs.
  jupyter: {
    tries: [['jupyter', '--version']],
    pattern: /^\s*(?:notebook|jupyterlab)\s*:\s*(\d+(?:\.\d+)*)/im,
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
