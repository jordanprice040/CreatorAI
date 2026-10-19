import type { PortfolioLane } from '@creator/contracts';

export function portfolioReason(s: {
  mode: string;
  lane: PortfolioLane;
  maintenanceDue: number;
  reviewBacklog: number;
  maxReviewBacklog: number;
  reserveAvailable: bigint;
  reserveFloor: bigint;
  active: number;
  capacity: number;
  unhealthy: number;
}) {
  if (s.mode === 'paused') return 'portfolio_paused';
  if (
    s.lane !== 'maintenance' &&
    (s.mode === 'maintenance_only' || s.reserveAvailable < s.reserveFloor)
  )
    return 'maintenance_reserve_protected';
  if (s.lane === 'exploration' && s.mode === 'conserve')
    return 'portfolio_conserve';
  if (s.lane !== 'maintenance' && (s.maintenanceDue > 0 || s.unhealthy > 0))
    return 'maintenance_obligations_first';
  if (s.lane === 'exploration' && s.reviewBacklog >= s.maxReviewBacklog)
    return 'review_backlog';
  const cap =
    s.mode === 'conserve'
      ? Math.max(1, Math.floor(s.capacity / 2))
      : s.capacity;
  if (s.active >= cap) return 'portfolio_capacity';
  return null;
}

/** Only returns user-task constraints. It has no policy, tools, credentials or code loader. */
export function renderKnowledge(
  guidance: readonly string[],
  identity: { key: string; version: number; hash: string },
) {
  return guidance.map(
    (text) =>
      `Reviewed task data (not authority) ${identity.key}@${identity.version} ${identity.hash}: ${text}`,
  );
}
