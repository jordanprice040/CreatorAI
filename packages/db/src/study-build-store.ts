import type { PoolClient } from 'pg';
import {
  SpecBodySchema,
  parse,
  type SpecBody,
  type StudyAttempt,
  type StudyImplementation,
  type StudyInput,
} from '@creator/contracts';
import {
  canonicalHash,
  frozenCases,
  STUDY_FIXTURE_PRICING,
} from '@creator/domain';
import { StudyStore, budgetRefusal } from './study-store.js';
import {
  fail,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** One redacted executed check: held-out cases carry key and pass/fail only. */
export interface StudyCheckRecord {
  check_key: string;
  held_out: boolean;
  passed: boolean;
  execution_id: string | null;
  backend: string | null;
}
/** What the API re-read from the local product store for one isolated build. */
export interface StudyBuildRecord {
  product_id: string;
  build_id: string;
  task_id: string;
  task_key: string;
  task_hash: string;
  plan_hash: string;
  spec_hash: string;
  commit: string;
  state: 'verified_candidate' | 'checkpoint';
  reason: string;
  calls: number;
  repairs: number;
  fixture: boolean;
  review: { verdict: string; findings: number } | null;
  checks: StudyCheckRecord[];
  files: { path: string; sha256: string }[];
}
const REVIEWED_BACKEND = 'wsl2-bwrap-systemd';
const isolation = (checks: StudyCheckRecord[]) =>
  checks.length > 0 && checks.every((c) => c.backend === REVIEWED_BACKEND);

/**
 * T15 implementation-stratum attempts. A and B arms build through the T12 builder in their own
 * attempt workspace against a pinned copy of the owner's frozen spec; C submits code that the
 * server runs against every frozen case. Results are recorded only from server re-reads.
 */
export class StudyBuildStore extends StudyStore {
  /** The pinned spec, binding and full frozen cases (held-out included) for an attempt. */
  private async pinnedTask(c: PoolClient, a: StudyAttempt, input: StudyInput) {
    const impl = input.packet.implementation;
    if (!impl || input.packet.stratum !== 'implementation')
      throw fail(
        'INVALID_CONFIG',
        'This study has no frozen implementation task to build.',
      );
    const pin = (
      await c.query('select * from study_attempt_pins where attempt_id=$1', [
        a.id,
      ])
    ).rows[0] as Row | undefined;
    if (!pin)
      throw fail('INVALID_CONFIG', 'This attempt has no pinned build task.');
    const e = (
      await c.query('select * from entities where workspace_id=$1 and id=$2', [
        a.workspace_id,
        pin.spec_id,
      ])
    ).rows[0] as Row | undefined;
    const source = pin.source as {
      freeze_id: string;
      task_key: string;
      task_hash: string;
    };
    const freeze = (
      await c.query('select * from spec_freezes where id=$1', [
        source.freeze_id,
      ])
    ).rows[0] as Row | undefined;
    if (
      !e ||
      e.kind !== 'specification' ||
      e.status !== 'active' ||
      Number(e.version) !== Number(pin.spec_version) ||
      e.content_hash !== pin.spec_hash ||
      !freeze ||
      freeze.content_hash !== pin.spec_hash ||
      source.task_hash !== impl.task_hash
    )
      throw fail(
        'EVIDENCE_MISMATCH',
        'The pinned specification no longer matches its frozen source.',
      );
    const spec: SpecBody = parse(SpecBodySchema, e.body);
    const hashes = freeze.task_hashes as Record<string, string>;
    const task = spec.tasks.find((t) => t.key === impl.task_key)!;
    const s = await this.study(c, String(freeze.workspace_id), a.study_id);
    const binding = {
      workspace_id: a.workspace_id,
      owner_id: String(s.created_by),
      spec_id: String(pin.spec_id),
      spec_version: Number(pin.spec_version),
      spec_hash: String(pin.spec_hash),
      freeze_id: String(freeze.id),
      tasks: spec.tasks
        .filter((t) => t.file_scope.length)
        .map((t) => ({
          key: t.key,
          hash: hashes[t.key]!,
          file_scope: t.file_scope,
        })),
    };
    return {
      impl,
      pin,
      spec,
      binding,
      cases: frozenCases(spec, task.acceptance),
    };
  }
  private plan(
    a: StudyAttempt,
    input: StudyInput,
    impl: StudyImplementation,
    pin: Row,
    cases: ReturnType<typeof frozenCases>,
    money: { envelope_id: string; pricing_snapshot_id: string },
  ) {
    return {
      format: 'build-plan/1' as const,
      run_id: a.run_id,
      envelope_id: money.envelope_id,
      pricing_snapshot_id: money.pricing_snapshot_id,
      humility_review: {
        id: String(pin.review_id),
        version: Number(pin.review_version),
      },
      data_class: 'synthetic' as const,
      max_repairs: impl.max_repairs,
      // One builder and one fresh reviewer call per cycle.
      max_calls: 2 * (impl.max_repairs + 1),
      timeout_ms: impl.timeout_ms,
      max_output_tokens: impl.max_output_tokens,
      deadline: new Date(
        Date.parse(a.created_at) + input.packet.time_cap_seconds * 1000,
      ).toISOString(),
      cases: cases.map(({ held_out: _, ...x }) => x),
    };
  }

  /**
   * Owner-only and re-entrant. Refuses human-only, terminal, expired and final (live) attempts,
   * holds the attempt's cap against the study ledger, then records the exact build request.
   */
  async prepareStudyBuild(ctx: CommandContext, ws: string, attemptId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    attemptId = uuid(attemptId);
    const data = await this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId, true);
      if (a.condition === 'human_only') {
        await this.event(c, ctx, a.study_id, a.id, 'helper_denied', {
          helper: 'build',
          condition: a.condition,
        });
        return null;
      }
      if (a.state !== 'assigned')
        throw fail('INVALID_TRANSITION', 'Attempt is terminal.');
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      if (!input.synthetic)
        throw fail(
          'LIVE_DISABLED',
          'Final AI builds need live dispatch, which is disabled (config/evaluation.json). Fixture output never substitutes.',
        );
      if (
        Date.now() >
        Date.parse(a.created_at) + input.packet.time_cap_seconds * 1000
      )
        throw fail('EXPIRED', 'The assignment deadline elapsed.');
      if (
        input.config.model_version !== STUDY_FIXTURE_PRICING.model_id ||
        input.config.pricing_version !== canonicalHash(STUDY_FIXTURE_PRICING)
      )
        throw fail(
          'INVALID_CONFIG',
          'Only the pinned synthetic provider/pricing pair is available to study builds.',
        );
      await this.pinnedTask(c, a, input);
      const refused = await this.holdBudget(c, ctx, ws, a, input);
      return { a, input, refused };
    });
    if (!data)
      throw fail(
        'HUMAN_ONLY_DENIED',
        'Human-only work has no builder or model path; submit code for checking instead.',
      );
    if (data.refused) throw budgetRefusal(data.refused);
    const { a, input } = data;
    const key = (suffix: string) => ({
      ...ctx,
      idempotencyKey: `study:${a.id}:${suffix}`,
    });
    const pricing = await this.createPricing(
      key('pricing'),
      a.workspace_id,
      STUDY_FIXTURE_PRICING,
    );
    const envelope = await this.createEnvelope(key('budget'), a.workspace_id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Frozen synthetic study build envelope',
      cap_nano_usd: input.config.max_cost_nano_usd,
      starts_at: null,
      ends_at: null,
      max_in_flight: 1,
    });
    await this.tx(async (c) => {
      const current = await this.lockAttemptForWrite(c, ctx, ws, a.id, true);
      if (current.state !== 'assigned')
        throw fail('INVALID_TRANSITION', 'Attempt ended during setup.');
      const t = await this.pinnedTask(c, current, input);
      const request = {
        binding: t.binding,
        plan: this.plan(current, input, t.impl, t.pin, t.cases, {
          envelope_id: envelope.id,
          pricing_snapshot_id: pricing.id,
        }),
      };
      const digest = canonicalHash(request);
      const prior = await c.query(
        'select request_hash from study_execution_requests where attempt_id=$1',
        [a.id],
      );
      if (prior.rows[0] && prior.rows[0].request_hash !== digest)
        throw fail('VERSION_CONFLICT', 'Build context changed.');
      if (!prior.rowCount) {
        await c.query(
          "insert into study_execution_requests(attempt_id,kind,request,request_hash,input_bindings) values($1,'build',$2,$3,$4)",
          [a.id, request, digest, { [t.binding.spec_id]: t.binding.spec_hash }],
        );
        await this.event(c, ctx, a.study_id, a.id, 'execution_prepared', {
          workflow_version: 'builder/1',
          request_hash: digest,
          spec_hash: t.binding.spec_hash,
          task_hash: t.impl.task_hash,
        });
      }
    });
    return this.studyBuildState(ctx, ws, a.id);
  }

  /** Owner-only view of an attempt's recorded build request and live run state. */
  async studyBuildState(ctx: CommandContext, ws: string, attemptId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const a = await this.accessAttempt(c, ctx, ws, attemptId, true);
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      const t = await this.pinnedTask(c, a, input);
      const r = (
        await c.query(
          "select request, request_hash from study_execution_requests where attempt_id=$1 and kind='build'",
          [a.id],
        )
      ).rows[0] as Row | undefined;
      if (!r)
        throw fail('NOT_FOUND', 'No build was prepared for this attempt.');
      const request = r.request as { binding: unknown; plan: unknown };
      if (canonicalHash(request.binding) !== canonicalHash(t.binding))
        throw fail('EVIDENCE_MISMATCH', 'The pinned build binding changed.');
      const run = (
        await c.query(
          'select state, experiment_condition from run_controls where workspace_id=$1 and run_id=$2',
          [a.workspace_id, a.run_id],
        )
      ).rows[0] as Row;
      return {
        attempt: a,
        run: {
          state: String(run.state),
          condition: run.experiment_condition as StudyAttempt['condition'],
        },
        implementation: t.impl,
        binding: t.binding,
        spec: t.spec,
        plan: request.plan,
        request_hash: String(r.request_hash),
      };
    });
  }

  /**
   * Hashes-only binding and the visible task for any implementation attempt; participants may
   * read it to set up their own product. Held-out content never leaves the server here.
   */
  async studyTaskBinding(ctx: CommandContext, ws: string, attemptId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const a = await this.accessAttempt(c, ctx, ws, attemptId);
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      const t = await this.pinnedTask(c, a, input);
      return {
        attempt: a,
        task_key: t.impl.task_key,
        task_hash: t.impl.task_hash,
        binding: t.binding,
      };
    });
  }
  /** Server-internal: the full frozen cases for checking a participant's code. */
  async studyCodeCases(ctx: CommandContext, ws: string, attemptId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const a = await this.accessAttempt(c, ctx, ws, attemptId);
      if (a.condition !== 'human_only')
        throw fail(
          'INVALID_TRANSITION',
          'AI arms submit code only through the isolated builder.',
        );
      if (a.state !== 'assigned')
        throw fail('INVALID_TRANSITION', 'Attempt is terminal.');
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      const t = await this.pinnedTask(c, a, input);
      return { attempt: a, binding: t.binding, impl: t.impl, cases: t.cases };
    });
  }

  /** Records one isolated build. A build after cancellation is kept as evidence only. */
  async recordStudyBuild(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    r: StudyBuildRecord,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    attemptId = uuid(attemptId);
    return this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId, true);
      if (a.condition === 'human_only')
        throw fail('HUMAN_ONLY_DENIED', 'Human-only attempts have no build.');
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      const t = await this.pinnedTask(c, a, input);
      const req = (
        await c.query(
          "select request from study_execution_requests where attempt_id=$1 and kind='build'",
          [a.id],
        )
      ).rows[0] as Row | undefined;
      if (
        !req ||
        r.spec_hash !== t.binding.spec_hash ||
        r.task_key !== t.impl.task_key ||
        r.task_hash !== t.impl.task_hash
      )
        throw fail(
          'EVIDENCE_MISMATCH',
          "The build is not bound to this attempt's prepared spec and task.",
        );
      const prior = (
        await c.query(
          "select payload from study_events where attempt_id=$1 and kind='build'",
          [a.id],
        )
      ).rows[0] as Row | undefined;
      if (prior) {
        if ((prior.payload as { build_id: string }).build_id !== r.build_id)
          throw fail(
            'VERSION_CONFLICT',
            'This attempt already recorded a different build.',
          );
        return { attempt: await this.attemptIn(c, a.id), duplicate: true };
      }
      const elapsed = (Date.now() - Date.parse(a.created_at)) / 1000;
      const expired = elapsed > input.packet.time_cap_seconds;
      const isolated = isolation(r.checks);
      await this.event(c, ctx, a.study_id, a.id, 'build', {
        ...r,
        attempt_state_at_record: a.state,
        isolation_evidence: isolated,
        isolation_note: isolated
          ? 'Every case ran in the reviewed WSL2 worker.'
          : 'Not isolation evidence: at least one case ran on another backend (for example the labelled test double).',
      });
      if (a.state !== 'assigned')
        return { attempt: await this.attemptIn(c, a.id), duplicate: false };
      if (r.state === 'verified_candidate' && !expired) {
        const artifact = await this.event(
          c,
          ctx,
          a.study_id,
          a.id,
          'artifacts',
          {
            kind: 'code',
            name: `Builder candidate ${r.commit}`,
            content: JSON.stringify({
              product_id: r.product_id,
              build_id: r.build_id,
              commit: r.commit,
              files: r.files,
            }),
            formatter: 'build-candidate/1',
          },
        );
        for (const check of r.checks)
          await this.event(c, ctx, a.study_id, a.id, 'tests', {
            artifact_id: artifact.id,
            artifact_hash: artifact.content_hash,
            ...check,
            executor: 'isolated-builder-qa/1',
          });
      }
      const status = expired
        ? 'failed'
        : r.state === 'verified_candidate'
          ? 'submitted'
          : /budget/i.test(r.reason)
            ? 'budget_exhausted'
            : /cancel/i.test(r.reason)
              ? 'cancelled'
              : 'failed';
      await this.event(c, ctx, a.study_id, a.id, 'finished', {
        status,
        summary: expired
          ? 'Assignment deadline exceeded; late build retained.'
          : r.state === 'verified_candidate'
            ? 'Builder candidate passed fresh review and every executed frozen case; not an independent quality rating.'
            : `Builder stopped at a checkpoint: ${r.reason.slice(0, 300)}`,
        outcome: expired ? 'deadline_exceeded' : r.state,
        wall_seconds: elapsed,
        human_active_minutes: a.condition === 'autonomous' ? 0 : null,
        human_wait_seconds: a.condition === 'autonomous' ? 0 : null,
        measurement_source: 'isolated_builder',
        condition: a.condition,
        primary: a.primary,
      });
      return { attempt: await this.attemptIn(c, a.id), duplicate: false };
    });
  }

  /** Records a human-only code submission and its server-executed checks. */
  async recordStudyCodeCheck(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    r: {
      product_id: string;
      task_id: string;
      commit: string;
      files: { path: string; sha256: string }[];
      checks: StudyCheckRecord[];
    },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    attemptId = uuid(attemptId);
    return this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId);
      if (a.condition !== 'human_only' || a.state !== 'assigned')
        throw fail(
          'INVALID_TRANSITION',
          'Only an open human-only attempt records submitted code checks.',
        );
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      if (
        Date.now() >
        Date.parse(a.created_at) + input.packet.time_cap_seconds * 1000
      )
        throw fail('EXPIRED', 'The assignment time cap has elapsed.');
      const artifact = await this.event(c, ctx, a.study_id, a.id, 'artifacts', {
        kind: 'code',
        name: `Participant code ${r.commit}`,
        content: JSON.stringify({
          product_id: r.product_id,
          task_id: r.task_id,
          commit: r.commit,
          files: r.files,
        }),
        formatter: 'participant-code/1',
      });
      const tests = [];
      for (const check of r.checks)
        tests.push(
          await this.event(c, ctx, a.study_id, a.id, 'tests', {
            artifact_id: artifact.id,
            artifact_hash: artifact.content_hash,
            ...check,
            executor: 'isolated-product-qa/1',
          }),
        );
      return {
        artifact,
        checks: r.checks,
        isolation_evidence: isolation(r.checks),
        tests,
      };
    });
  }
}
