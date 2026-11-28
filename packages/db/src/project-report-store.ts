import type { PoolClient } from 'pg';
import { ContractError, SpecBodySchema } from '@creator/contracts';
import {
  projectReportFileName,
  projectReportMarkdown,
  type ProjectReportInput,
  type ReportBuild,
  type ReportClaim,
  type ReportIntervention,
  type ReportOption,
  type ReportProblem,
  type ReportSelection,
} from '@creator/domain';
import { RunbookStore } from './runbook-store.js';
import { ASSESSMENT_CLAIMS_SQL } from './selection-store.js';
import {
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** How many of each record the report lists; the rest are counted, not shown. */
export const REPORT_LIMITS = {
  problems: 20,
  claims: 30,
  sources: 10,
  interventions: 200,
  specs: 20,
  builds: 30,
  proposals: 30,
  autopilots: 20,
  envelopes: 30,
  humility: 50,
  options: 40,
  selections: 20,
  feedback: 20,
} as const;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Row =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
const counts = (rows: Row[]) =>
  Object.fromEntries(rows.map((r) => [String(r.k), Number(r.n)]));
const who = (name: unknown, kind: unknown) =>
  `${String(name ?? 'unknown')} (${kind === 'human' ? 'person' : String(kind ?? 'unknown')})`;

export interface ProjectReport {
  name: string;
  markdown: string;
  redactions: { secrets: number; paths: number };
}

/**
 * ADR-0117 (F3): the project report of one workspace, computed on read from its records by any
 * member who can read the workspace. Nothing is stored and no model is called; reading it
 * changes nothing.
 */
export class ProjectReportStore extends RunbookStore {
  async projectReport(
    ctx: CommandContext,
    ws: string,
    now = new Date(),
  ): Promise<ProjectReport> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const input = await this.tx(async (c) => {
      // The same check every workspace read makes: a non-member learns nothing.
      await this.role(c, ws, ctx.actorId, false);
      return this.reportInput(c, ws, now);
    });
    // The live comparison of each problem's options, through its own read (and access check).
    for (const p of input.problems) await this.reportOptions(ctx, ws, p);
    const { markdown, redactions } = projectReportMarkdown(input);
    return {
      name: projectReportFileName(input.workspace.name, input.generated_at),
      markdown,
      redactions,
    };
  }

  private async reportOptions(
    ctx: CommandContext,
    ws: string,
    p: ReportProblem,
  ) {
    let report;
    try {
      report = await this.selectionReport(ctx, ws, p.id);
    } catch (e) {
      if (!(e instanceof ContractError)) throw e;
      p.comparison_note = `The current comparison could not be read: ${e.message}`;
      return;
    }
    const byId = new Map(p.options.map((o) => [o.id.toLowerCase(), o]));
    for (const cand of report.suitability.candidates) {
      const o = byId.get(cand.alternative.id.toLowerCase());
      if (!o) continue;
      o.rank = cand.rank;
      o.score = cand.score === null ? null : String(cand.score.display);
      o.score_status = cand.status;
      o.disagreements = cand.disagreements.map((d) => ({
        criterion: d.criterion,
        ratings: d.ratings.map(
          (r) =>
            `${r.reviewer} rated ${r.rating === null ? 'unknown' : r.rating}`,
        ),
      }));
      o.gates = (cand.gates.gate_details ?? []).map((g) => ({
        gate: g.gate,
        state: g.state,
        concerns: g.concerns.map((x) => `${x.reviewer}: ${x.note}`),
      }));
    }
  }

  private async reportInput(
    c: PoolClient,
    ws: string,
    now: Date,
  ): Promise<ProjectReportInput> {
    const w = (
      await c.query(
        'select id, name, record_mode from workspaces where id = $1',
        [ws],
      )
    ).rows[0] as Row;
    const asOf = (
      await c.query(
        'select max(occurred_at) as at from audit_events where workspace_id = $1',
        [ws],
      )
    ).rows[0] as Row;
    const problems = (
      await c.query(
        `select * from entities where workspace_id = $1 and kind = 'problem' and status = 'active'
          order by updated_at desc, id`,
        [ws],
      )
    ).rows as Row[];
    const out: ProjectReportInput = {
      workspace: {
        id: String(w.id),
        name: String(w.name),
        record_mode: w.record_mode === 'fixture' ? 'fixture' : 'real',
      },
      records_as_of: asOf.at ? iso(asOf.at) : null,
      generated_at: now.toISOString(),
      problems: [],
      problems_omitted: Math.max(0, problems.length - REPORT_LIMITS.problems),
      claims_not_listed: 0,
      humility: [],
      humility_omitted: 0,
      ...(await this.reportUnpackaged(c, ws)),
      interventions: [],
      interventions_omitted: 0,
      specs: await this.reportSpecs(c, ws),
      builds: await this.reportBuilds(c, ws),
      proposals: await this.reportProposals(c, ws),
      autopilots: (
        await c.query(
          `select * from autopilots where workspace_id = $1 order by created_at desc, id
            limit ${REPORT_LIMITS.autopilots}`,
          [ws],
        )
      ).rows.map((r: Row) => ({
        id: String(r.id),
        created_at: iso(r.created_at),
        state: String(r.state),
        stage: String(r.stage),
        outcome: r.outcome === null ? null : String(r.outcome),
        explanation: String(r.explanation),
      })),
      money: await this.reportMoney(c, ws),
    };
    for (const r of problems.slice(0, REPORT_LIMITS.problems))
      out.problems.push(await this.reportProblem(c, ws, r));
    const listed = new Set(
      out.problems.flatMap((p) => p.claims.map((x) => x.id.toLowerCase())),
    );
    const active = (
      await c.query(
        `select id::text from entities where workspace_id = $1 and kind = 'claim'
            and status = 'active'`,
        [ws],
      )
    ).rows as { id: string }[];
    out.claims_not_listed = active.filter(
      (x) => !listed.has(x.id.toLowerCase()),
    ).length;
    const humility = await this.reportHumility(c, ws);
    out.humility = humility.list;
    out.humility_omitted = humility.omitted;
    const { list, omitted } = await this.reportInterventions(c, ws);
    out.interventions = list;
    out.interventions_omitted = omitted;
    return out;
  }

  private async reportProblem(
    c: PoolClient,
    ws: string,
    r: Row,
  ): Promise<ReportProblem> {
    const id = String(r.id);
    const body = obj(r.body);
    // The claims an assessment reads (ADR-0091): the problem's own, supporting first, then
    // those that back one of its options. A claim linked both ways is listed with the problem.
    const linked = new Map(
      (
        await c.query<{
          id: string;
          relation: string;
          option_id: string | null;
        }>(
          `select distinct on (x.from_id) x.from_id::text as id, x.relation,
              x.option_id::text as option_id
             from (${ASSESSMENT_CLAIMS_SQL}) x
            order by x.from_id, x.option_id is not null, (x.relation = 'contradicts') desc,
              x.created_at`,
          [ws, id],
        )
      ).rows.map((x) => [
        x.id.toLowerCase(),
        {
          relation:
            x.relation === 'contradicts'
              ? ('contradicts' as const)
              : ('supports' as const),
          option: x.option_id?.toLowerCase() ?? null,
        },
      ]),
    );
    const claimRows = linked.size
      ? ((
          await c.query(
            `select * from entities where workspace_id = $1 and kind = 'claim'
                and id = any($2::uuid[]) and status = 'active' order by created_at, id`,
            [ws, [...linked.keys()]],
          )
        ).rows as Row[])
      : [];
    const link = (x: Row) => linked.get(String(x.id).toLowerCase())!;
    const ordered = [
      ...claimRows.filter(
        (x) => !link(x).option && link(x).relation === 'supports',
      ),
      ...claimRows.filter(
        (x) => !link(x).option && link(x).relation === 'contradicts',
      ),
      ...claimRows.filter((x) => link(x).option),
    ];
    const claims: ReportClaim[] = [];
    for (const x of ordered.slice(0, REPORT_LIMITS.claims)) {
      const ev = await this.claimEvidenceIn(c, ws, x);
      const passages = new Map(
        (
          await c.query(
            `select id, paragraph, char_start, char_end from source_passages
              where workspace_id = $1 and id = any($2::uuid[])`,
            [
              ws,
              ev.rows
                .map((s) => s.support.passage_id)
                .filter((p): p is string => p !== null),
            ],
          )
        ).rows.map((p: Row) => [
          String(p.id).toLowerCase(),
          `paragraph ${Number(p.paragraph) + 1}, characters ${Number(p.char_start)}–${Number(p.char_end)}`,
        ]),
      );
      claims.push({
        id: ev.claim.id,
        version: ev.claim.version,
        statement: ev.claim.statement ?? ev.claim.title,
        basis: ev.claim.basis,
        relation: link(x).relation,
        for_option: link(x).option,
        evidence_status: ev.status,
        labels: ev.labels,
        sources: ev.rows
          .filter((s) => s.support.retracted_at === null)
          .slice(0, REPORT_LIMITS.sources)
          .map((s) => ({
            source_id: s.support.source_id,
            source_version: s.support.source_version,
            title: s.source_title,
            url: s.source_url,
            stance: s.support.stance,
            freshness: s.freshness,
            quote: s.support.quote,
            locator: s.support.passage_id
              ? (passages.get(s.support.passage_id.toLowerCase()) ?? null)
              : null,
          })),
      });
    }
    // Every option recorded for the problem, rejected and archived ones too.
    const options: ReportOption[] = (
      await c.query(
        `select distinct on (e.id) e.* from entity_links l
           join entities e on e.workspace_id = l.workspace_id and e.id = l.from_id
          where l.workspace_id = $1 and l.relation = 'derived_from' and l.to_id = $2
            and l.from_kind = 'alternative'
            and l.retracted_at is null and e.status <> 'redacted'
          order by e.id`,
        [ws, id],
      )
    ).rows
      .sort((a: Row, b: Row) =>
        iso(a.created_at).localeCompare(iso(b.created_at)),
      )
      .map((o: Row) => {
        const ob = obj(o.body);
        return {
          id: String(o.id),
          version: Number(o.version),
          title: String(o.title),
          kind: str(ob.kind) || 'build',
          status: String(o.status),
          rationale: str(ob.rationale),
          tradeoffs: arr(ob.tradeoffs).map(str).filter(Boolean),
          uncertainty: str(ob.uncertainty),
          rank: null,
          score: null,
          score_status: null,
          disagreements: [],
          gates: [],
        };
      });
    // Titles of every option (also those cut from the list) for selections and claims.
    const titles = new Map(options.map((o) => [o.id.toLowerCase(), o.title]));
    for (const cl of claims)
      if (cl.for_option)
        cl.for_option =
          titles.get(cl.for_option) ?? `option ${cl.for_option.slice(0, 8)}`;
    const selectionRows = (
      await c.query(
        `select s.*, a.display_name, a.kind as actor_kind from selections s
           join actors a on a.id = s.actor_id
          where s.workspace_id = $1 and s.problem_id = $2
          order by s.created_at desc, s.id desc`,
        [ws, id],
      )
    ).rows as Row[];
    const selections: ReportSelection[] = selectionRows
      .slice(0, REPORT_LIMITS.selections)
      .map((s: Row, i: number) => ({
        id: String(s.id),
        created_at: iso(s.created_at),
        current: i === 0,
        by: s.autopilot_id
          ? 'the autopilot'
          : who(s.display_name, s.actor_kind),
        rationale: String(s.rationale),
        override_reason:
          s.override_reason === null ? null : String(s.override_reason),
        gate_overrides: arr(s.gate_overrides).map((g) => {
          const x = obj(g);
          const alt = obj(x.alternative);
          return {
            option_title:
              titles.get(str(alt.id).toLowerCase()) ??
              `option ${str(alt.id).slice(0, 8)}`,
            disposition: str(x.disposition),
            reasons: arr(x.reasons).map(str),
          };
        }),
        gate_override_reason:
          s.gate_override_reason == null
            ? null
            : String(s.gate_override_reason),
        dispositions: arr(s.dispositions).map((d) => {
          const x = obj(d);
          const alt = obj(x.alternative);
          return {
            option_id: str(alt.id),
            option_title:
              titles.get(str(alt.id).toLowerCase()) ??
              `option ${str(alt.id).slice(0, 8)}`,
            disposition: str(x.disposition),
            reasons: arr(x.reasons).map(str),
            reverse_if: str(x.reverse_if),
          };
        }),
      }));
    return {
      id,
      version: Number(r.version),
      status: String(r.status),
      title: String(r.title),
      statement: str(body.statement),
      affected_group: str(body.affected_group),
      uncertainty: str(body.uncertainty),
      claims,
      claims_omitted: Math.max(0, ordered.length - claims.length),
      options: options.slice(0, REPORT_LIMITS.options),
      options_omitted: Math.max(0, options.length - REPORT_LIMITS.options),
      comparison_note: null,
      selections,
      selections_omitted: Math.max(
        0,
        selectionRows.length - REPORT_LIMITS.selections,
      ),
    };
  }

  private async reportHumility(c: PoolClient, ws: string) {
    const rows = (
      await c.query(
        `select h.*, s.title as subject_title from entities h
           left join entities s on s.workspace_id = h.workspace_id
             and s.id::text = lower(h.body->'subject'->>'id') and s.status <> 'redacted'
          where h.workspace_id = $1 and h.kind = 'humility_review' and h.status = 'active'
          order by h.created_at desc, h.id desc`,
        [ws],
      )
    ).rows as Row[];
    const list = rows
      .slice(0, REPORT_LIMITS.humility)
      .reverse()
      .map((r: Row) => {
        const b = obj(r.body);
        const subject = obj(b.subject);
        return {
          id: String(r.id),
          version: Number(r.version),
          subject_id: str(subject.id),
          subject_version: Number(subject.version ?? 0),
          subject_title:
            typeof r.subject_title === 'string' ? r.subject_title : null,
          disposition: str(b.disposition),
          rationale: str(b.rationale),
          ethical_status: str(obj(b.ethical).status),
          dissent: arr(b.dissent).map(str).filter(Boolean),
        };
      });
    return {
      list,
      omitted: Math.max(0, rows.length - REPORT_LIMITS.humility),
    };
  }

  /** Where the work stopped for a person, and what people decided, oldest first. */
  private async reportInterventions(c: PoolClient, ws: string) {
    const human = `a.kind = 'human'`;
    // Every human decision and every request that waited for a person, as one union.
    const union = `
           select d.answered_at as at, a.display_name, a.kind,
             'Answered a request (' || d.kind || '): ' || coalesce(d.request->>'question', d.reason) as what,
             replace(coalesce(d.response->>'choice', ''), '_', ' ') || coalesce(' (' || (d.response->>'option_id') || ')', '')
               || ': ' || coalesce(d.response->>'rationale', '') as detail
             from decision_requests d join actors a on a.id = d.answered_by
            where d.workspace_id = $1 and d.status = 'answered' and ${human}
           union all
           select d.created_at, 'nobody yet', 'waiting',
             'Asked a person (' || d.kind || ', ' || d.status || '): ' || coalesce(d.request->>'question', d.reason),
             coalesce(d.closed_reason, '')
             from decision_requests d where d.workspace_id = $1 and d.status <> 'answered'
           union all
           select g.created_at, a.display_name, a.kind,
             'Confirmed the ' || g.gate || ' gate for option ' || coalesce(e.title, g.alternative_id::text),
             g.reason
             from gate_confirmations g join actors a on a.id = g.actor_id
               left join entities e on e.id = g.alternative_id
            where g.workspace_id = $1 and ${human}
           union all
           select s.created_at, a.display_name, a.kind,
             'Recorded a selection for problem ' || coalesce(e.title, s.problem_id::text), s.rationale
             from selections s join actors a on a.id = s.actor_id
               left join entities e on e.id = s.problem_id
            where s.workspace_id = $1 and s.autopilot_id is null and ${human}
           union all
           select f.created_at, a.display_name, a.kind,
             'Froze spec ' || coalesce(e.title, f.spec_id::text) || ' version ' || f.spec_version, ''
             from spec_freezes f join actors a on a.id = f.actor_id
               left join entities e on e.id = f.spec_id
            where f.workspace_id = $1 and ${human}
           union all
           select p.created_at, a.display_name, a.kind,
             'Reviewed proposal ' || coalesce(e.title, p.proposal_id::text) || ' version ' || p.proposal_version
               || ': ' || p.verdict, p.comments
             from proposal_reviews p join actors a on a.id = p.reviewer
               left join entities e on e.id = p.proposal_id
            where p.workspace_id = $1 and ${human}
           union all
           select fb.created_at, a.display_name, a.kind,
             'Gave ' || replace(fb.category, '_', ' ') || ' feedback on build ' || left(fb.artifact_id::text, 8)
               || ' (' || fb.status || ')', fb.body
             from artifact_feedback fb join actors a on a.id = fb.created_by
            where fb.workspace_id = $1 and ${human}
           union all
           select r.cancelled_at, a.display_name, a.kind, 'Cancelled run ' || left(r.run_id::text, 8),
             coalesce(r.cancel_reason, '')
             from run_controls r join actors a on a.id = r.cancelled_by
            where r.workspace_id = $1 and r.state = 'cancelled' and ${human}`;
    const rows = (
      await c.query(
        `select * from (${union}) x order by at desc limit ${REPORT_LIMITS.interventions}`,
        [ws],
      )
    ).rows as Row[];
    const list: ReportIntervention[] = rows.reverse().map((r) => ({
      at: iso(r.at),
      who:
        r.kind === 'waiting'
          ? 'waiting for a person'
          : who(r.display_name, r.kind),
      what: String(r.what ?? ''),
      detail: String(r.detail ?? ''),
    }));
    // Counted with the same filters as the list, so the number left out is exact.
    const total =
      rows.length < REPORT_LIMITS.interventions
        ? rows.length
        : Number(
            (await c.query(`select count(*)::int as n from (${union}) x`, [ws]))
              .rows[0]?.n ?? 0,
          );
    return { list, omitted: Math.max(0, total - list.length) };
  }

  /**
   * Artifacts with no package manifest (build output the Builds list cannot show), and
   * product records, counted apart: a product is a catalog record, not a build.
   */
  private async reportUnpackaged(c: PoolClient, ws: string) {
    const r = (
      await c.query(
        `select
            (select count(*)::int from entities where workspace_id = $1 and kind = 'product'
               and status = 'active') as products,
            (select count(*)::int from entities e where e.workspace_id = $1 and e.kind = 'artifact'
               and e.status = 'active' and not exists (select 1 from artifact_manifests m
                 where m.workspace_id = e.workspace_id and m.entity_id = e.id)) as artifacts`,
        [ws],
      )
    ).rows[0] as Row;
    return {
      unpackaged_artifacts: Number(r.artifacts),
      product_records: Number(r.products),
    };
  }

  private async reportSpecs(c: PoolClient, ws: string) {
    const specs = (
      await c.query(
        `select * from entities where workspace_id = $1 and kind = 'specification'
            and status = 'active' order by updated_at desc, id limit ${REPORT_LIMITS.specs}`,
        [ws],
      )
    ).rows as Row[];
    const out = [];
    for (const s of specs) {
      const f = (
        await c.query(
          `select f.*, a.display_name, a.kind as actor_kind from spec_freezes f
             join actors a on a.id = f.actor_id
            where f.workspace_id = $1 and f.spec_id = $2
            order by f.spec_version desc limit 1`,
          [ws, s.id],
        )
      ).rows[0] as Row | undefined;
      // The checks of the frozen version when there is one, else of the current draft.
      const body = f
        ? obj(
            (
              await c.query(
                `select body from entity_versions where entity_id = $1 and version = $2`,
                [s.id, f.spec_version],
              )
            ).rows[0]?.body,
          )
        : obj(s.body);
      const parsed = SpecBodySchema.safeParse(body);
      out.push({
        id: String(s.id),
        version: Number(s.version),
        status: String(s.status),
        title: String(s.title),
        freeze: f
          ? {
              version: Number(f.spec_version),
              at: iso(f.created_at),
              content_hash: String(f.content_hash),
              by: who(f.display_name, f.actor_kind),
            }
          : null,
        checks_unreadable: !parsed.success,
        checks: parsed.success
          ? parsed.data.acceptance_checks.map((k) => {
              const all = [...(k.cases ?? []), ...(k.browser_cases ?? [])];
              const held = all.filter((x) => x.held_out).length;
              return {
                key: k.key,
                statement: k.statement,
                method: k.method,
                cases: all.length - held,
                held_out: held,
              };
            })
          : [],
      });
    }
    return out;
  }

  private async reportBuilds(
    c: PoolClient,
    ws: string,
  ): Promise<ReportBuild[]> {
    const rows = (
      await c.query(
        `select * from artifact_manifests where workspace_id = $1
          order by created_at desc, id limit ${REPORT_LIMITS.builds}`,
        [ws],
      )
    ).rows as Row[];
    const out: ReportBuild[] = [];
    for (const r of rows) {
      const m = obj(r.manifest);
      const build = obj(m.build);
      const tests = obj(m.tests);
      const costs = obj(m.costs);
      const toolchain = obj(m.toolchain);
      const checks = (v: unknown) =>
        arr(v).map((x) => {
          const k = obj(x);
          return {
            key: str(k.check_key),
            passed: k.passed === true,
            reason: typeof k.reason === 'string' ? k.reason : null,
          };
        });
      const settled = str(costs.settled_nano_usd);
      out.push({
        artifact_id: String(r.id),
        created_at: iso(r.created_at),
        state: String(r.state),
        spec_id: String(r.spec_id),
        spec_version: Number(r.spec_version),
        commit: String(r.commit),
        recipe: str(toolchain.recipe) || 'unknown',
        fixture_roles: build.fixture_roles === true,
        unqualified_trial: toolchain.role_qualification === 'unqualified_trial',
        calls: Number(build.calls ?? 0),
        repairs: Number(build.repairs ?? 0),
        qa: checks(tests.build_qa),
        package: checks(tests.package),
        settled_nano: /^(0|[1-9][0-9]*)$/.test(settled) ? settled : '0',
        unsettled_attempts: Number(costs.unsettled_attempts ?? 0),
        plan_requests: arr(obj(costs.plan_requests).request_ids).length,
        limitations: arr(m.limitations).map(str).filter(Boolean),
        feedback_omitted: Number(
          (
            await c.query(
              `select greatest(count(*) - ${REPORT_LIMITS.feedback}, 0)::int as n
                 from artifact_feedback where artifact_id = $1`,
              [r.id],
            )
          ).rows[0]?.n ?? 0,
        ),
        feedback: (
          await c.query(
            `select category, status, body from artifact_feedback where artifact_id = $1
              order by created_at, id limit ${REPORT_LIMITS.feedback}`,
            [r.id],
          )
        ).rows.map((f: Row) => ({
          category: String(f.category),
          status: String(f.status),
          text: String(f.body),
        })),
      });
    }
    return out;
  }

  private async reportProposals(c: PoolClient, ws: string) {
    return (
      await c.query(
        `select e.*, (select row_to_json(x) from (select proposal_version as version, verdict
             from proposal_reviews p where p.workspace_id = e.workspace_id and p.proposal_id = e.id
             order by created_at desc, id desc limit 1) x) as review
           from entities e where e.workspace_id = $1 and e.kind = 'proposal' and e.status = 'active'
          order by e.updated_at desc, e.id limit ${REPORT_LIMITS.proposals}`,
        [ws],
      )
    ).rows.map((r: Row) => {
      const review = r.review ? obj(r.review) : null;
      return {
        id: String(r.id),
        version: Number(r.version),
        title: String(r.title),
        response: str(obj(r.body).response),
        review: review
          ? { version: Number(review.version), verdict: str(review.verdict) }
          : null,
      };
    });
  }

  /** Requests and money from the budget records alone (ADR-0117: nothing is estimated). */
  private async reportMoney(c: PoolClient, ws: string) {
    const q = async (sql: string) => (await c.query(sql, [ws])).rows as Row[];
    const totals = (
      await q(
        `select coalesce(sum(incurred_nano) filter (where status = 'settled'), 0)::text as settled,
            coalesce(sum(reserved_nano) filter (where status in ('unknown', 'in_flight')), 0)::text as exposure,
            count(*) filter (where status = 'unknown')::int as unknown,
            count(*) filter (where status = 'in_flight')::int as in_flight
           from budget_reservations where workspace_id = $1`,
      )
    )[0]!;
    const plan = (
      await q(
        `select count(*)::int as total,
            count(*) filter (where p.state in ('in_flight', 'unknown'))::int as open
           from plan_requests p join plan_connections pc on pc.id = p.connection_id
          where pc.workspace_id = $1`,
      )
    )[0]!;
    return {
      // A denied row is an evaluation that was refused before anything was sent.
      attempts: counts(
        await q(
          `select status as k, count(*) as n from budget_reservations
            where workspace_id = $1 and status <> 'denied' group by status order by status`,
        ),
      ),
      denied: Number(
        (
          await q(
            `select count(*)::int as n from budget_reservations
              where workspace_id = $1 and status = 'denied'`,
          )
        )[0]!.n,
      ),
      settled_nano: String(totals.settled),
      unknown_exposure_nano: String(totals.exposure),
      unknown_attempts: Number(totals.unknown),
      in_flight_attempts: Number(totals.in_flight),
      providers: counts(
        await q(
          `select provider as k, count(*) as n from budget_reservations
            where workspace_id = $1 and status <> 'denied' group by provider order by provider`,
        ),
      ),
      envelopes: (
        await q(
          `select name, kind, status, cap_nano::text as cap, incurred_nano::text as incurred
             from budget_envelopes where workspace_id = $1
            order by array_position(array['global','period','run','task'], kind), created_at, id
            limit ${REPORT_LIMITS.envelopes}`,
        )
      ).map((e) => ({
        name: String(e.name),
        kind: String(e.kind),
        status: String(e.status),
        cap_nano: String(e.cap),
        incurred_nano: String(e.incurred),
      })),
      // Every request through this workspace's plan connections, as the usage panel counts
      // them: runs, builds, chat answers, verification and qualification alike.
      plan_requests: {
        total: Number(plan.total),
        open: Number(plan.open),
        by_purpose: counts(
          await q(
            `select p.purpose as k, count(*) as n from plan_requests p
               join plan_connections pc on pc.id = p.connection_id
              where pc.workspace_id = $1 group by p.purpose order by p.purpose`,
          ),
        ),
        by_state: counts(
          await q(
            `select p.state as k, count(*) as n from plan_requests p
               join plan_connections pc on pc.id = p.connection_id
              where pc.workspace_id = $1 group by p.state order by p.state`,
          ),
        ),
      },
    };
  }
}
