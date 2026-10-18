import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  AdmissionSchema,
  BrokerCallResultSchema,
  BrokerStatusSchema,
  EnvelopeSchema,
  PricingSnapshotSchema,
  ReservationSchema,
  DecisionSchema,
  GrantSchema,
  HumilityVerdictSchema,
  RunControlSchema,
  SessionInfoSchema,
  HealthSchema,
  FixtureResponseSchema,
  FixtureRequestSchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  WorkspaceSchema,
  StoredEntitySchema,
  StoredLinkSchema,
  EntityDetailSchema,
  HistoryEntrySchema,
  ClaimEvidenceSchema,
  ClaimSupportSchema,
  RetrievalSchema,
  SourceBrokerStatusSchema,
  SourceDetailSchema,
  SourceSummarySchema,
  EvidencePacketSchema,
  FreezeOutcomeSchema,
  SelectOutcomeSchema,
  SelectionReportSchema,
  SelectionSchema,
  SpecStatusSchema,
  type SelectionReport,
  type SpecStatus,
  type WorkflowDetail,
  z,
  parse,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  fixtureSpecRevision,
} from '@creator/domain';

const USAGE = `Usage:
  pnpm cli health
  pnpm cli demo [outcome] [goal]
  pnpm cli workspaces
  pnpm cli workspace-create <name> <fixture|real>
  pnpm cli list <workspace> [kind]
  pnpm cli create <workspace> <kind> <title> <body-json>
  pnpm cli show <workspace> <id>
  pnpm cli revise <workspace> <id> <expected-version> <title> <body-json> <reason>
  pnpm cli archive <workspace> <id> <expected-version> <reason>
  pnpm cli link <workspace> <relation> <from-id>@<version> <to-id>@<version> <rationale>
  pnpm cli lineage <workspace> <id> [upstream|downstream]
  pnpm cli history <workspace> [subject-id]
  pnpm cli seed-lineage
  pnpm cli login <code> | logout | whoami
  pnpm cli runs <workspace>
  pnpm cli run-register <workspace> <run-id>@<version> <mode> [grant-id@version ...]
  pnpm cli run-cancel <workspace> <run-id> <reason>
  pnpm cli admit <workspace> <run-id> <action-json>
  pnpm cli decisions <workspace> [status]
  pnpm cli decision <workspace> <decision-id>
  pnpm cli answer <workspace> <decision-id> <coverage-hash> <choice> [option-id] <rationale> [--standing-days <n>]
  pnpm cli grants <workspace>
  pnpm cli grant-create <workspace> <grant-json>
  pnpm cli grant-revoke <workspace> <grant-id> <expected-version> <reason>
  pnpm cli humility-gate <workspace> <review-id>
  pnpm cli broker-status
  pnpm cli pricing <workspace>
  pnpm cli pricing-add <workspace> <pricing-file.json>
  pnpm cli budgets <workspace>
  pnpm cli budget <workspace> <envelope-id>
  pnpm cli budget-create <workspace> <envelope-json>
  pnpm cli budget-close <workspace> <envelope-id> <expected-version> <reason>
  pnpm cli reservations <workspace> [envelope-id]
  pnpm cli model-call <workspace> <run-id> <request-json>
  pnpm cli reconcile <workspace> <reservation-id> <reconcile-json>
  pnpm cli workflow-start <workspace> <run-id> <request-json>
  pnpm cli workflows <workspace> [run-id]
  pnpm cli workflow <workspace> <workflow-id> [--wait]
  pnpm cli workflow-pause|workflow-resume|workflow-cancel <workspace> <workflow-id> <expected-version> <reason>
  pnpm cli source-status
  pnpm cli source-fetch <workspace> <run-id> <url> [justification]
  pnpm cli sources <workspace>
  pnpm cli source <workspace> <source-id>
  pnpm cli retrievals <workspace> [run-id]
  pnpm cli claim-support <workspace> <claim-id> <support-json>
  pnpm cli claim-evidence <workspace> <claim-id> [max-age-days]
  pnpm cli support-retract <workspace> <support-id> <reason>
  pnpm cli seed-research
  pnpm cli discovery-start <workspace> <run-id> <request-json>
  pnpm cli discovery <workspace> <workflow-id> [--wait]
  pnpm cli discovery-packet <workspace> <workflow-id>
  pnpm cli seed-discovery
  pnpm cli scorecard <workspace> <scorecard-json>
  pnpm cli report <workspace> <problem-id> [shortlist-size]
  pnpm cli select <workspace> <run-id> <select-json>
  pnpm cli selections <workspace> <problem-id>
  pnpm cli spec-create <workspace> <spec-json>
  pnpm cli spec <workspace> <spec-id>
  pnpm cli spec-revise <workspace> <spec-id> <revise-json>
  pnpm cli spec-freeze <workspace> <run-id> <freeze-json>
  pnpm cli seed-selection

Workflows run on the API server's worker (or \`pnpm worker\`), not in this command: exiting the
CLI or closing the web page does not stop or cancel them.

Sign-in state is kept in CREATOR_SESSION_FILE (default .creator/cli-session.json).`;
interface Saved {
  origin: string;
  token: string;
  csrf: string;
}
function sessionFile(): string {
  return process.env.CREATOR_SESSION_FILE ?? '.creator/cli-session.json';
}
function loadSession(origin: string): Saved | null {
  try {
    const saved = JSON.parse(readFileSync(sessionFile(), 'utf8')) as Saved;
    return saved.origin === origin ? saved : null;
  } catch {
    return null;
  }
}

function json(raw: string | undefined, label: string): unknown {
  try {
    return JSON.parse(raw ?? '') as unknown;
  } catch {
    throw new Error(`${label} must be JSON.`);
  }
}
function ref(raw: string | undefined) {
  const [id, version] = (raw ?? '').split('@');
  if (!id || !version || !/^[1-9][0-9]*$/.test(version))
    throw new Error('Link endpoints use <id>@<version>.');
  return { id, version: Number(version) };
}
function version(raw: string | undefined) {
  if (!raw || !/^[1-9][0-9]*$/.test(raw))
    throw new Error('Expected version must be a positive integer.');
  return Number(raw);
}

export async function runCli(
  args: string[],
  base = 'http://127.0.0.1:4310',
  write: (value: string) => void = console.log,
): Promise<number> {
  try {
    const url = new URL(base);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('CLI requires a loopback HTTP API origin.');
    const saved = loadSession(url.origin);
    let lastResponse: Response | null = null;
    async function call<T>(
      schema: z.ZodType<T>,
      path: string,
      body?: unknown,
      timeoutMs = 5000,
    ): Promise<T> {
      const auth: Record<string, string> = saved
        ? { Cookie: `creator_session=${saved.token}` }
        : {};
      const response = await fetch(`${url.origin}/api/${path}`, {
        ...(body === undefined
          ? { headers: auth }
          : {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...auth,
                ...(saved ? { 'X-CSRF-Token': saved.csrf } : {}),
              },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastResponse = response;
      const value: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          `API returned ${response.status}: ${JSON.stringify(value)}`,
        );
      return parse(schema, value);
    }
    const ws = (raw: string | undefined) => {
      if (!raw) throw new Error(USAGE);
      return `workspaces/${encodeURIComponent(raw)}`;
    };
    const [command = 'health', ...rest] = args;
    let data: unknown;
    switch (command) {
      case 'health':
        data = await call(HealthSchema, 'health');
        break;
      case 'demo':
        data = await call(
          FixtureResponseSchema,
          'fixture',
          parse(FixtureRequestSchema, {
            outcome: rest[0] ?? 'use_existing',
            goal:
              rest.slice(1).join(' ') ||
              'Compare a shared checklist with custom software',
          }),
        );
        break;
      case 'workspaces':
        data = await call(z.array(WorkspaceSchema), 'workspaces');
        break;
      case 'workspace-create':
        data = await call(WorkspaceSchema, 'workspaces', {
          name: rest[0],
          record_mode: rest[1],
        });
        break;
      case 'list':
        data = await call(
          z.array(StoredEntitySchema),
          `${ws(rest[0])}/entities${rest[1] ? `?kind=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'create':
        data = await call(StoredEntitySchema, `${ws(rest[0])}/entities`, {
          kind: rest[1],
          title: rest[2],
          body: json(rest[3], 'Body'),
        });
        break;
      case 'show':
        data = await call(
          EntityDetailSchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'revise':
        data = await call(
          StoredEntitySchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/revisions`,
          {
            expected_version: version(rest[2]),
            title: rest[3],
            body: json(rest[4], 'Body'),
            reason: rest[5],
            corrects_version: null,
          },
        );
        break;
      case 'archive':
        data = await call(
          StoredEntitySchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/archive`,
          { expected_version: version(rest[2]), reason: rest[3] },
        );
        break;
      case 'link':
        data = await call(StoredLinkSchema, `${ws(rest[0])}/links`, {
          relation: rest[1],
          from: ref(rest[2]),
          to: ref(rest[3]),
          rationale: rest.slice(4).join(' '),
        });
        break;
      case 'lineage':
        data = await call(
          z.array(
            z.strictObject({ depth: z.number(), link: StoredLinkSchema }),
          ),
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/lineage?direction=${rest[2] ?? 'upstream'}`,
        );
        break;
      case 'history':
        data = await call(
          z.array(HistoryEntrySchema),
          `${ws(rest[0])}/history${rest[1] ? `?subject=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'seed-lineage':
        data = await seedLineage(call);
        break;
      case 'login': {
        const session = await call(SessionInfoSchema, 'auth/dev-login', {
          code: rest[0],
        });
        const cookie = (lastResponse as Response | null)?.headers
          .getSetCookie()
          .find((c) => c.startsWith('creator_session='));
        const value = cookie?.split(';')[0]?.slice('creator_session='.length);
        if (!value) throw new Error('The API did not start a session.');
        mkdirSync(dirname(sessionFile()), { recursive: true });
        writeFileSync(
          sessionFile(),
          JSON.stringify({
            origin: url.origin,
            token: value,
            csrf: session.csrf_token,
          }),
          { mode: 0o600 },
        );
        data = { signed_in: true, expires_at: session.expires_at };
        break;
      }
      case 'logout':
        data = await call(
          z.strictObject({ signed_out: z.literal(true) }),
          'auth/logout',
          {},
        );
        rmSync(sessionFile(), { force: true });
        break;
      case 'whoami':
        data = await call(SessionInfoSchema, 'auth/session');
        break;
      case 'runs':
        data = await call(z.array(RunControlSchema), `${ws(rest[0])}/runs`);
        break;
      case 'run-register':
        data = await call(RunControlSchema, `${ws(rest[0])}/runs`, {
          run: ref(rest[1]),
          autonomy_mode: rest[2],
          stage_gates: null,
          initial_grants: rest.slice(3).map(ref),
        });
        break;
      case 'run-cancel':
        data = await call(
          RunControlSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/cancel`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'admit':
        data = await call(
          AdmissionSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/actions`,
          json(rest[2], 'Action'),
        );
        break;
      case 'decisions':
        data = await call(
          z.array(DecisionSchema),
          `${ws(rest[0])}/decisions${rest[1] ? `?status=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'decision':
        data = await call(
          DecisionSchema,
          `${ws(rest[0])}/decisions/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'answer': {
        const [workspace, decision, coverage, choice, ...tail] = rest;
        const days = tail.indexOf('--standing-days');
        const standingDays = days >= 0 ? Number(tail.splice(days, 2)[1]) : null;
        const option =
          choice === 'choose_option' ? (tail.shift() ?? null) : null;
        data = await call(
          DecisionSchema,
          `${ws(workspace)}/decisions/${encodeURIComponent(decision ?? '')}/answer`,
          {
            choice,
            option_id: option,
            rationale: tail.join(' '),
            coverage_hash: coverage,
            standing_expires_at:
              standingDays === null
                ? null
                : new Date(
                    Date.now() + standingDays * 86_400_000,
                  ).toISOString(),
            time_spent_ms: null,
            interruption: null,
          },
        );
        break;
      }
      case 'grants':
        data = await call(z.array(GrantSchema), `${ws(rest[0])}/grants`);
        break;
      case 'grant-create':
        data = await call(
          GrantSchema,
          `${ws(rest[0])}/grants`,
          json(rest[1], 'Grant'),
        );
        break;
      case 'grant-revoke':
        data = await call(
          GrantSchema,
          `${ws(rest[0])}/grants/${encodeURIComponent(rest[1] ?? '')}/revoke`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'humility-gate':
        data = await call(
          HumilityVerdictSchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/humility-gate`,
        );
        break;
      case 'broker-status':
        data = await call(BrokerStatusSchema, 'broker/status');
        break;
      case 'pricing':
        data = await call(
          z.array(PricingSnapshotSchema),
          `${ws(rest[0])}/pricing`,
        );
        break;
      case 'pricing-add':
        data = await call(
          PricingSnapshotSchema,
          `${ws(rest[0])}/pricing`,
          json(readFileSync(rest[1] ?? '', 'utf8'), 'Pricing file'),
        );
        break;
      case 'budgets':
        data = await call(z.array(EnvelopeSchema), `${ws(rest[0])}/budgets`);
        break;
      case 'budget':
        data = await call(
          EnvelopeSchema,
          `${ws(rest[0])}/budgets/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'budget-create':
        data = await call(
          EnvelopeSchema,
          `${ws(rest[0])}/budgets`,
          json(rest[1], 'Envelope'),
        );
        break;
      case 'budget-close':
        data = await call(
          EnvelopeSchema,
          `${ws(rest[0])}/budgets/${encodeURIComponent(rest[1] ?? '')}/close`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'reservations':
        data = await call(
          z.array(ReservationSchema),
          `${ws(rest[0])}/reservations${rest[1] ? `?envelope=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'model-call': {
        const request = json(rest[2], 'Request') as { timeout_ms?: unknown };
        const wait =
          typeof request.timeout_ms === 'number' ? request.timeout_ms : 0;
        data = await call(
          BrokerCallResultSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/model-calls`,
          request,
          // Up to three attempts plus retry waits; the server bounds each attempt.
          Math.min(wait * 3 + 10_000, 1_900_000),
        );
        break;
      }
      case 'reconcile':
        data = await call(
          ReservationSchema,
          `${ws(rest[0])}/reservations/${encodeURIComponent(rest[1] ?? '')}/reconcile`,
          json(rest[2], 'Reconciliation'),
        );
        break;
      case 'workflow-start':
        data = await call(
          WorkflowDetailSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/workflows`,
          json(rest[2], 'Workflow request'),
        );
        break;
      case 'workflows':
        data = await call(
          z.array(WorkflowSchema),
          `${ws(rest[0])}/workflows${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'workflow': {
        const path = `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}`;
        let detail = await call(WorkflowDetailSchema, path);
        // --wait polls the durable state; it observes the worker, it does not drive it.
        const until = Date.now() + 120_000;
        while (
          rest.includes('--wait') &&
          !detail.workflow.finished_at &&
          !['waiting_human', 'paused_operator', 'reconciling'].includes(
            detail.workflow.state,
          ) &&
          Date.now() < until
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          detail = await call(WorkflowDetailSchema, path);
        }
        data = detail;
        break;
      }
      case 'workflow-pause':
      case 'workflow-resume':
      case 'workflow-cancel':
        data = await call(
          WorkflowDetailSchema,
          `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}/${command.slice(9)}`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'source-status':
        data = await call(SourceBrokerStatusSchema, 'sources/status');
        break;
      case 'source-fetch':
        data = await call(
          RetrievalSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/source-fetches`,
          {
            url: rest[2],
            task_id: null,
            logical_operation_id: randomUUID(),
            justification: rest.slice(3).join(' ') || 'Requested from the CLI.',
          },
          // The server bounds each fetch by its policy time limit (15 s live).
          30_000,
        );
        break;
      case 'sources':
        data = await call(
          z.array(SourceSummarySchema),
          `${ws(rest[0])}/sources`,
        );
        break;
      case 'source':
        data = await call(
          SourceDetailSchema,
          `${ws(rest[0])}/sources/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'retrievals':
        data = await call(
          z.array(RetrievalSchema),
          `${ws(rest[0])}/retrievals${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'claim-support':
        data = await call(
          ClaimSupportSchema,
          `${ws(rest[0])}/claims/${encodeURIComponent(rest[1] ?? '')}/support`,
          json(rest[2], 'Support'),
        );
        break;
      case 'claim-evidence':
        data = await call(
          ClaimEvidenceSchema,
          `${ws(rest[0])}/claims/${encodeURIComponent(rest[1] ?? '')}/evidence${rest[2] ? `?max_age_days=${encodeURIComponent(rest[2])}` : ''}`,
        );
        break;
      case 'support-retract':
        data = await call(
          ClaimSupportSchema,
          `${ws(rest[0])}/claim-support/${encodeURIComponent(rest[1] ?? '')}/retract`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'seed-research':
        data = await seedResearch(call);
        break;
      case 'discovery-start':
        data = await call(
          WorkflowDetailSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/discoveries`,
          json(rest[2], 'Discovery request'),
        );
        break;
      case 'discovery': {
        const path = `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}`;
        let detail = await call(WorkflowDetailSchema, path);
        const until = Date.now() + 120_000;
        while (
          rest.includes('--wait') &&
          !detail.workflow.finished_at &&
          !['waiting_human', 'paused_operator', 'reconciling'].includes(
            detail.workflow.state,
          ) &&
          Date.now() < until
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          detail = await call(WorkflowDetailSchema, path);
        }
        data = discoverySummary(detail);
        break;
      }
      case 'discovery-packet':
        data = await call(
          z.strictObject({
            packet: EvidencePacketSchema,
            packet_hash: z.string(),
          }),
          `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}/packet`,
        );
        break;
      case 'seed-discovery':
        data = await seedDiscovery(call);
        break;
      case 'scorecard':
        data = await call(
          StoredEntitySchema,
          `${ws(rest[0])}/scorecards`,
          json(rest[1], 'Scorecard'),
        );
        break;
      case 'report':
        data = reportSummary(
          await call(
            SelectionReportSchema,
            `${ws(rest[0])}/problems/${encodeURIComponent(rest[1] ?? '')}/report${rest[2] ? `?shortlist=${encodeURIComponent(rest[2])}` : ''}`,
          ),
        );
        break;
      case 'select':
        data = await call(
          SelectOutcomeSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/selections`,
          json(rest[2], 'Selection'),
        );
        break;
      case 'selections':
        data = await call(
          z.array(SelectionSchema),
          `${ws(rest[0])}/problems/${encodeURIComponent(rest[1] ?? '')}/selections`,
        );
        break;
      case 'spec-create':
        data = await call(
          SpecStatusSchema,
          `${ws(rest[0])}/specs`,
          json(rest[1], 'Spec'),
        );
        break;
      case 'spec':
        data = await call(
          SpecStatusSchema,
          `${ws(rest[0])}/specs/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'spec-revise':
        data = await call(
          SpecStatusSchema,
          `${ws(rest[0])}/specs/${encodeURIComponent(rest[1] ?? '')}/revisions`,
          json(rest[2], 'Spec revision'),
        );
        break;
      case 'spec-freeze':
        data = await call(
          FreezeOutcomeSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/spec-freezes`,
          json(rest[2], 'Freeze request'),
        );
        break;
      case 'seed-selection':
        data = await seedSelection(call);
        break;
      default:
        throw new Error(USAGE);
    }
    write(JSON.stringify(data, null, 2));
    return 0;
  } catch (error) {
    write(
      JSON.stringify({
        error: error instanceof ContractError ? error.code : 'CLI_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return 1;
  }
}

type Call = <T>(
  schema: z.ZodType<T>,
  path: string,
  body?: unknown,
) => Promise<T>;
/**
 * Creates a labeled fixture workspace showing many-to-many provenance: two ideas feed one
 * product, one idea feeds two products, and a task produces an artifact. Synthetic records only.
 */
async function seedLineage(call: Call) {
  const ws = await call(WorkspaceSchema, 'workspaces', {
    name: 'Fixture lineage demonstration',
    record_mode: 'fixture',
  });
  const base = `workspaces/${ws.id}`;
  const zero = '0'.repeat(64);
  const make = (kind: string, title: string, body: unknown) =>
    call(StoredEntitySchema, `${base}/entities`, { kind, title, body });
  const link = (
    relation: string,
    from: { id: string; version: number },
    to: { id: string; version: number },
  ) =>
    call(StoredLinkSchema, `${base}/links`, {
      relation,
      from: { id: from.id, version: from.version },
      to: { id: to.id, version: to.version },
      rationale: 'Synthetic fixture lineage',
    });
  const uncertainty = 'Synthetic fixture; no research performed.';
  const source = await make('source', 'Fixture volunteer report', {
    url: 'https://example.org/fixture-report',
    retrieval_status: 'inaccessible',
    content_hash: null,
    retrieved_at: new Date().toISOString(),
    published_at: null,
    independent_origin: 'example.org (fixture)',
    observation: 'Fixture placeholder; not retrieved.',
    uncertainty,
  });
  const claim = await make('claim', 'Volunteers miss shifts', {
    statement: 'Volunteers miss shifts when schedules change.',
    basis: 'inference',
    uncertainty,
  });
  const problem = await make('problem', 'Shift coverage gaps', {
    statement: 'Shifts go uncovered after schedule changes.',
    affected_group: 'Food bank volunteers (fixture)',
    uncertainty,
  });
  const ideaA = await make('idea', 'Shared roster', {
    summary: 'One shared roster.',
    uncertainty,
  });
  const ideaB = await make('idea', 'Reminder messages', {
    summary: 'Reminders before shifts.',
    uncertainty,
  });
  const combined = await make('product', 'Roster with reminders', {
    stage: 'captured',
    summary: 'Combines both ideas.',
  });
  const paper = await make('product', 'Printable roster kit', {
    stage: 'captured',
    summary: 'Non-software descendant of the roster idea.',
  });
  const run = await make('run', 'Fixture packaging run', {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  });
  const task = await make('task', 'Package roster kit', {
    state: 'queued',
    role: 'fixture-builder',
    goal: 'Package the printable roster.',
  });
  const artifact = await make('artifact', 'Roster kit bundle', {
    storage_uri: 'fixture://artifacts/roster-kit.zip',
    sha256: zero,
    bytes: 0,
    media_type: 'application/zip',
  });
  await link('supports', source, claim);
  await link('supports', claim, problem);
  await link('derived_from', ideaA, problem);
  await link('derived_from', ideaB, problem);
  await link('derived_from', combined, ideaA);
  await link('derived_from', combined, ideaB);
  await link('derived_from', paper, ideaA);
  await link('part_of', task, run);
  await link('derived_from', artifact, task);
  return {
    workspace: ws,
    product_from_two_ideas: combined.id,
    idea_with_two_descendants: ideaA.id,
    artifact: artifact.id,
  };
}

const FIXTURE = {
  report: 'https://health.fixture.test/reports/clinic-access-2025',
  wire: 'https://wire.fixture.test/stories/clinic-waits',
  repost: 'https://news.fixture.test/2026/03/clinic-waits',
  copy: 'https://blog.fixture.test/posts/clinic-waits-copy',
  survey: 'https://journal.fixture.test/articles/wait-time-survey',
  paywalled: 'https://journal.fixture.test/articles/paywalled-study',
  staffing: 'https://health.fixture.test/reports/staffing-brief',
  metadataRedirect: 'https://health.fixture.test/go/latest-report',
  forum: 'https://forum.fixture.test/threads/clinic-tips',
};
/**
 * Builds a labeled fixture workspace that walks through T06: fetches from the synthetic corpus
 * (reposts, a conflicting survey, a correction, a paywall, a removal, an inward redirect and a
 * page with injected instructions), two claims with passage-level evidence, and their status.
 */
async function seedResearch(call: Call) {
  const ws = await call(WorkspaceSchema, 'workspaces', {
    name: 'Fixture research demonstration',
    record_mode: 'fixture',
  });
  const base = `workspaces/${ws.id}`;
  const run = await call(StoredEntitySchema, `${base}/entities`, {
    kind: 'run',
    title: 'Fixture research run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  await call(RunControlSchema, `${base}/runs`, {
    run: { id: run.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  await call(GrantSchema, `${base}/grants`, {
    run_id: run.id,
    action_types: ['source.fetch'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['public'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Fetch the fixture corpus for this demonstration run.',
  });
  const fetch = (url: string) =>
    call(RetrievalSchema, `${base}/runs/${run.id}/source-fetches`, {
      url,
      task_id: null,
      logical_operation_id: randomUUID(),
      justification: 'Fixture research demonstration.',
    });
  const retrievals: Record<string, string> = {};
  const got: Record<string, z.infer<typeof RetrievalSchema>> = {};
  for (const [name, url] of Object.entries(FIXTURE)) {
    got[name] = await fetch(url);
    retrievals[name] = `${got[name].state} (${got[name].reason_code})`;
  }
  const passage = async (sourceId: string | null, needle: string) => {
    const detail = await call(
      SourceDetailSchema,
      `${base}/sources/${sourceId}`,
    );
    const p = detail.passages.find((x) => x.excerpt?.includes(needle));
    if (!p) throw new Error(`Fixture passage "${needle}" not found.`);
    return p.id;
  };
  const claim = (statement: string) =>
    call(StoredEntitySchema, `${base}/entities`, {
      kind: 'claim',
      title: statement.slice(0, 120),
      body: {
        statement,
        basis: 'observation',
        uncertainty: 'Synthetic fixture claim.',
      },
    });
  const support = (claimId: string, body: Record<string, unknown>) =>
    call(ClaimSupportSchema, `${base}/claims/${claimId}/support`, {
      claim_version: 1,
      rationale: 'Assessed against the passage text (fixture).',
      ...body,
    });
  const waits = await claim(
    'Rural first-appointment waits rose between 2022 and 2025.',
  );
  for (const name of ['wire', 'repost', 'copy'])
    await support(waits.id, {
      evidence: 'passage',
      passage_id: await passage(got[name]!.source_id, '41 days'),
      stance: 'supports',
      support_type: 'source_assertion',
      quote: 'was 41 days in 2025, up from 29 days in 2022',
    });
  await support(waits.id, {
    evidence: 'passage',
    passage_id: await passage(got.report!.source_id, '41 days'),
    stance: 'supports',
    support_type: 'observation',
    quote: 'was 41 days, up from 29 days in 2022',
  });
  await support(waits.id, {
    evidence: 'passage',
    passage_id: await passage(got.survey!.source_id, 'fell slightly'),
    stance: 'contradicts',
    support_type: 'observation',
    quote: 'fell slightly, from a mean of 35 days in 2022 to 33 days in 2025',
  });
  const triage = await claim(
    'A randomized study found shorter waits after triage changes.',
  );
  await support(triage.id, {
    evidence: 'inaccessible_source',
    source_id: got.paywalled!.source_id,
    source_version: got.paywalled!.source_version,
  });
  const vacancies = await claim(
    'Rural clinics had many vacant nursing posts in 2025.',
  );
  await support(vacancies.id, {
    evidence: 'passage',
    passage_id: await passage(got.staffing!.source_id, '18 percent'),
    stance: 'supports',
    support_type: 'observation',
    quote: '18 percent of nursing posts vacant in 2025',
  });
  // Second fetches: the report is corrected (new version) and the brief is removed.
  const corrected = await fetch(FIXTURE.report);
  const removed = await fetch(FIXTURE.staffing);
  const evidence = async (id: string) => {
    const e = await call(ClaimEvidenceSchema, `${base}/claims/${id}/evidence`);
    return { status: e.status, labels: e.labels };
  };
  return {
    workspace: ws,
    run: run.id,
    retrievals,
    refetch: {
      report: `${corrected.reason_code} → source v${corrected.source_version}`,
      staffing: `${removed.state} → source v${removed.source_version}`,
    },
    claims: {
      [waits.id]: await evidence(waits.id),
      [triage.id]: await evidence(triage.id),
      [vacancies.id]: await evidence(vacancies.id),
    },
  };
}

/** The parts of a discovery run a person reads first; the full detail stays in `workflow`. */
function discoverySummary(detail: WorkflowDetail) {
  const r = detail.workflow.result;
  const d = r?.discovery;
  return {
    workflow: detail.workflow.id,
    state: detail.workflow.state,
    reason: detail.workflow.reason,
    fixture: detail.workflow.fixture,
    outcome: r?.outcome ?? null,
    explanation: r?.explanation ?? null,
    discovery: d
      ? {
          outcome: d.outcome,
          sufficiency: d.sufficiency.verdict,
          gaps: d.sufficiency.reasons,
          cross_field: d.locator?.mechanism_support ?? null,
          independence: d.independence.verified,
          proposals: d.proposals.map((p) => ({
            proposal: `${p.proposal} ${p.perspective}`,
            disposition: p.disposition,
            title: p.title,
            recommendation: p.recommendation,
            skeptic: p.verdict,
            revisions: p.revisions,
            reasons: p.reasons,
            dissent: p.dissent,
          })),
          excluded: d.excluded,
          catalog_records: d.catalog_records,
        }
      : null,
    usage: detail.usage,
  };
}

/**
 * Builds a labeled fixture workspace that runs the three T07 scenarios through the API: a
 * software-suitable case with cross-field reasoning and a known duplicate, an existing-tool
 * case, and insufficient evidence. Requires the API worker (on by default).
 */
async function seedDiscovery(call: Call) {
  const ws = await call(WorkspaceSchema, 'workspaces', {
    name: 'Fixture discovery demonstration',
    record_mode: 'fixture',
  });
  const base = `workspaces/${ws.id}`;
  const pricing = await call(
    PricingSnapshotSchema,
    `${base}/pricing`,
    JSON.parse(
      readFileSync(
        new URL(
          '../../../config/pricing/fixture-model-v1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown,
  );
  const envelope = await call(EnvelopeSchema, `${base}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Fixture discovery budget',
    cap_nano_usd: '100000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 8,
  });
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const started: { scenario: string; workflow: string; run: string }[] = [];
  for (const s of DISCOVERY_SCENARIOS) {
    const run = await call(StoredEntitySchema, `${base}/entities`, {
      kind: 'run',
      title: `Fixture discovery: ${s.title}`,
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    await call(RunControlSchema, `${base}/runs`, {
      run: { id: run.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
    for (const [action_types, data_classes, max] of [
      [['source.fetch'], ['public'], null],
      [['model.generate', 'model.summarize'], ['synthetic'], '2000000000'],
    ] as const)
      await call(GrantSchema, `${base}/grants`, {
        run_id: run.id,
        action_types,
        target_kind: null,
        max_amount_nano_usd: max,
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes,
        expires_at: expires,
        rationale: 'Fixture discovery demonstration run.',
      });
    const sourceOf: Record<string, { id: string; version: number }> = {};
    for (const url of s.fetch) {
      const r = await call(
        RetrievalSchema,
        `${base}/runs/${run.id}/source-fetches`,
        {
          url,
          task_id: null,
          logical_operation_id: randomUUID(),
          justification: `Evidence for ${s.title} (fixture).`,
        },
      );
      if (!r.source_id || !r.source_version)
        throw new Error(
          `Fixture fetch of ${url} recorded no source (${r.state}).`,
        );
      sourceOf[url] = { id: r.source_id, version: r.source_version };
    }
    const evidence = [];
    for (const c of s.claims) {
      const claim = await call(StoredEntitySchema, `${base}/entities`, {
        kind: 'claim',
        title: c.statement.slice(0, 120),
        body: {
          statement: c.statement,
          basis: 'observation',
          uncertainty: 'Synthetic fixture claim.',
        },
      });
      for (const e of c.support) {
        const src = sourceOf[e.url]!;
        if (e.evidence === 'inaccessible_source') {
          await call(ClaimSupportSchema, `${base}/claims/${claim.id}/support`, {
            evidence: 'inaccessible_source',
            claim_version: 1,
            source_id: src.id,
            source_version: src.version,
            rationale: 'The page could not be read (fixture).',
          });
          continue;
        }
        const detail = await call(
          SourceDetailSchema,
          `${base}/sources/${src.id}`,
        );
        const passage = detail.passages.find((x) =>
          x.excerpt?.includes(e.needle),
        );
        if (!passage)
          throw new Error(`Fixture passage "${e.needle}" not found.`);
        await call(ClaimSupportSchema, `${base}/claims/${claim.id}/support`, {
          evidence: 'passage',
          claim_version: 1,
          passage_id: passage.id,
          stance: e.stance,
          support_type: e.support_type,
          quote: e.quote,
          rationale: 'Assessed against the passage text (fixture).',
        });
      }
      evidence.push({ claim_id: claim.id, bears_on: c.bears_on });
    }
    for (const k of s.catalog)
      await call(StoredEntitySchema, `${base}/entities`, {
        kind: k.kind,
        title: k.title,
        body: { summary: k.summary, uncertainty: 'Synthetic catalog entry.' },
      });
    const brief = await call(StoredEntitySchema, `${base}/entities`, {
      kind: 'search_brief',
      title: s.title,
      body: s.brief,
    });
    const detail = await call(
      WorkflowDetailSchema,
      `${base}/runs/${run.id}/discoveries`,
      {
        brief: { id: brief.id, version: 1 },
        evidence,
        perspectives: s.perspectives,
        excluded: s.excluded,
        max_revisions: 1,
        max_age_days: 180,
        envelope_id: envelope.id,
        pricing_snapshot_id: pricing.id,
        data_class: 'synthetic',
        limits: {
          max_children: 5,
          max_concurrency: 2,
          max_depth: 1,
          max_attempts: 1,
          max_repairs: 1,
          max_calls: 24,
          max_output_tokens: 4000,
          call_timeout_ms: 10_000,
          max_wall_seconds: 900,
        },
      },
    );
    started.push({
      scenario: s.key,
      workflow: detail.workflow.id,
      run: run.id,
    });
  }
  // The API's worker runs them; this only waits to report what happened.
  const results = [];
  for (const { scenario, workflow, run } of started) {
    const path = `${base}/workflows/${workflow}`;
    let detail = await call(WorkflowDetailSchema, path);
    const until = Date.now() + 90_000;
    while (!detail.workflow.finished_at && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      detail = await call(WorkflowDetailSchema, path);
    }
    results.push({ scenario, run, ...discoverySummary(detail) });
  }
  return { workspace: ws, results };
}

function reportSummary(r: SelectionReport) {
  const rows = (k: 'opportunity' | 'suitability') =>
    r[k].candidates.map((c) => ({
      alternative: c.alternative.id,
      kind: c.alternative.kind,
      title: c.alternative.title,
      status: c.status,
      rank: c.rank,
      score: c.score?.display ?? null,
      range: c.range
        ? `${c.range.lower.display}–${c.range.upper.display}`
        : null,
      unknown: c.unknown_criteria,
      disagreements: c.disagreements.map((d) => d.criterion),
      gates: c.gates,
    }));
  return {
    problem: r.problem,
    report_hash: r.report_hash,
    opportunity: rows('opportunity'),
    opportunity_excluded: r.opportunity.excluded,
    suitability: rows('suitability'),
    sensitivity: {
      opportunity_stable: r.opportunity.sensitivity.stable,
      suitability_stable: r.suitability.sensitivity.stable,
      suitability_changes: r.suitability.sensitivity.scenarios
        .filter((s) => s.shortlist_changed)
        .map((s) => s.name),
    },
  };
}
const specSummary = (s: SpecStatus) => ({
  spec: s.spec,
  frozen_current: s.frozen_current,
  frozen_version: s.latest_freeze?.spec.version ?? null,
  tasks: s.tasks.map((t) => `${t.key} ${t.status}`),
  removed_tasks: s.removed_tasks,
  problems: s.problems,
  blockers: s.blockers,
});

/**
 * Runs the T07 seed, then scores the clinic case with labeled fixture reviewers, records a
 * humility review, selects (with an override and its reason), writes and freezes a spec, and
 * revises one task to show which tasks the change invalidates. Every authorization the run
 * asks for is answered here as the signed-in owner, approve-once, for the exact version shown.
 */
async function seedSelection(call: Call) {
  const seeded = await seedDiscovery(call);
  const clinic = seeded.results.find((r) => r.scenario === 'software');
  const problemId = clinic?.discovery?.catalog_records.problem?.id;
  if (!clinic || !problemId)
    throw new Error('The software discovery scenario wrote no problem record.');
  const base = `workspaces/${seeded.workspace.id}`;
  const runId = clinic.run;
  const packet = await call(
    z.strictObject({ packet: EvidencePacketSchema, packet_hash: z.string() }),
    `${base}/workflows/${clinic.workflow}/packet`,
  );
  const evidence = packet.packet.claims
    .filter((c) => c.status === 'supported')
    .map((c) => ({ id: c.claim_id, version: c.version }));
  const report = () =>
    call(SelectionReportSchema, `${base}/problems/${problemId}/report`);
  const before = await report();
  const alts = before.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await call(StoredEntitySchema, `${base}/scorecards`, card);
  const build = alts.find((a) => a.kind === 'build');
  if (!build) throw new Error('No software alternative to select.');
  await call(StoredEntitySchema, `${base}/entities`, {
    kind: 'humility_review',
    title: `Humility review: ${build.title}`.slice(0, 300),
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      evidence,
    ),
  });
  const scored = await report();
  const approveOnce = async (decisionId: string | null) => {
    if (!decisionId) throw new Error('Expected a decision request.');
    const d = await call(DecisionSchema, `${base}/decisions/${decisionId}`);
    await call(DecisionSchema, `${base}/decisions/${decisionId}/answer`, {
      choice: 'approve_once',
      option_id: null,
      rationale:
        'Fixture seed: approved as the signed-in owner for this exact version.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    });
  };
  const selectRequest = {
    problem: { id: scored.problem.id, version: scored.problem.version },
    report_hash: scored.report_hash,
    dispositions: fixtureDispositions(scored),
    override_reason:
      'The human-led option is deferred only because no coordinator is funded this quarter (fixture).',
    rationale:
      'Recommend turning on reminders now and prototype risk flags against a manual baseline (fixture).',
    shortlist_size: 3,
    data_class: 'synthetic',
  };
  const asked = await call(
    SelectOutcomeSchema,
    `${base}/runs/${runId}/selections`,
    selectRequest,
  );
  await approveOnce(asked.admission.decision_id);
  const selected = await call(
    SelectOutcomeSchema,
    `${base}/runs/${runId}/selections`,
    selectRequest,
  );
  if (!selected.selection)
    throw new Error(
      `Selection not recorded: ${selected.admission.explanation}`,
    );
  const created = await call(SpecStatusSchema, `${base}/specs`, {
    selection_id: selected.selection.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show risk flags prototype (fixture)',
    content: FIXTURE_SPEC,
  });
  const freezeRequest = {
    spec: { id: created.spec.id, version: created.spec.version },
    justification: 'Freeze the prototype spec for a bounded build (fixture).',
    data_class: 'synthetic',
  };
  const freezeAsked = await call(
    FreezeOutcomeSchema,
    `${base}/runs/${runId}/spec-freezes`,
    freezeRequest,
  );
  await approveOnce(freezeAsked.admission.decision_id);
  const frozen = await call(
    FreezeOutcomeSchema,
    `${base}/runs/${runId}/spec-freezes`,
    freezeRequest,
  );
  const afterFreeze = await call(
    SpecStatusSchema,
    `${base}/specs/${created.spec.id}`,
  );
  const revised = await call(
    SpecStatusSchema,
    `${base}/specs/${created.spec.id}/revisions`,
    {
      expected_version: created.spec.version,
      title: created.spec.title,
      content: fixtureSpecRevision(FIXTURE_SPEC),
      reason: 'A printable list was requested (fixture).',
    },
  );
  return {
    workspace: seeded.workspace,
    run: runId,
    problem: problemId,
    report: reportSummary(scored),
    selection: {
      status: selected.status,
      id: selected.selection.id,
      first_attempt: asked.status,
      dispositions: selected.selection.dispositions.map((d) => ({
        alternative: d.alternative.id,
        disposition: d.disposition,
        reasons: d.reasons,
        reverse_if: d.reverse_if,
      })),
      overrides: selected.selection.overrides,
      override_reason: selected.selection.override_reason,
    },
    spec: {
      id: created.spec.id,
      first_attempt: freezeAsked.status,
      freeze: frozen.status,
      after_freeze: specSummary(afterFreeze),
      after_revision: specSummary(revised),
    },
  };
}
