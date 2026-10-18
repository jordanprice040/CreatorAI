import {
  SearchBriefBodySchema,
  StartDiscoveryRequestSchema,
  parse,
  type CatalogEntry,
  type ClaimEvidence,
  type WorkflowDetail,
} from '@creator/contracts';
import {
  DISCOVERY_PROMPT_HASH,
  DISCOVERY_ROLE_VERSION,
  MAX_PACKET_CHARS,
  buildPacket,
  canonicalHash,
  discoveryContext,
} from '@creator/domain';
import { ResearchStore } from './research-store.js';
import {
  fail,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';
import type { DiscoveryWorkflowContext } from './workflow-store.js';

const summaryOf = (kind: string, body: Row | null): string => {
  if (!body) return '';
  const text =
    kind === 'problem'
      ? body.statement
      : kind === 'idea'
        ? body.summary
        : body.rationale;
  return typeof text === 'string' ? text.slice(0, 400) : '';
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
          envelopeId: req.envelope_id,
          pricingSnapshotId: req.pricing_snapshot_id,
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
}
