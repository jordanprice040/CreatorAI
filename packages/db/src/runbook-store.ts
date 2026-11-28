import type { PoolClient } from 'pg';
import {
  HumilityBodySchema,
  PROPOSAL_MAX_CITED_CLAIMS,
  SpecBodySchema,
  type ProposalReference,
  type RunbookManifest,
} from '@creator/contracts';
import {
  actionRunbook,
  humilityGate,
  runbookFileName,
  softwareRunbook,
  validateSpec,
  writeZip,
  type RunbookOption,
  type RunbookProblem,
  type RunbookSelection,
} from '@creator/domain';
import { ProposalStore } from './proposal-store.js';
import { contentOf, toFreeze, toSelection } from './selection-store.js';
import {
  fail,
  iso,
  normalize,
  toEntity,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export interface RunbookExport {
  name: string;
  version: number;
  manifest: RunbookManifest;
  archive: Buffer;
}

/**
 * ADR-0080 (P16): an implementation runbook exported from one saved spec or proposal version.
 * Nothing is stored: the bundle is computed on read from the version and the records it
 * follows, by any member who can read them. Reading a runbook grants and changes nothing.
 */
export class RunbookStore extends ProposalStore {
  private async runbookSelection(
    c: PoolClient,
    ws: string,
    selectionId: string,
    optionId: string,
  ): Promise<RunbookSelection & { problem_id: string }> {
    const { rows } = await c.query(
      `select s.*, (select l.id from selections l where l.workspace_id = s.workspace_id
           and l.problem_id = s.problem_id order by l.created_at desc, l.id desc limit 1) as latest
         from selections s where s.workspace_id = $1 and s.id = $2`,
      [ws, selectionId.toLowerCase()],
    );
    const r = rows[0] as Row | undefined;
    if (!r)
      throw fail('NOT_FOUND', 'The selection this follows was not found.');
    const selection = toSelection(r, r.latest === r.id);
    const choice = selection.dispositions.find(
      (d) => d.alternative.id.toLowerCase() === optionId.toLowerCase(),
    );
    return {
      id: selection.id,
      created_at: selection.created_at,
      current: selection.current,
      rationale: selection.rationale,
      disposition: choice?.disposition ?? null,
      reasons: choice?.reasons ?? [],
      reverse_if: choice?.reverse_if ?? null,
      problem_id: selection.problem.id,
    };
  }

  /** The option as it was at the version the subject names, and its version now. */
  private async runbookOption(
    c: PoolClient,
    ws: string,
    ref: { id: string; version: number },
  ): Promise<RunbookOption> {
    const id = ref.id.toLowerCase();
    const now = (
      await c.query(
        `select version, status from entities where workspace_id = $1 and id = $2 and kind = 'alternative'`,
        [ws, id],
      )
    ).rows[0] as Row | undefined;
    if (!now || now.status === 'redacted')
      throw fail('NOT_FOUND', 'The option this follows was not found.');
    const v = (
      await c.query(
        `select title, body from entity_versions where workspace_id = $1 and entity_id = $2
            and version = $3 and body is not null`,
        [ws, id, ref.version],
      )
    ).rows[0] as Row | undefined;
    if (!v)
      throw fail('NOT_FOUND', 'The option version this follows was not found.');
    const body = (v.body as Row | null) ?? {};
    return {
      id,
      version: ref.version,
      kind: str(body.kind) || 'build',
      title: String(v.title),
      rationale: str(body.rationale),
      tradeoffs: Array.isArray(body.tradeoffs)
        ? (body.tradeoffs as unknown[]).map(str).filter(Boolean).slice(0, 20)
        : [],
      uncertainty: str(body.uncertainty),
      current_version: now.status === 'active' ? Number(now.version) : null,
    };
  }

  private async runbookProblem(
    c: PoolClient,
    ws: string,
    problemId: string,
  ): Promise<RunbookProblem | null> {
    const r = (
      await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'problem'`,
        [ws, problemId.toLowerCase()],
      )
    ).rows[0] as Row | undefined;
    if (!r || r.status === 'redacted') return null;
    const e = toEntity(r);
    return {
      id: e.id,
      version: e.version,
      title: e.title,
      statement: str(e.body?.statement),
      affected_group: str(e.body?.affected_group),
    };
  }

  /** Active claims linked to the problem, as references: supporting first, then contrary. */
  private async problemReferences(
    c: PoolClient,
    ws: string,
    problemId: string,
  ): Promise<{ references: ProposalReference[]; omitted: number }> {
    const linked = await this.problemClaims(c, ws, problemId.toLowerCase());
    if (!linked.size) return { references: [], omitted: 0 };
    const rows = (
      await c.query(
        `select * from entities where workspace_id = $1 and kind = 'claim'
            and id = any($2::uuid[]) and status = 'active' order by created_at, id`,
        [ws, [...linked.keys()]],
      )
    ).rows as Row[];
    const relation = (r: Row) => linked.get(String(r.id).toLowerCase())!;
    const ordered = [
      ...rows.filter((r) => relation(r) === 'supports'),
      ...rows.filter((r) => relation(r) === 'contradicts'),
    ];
    const references: ProposalReference[] = [];
    for (const r of ordered.slice(0, PROPOSAL_MAX_CITED_CLAIMS)) {
      const ev = await this.claimEvidenceIn(c, ws, r);
      references.push({
        label: `R${references.length + 1}`,
        claim: { id: String(r.id), version: Number(r.version) },
        current_version: Number(r.version),
        statement: String((r.body as Row | null)?.statement ?? r.title).slice(
          0,
          2000,
        ),
        relation: relation(r),
        status: ev.status,
        // A retracted support row is no longer evidence, so it does not leave the studio.
        sources: ev.rows
          .filter((x) => x.freshness !== 'retracted')
          .slice(0, 10)
          .map((x) => ({
            title: x.source_title.slice(0, 500),
            url: x.source_url.slice(0, 2000),
            stance: x.support.stance,
            freshness: x.freshness,
            quote: x.support.quote,
          })),
      });
    }
    return {
      references,
      omitted: Math.max(0, ordered.length - references.length),
    };
  }

  private pack(
    built: ReturnType<typeof softwareRunbook>,
    version: number,
  ): RunbookExport {
    return {
      name: runbookFileName(built.manifest.title, version),
      version,
      manifest: built.manifest,
      archive: writeZip(built.files),
    };
  }

  /** The runbook of one spec version (the current one by default). */
  async specRunbook(
    ctx: CommandContext,
    ws: string,
    specId: string,
    version?: number,
  ): Promise<RunbookExport> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    specId = uuid(specId);
    const input = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'specification'`,
        [ws, specId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Specification not found.');
      const e = toEntity(rows[0] as Row);
      if (e.status === 'redacted')
        throw fail('NOT_FOUND', 'Specification was redacted.');
      const want = version ?? e.version;
      const v = (
        await c.query(
          `select version, title, body, content_hash, created_at from entity_versions
            where workspace_id = $1 and entity_id = $2 and version = $3 and body is not null`,
          [ws, e.id, want],
        )
      ).rows[0] as Row | undefined;
      const parsed = SpecBodySchema.safeParse(v?.body);
      if (!v || !parsed.success)
        throw fail('NOT_FOUND', `Specification version ${want} not found.`);
      const body = parsed.data;
      const content = contentOf(body);
      const graph = validateSpec(content);
      if (graph.length)
        throw fail(
          'INVALID_CONTRACT',
          `Fix the spec’s task plan before exporting a runbook: ${graph
            .map((p) => p.detail)
            .join(' ')}`.slice(0, 900),
        );
      const freezes = (
        await c.query(
          `select * from spec_freezes where workspace_id = $1 and spec_id = $2
            order by spec_version desc`,
          [ws, e.id],
        )
      ).rows.map((r: Row) => toFreeze(r));
      const freeze = freezes.find((f) => f.spec.version === want) ?? null;
      const option = await this.runbookOption(c, ws, body.alternative);
      const { problem_id, ...selection } = await this.runbookSelection(
        c,
        ws,
        body.selection_id,
        option.id,
      );
      const problem = await this.runbookProblem(c, ws, problem_id);
      const { references, omitted } = problem
        ? await this.problemReferences(c, ws, problem.id)
        : { references: [], omitted: 0 };
      // The newest active humility review of this spec (BOUNDED_BUILDER: the spec is the subject),
      // or (ADR-0138, review 1 L-4) of the exact option version the spec builds, the one written
      // in Decide that a build admission accepts too. A passing review wins; the spec's first.
      const reviewOf = async (id: string, version: number, exact: boolean) =>
        (
          await c.query(
            `select * from entities where workspace_id = $1 and kind = 'humility_review'
                and status = 'active' and body->'subject'->>'id' = $2
                and ($4::boolean = false or (body->'subject'->>'version')::int = $3)
              order by (body->'subject'->>'version')::int = $3 desc, updated_at desc, id limit 1`,
            [ws, id, version, exact],
          )
        ).rows[0] as Row | undefined;
      const judge = (
        h: Row | undefined,
        subject: { id: string; version: number },
      ) => {
        const hb = h ? HumilityBodySchema.safeParse(h.body) : null;
        // The same gate a build goes through (ADR-0077 for a hybrid).
        const gate =
          h && hb?.success
            ? humilityGate(
                {
                  id: String(h.id),
                  version: Number(h.version),
                  status: String(h.status),
                  body: h.body,
                },
                subject,
                option.kind === 'hybrid' ? 'hybrid' : 'software',
              )
            : null;
        return { h, hb, gate };
      };
      const ofSpec = judge(await reviewOf(e.id, want, false), {
        id: e.id,
        version: want,
      });
      const ofOption = judge(
        await reviewOf(body.alternative.id, body.alternative.version, true),
        body.alternative,
      );
      const picked =
        [ofSpec, ofOption].find((x) => x.gate?.build_admissible) ??
        (ofSpec.h ? ofSpec : ofOption);
      const { h, hb, gate } = picked;
      const viaOption = picked === ofOption && !!h;
      return {
        spec: {
          id: e.id,
          version: want,
          title: String(v.title),
          content_hash: String(v.content_hash),
          saved_at: iso(v.created_at),
          content,
        },
        freeze: freeze
          ? {
              id: freeze.id,
              frozen_at: freeze.created_at,
              content_hash: freeze.content_hash,
            }
          : null,
        latest_frozen_version: freezes[0]?.spec.version ?? null,
        problem,
        option,
        selection,
        humility:
          h && hb?.success
            ? {
                id: String(h.id),
                version: Number(h.version),
                subject_version: hb.data.subject.version,
                ...(viaOption ? { of_option: option.title } : {}),
                disposition: hb.data.disposition,
                software_part: hb.data.software_part,
                human_part: hb.data.human_part,
                burden_risks: hb.data.burden_risks,
                disconfirming_test: hb.data.disconfirming_test,
                change_course_trigger: hb.data.change_course_trigger,
                rationale: hb.data.rationale,
                ethical_status: hb.data.ethical.status,
                ethical_note: hb.data.ethical.note,
                dissent: hb.data.dissent,
                build_admissible: gate!.build_admissible,
                needs_judgment: gate!.needs_judgment,
                gate_reasons: gate!.reasons,
              }
            : null,
        references,
        references_omitted: omitted,
      };
    });
    return this.pack(softwareRunbook(input), input.spec.version);
  }

  /** The action runbook of one proposal version (the current one by default). */
  async proposalRunbook(
    ctx: CommandContext,
    ws: string,
    proposalId: string,
    version?: number,
  ): Promise<RunbookExport> {
    // One read of one version: the plan text is rendered from it inside actionRunbook.
    const d = await this.proposalDetail(ctx, ws, proposalId, version);
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = d.proposal.body;
    const rest = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const option = await this.runbookOption(c, ws, body.alternative);
      const { problem_id: _p, ...selection } = await this.runbookSelection(
        c,
        ws,
        body.selection_id,
        option.id,
      );
      return {
        option,
        selection,
        problem: await this.runbookProblem(c, ws, body.problem.id),
      };
    });
    return this.pack(
      actionRunbook({
        proposal: {
          id: d.proposal.id,
          version: d.shown_version,
          title: d.proposal.title,
          content_hash: d.proposal.content_hash,
          saved_at:
            d.versions.find((x) => x.version === d.shown_version)?.created_at ??
            d.proposal.updated_at,
          body,
          checks: d.checks,
          problem_title: d.problem_title,
          option_title: d.option_title,
        },
        ...rest,
      }),
      d.shown_version,
    );
  }
}
