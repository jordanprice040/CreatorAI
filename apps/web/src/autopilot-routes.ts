import {
  EnvelopeSchema,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  PricingSnapshotSchema,
  z,
  type Envelope,
  type PlanConnectionDetail,
  type PricingSnapshot,
} from '@creator/contracts';
import { api } from './oversight.js';
import { newestFirst } from './versions.js';
import { envelopesFor } from './build-defaults.js';

// The model routes an autopilot can use (P13, ADR-0092), shared by "Run it for me" and the
// automation levels (P33, ADR-0099): each verified plan model, and the newest active API budget
// with the newest pricing.

/** Sent on `window` when a panel starts or stops autopilots, so the others read them again. */
export const AUTOPILOTS_CHANGED = 'creator:autopilots-changed';
/**
 * Sent on `window` with `{ id, at }` as `detail` (an exploration's workflow id and when it
 * started), so Explore for me opens it (the autopilot's stopped card links to the exploration
 * it made).
 */
export const OPEN_EXPLORATION = 'creator:open-exploration';

export type Route =
  | {
      kind: 'plan';
      key: string;
      label: string;
      connection: string;
      model: string;
      chatgpt: boolean;
    }
  | { kind: 'api'; key: string; label: string };

export type RouteContext = {
  details: PlanConnectionDetail[];
  envelope: Envelope | undefined;
  pricing: PricingSnapshot | undefined;
};

export async function loadRoutes(base: string): Promise<RouteContext> {
  const [connections, envelopes, pricing] = await Promise.all([
    api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
      () => [],
    ),
    api(z.array(EnvelopeSchema), `${base}/budgets`).catch(() => []),
    api(z.array(PricingSnapshotSchema), `${base}/pricing`).catch(() => []),
  ]);
  const details = (
    await Promise.all(
      connections.map((c) =>
        api(
          PlanConnectionDetailSchema.passthrough(),
          `${base}/plan-connections/${c.id}`,
        ).catch(() => null),
      ),
    )
  ).filter((d) => d !== null) as PlanConnectionDetail[];
  return {
    details,
    envelope: envelopesFor(
      newestFirst(envelopes.filter((e) => e.status === 'active')),
      '',
    )[0],
    pricing: newestFirst(pricing)[0],
  };
}

export function routesOf(c: RouteContext | null, fixture: boolean): Route[] {
  return [
    ...(c?.details ?? []).flatMap((d) =>
      d.model_access
        .filter((a) => a.path === 'responses' && a.access === 'verified')
        .map((a): Route => ({
          kind: 'plan',
          key: `${d.connection.id}:${a.model_id}`,
          label: `${d.connection.label} · ${a.model_id}`,
          connection: d.connection.id,
          model: a.model_id,
          chatgpt: d.connection.kind === 'chatgpt_plan',
        })),
    ),
    ...(c?.envelope && c.pricing
      ? [
          {
            kind: 'api' as const,
            key: 'api',
            label: fixture
              ? 'Fixture model (budget and pricing)'
              : `API budget “${c.envelope.name}”`,
          },
        ]
      : []),
  ];
}

/** The route the form shows: the one picked, else the fixture model in a fixture workspace, else the first. */
export function pickRoute(
  routes: Route[],
  key: string,
  fixture: boolean,
): Route | undefined {
  return (
    routes.find((r) => r.key === key) ??
    (fixture ? routes.find((r) => r.kind === 'api') : undefined) ??
    routes[0]
  );
}

/** The plan connection behind a route, if it is a plan route. */
export function planOf(c: RouteContext | null, route: Route | undefined) {
  return route?.kind === 'plan'
    ? c?.details.find((d) => d.connection.id === route.connection)
    : undefined;
}

/** The `resource_setup` an autopilot config takes for a route. */
export function resourceSetupOf(
  c: RouteContext | null,
  route: Route | undefined,
) {
  const plan = planOf(c, route);
  return route?.kind === 'plan'
    ? {
        kind: 'subscription' as const,
        connection_id: route.connection,
        model_id: route.model,
        settings_hash: plan?.connection.settings_hash ?? '',
        max_output_chars:
          plan?.connection.settings.caps.responses.max_output_chars ?? 16000,
      }
    : {
        kind: 'api' as const,
        envelope_id: c?.envelope?.id ?? '',
        pricing_snapshot_id: c?.pricing?.id ?? '',
      };
}
