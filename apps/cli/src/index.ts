import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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
  z,
  parse,
} from '@creator/contracts';

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
