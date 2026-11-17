import type { GitHubAppSetup } from '@creator/contracts';

/** ADR-0132: which part of the in-app GitHub App setup the page shows for the newest setup. */
export type SetupStep =
  'start' | 'retry' | 'waiting' | 'install' | 'connect' | 'connected';
export function setupStep(latest: GitHubAppSetup | null): SetupStep {
  switch (latest?.status) {
    case 'waiting_for_github':
      return 'waiting';
    case 'app_created':
      return 'install';
    case 'installed':
      return 'connect';
    case 'connected':
      // Review N-2: say which app is connected; another app sits behind its own button.
      return 'connected';
    case 'failed':
    case 'expired':
    case 'abandoned':
      return 'retry';
    default:
      // None yet.
      return 'start';
  }
}

/** Review L-3: the page looks again while GitHub has the browser (create, then install). */
export const pollsGitHub = (step: SetupStep) =>
  step === 'waiting' || step === 'install';
