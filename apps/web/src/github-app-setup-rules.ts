import type { GitHubAppSetup } from '@creator/contracts';

/** ADR-0132: which part of the in-app GitHub App setup the page shows for the newest setup. */
export type SetupStep = 'start' | 'retry' | 'waiting' | 'install' | 'connect';
export function setupStep(latest: GitHubAppSetup | null): SetupStep {
  switch (latest?.status) {
    case 'waiting_for_github':
      return 'waiting';
    case 'app_created':
      return 'install';
    case 'installed':
      return 'connect';
    case 'failed':
    case 'expired':
    case 'abandoned':
      return 'retry';
    default:
      // None yet, or connected: another app can still be set up.
      return 'start';
  }
}
