import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import pg from 'pg';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import { migrate, PortfolioStore, type CommandContext } from '@creator/db';

/**
 * X10 declared-workload benchmark. Seeds one disposable fixture workspace through the real
 * store (audited writes, real links, real metered fixture broker calls), then times the owner
 * API over HTTP: catalog search, bounded lineage, cost aggregation and event display lag.
 * It creates and drops its own database, so it can never touch a studio database.
 */
export interface BenchOptions {
  /** Admin connection to a disposable PostgreSQL server; the bench creates its own database. */
  adminUrl: string;
  ideas: number;
  events: number;
  /** Timed requests per measurement, after warm-up. */
  samples: number;
  log?: (line: string) => void;
}

export interface Latency {
  samples: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
}

export interface BenchReport {
  schema: 'x10-bench/1';
  started_at: string;
  finished_at: string;
  label: 'synthetic fixture workload; not real usage';
  declared: { ideas: number; events: number };
  seeded: Record<string, number>;
  seed_seconds: number;
  environment: Record<string, unknown>;
  measurements: Record<string, Latency & { what: string }>;
  provisional_targets: {
    target: string;
    measured_p95_ms: number;
    met: boolean;
  }[];
  notes: string[];
}

/** Nearest-rank percentile of already-sorted values. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new Error('No samples');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function summarize(values: number[]): Latency {
  const s = [...values].sort((a, b) => a - b);
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    samples: s.length,
    p50_ms: r(percentile(s, 50)),
    p95_ms: r(percentile(s, 95)),
    p99_ms: r(percentile(s, 99)),
    max_ms: r(s[s.length - 1]!),
  };
}

const WORDS = [
  'roster',
  'reminder',
  'volunteer',
  'clinic',
  'inventory',
  'schedule',
  'tenant',
  'repair',
  'transit',
  'pantry',
  'tutoring',
  'permit',
  'harvest',
  'shelter',
  'library',
  'garden',
];
const U = 'Synthetic X10 benchmark record; no research performed.';

async function pool<T>(items: T[], width: number, f: (x: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < items.length) await f(items[next++]!);
    }),
  );
}

export async function runBench(o: BenchOptions): Promise<BenchReport> {
  const log = o.log ?? (() => undefined);
  if (o.ideas < 50 || o.events < o.ideas)
    throw new Error('Need at least 50 ideas and at least one event per idea.');
  const started = new Date();
  const name = `creator_bench_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: o.adminUrl, max: 1 });
  await admin.query(`create database ${name}`);
  const url = new URL(o.adminUrl);
  url.pathname = `/${name}`;
  const db = new pg.Pool({ connectionString: url.toString(), max: 8 });
  db.on('error', () => undefined);
  let closeApi = async () => {};
  try {
    await migrate(db);
    const store = new PortfolioStore(db);
    const owner: CommandContext = { actorId: DEFAULT_OWNER_ACTOR_ID };
    await store.ensureActor({
      id: owner.actorId,
      kind: 'human',
      display_name: 'Local owner',
    });
    const seedStart = performance.now();
    const ws = (
      await store.createWorkspace(owner, {
        name: 'X10 benchmark (synthetic)',
        record_mode: 'fixture',
      })
    ).id;
    type Ref = { id: string; version: number };
    const make = async (kind: string, title: string, body: unknown) => {
      const e = await store.createEntity(owner, ws, { kind, title, body });
      return { id: e.id, version: e.version } as Ref;
    };
    const link = (relation: string, from: Ref, to: Ref) =>
      store.createLink(owner, ws, {
        relation,
        from,
        to,
        rationale: 'Synthetic X10 lineage',
      });
    const word = (i: number) =>
      `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]}`;
    const width = 6;
    const nProblems = Math.max(5, Math.floor(o.ideas / 20));
    const nProducts = Math.max(2, Math.floor(o.ideas / 50));
    const problems: Ref[] = [];
    for (let i = 0; i < nProblems; i++) {
      const source = await make('source', `Report on ${word(i)} ${i}`, {
        url: `https://example.org/x10/${i}`,
        retrieval_status: 'inaccessible',
        content_hash: null,
        retrieved_at: new Date().toISOString(),
        published_at: null,
        independent_origin: 'example.org (fixture)',
        observation: 'Fixture placeholder; not retrieved.',
        uncertainty: U,
      });
      const problem = await make('problem', `Gap in ${word(i)} ${i}`, {
        statement: `People lose track of ${word(i)} work (synthetic ${i}).`,
        affected_group: 'Synthetic group',
        uncertainty: U,
      });
      const claim = await make('claim', `Claim about ${word(i)} ${i}`, {
        statement: `Synthetic ${word(i)} claim ${i}.`,
        basis: 'inference',
        uncertainty: U,
      });
      await link('supports', source, claim);
      await link('supports', claim, problem);
      problems.push(problem);
    }
    const ideas: Ref[] = new Array(o.ideas);
    await pool([...Array(o.ideas).keys()], width, async (i) => {
      ideas[i] = await make('idea', `Idea ${i}: shared ${word(i)}`, {
        summary: `A synthetic ${word(i)} idea number ${i}.`,
        uncertainty: U,
      });
      await link('derived_from', ideas[i]!, problems[i % nProblems]!);
    });
    log(`seeded ${o.ideas} ideas`);
    const products: Ref[] = [];
    const runs: Ref[] = [];
    for (let i = 0; i < nProducts; i++) {
      const product = await make('product', `Product ${i}: ${word(i)} kit`, {
        stage: 'captured',
        summary: `Synthetic product ${i}.`,
      });
      for (let k = 0; k < 3; k++)
        await link('derived_from', product, ideas[(i * 3 + k) % o.ideas]!);
      products.push(product);
      const run = await make('run', `Run ${i}`, {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      });
      await link('part_of', run, product);
      // Every fifth run also serves the previous product: shared costs must count once.
      if (i % 5 === 4) await link('part_of', run, products[i - 1]!);
      runs.push(run);
    }
    const env = (
      await store.createEnvelope(owner, ws, {
        parent_id: null,
        kind: 'global',
        run_id: null,
        name: 'X10 benchmark budget',
        cap_nano_usd: '100000000000000',
        starts_at: null,
        ends_at: null,
        max_in_flight: 32,
      })
    ).id;
    const pricing = (
      await store.createPricing(
        owner,
        ws,
        JSON.parse(
          readFileSync(
            new URL(
              '../../config/pricing/fixture-model-v1.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ),
      )
    ).id;
    const broker = new ModelBroker(store, {
      fixture: new FixtureAdapter(),
      live: null,
    });
    let calls = 0;
    await pool(runs, width, async (run) => {
      await store.registerRun(owner, ws, {
        run,
        autonomy_mode: 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      });
      await store.createStandingGrant(owner, ws, {
        run_id: run.id,
        action_types: ['model.generate'],
        target_kind: null,
        max_amount_nano_usd: '1000000000000',
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['synthetic'],
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rationale: 'Synthetic X10 benchmark calls.',
      });
      for (let k = 0; k < 3; k++) {
        const r = await broker.call(owner, ws, run.id, {
          envelope_id: env,
          action_type: 'model.generate',
          task_id: null,
          logical_operation_id: randomUUID(),
          pricing_snapshot_id: pricing,
          data_class: 'synthetic',
          input: [{ role: 'user', text: `Synthetic call ${k}` }],
          max_output_tokens: 32,
          output_format: 'text',
          tool: null,
          max_attempts: 1,
          timeout_ms: 5000,
          justification: 'Synthetic X10 benchmark cost record.',
        });
        if (r.status !== 'succeeded') throw new Error(r.explanation);
        calls++;
      }
    });
    log(`seeded ${runs.length} runs and ${calls} metered fixture calls`);
    const count = async (sql: string) =>
      Number((await db.query(sql)).rows[0]?.n ?? 0);
    // Revisions fill the rest of the declared event volume through the audited path.
    const current = new Map(ideas.map((r) => [r.id, r.version]));
    let have = await count('select count(*) as n from audit_events');
    let round = 0;
    while (have < o.events) {
      const batch = Math.min(o.events - have, o.ideas);
      const todo = ideas.slice(0, batch);
      await pool(todo, width, async (r) => {
        const v = current.get(r.id)!;
        const e = await store.reviseEntity(owner, ws, r.id, {
          expected_version: v,
          title: `Idea revised ${round}: ${word(v)}`,
          body: {
            summary: `Revision ${round} of a synthetic idea.`,
            uncertainty: U,
          },
          reason: 'Synthetic X10 revision',
          corrects_version: null,
        });
        current.set(r.id, e.version);
      });
      have = await count('select count(*) as n from audit_events');
      round++;
      log(`events ${have}/${o.events}`);
    }
    await store.drainOutbox(1000);
    await db.query('analyze');
    const seeded = {
      ideas: await count(
        `select count(*) as n from entities where kind = 'idea'`,
      ),
      entities: await count('select count(*) as n from entities'),
      entity_versions: await count('select count(*) as n from entity_versions'),
      links: await count('select count(*) as n from entity_links'),
      audit_events: await count('select count(*) as n from audit_events'),
      history_rows: await count('select count(*) as n from history_projection'),
      reservations: await count(
        'select count(*) as n from budget_reservations',
      ),
    };
    const seedSeconds = Math.round((performance.now() - seedStart) / 100) / 10;
    log(`seeded in ${seedSeconds}s: ${JSON.stringify(seeded)}`);

    // ---- Measure through the real owner API ----
    const LOGIN = randomBytes(24).toString('hex');
    const api = createApi({
      CREATOR_DATABASE_URL: url.toString(),
      CREATOR_DEV_LOGIN_CODE: LOGIN,
      CREATOR_WORKER: 'off',
    });
    api.server.listen(0, '127.0.0.1');
    await once(api.server, 'listening');
    closeApi = api.close;
    await api.ready();
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
    const signIn = await fetch(`${base}/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: LOGIN }),
    });
    const csrf = ((await signIn.json()) as { csrf_token: string }).csrf_token;
    const cookie = signIn.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const call = async (path: string, body?: unknown) => {
      const t0 = performance.now();
      const r = await fetch(`${base}/workspaces/${ws}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Cookie: cookie,
          'X-CSRF-Token': csrf,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const json = (await r.json()) as Record<string, unknown>;
      const ms = performance.now() - t0;
      if (!r.ok)
        throw new Error(`${path}: ${r.status} ${JSON.stringify(json)}`);
      return { ms, json };
    };
    const time = async (f: (i: number) => Promise<number>) => {
      for (let i = 0; i < 5; i++) await f(i);
      const out: number[] = [];
      for (let i = 0; i < o.samples; i++) out.push(await f(i + 5));
      return summarize(out);
    };
    const m: BenchReport['measurements'] = {};
    m.catalog_text_search = {
      what: 'GET search, text mode over all types, limit 20',
      ...(await time(async (i) => {
        const r = await call(
          `search?q=${encodeURIComponent(WORDS[i % WORDS.length]!)}&limit=20`,
        );
        if (!Array.isArray(r.json.hits)) throw new Error('no hits array');
        return r.ms;
      })),
    };
    m.catalog_browse = {
      what: 'GET search, empty query (browse) over records, limit 20',
      ...(await time(
        async () => (await call('search?types=record&limit=20')).ms,
      )),
    };
    m.catalog_id_lookup = {
      what: 'GET search by 8-character id prefix over all types',
      ...(await time(
        async (i) =>
          (await call(`search?q=${ideas[(i * 97) % o.ideas]!.id.slice(0, 8)}`))
            .ms,
      )),
    };
    m.bounded_lineage = {
      what: 'GET entity lineage-graph, both directions, depth 4, max 200 nodes, from a product',
      ...(await time(
        async (i) =>
          (
            await call(
              `entities/${products[i % products.length]!.id}/lineage-graph?direction=both&depth=4&max_nodes=200`,
            )
          ).ms,
      )),
    };
    m.cost_aggregation = {
      what: 'POST audit-questions: cost of two products (shared runs counted once)',
      ...(await time(async (i) => {
        const a = products[i % products.length]!;
        const b = products[(i + 1) % products.length]!;
        const r = await call('audit-questions', {
          question: `What did products ${a.id} and ${b.id} cost?`,
          tz: 'UTC',
        });
        if (r.json.status !== 'answered')
          throw new Error(`cost question: ${String(r.json.explanation)}`);
        return r.ms;
      })),
    };
    m.overview = {
      what: 'GET overview (counts and attention items)',
      ...(await time(async () => (await call('overview')).ms)),
    };
    // Event display lag: a write commits, then the activity API is polled until it shows it.
    const lags: number[] = [];
    for (let i = 0; i < Math.min(o.samples, 100) + 5; i++) {
      const id = ideas[(i * 13) % o.ideas]!.id;
      const v = current.get(id)!;
      const t0 = performance.now();
      const e = await store.reviseEntity(owner, ws, id, {
        expected_version: v,
        title: `Lag probe ${i}`,
        body: { summary: 'Synthetic lag probe.', uncertainty: U },
        reason: 'Synthetic X10 lag probe',
        corrects_version: null,
      });
      current.set(id, e.version);
      for (;;) {
        const r = await call(`activity?subject=${id}&limit=1`);
        const top = (r.json.entries as { subject_version?: number }[])[0];
        if (top?.subject_version === e.version) break;
        if (performance.now() - t0 > 30_000)
          throw new Error('lag probe timed out');
        await new Promise((res) => setTimeout(res, 25));
      }
      if (i >= 5) lags.push(performance.now() - t0);
    }
    m.event_display_lag = {
      what: 'commit of a revision until GET activity returns it (API drains the outbox on read)',
      ...summarize(lags),
    };
    const pgVersion = String(
      (await db.query('show server_version')).rows[0]?.server_version,
    );
    const settings = Object.fromEntries(
      (
        await db.query(
          `select name, setting, unit from pg_settings
            where name in ('shared_buffers','work_mem','effective_cache_size','max_connections')`,
        )
      ).rows.map(
        (r: { name: string; setting: string; unit: string | null }) => [
          r.name,
          `${r.setting}${r.unit ? ` ${r.unit}` : ''}`,
        ],
      ),
    );
    const cpus = os.cpus();
    const searchP95 = Math.max(
      m.catalog_text_search.p95_ms,
      m.catalog_browse.p95_ms,
      m.catalog_id_lookup.p95_ms,
    );
    return {
      schema: 'x10-bench/1',
      started_at: started.toISOString(),
      finished_at: new Date().toISOString(),
      label: 'synthetic fixture workload; not real usage',
      declared: { ideas: o.ideas, events: o.events },
      seeded,
      seed_seconds: seedSeconds,
      environment: {
        platform: `${os.platform()} ${os.release()}`,
        cpu: `${cpus.length} × ${cpus[0]?.model ?? 'unknown'}`,
        memory_gb: Math.round(os.totalmem() / 2 ** 30),
        node: process.version,
        postgresql: pgVersion,
        postgresql_settings: settings,
        topology:
          'API, benchmark client and PostgreSQL on one host over loopback; one sequential client',
      },
      measurements: m,
      provisional_targets: [
        {
          target: 'catalog search p95 under 2000 ms (provisional)',
          measured_p95_ms: searchP95,
          met: searchP95 < 2000,
        },
        {
          target: 'event display p95 under 5000 ms (provisional)',
          measured_p95_ms: m.event_display_lag.p95_ms,
          met: m.event_display_lag.p95_ms < 5000,
        },
      ],
      notes: [
        'Latency is measured at the owner HTTP API, not in a browser; screens add their own polling interval on top (the Overview screen polls every 4 s).',
        'One sequential client: no concurrent-user load was measured.',
        'Seeded through the audited store and fixture broker; costs are simulated nano-USD.',
      ],
    };
  } finally {
    await closeApi();
    await db.end();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
}
