import {
  ContractError,
  HealthSchema,
  FixtureResponseSchema,
  FixtureRequestSchema,
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
  pnpm cli seed-lineage`;

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
    async function call<T>(
      schema: z.ZodType<T>,
      path: string,
      body?: unknown,
    ): Promise<T> {
      const response = await fetch(`${url.origin}/api/${path}`, {
        ...(body === undefined
          ? {}
          : {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(5000),
      });
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
