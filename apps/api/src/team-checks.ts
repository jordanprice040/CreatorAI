import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { CapabilityCheck, TeamCapabilityKey } from '@creator/contracts';
import { studioMachine } from '@creator/db';
import { CAPABILITY_CHECKS, readCapabilityCheck } from '@creator/domain';

// ADR-0090: built-in capability checks. Each runs a fixed program from CAPABILITY_CHECKS with
// fixed arguments that only ask for a version: no shell, no model-written text, a short time
// limit, a small output limit, and a bare environment that carries only what finding programs
// needs (never the studio's credentials or CREATOR_* settings).

export type CapabilityRunner = (
  file: string,
  args: readonly string[],
) => Promise<{ exit_code: number | null; output: string }>;

const PASS_ENV = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'HOME',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'TEMP',
  'TMP',
  'LANG',
  'JAVA_HOME',
] as const;

export function checkEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PASS_ENV) {
    const v = env[k];
    if (typeof v === 'string') out[k] = v;
  }
  // Windows otherwise looks for the program in the current directory before PATH.
  out.NoDefaultCurrentDirectoryInExePath = '1';
  return out;
}

export const runCapabilityProgram: CapabilityRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      {
        shell: false,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
        windowsHide: true,
        // Not the API's own working directory, so no program left there runs instead.
        cwd: tmpdir(),
        env: checkEnv(),
      },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code as number)
            : err
              ? null
              : 0;
        resolve({
          exit_code: code,
          output: `${stdout}\n${stderr}`.slice(0, 8_000),
        });
      },
    );
  });

export { studioMachine };

/** Runs one capability's tries in order; the first that passes is recorded. */
export async function runCapabilityCheck(
  key: TeamCapabilityKey,
  run: CapabilityRunner = runCapabilityProgram,
  now: () => Date = () => new Date(),
): Promise<
  { passed: true; check: CapabilityCheck } | { passed: false; detail: string }
> {
  const spec = CAPABILITY_CHECKS[key];
  if (!spec)
    return {
      passed: false,
      detail: 'There is no built-in check for this; tick it yourself.',
    };
  for (const [file, ...args] of spec.tries) {
    const result = await run(file!, args);
    const read = readCapabilityCheck(key, result);
    if (read.passed)
      return {
        passed: true,
        check: {
          command: [file, ...args].join(' ').slice(0, 200),
          detail: read.detail,
          output_hash: createHash('sha256').update(result.output).digest('hex'),
          machine: studioMachine(),
          checked_at: now().toISOString(),
        },
      };
  }
  return {
    passed: false,
    detail: `${spec.name} was not found on this computer (tried: ${spec.tries
      .map((t) => t.join(' '))
      .join(
        '; ',
      )}). Install it, or tick the answer yourself if the team runs it elsewhere.`.slice(
      0,
      300,
    ),
  };
}
