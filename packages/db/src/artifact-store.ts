import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BuildManifestSchema,
  DecideFeedbackRequestSchema,
  FeedbackRevisionRequestSchema,
  StartPreviewRequestSchema,
  StopPreviewRequestSchema,
  SubmitFeedbackRequestSchema,
  parse,
  type ArtifactComparison,
  type ArtifactSummary,
  type BuildManifest,
  type Feedback,
  type Preview,
} from '@creator/contracts';
import { canonicalHash } from '@creator/domain';
import { StudyStore } from './study-store.js';
import {
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** The only isolation backend whose manifests a real (non-fixture) workspace accepts. */
export const REVIEWED_ARTIFACT_BACKEND = 'wsl2-bwrap-systemd';
/** Simultaneous live previews per workspace: each holds the single local worker on use. */
export const MAX_ACTIVE_PREVIEWS = 2;
const secretHash = (v: string) => createHash('sha256').update(v).digest('hex');
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export interface ArtifactRecord {
  summary: ArtifactSummary;
  manifest: BuildManifest;
}

/**
 * T13 artifact index, previews and feedback. Bytes stay in the local product store; callers
 * re-hash them against these rows on every download and start.
 */
export class ArtifactStore extends StudyStore {
  private async summaries(
    c: PoolClient,
    ws: string,
    where = 'true',
    params: unknown[] = [],
  ): Promise<ArtifactRecord[]> {
    const { rows } = await c.query(
      `select a.*, e.version as current_spec_version,
         not exists (select 1 from artifact_manifests b where b.workspace_id = a.workspace_id
           and b.spec_id = a.spec_id and b.created_at > a.created_at) as latest
       from artifact_manifests a join entities e on e.id = a.spec_id
       where a.workspace_id = $1 and ${where} order by a.created_at, a.id`,
      [ws, ...params],
    );
    return rows.map((r: Row) => {
      const manifest = parse(BuildManifestSchema, r.manifest);
      return {
        manifest,
        summary: {
          id: String(r.id),
          entity_id: String(r.entity_id),
          state: manifest.state,
          manifest_sha256: String(r.manifest_sha256),
          archive_sha256: String(r.archive_sha256),
          spec: { id: String(r.spec_id), version: Number(r.spec_version) },
          commit: String(r.commit),
          backend: manifest.toolchain.backend,
          availability: manifest.availability,
          current:
            Boolean(r.latest) &&
            Number(r.current_spec_version) === Number(r.spec_version),
          previous_id: r.previous_id ? String(r.previous_id) : null,
          created_at: iso(r.created_at),
        },
      };
    });
  }
  private async artifact(c: PoolClient, ws: string, artifactId: string) {
    const [a] = await this.summaries(c, ws, 'a.id = $2', [uuid(artifactId)]);
    if (!a) throw fail('NOT_FOUND', 'Artifact not found.');
    return a;
  }
  private preview(r: Row): Preview {
    const live = r.state === 'starting' || r.state === 'ready';
    const expired = live && Date.parse(iso(r.expires_at)) <= Date.now();
    return {
      id: String(r.id),
      artifact_id: String(r.artifact_id),
      manifest_sha256: String(r.manifest_sha256),
      state: expired ? 'expired' : (r.state as Preview['state']),
      readiness: (r.readiness as unknown) ?? null,
      max_runs: Number(r.max_runs),
      runs_used: Number(r.runs_used),
      expires_at: iso(r.expires_at),
      created_at: iso(r.created_at),
      ended_at: r.ended_at ? iso(r.ended_at) : null,
      end_reason: (r.end_reason as string | null) ?? null,
      version: Number(r.version),
    };
  }
  private feedback(r: Row): Feedback {
    return {
      id: String(r.id),
      artifact_id: String(r.artifact_id),
      manifest_sha256: String(r.manifest_sha256),
      spec: { id: String(r.spec_id), version: Number(r.spec_version) },
      category: r.category as Feedback['category'],
      text: String(r.body),
      status: r.status as Feedback['status'],
      rationale: (r.rationale as string | null) ?? null,
      revision:
        r.revision_spec_version === null
          ? null
          : { id: String(r.spec_id), version: Number(r.revision_spec_version) },
      version: Number(r.version),
      created_at: iso(r.created_at),
    };
  }

  /**
   * Indexes a manifest the caller has already read from disk and hashed. It must name the
   * current frozen spec version and its exact task hash; revisions name their feedback.
   */
  async registerArtifact(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    manifestSha256: string,
  ): Promise<ArtifactSummary> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const m = parse(BuildManifestSchema, raw);
    await this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      if (m.workspace_id !== ws || m.owner_id !== ctx.actorId)
        throw fail(
          'ACCESS_DENIED',
          'The manifest belongs to another workspace or owner.',
        );
      const w = await c.query('select fixture from workspaces where id = $1', [
        ws,
      ]);
      if (
        !w.rows[0]?.fixture &&
        m.toolchain.backend !== REVIEWED_ARTIFACT_BACKEND
      )
        throw fail(
          'EVIDENCE_MISMATCH',
          'Real workspaces accept only manifests executed in the reviewed isolation backend.',
        );
      const spec = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'specification' for share`,
        [ws, m.spec.id],
      );
      const s = spec.rows[0] as Row | undefined;
      if (!s) throw fail('NOT_FOUND', 'Specification not found.');
      if (
        Number(s.version) !== m.spec.version ||
        s.content_hash !== m.spec.hash
      )
        throw fail(
          'VERSION_CONFLICT',
          'Stale version: the manifest was built from a superseded specification version.',
        );
      const freeze = await c.query(
        'select * from spec_freezes where workspace_id = $1 and id = $2',
        [ws, m.spec.freeze_id],
      );
      const f = freeze.rows[0] as Row | undefined;
      if (
        !f ||
        f.spec_id !== m.spec.id ||
        Number(f.spec_version) !== m.spec.version ||
        f.content_hash !== m.spec.hash ||
        (f.task_hashes as Record<string, string>)[m.task.key] !== m.task.hash
      )
        throw fail(
          'EVIDENCE_MISMATCH',
          'The manifest does not match the recorded freeze of its spec and task.',
        );
      let previousId: string | null = null;
      if (m.lineage.previous) {
        const p = await c.query(
          'select * from artifact_manifests where workspace_id = $1 and id = $2',
          [ws, m.lineage.previous.artifact_id],
        );
        const prev = p.rows[0] as Row | undefined;
        if (
          !prev ||
          prev.manifest_sha256 !== m.lineage.previous.manifest_sha256 ||
          prev.spec_id !== m.spec.id
        )
          throw fail(
            'EVIDENCE_MISMATCH',
            'The previous artifact named by this revision does not match.',
          );
        previousId = String(prev.id);
      }
      for (const fid of m.lineage.feedback_ids) {
        const fb = await c.query(
          'select * from artifact_feedback where workspace_id = $1 and id = $2',
          [ws, fid],
        );
        const r = fb.rows[0] as Row | undefined;
        if (
          !r ||
          r.status !== 'revised' ||
          Number(r.revision_spec_version) !== m.spec.version ||
          r.artifact_id !== previousId
        )
          throw fail(
            'EVIDENCE_MISMATCH',
            'Linked feedback must be accepted into this spec version for the previous artifact.',
          );
      }
      const entity = await this.insertEntity(
        c,
        ctx,
        ws,
        'artifact',
        `Source package ${m.repository.commit.slice(0, 10)} (spec v${m.spec.version}, ${m.state})`,
        {
          storage_uri: `artifact://${m.product_id}/${m.id}/source.tar`,
          sha256: m.package.sha256,
          bytes: m.package.bytes,
          media_type: m.package.media_type,
        },
      );
      await this.linkTo(
        c,
        ctx,
        ws,
        'implements',
        entity,
        { id: m.spec.id, kind: 'specification', version: m.spec.version },
        'Packaged from this exact frozen spec version.',
      );
      await c.query(
        `insert into artifact_manifests (id, workspace_id, entity_id, product_id, spec_id,
           spec_version, freeze_id, commit, state, manifest, manifest_sha256, archive_sha256,
           previous_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          m.id,
          ws,
          entity.id,
          m.product_id,
          m.spec.id,
          m.spec.version,
          m.spec.freeze_id,
          m.repository.commit,
          m.state,
          m,
          manifestSha256,
          m.package.sha256,
          previousId,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'artifact.registered',
        subjectKind: 'artifact',
        subjectId: entity.id,
        subjectVersion: 1,
        contentHash: manifestSha256,
        payload: {
          artifact_id: m.id,
          state: m.state,
          commit: m.repository.commit,
          spec_version: m.spec.version,
        },
        relatedIds: [m.spec.id, ...(previousId ? [previousId] : [])],
      });
    });
    return (await this.artifactRecord(ctx, ws, m.id)).summary;
  }
  async listArtifacts(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return (await this.summaries(c, ws)).map((a) => a.summary);
    });
  }
  /** Owner-only read used right before bytes leave the store or code starts. */
  async artifactRecord(
    ctx: CommandContext,
    ws: string,
    artifactId: string,
    owner = false,
  ): Promise<ArtifactRecord> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      if (owner) await this.requireOwner(c, ws, ctx.actorId);
      else await this.role(c, ws, ctx.actorId, false);
      return this.artifact(c, ws, artifactId);
    });
  }
  async artifactActivity(ctx: CommandContext, ws: string, artifactId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const a = await this.artifact(c, ws, artifactId);
      const p = await c.query(
        'select * from artifact_previews where artifact_id = $1 order by created_at, id',
        [a.summary.id],
      );
      const f = await c.query(
        'select * from artifact_feedback where artifact_id = $1 order by created_at, id',
        [a.summary.id],
      );
      return {
        ...a,
        previews: p.rows.map((r) => this.preview(r as Row)),
        feedback: f.rows.map((r) => this.feedback(r as Row)),
      };
    });
  }

  /** Audit for a byte download, written after the owner and hash checks passed. */
  async recordDownload(ctx: CommandContext, ws: string, artifactId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    await this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const a = await this.artifact(c, ws, artifactId);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'artifact.downloaded',
        subjectKind: 'artifact',
        subjectId: a.summary.entity_id,
        subjectVersion: 1,
        contentHash: a.summary.archive_sha256,
        payload: { artifact_id: a.summary.id },
      });
    });
  }

  // ---- Previews --------------------------------------------------------------------------

  /** Leases a preview on one exact manifest. Readiness is settled by the caller's start. */
  async beginPreview(
    ctx: CommandContext,
    ws: string,
    artifactId: string,
    raw: unknown,
  ): Promise<{ preview: Preview; ticket: string; record: ArtifactRecord }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(StartPreviewRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      // Serialize lease counting per workspace.
      await c.query('select id from workspaces where id = $1 for update', [ws]);
      const record = await this.artifact(c, ws, artifactId);
      if (record.summary.manifest_sha256 !== req.expected_manifest_sha256)
        throw fail(
          'EVIDENCE_MISMATCH',
          'Hash mismatch: the preview request names a different manifest.',
        );
      if (record.manifest.availability.runnable_demo.state !== 'available')
        throw fail(
          'INVALID_TRANSITION',
          `No runnable demo: ${record.manifest.availability.runnable_demo.reason}`,
        );
      const active = await c.query(
        `select count(*)::int as n from artifact_previews where workspace_id = $1
           and state in ('starting','ready') and expires_at > clock_timestamp()`,
        [ws],
      );
      if (Number(active.rows[0]?.n) >= MAX_ACTIVE_PREVIEWS)
        throw fail(
          'LIMIT_EXCEEDED',
          `At most ${MAX_ACTIVE_PREVIEWS} previews may be live; stop one first.`,
        );
      const id = randomUUID();
      const ticket = randomBytes(32).toString('base64url');
      const { rows } = await c.query(
        `insert into artifact_previews (id, workspace_id, artifact_id, manifest_sha256, actor_id,
           ticket_hash, state, max_runs, expires_at)
         values ($1,$2,$3,$4,$5,$6,'starting',$7, clock_timestamp() + make_interval(mins => $8))
         returning *`,
        [
          id,
          ws,
          record.summary.id,
          record.summary.manifest_sha256,
          ctx.actorId,
          secretHash(ticket),
          req.max_runs,
          req.ttl_minutes,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'preview.leased',
        subjectKind: 'artifact',
        subjectId: record.summary.entity_id,
        subjectVersion: 1,
        contentHash: record.summary.manifest_sha256,
        payload: {
          preview_id: id,
          ttl_minutes: req.ttl_minutes,
          max_runs: req.max_runs,
        },
      });
      return { preview: this.preview(rows[0] as Row), ticket, record };
    });
  }
  async settlePreview(
    ctx: CommandContext,
    ws: string,
    previewId: string,
    state: 'ready' | 'failed' | 'blocked',
    readiness: unknown,
  ): Promise<Preview> {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `update artifact_previews set state = $3, readiness = $4, version = version + 1
         where workspace_id = $1 and id = $2 and state = 'starting' returning *`,
        [uuid(ws), uuid(previewId), state, JSON.stringify(readiness)],
      );
      // A stop that raced readiness wins; report the stopped lease.
      if (!rows[0]) return this.previewRow(c, ws, previewId);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: `preview.${state}`,
        subjectKind: 'preview',
        subjectId: previewId,
        subjectVersion: Number(rows[0].version),
        contentHash: String(rows[0].manifest_sha256),
        payload: { artifact_id: String(rows[0].artifact_id) },
      });
      return this.preview(rows[0] as Row);
    });
  }
  private async previewRow(c: PoolClient, ws: string, previewId: string) {
    const { rows } = await c.query(
      'select * from artifact_previews where workspace_id = $1 and id = $2',
      [uuid(ws), uuid(previewId)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Preview not found.');
    return this.preview(rows[0] as Row);
  }
  async stopPreview(
    ctx: CommandContext,
    ws: string,
    previewId: string,
    raw: unknown,
  ): Promise<Preview> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(StopPreviewRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { rows } = await c.query(
        'select * from artifact_previews where workspace_id = $1 and id = $2 for update',
        [ws, uuid(previewId)],
      );
      const r = rows[0] as Row | undefined;
      if (!r) throw fail('NOT_FOUND', 'Preview not found.');
      if (Number(r.version) !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The preview changed; reload it.');
      if (r.state === 'stopped' || r.state === 'revoked')
        throw fail(
          'INVALID_TRANSITION',
          `The preview is already ${String(r.state)}.`,
        );
      const state = req.revoke ? 'revoked' : 'stopped';
      const updated = await c.query(
        `update artifact_previews set state = $2, ended_at = clock_timestamp(), end_reason = $3,
           session_hash = null, version = version + 1 where id = $1 returning *`,
        [r.id, state, req.reason],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: `preview.${state}`,
        subjectKind: 'preview',
        subjectId: String(r.id),
        subjectVersion: Number(updated.rows[0].version),
        contentHash: String(r.manifest_sha256),
        payload: { artifact_id: String(r.artifact_id) },
      });
      return this.preview(updated.rows[0] as Row);
    });
  }
  /** Rechecks lease, expiry, owner membership and manifest; throws the precise refusal. */
  private async livePreview(c: PoolClient, previewId: string) {
    const { rows } = await c.query(
      'select * from artifact_previews where id = $1 for update',
      [uuid(previewId)],
    );
    const r = rows[0] as Row | undefined;
    if (!r) throw fail('NOT_FOUND', 'Preview not found.');
    if (r.state === 'revoked' || r.state === 'stopped')
      throw fail(
        'ACCESS_DENIED',
        `Preview access was ${String(r.state === 'revoked' ? 'revoked' : 'stopped')}.`,
      );
    if (Date.parse(iso(r.expires_at)) <= Date.now())
      throw fail('EXPIRED', 'This preview has expired.');
    if (r.state !== 'ready')
      throw fail(
        'INVALID_TRANSITION',
        `Preview is ${String(r.state)}, not ready.`,
      );
    const role = await c.query(
      'select role from workspace_members where workspace_id = $1 and actor_id = $2',
      [r.workspace_id, r.actor_id],
    );
    if (role.rows[0]?.role !== 'owner')
      throw fail(
        'ACCESS_DENIED',
        'The preview owner no longer owns this workspace.',
      );
    const a = await this.artifact(
      c,
      String(r.workspace_id),
      String(r.artifact_id),
    );
    if (a.summary.manifest_sha256 !== r.manifest_sha256)
      throw fail(
        'EVIDENCE_MISMATCH',
        'Hash mismatch between preview and manifest.',
      );
    return { row: r, record: a };
  }
  /** One-time ticket → preview-only session. Management sessions are never involved. */
  async openPreview(previewId: string, ticket: string): Promise<string> {
    return this.tx(async (c) => {
      const { row } = await this.livePreview(c, previewId);
      if (row.ticket_used || !same(secretHash(ticket), String(row.ticket_hash)))
        throw fail(
          'ACCESS_DENIED',
          'This preview link was already used or is wrong.',
        );
      const session = randomBytes(32).toString('base64url');
      await c.query(
        'update artifact_previews set ticket_used = true, session_hash = $2 where id = $1',
        [row.id, secretHash(session)],
      );
      await this.append(
        c,
        { actorId: String(row.actor_id) },
        {
          workspaceId: String(row.workspace_id),
          action: 'preview.opened',
          subjectKind: 'preview',
          subjectId: String(row.id),
          subjectVersion: Number(row.version),
          contentHash: String(row.manifest_sha256),
          payload: {},
        },
      );
      return session;
    });
  }
  /** Checks a preview session; with `claim`, also consumes one run from the lease. */
  async previewAccess(previewId: string, session: string, claim: boolean) {
    return this.tx(async (c) => {
      const { row, record } = await this.livePreview(c, previewId);
      if (
        !row.session_hash ||
        !same(secretHash(session), String(row.session_hash))
      )
        throw fail('ACCESS_DENIED', 'Preview session is not valid.');
      let r = row;
      if (claim) {
        if (Number(row.runs_used) >= Number(row.max_runs))
          throw fail(
            'LIMIT_EXCEEDED',
            'This preview has used all of its runs.',
          );
        r = (
          await c.query(
            'update artifact_previews set runs_used = runs_used + 1 where id = $1 returning *',
            [row.id],
          )
        ).rows[0] as Row;
      }
      return {
        preview: this.preview(r),
        record,
        workspace_id: String(row.workspace_id),
        actor_id: String(row.actor_id),
        product_id: String(
          (
            await c.query(
              'select product_id from artifact_manifests where id = $1',
              [row.artifact_id],
            )
          ).rows[0]!.product_id,
        ),
      };
    });
  }
  async recordPreviewRun(
    actorId: string,
    ws: string,
    previewId: string,
    result: {
      execution_id: string | null;
      state: string;
      exit_code: number | null;
    },
  ) {
    await this.tx(async (c) => {
      await this.append(
        c,
        { actorId },
        {
          workspaceId: ws,
          action: 'preview.run',
          subjectKind: 'preview',
          subjectId: previewId,
          subjectVersion: null,
          contentHash: null,
          payload: result,
        },
      );
    });
  }

  // ---- Feedback --------------------------------------------------------------------------

  async submitFeedback(
    ctx: CommandContext,
    ws: string,
    artifactId: string,
    raw: unknown,
  ): Promise<Feedback> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SubmitFeedbackRequestSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'feedback.submit', artifactId, req },
      async (c) => {
        await this.role(c, ws, ctx.actorId, true);
        const a = await this.artifact(c, ws, artifactId);
        if (a.summary.manifest_sha256 !== req.expected_manifest_sha256)
          throw fail(
            'VERSION_CONFLICT',
            'Stale version: feedback must name the exact artifact manifest you reviewed.',
          );
        const id = randomUUID();
        const contentHash = canonicalHash({
          category: req.category,
          text: req.text,
        });
        const { rows } = await c.query(
          `insert into artifact_feedback (id, workspace_id, artifact_id, manifest_sha256, spec_id,
           spec_version, category, body, content_hash, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',$10) returning *`,
          [
            id,
            ws,
            a.summary.id,
            a.summary.manifest_sha256,
            a.summary.spec.id,
            a.summary.spec.version,
            req.category,
            req.text,
            contentHash,
            ctx.actorId,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'feedback.submitted',
          subjectKind: 'feedback',
          subjectId: id,
          subjectVersion: 1,
          contentHash,
          payload: { artifact_id: a.summary.id, category: req.category },
          relatedIds: [a.summary.entity_id],
        });
        return this.feedback(rows[0] as Row);
      },
    );
  }
  private async lockFeedback(
    c: PoolClient,
    ws: string,
    id: string,
    expected: number,
  ) {
    const { rows } = await c.query(
      'select * from artifact_feedback where workspace_id = $1 and id = $2 for update',
      [ws, uuid(id)],
    );
    const r = rows[0] as Row | undefined;
    if (!r) throw fail('NOT_FOUND', 'Feedback not found.');
    if (Number(r.version) !== expected)
      throw fail('VERSION_CONFLICT', 'The feedback changed; reload it.');
    return r;
  }
  async decideFeedback(
    ctx: CommandContext,
    ws: string,
    feedbackId: string,
    raw: unknown,
  ): Promise<Feedback> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(DecideFeedbackRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const r = await this.lockFeedback(
        c,
        ws,
        feedbackId,
        req.expected_version,
      );
      if (r.status !== 'submitted')
        throw fail(
          'INVALID_TRANSITION',
          `Feedback is already ${String(r.status)}.`,
        );
      const status = req.decision === 'accept' ? 'accepted' : 'declined';
      const { rows } = await c.query(
        `update artifact_feedback set status = $2, rationale = $3, version = version + 1
         where id = $1 returning *`,
        [r.id, status, req.rationale],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: `feedback.${status}`,
        subjectKind: 'feedback',
        subjectId: String(r.id),
        subjectVersion: Number(rows[0].version),
        contentHash: String(r.content_hash),
        payload: { artifact_id: String(r.artifact_id) },
      });
      return this.feedback(rows[0] as Row);
    });
  }
  /**
   * Turns accepted feedback into the next spec version in one transaction. Feedback on an
   * artifact whose spec has already moved on is stale and refused.
   */
  async reviseFromFeedback(
    ctx: CommandContext,
    ws: string,
    feedbackId: string,
    raw: unknown,
  ): Promise<Feedback> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(FeedbackRevisionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const r = await this.lockFeedback(
        c,
        ws,
        feedbackId,
        req.expected_version,
      );
      if (r.status !== 'accepted')
        throw fail(
          'INVALID_TRANSITION',
          'Only accepted feedback can revise the spec.',
        );
      const spec = await c.query(
        `select version from entities where workspace_id = $1 and id = $2 for update`,
        [ws, r.spec_id],
      );
      const current = Number(spec.rows[0]?.version);
      if (
        current !== Number(r.spec_version) ||
        current !== req.expected_spec_version
      )
        throw fail(
          'VERSION_CONFLICT',
          'Stale version: the feedback targets a superseded spec version.',
        );
      const next = await this.reviseSpecIn(
        c,
        ctx,
        ws,
        String(r.spec_id),
        {
          expected_version: current,
          title: req.title,
          content: req.content,
          reason: `${req.reason} (feedback ${String(r.id)})`.slice(0, 300),
        },
        { feedback_id: String(r.id) },
      );
      const { rows } = await c.query(
        `update artifact_feedback set status = 'revised', revision_spec_version = $2,
           version = version + 1 where id = $1 returning *`,
        [r.id, next],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'feedback.revised',
        subjectKind: 'feedback',
        subjectId: String(r.id),
        subjectVersion: Number(rows[0].version),
        contentHash: String(r.content_hash),
        payload: { spec_version: next },
        relatedIds: [String(r.spec_id)],
      });
      return this.feedback(rows[0] as Row);
    });
  }

  async compareArtifacts(
    ctx: CommandContext,
    ws: string,
    baseId: string,
    candidateId: string,
  ): Promise<ArtifactComparison> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const base = await this.artifact(c, ws, baseId);
      const cand = await this.artifact(c, ws, candidateId);
      const bf = new Map(
        base.manifest.package.files.map((f) => [f.path, f.sha256]),
      );
      const cf = new Map(
        cand.manifest.package.files.map((f) => [f.path, f.sha256]),
      );
      const paths = [...new Set([...bf.keys(), ...cf.keys()])].sort();
      const keys = [
        ...new Set([
          ...base.manifest.tests.package.map((t) => t.check_key),
          ...cand.manifest.tests.package.map((t) => t.check_key),
        ]),
      ].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
      const result = (m: BuildManifest, k: string) =>
        m.tests.package.find((t) => t.check_key === k)?.passed ?? null;
      const fb = cand.manifest.lineage.feedback_ids.length
        ? await c.query(
            'select * from artifact_feedback where workspace_id = $1 and id = any($2::uuid[]) order by created_at',
            [ws, cand.manifest.lineage.feedback_ids],
          )
        : { rows: [] };
      return {
        base: base.summary,
        candidate: cand.summary,
        linked: cand.manifest.lineage.previous?.artifact_id === base.summary.id,
        spec_versions: [base.manifest.spec.version, cand.manifest.spec.version],
        changed_tasks:
          base.manifest.task.hash === cand.manifest.task.hash
            ? []
            : [cand.manifest.task.key],
        files: paths.map((path) => ({
          path,
          change: !bf.has(path)
            ? 'added'
            : !cf.has(path)
              ? 'removed'
              : bf.get(path) === cf.get(path)
                ? 'same'
                : 'changed',
        })),
        tests: keys.map((k) => ({
          check_key: k,
          base: result(base.manifest, k),
          candidate: result(cand.manifest, k),
        })),
        costs: {
          base_nano_usd: base.manifest.costs.settled_nano_usd,
          candidate_nano_usd: cand.manifest.costs.settled_nano_usd,
          base_calls: base.manifest.costs.broker_calls,
          candidate_calls: cand.manifest.costs.broker_calls,
        },
        feedback: fb.rows.map((r) => this.feedback(r as Row)),
      };
    });
  }
}
