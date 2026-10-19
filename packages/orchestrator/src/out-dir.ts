import { existsSync, readdirSync } from 'node:fs';

/**
 * Output folders hold the only copy of a blinding key; a rerun into a used folder would
 * overwrite it and leave returned ratings undecodable, so a used folder is refused.
 */
export function assertFreshOutDir(dir: string) {
  if (existsSync(dir) && readdirSync(dir).length)
    throw new Error(
      `${dir} is not empty; choose a new output folder so earlier packets and keys are kept.`,
    );
}
