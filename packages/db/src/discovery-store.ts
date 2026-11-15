import {
  CreateExploredBriefRequestSchema,
  ExplorationResultSchema,
  ExploreScopeSchema,
  SearchBriefBodySchema,
  StartDiscoveryRequestSchema,
  StartExplorationRequestSchema,
  cutText,
  parse,
  type CatalogEntry,
  type ClaimEvidence,
  type ExplorationCatalogEntry,
  type ExplorationPacket,
  type ExplorationPreview,
  type ExploreScope,
  type StoredEntity,
  type WorkflowDetail,
} from '@creator/contracts';
import {
  DISCOVERY_PROMPT_HASH,
  DISCOVERY_ROLE_VERSION,
  EXPLORATION_PROMPT_HASH,
  EXPLORATION_ROLE_VERSION,
  MAX_EXPLORATION_PACKET_CHARS,
  MAX_PACKET_CHARS,
  briefFromCandidate,
  buildExplorationPacket,
  explorationPreviewHash,
  buildPacket,
  canonicalHash,
  discoveryContext,
  explorationContext,
} from '@creator/domain';
import { ResearchStore } from './research-store.js';
import {
  fail,
  normalize,
  toEntity,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';
import type {
  DiscoveryWorkflowContext,
  ExplorationWorkflowContext,
} from './workflow-store.js';

const summaryOf = (kind: string, body: Row | null): string => {
  if (!body) return '';
  const text =
    kind === 'problem'
      ? body.statement
      : kind === 'idea'
        ? body.summary
        : kind === 'search_brief'
          ? body.measurable_problem
          : body.rationale;
  return typeof text === 'string' ? cutText(text, 400) : '';
};

/**
 * T07 discovery runs (migration 6). The packet is assembled here from T06 claim evidence as
 * it stands at start, bound by hash into the workflow, and never changed afterwards; the
 * workflow tables, leases and broker path are the T05 ones.
 */
export class DiscoveryStore extends ResearchStore {
  async startDiscovery(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<WorkflowDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(StartDiscoveryRequestSchema, raw);
    await this.studyWorkflowGate(ctx, ws, runId, canonicalHash(req));
    // Read the evidence as the owner sees it now; its versions are re-checked at insert.
    const evidence: {
      claim: ClaimEvidence;
      bears_on: (typeof req.evidence)[number]['bears_on'];
    }[] = [];
    for (const e of req.evidence)
      evidence.push({
        claim: await this.claimEvidence(ctx, ws, e.claim_id, req.max_age_days),
        bears_on: e.bears_on,
      });
    const { brief, catalog } = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const s = await this.subjectVersion(c, ws, req.brief);
      if (s.kind !== 'search_brief')
        throw fail(
          'INVALID_CONTRACT',
          'Start a discovery run from a search_brief record.',
        );
      const assigned = await c.query(
        `select e.input_bindings from study_attempts a join study_execution_requests e on e.attempt_id=a.id where a.workspace_id=$1 and a.run_id=$2`,
        [ws, runId],
      );
      const bindings = assigned.rows[0]?.input_bindings as
        Record<string, string> | undefined;
      if (bindings) {
        const current = await c.query(
          'select id,content_hash,version,status from entities where workspace_id=$1 and id=any($2::uuid[])',
          [ws, Object.keys(bindings)],
        );
        if (
          current.rows.length !== Object.keys(bindings).length ||
          current.rows.some(
            (r) =>
              r.content_hash !== bindings[r.id] ||
              r.version !== 1 ||
              r.status !== 'active',
          )
        )
          throw fail(
            'VERSION_CONFLICT',
            'Frozen study inputs changed before dispatch.',
          );
      }
      const rows = (
        await c.query(
          `select id, kind, version, title, body from entities
            where workspace_id = $1 and kind in ('problem', 'idea', 'alternative')
              and status = 'active'
            order by updated_at desc, id limit 40`,
          [ws],
        )
      ).rows as Row[];
      return {
        brief: {
          id: req.brief.id.toLowerCase(),
          version: req.brief.version,
          content_hash: String(s.content_hash),
          title: String(s.title),
          body: parse(SearchBriefBodySchema, s.body),
        },
        catalog: (bindings ? [] : rows).map((r): Omit<CatalogEntry, 'ref'> => ({
          id: String(r.id),
          kind: r.kind as CatalogEntry['kind'],
          version: Number(r.version),
          title: String(r.title),
          summary: summaryOf(String(r.kind), r.body as Row | null),
        })),
      };
    });
    const packet = buildPacket({
      brief,
      evidence,
      catalog,
      max_age_days: req.max_age_days,
      now: new Date(),
    });
    if (JSON.stringify(packet).length > MAX_PACKET_CHARS)
      throw fail(
        'INVALID_CONTRACT',
        'The evidence packet is too large for one model message; select fewer claims.',
      );
    const context: DiscoveryWorkflowContext = {
      packet,
      packet_hash: canonicalHash(packet),
      // L-3: records the packet had no room for are still checked for duplicates.
      ...(packet.catalog_beyond_limit
        ? { duplicates_against: catalog.slice(0, 40) }
        : {}),
      perspectives: req.perspectives,
      excluded: req.excluded,
      max_revisions: req.max_revisions,
      constraints: brief.body.constraints,
    };
    const id = await this.idempotent(
      ws,
      ctx,
      { op: 'discovery.start', runId, req },
      async (c) => {
        const { rows } = await c.query<{ id: string; version: number }>(
          `select id, version from entities where workspace_id = $1 and id = any($2::uuid[])
             and kind = 'claim' for share`,
          [ws, packet.claims.map((x) => x.claim_id)],
        );
        for (const claim of packet.claims)
          if (
            rows.find((r) => r.id === claim.claim_id)?.version !== claim.version
          )
            throw fail(
              'VERSION_CONFLICT',
              `Claim ${claim.ref} changed while the packet was built; start again.`,
            );
        const bound = await c.query(
          `select e.input_bindings from study_attempts a join study_execution_requests e on e.attempt_id=a.id where a.workspace_id=$1 and a.run_id=$2`,
          [ws, runId],
        );
        const bindings = bound.rows[0]?.input_bindings as
          Record<string, string> | undefined;
        if (bindings) {
          const current = await c.query(
            'select id,content_hash,version,status from entities where workspace_id=$1 and id=any($2::uuid[]) for share',
            [ws, Object.keys(bindings)],
          );
          if (
            current.rows.length !== Object.keys(bindings).length ||
            current.rows.some(
              (r) =>
                r.content_hash !== bindings[r.id] ||
                r.version !== 1 ||
                r.status !== 'active',
            )
          )
            throw fail(
              'VERSION_CONFLICT',
              'Frozen study inputs changed during dispatch.',
            );
        }
        const workflowId = await this.insertWorkflow(c, ctx, ws, runId, {
          role: 'r02_discovery',
          roleVersion: DISCOVERY_ROLE_VERSION,
          promptHash: DISCOVERY_PROMPT_HASH,
          subject: req.brief,
          context: { ...context },
          limits: req.limits,
          envelopeId:
            req.resource_setup?.kind === 'api'
              ? req.resource_setup.envelope_id
              : (req.envelope_id ?? null),
          pricingSnapshotId:
            req.resource_setup?.kind === 'api'
              ? req.resource_setup.pricing_snapshot_id
              : (req.pricing_snapshot_id ?? null),
          resourceSetup: req.resource_setup,
          dataClass: req.data_class,
          audit: {
            perspectives: req.perspectives.length,
            packet_hash: context.packet_hash,
            sufficiency: packet.sufficiency.verdict,
            claims: packet.claims.length,
            catalog: packet.catalog.length,
          },
        });
        await this.insertTask(c, ctx, ws, workflowId, {
          kind: 'locate',
          ordinal: 0,
          round: 0,
          repair: 0,
          repairOf: null,
          state: 'queued',
          context: discoveryContext({
            context_version: 'discovery-context/1',
            role_version: DISCOVERY_ROLE_VERSION,
            packet_hash: context.packet_hash,
            perspective: null,
            proposal: null,
            round: 0,
            inputs: [],
            catalog_matches: [],
          }),
        });
        await this.coordinateIn(c, ctx, ws, workflowId);
        return workflowId;
      },
    );
    return this.getWorkflow(ctx, ws, id);
  }

  /** The packet a discovery workflow was bound to, for inspection. */
  async discoveryPacket(ctx: CommandContext, ws: string, workflowId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    workflowId = uuid(workflowId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select 1 from workflows where workspace_id = $1 and id = $2',
        [ws, workflowId],
      );
      if (!rows.length) throw fail('NOT_FOUND', 'Workflow not found.');
      const d = await this.discoveryContextOf(c, workflowId);
      return { packet: d.packet, packet_hash: d.packet_hash };
    });
  }

  /**
   * C53 "Explore for me" (ADR-0065): starts an exploration with no theme. The packet is built
   * here from the workspace's active claims, newest first, as the owner reads them now and
   * inside the scope, plus the catalog of problems, ideas, alternatives and search briefs; it
   * is bound by hash into the workflow and never changes. One explorer task runs on the T05
   * workflow path, so caps, leases, cancellation, restart and plan admission are the same as
   * discovery's. Frozen study runs are refused: this is not a study condition.
   */
  async startExploration(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<WorkflowDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(StartExplorationRequestSchema, raw);
    await this.studyWorkflowGate(ctx, ws, runId, null);
    const run = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const row = (
        await c.query<{ version: number }>(
          `select version from entities where workspace_id = $1 and id = $2 and kind = 'run'`,
          [ws, runId],
        )
      ).rows[0];
      if (!row) throw fail('NOT_FOUND', 'Run record not found.');
      return { id: runId, version: Number(row.version) };
    });
    const { packet, catalog } = await this.buildExploration(ctx, ws, req.scope);
    if (req.preview_hash && explorationPreviewHash(packet) !== req.preview_hash)
      throw fail(
        'VERSION_CONFLICT',
        'What Explore for me would send changed since the preview (a claim or record was added or changed). Check the preview again, then start.',
      );
    const context: ExplorationWorkflowContext = {
      packet,
      packet_hash: canonicalHash(packet),
      duplicates_against: catalog,
      left_out: req.scope.leave_out,
    };
    const id = await this.idempotent(
      ws,
      ctx,
      { op: 'exploration.start', runId, req },
      async (c) => {
        const { rows } = await c.query<{ id: string; version: number }>(
          `select id, version from entities where workspace_id = $1 and id = any($2::uuid[])
             and kind = 'claim' for share`,
          [ws, packet.claims.map((x) => x.claim_id)],
        );
        for (const claim of packet.claims)
          if (
            rows.find((r) => r.id === claim.claim_id)?.version !== claim.version
          )
            throw fail(
              'VERSION_CONFLICT',
              `Claim ${claim.ref} changed while the packet was built; start again.`,
            );
        const workflowId = await this.insertWorkflow(c, ctx, ws, runId, {
          role: 'r01_exploration',
          roleVersion: EXPLORATION_ROLE_VERSION,
          promptHash: EXPLORATION_PROMPT_HASH,
          subject: run,
          context: { ...context },
          limits: req.limits,
          envelopeId:
            req.resource_setup.kind === 'api'
              ? req.resource_setup.envelope_id
              : null,
          pricingSnapshotId:
            req.resource_setup.kind === 'api'
              ? req.resource_setup.pricing_snapshot_id
              : null,
          resourceSetup: req.resource_setup,
          dataClass: req.data_class,
          audit: {
            packet_hash: context.packet_hash,
            claims: packet.claims.length,
            usable_claims: packet.usable_claims,
            catalog: packet.catalog.length,
            max_candidates: req.scope.max_candidates,
            left_out: req.scope.leave_out.length,
          },
        });
        await this.insertTask(c, ctx, ws, workflowId, {
          kind: 'explore',
          ordinal: 0,
          round: 0,
          repair: 0,
          repairOf: null,
          state: 'queued',
          context: explorationContext(context.packet_hash),
        });
        await this.coordinateIn(c, ctx, ws, workflowId);
        return workflowId;
      },
    );
    return this.getWorkflow(ctx, ws, id);
  }

  /**
   * What an exploration with this scope would send now, without starting anything: the exact
   * packet, its hash and size (PR #131 review L-2). Any member may look.
   */
  async previewExploration(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ExplorationPreview> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const scope = parse(ExploreScopeSchema, raw ?? {});
    const { packet } = await this.buildExploration(ctx, ws, scope);
    return {
      packet,
      packet_hash: canonicalHash(packet),
      preview_hash: explorationPreviewHash(packet),
      chars: JSON.stringify(packet).length,
      limit: MAX_EXPLORATION_PACKET_CHARS,
    };
  }

  /**
   * Builds an exploration packet from the workspace's active claims, newest first, and its
   * catalog. Claims are read in small batches and reading stops once the packet is full, so a
   * large workspace costs no more than the packet holds (PR #131 review N-3). Search briefs
   * made from an earlier pick that no workflow used are not in the catalog, so an abandoned
   * pick does not mark the same problem as a duplicate later (review L-5).
   */
  private async buildExploration(
    ctx: CommandContext,
    ws: string,
    scope: ExploreScope,
  ): Promise<{
    packet: ExplorationPacket;
    catalog: Omit<ExplorationCatalogEntry, 'ref'>[];
  }> {
    const scan = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const claims = (
        await c.query<{ id: string }>(
          `select id from entities where workspace_id = $1 and kind = 'claim'
              and status = 'active'
            order by updated_at desc, id desc limit 200`,
          [ws],
        )
      ).rows.map((r) => r.id);
      const rows = (
        await c.query(
          `select e.id, e.kind, e.version, e.title, e.body from entities e
            where e.workspace_id = $1
              and e.kind in ('problem', 'idea', 'alternative', 'search_brief')
              and e.status = 'active'
              and not (e.kind = 'search_brief'
                and exists (select 1 from audit_events a where a.workspace_id = $1
                  and a.action = 'exploration.brief_created' and a.subject_id = e.id)
                and not exists (select 1 from workflows w where w.workspace_id = $1
                  and w.subject_id = e.id))
            order by e.updated_at desc, e.id limit 200`,
          [ws],
        )
      ).rows as Row[];
      return {
        claims,
        catalog: rows.map((r): Omit<ExplorationCatalogEntry, 'ref'> => ({
          id: String(r.id),
          kind: r.kind as ExplorationCatalogEntry['kind'],
          version: Number(r.version),
          title: String(r.title),
          summary: summaryOf(String(r.kind), r.body as Row | null),
        })),
      };
    });
    const now = new Date();
    const evidence: ClaimEvidence[] = [];
    let packet = buildExplorationPacket({
      scope,
      evidence,
      catalog: scan.catalog,
      now,
    });
    for (let i = 0; i < scan.claims.length; i += 10) {
      for (const id of scan.claims.slice(i, i + 10))
        evidence.push(
          await this.claimEvidence(ctx, ws, id, scope.max_age_days),
        );
      const unscanned = scan.claims.length - evidence.length;
      packet = buildExplorationPacket({
        scope,
        evidence,
        catalog: scan.catalog,
        now,
        unscanned,
      });
      // Full: a loaded claim did not fit, so no older one will.
      if (packet.not_searched.beyond_limit > unscanned) break;
    }
    if (scan.claims.length === 200)
      packet.not_searched.notes.unshift(
        'Only the 200 most recently changed claims were considered.',
      );
    if (scan.catalog.length === 200)
      packet.not_searched.notes.unshift(
        'Picks were checked for duplicates against the 200 most recently changed problems, ideas, options and briefs only.',
      );
    if (JSON.stringify(packet).length > MAX_EXPLORATION_PACKET_CHARS)
      throw fail(
        'INVALID_CONTRACT',
        'The exploration packet is too large for one model message; shorten the narrowing terms.',
      );
    return { packet, catalog: scan.catalog };
  }

  /** The packet an exploration read, for inspection. */
  async explorationPacket(ctx: CommandContext, ws: string, workflowId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    workflowId = uuid(workflowId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select 1 from workflows where workspace_id = $1 and id = $2',
        [ws, workflowId],
      );
      if (!rows.length) throw fail('NOT_FOUND', 'Workflow not found.');
      return this.explorationContextOf(c, workflowId);
    });
  }

  /**
   * Turns one shortlisted problem into a versioned search brief, written by application code
   * from the card (the owner edits it before discovery). Only a `candidate` qualifies; asking
   * again for the same card returns the brief made the first time. The choice is audited with
   * the exploration, its packet hash, the card and the owner's reason.
   */
  async createExploredBrief(
    ctx: CommandContext,
    ws: string,
    workflowId: string,
    candidate: string,
    raw: unknown,
  ): Promise<{ brief: StoredEntity; created: boolean }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    workflowId = uuid(workflowId);
    const req = parse(CreateExploredBriefRequestSchema, raw ?? {});
    if (!/^E[1-5]$/.test(candidate))
      throw fail('INVALID_CONTRACT', 'Name a shortlist entry E1–E5.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const wf = (
        await c.query(
          `select id, run_id, role, state, result, fixture, context from workflows
            where workspace_id = $1 and id = $2 for update`,
          [ws, workflowId],
        )
      ).rows[0] as Row | undefined;
      if (!wf || wf.role !== 'r01_exploration')
        throw fail('NOT_FOUND', 'Exploration not found.');
      const result = (wf.result as Row | null)?.exploration;
      if (!result || wf.state !== 'succeeded')
        throw fail(
          'INVALID_TRANSITION',
          'This exploration did not finish with a shortlist.',
        );
      const r = parse(ExplorationResultSchema, result);
      const entry = r.candidates.find((x) => x.ref === candidate);
      if (!entry) throw fail('NOT_FOUND', `No ${candidate} in this shortlist.`);
      if (entry.disposition !== 'candidate')
        throw fail(
          'INVALID_TRANSITION',
          `${candidate} is ${entry.disposition.replaceAll('_', ' ')}, not a candidate: ${entry.reasons.join(' ')}`,
        );
      const earlier = (
        await c.query<{ subject_id: string }>(
          `select subject_id from audit_events where workspace_id = $1
              and action = 'exploration.brief_created'
              and payload->>'workflow_id' = $2 and payload->>'candidate' = $3
            order by sequence desc limit 1`,
          [ws, workflowId, candidate],
        )
      ).rows[0];
      if (earlier) {
        const row = (
          await c.query(
            'select * from entities where workspace_id = $1 and id = $2',
            [ws, earlier.subject_id],
          )
        ).rows[0] as Row | undefined;
        if (row && row.status === 'active')
          return { brief: toEntity(row), created: false };
      }
      const scope = (wf.context as ExplorationWorkflowContext).packet.scope;
      const body = parse(
        SearchBriefBodySchema,
        briefFromCandidate(entry.card, scope, Boolean(wf.fixture)),
      );
      const brief = await this.insertEntity(
        c,
        ctx,
        ws,
        'search_brief',
        body.theme,
        body,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'exploration.brief_created',
        subjectKind: 'search_brief',
        subjectId: brief.id,
        subjectVersion: 1,
        contentHash: brief.content_hash,
        payload: {
          workflow_id: workflowId,
          candidate,
          packet_hash: r.packet_hash,
          output_hash: r.task?.output_hash ?? null,
          claims: entry.claims.map((x) => x.claim_id),
          reason: req.reason,
        },
        relatedIds: [workflowId, String(wf.run_id)],
      });
      return { brief, created: true };
    });
  }
}
