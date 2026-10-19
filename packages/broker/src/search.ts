import { createHash } from 'node:crypto';
import {
  AuditQuestionRequestSchema,
  ContractError,
  SemanticModelsConfigSchema,
  parse,
  type AuditAnswer,
  type BrokerCallResult,
  type SemanticModelsConfig,
  type SemanticSearchResult,
} from '@creator/contracts';
import { acceptModelPlan, auditCompilerInput, cosine } from '@creator/domain';
import { nameId, type CommandContext, type SearchStore } from '@creator/db';
import type { ModelBroker } from './broker.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * X03: the metered half of search. Semantic search embeds only candidates the store already
 * returned under the caller's access (never redacted text), one broker call per text; model
 * compilation of audit questions is one broker call whose output must pass the strict plan
 * schema before the store runs its own fixed, read-only SQL.
 */
export class SearchService {
  readonly #models: SemanticModelsConfig;
  constructor(
    private readonly store: SearchStore,
    private readonly broker: ModelBroker,
    models: unknown,
  ) {
    this.#models = parse(SemanticModelsConfigSchema, models, 'INVALID_CONFIG');
  }

  async semanticSearch(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<SemanticSearchResult> {
    const { req, fixture, candidates } = await this.store.semanticCandidates(
      ctx,
      ws,
      raw,
    );
    const allowed = (fixture ? this.#models.fixture : this.#models.real).some(
      (m) =>
        m.provider === req.model.provider && m.model_id === req.model.model_id,
    );
    const metering = {
      calls: 0,
      replayed: 0,
      reserved: 0n,
      incurred: 0n,
      unknown: 0n,
      logical_operation_ids: [] as string[],
    };
    const result = (
      status: SemanticSearchResult['status'],
      reason_code: string,
      explanation: string,
      hits: SemanticSearchResult['hits'] = [],
      embedded = 0,
    ): SemanticSearchResult => ({
      status,
      reason_code,
      explanation,
      fixture,
      model: req.model,
      query: { q: req.q, types: req.types, kind: req.kind },
      pool: {
        candidates: candidates.length,
        lexical_matches: candidates.filter((c) => c.lexical).length,
        embedded,
      },
      hits,
      metering: {
        calls: metering.calls,
        replayed: metering.replayed,
        reserved: metering.reserved.toString(),
        incurred: metering.incurred.toString(),
        unknown: metering.unknown.toString(),
        logical_operation_ids: metering.logical_operation_ids,
      },
    });
    if (!allowed)
      return result(
        'failed',
        'no_verified_embedding_model',
        fixture
          ? 'This embedding model is not listed for fixture workspaces in config/search/semantic-models.json.'
          : 'No embedding model is verified for real workspaces (config/search/semantic-models.json lists none), so semantic search is refused here; lexical search still works.',
      );
    const embed = async (text: string): Promise<BrokerCallResult> => {
      const op = nameId(`semantic:${req.operation_id}:${sha(text)}`);
      const r = await this.broker.callModel(ctx, ws, req.run_id, req.model, {
        envelope_id: req.envelope_id,
        action_type: 'model.embed',
        task_id: null,
        logical_operation_id: op,
        pricing_snapshot_id: req.pricing_snapshot_id,
        data_class: req.data_class,
        input: [{ role: 'user', text }],
        max_output_tokens: 1,
        output_format: 'text',
        tool: null,
        max_attempts: 1,
        timeout_ms: 30000,
        justification: req.justification,
      });
      if (!metering.logical_operation_ids.includes(op)) {
        metering.logical_operation_ids.push(op);
        metering.calls += 1;
        if (r.replayed) metering.replayed += 1;
        for (const a of r.attempts) {
          if (a.status === 'in_flight') metering.reserved += BigInt(a.reserved);
          if (a.status === 'unknown') metering.unknown += BigInt(a.reserved);
          if (a.incurred) metering.incurred += BigInt(a.incurred);
        }
      }
      return r;
    };
    const query = await embed(req.q);
    const qv = query.output?.vector ?? null;
    if (query.status !== 'succeeded' || !qv)
      return result(
        'failed',
        query.reason_code,
        `The query could not be embedded (${query.status}: ${query.explanation}); nothing was ranked.`,
      );
    const ranked: SemanticSearchResult['hits'] = [];
    let failed = 0;
    for (const c of candidates) {
      const r = await embed(c.text);
      const v = r.output?.vector ?? null;
      if (r.status !== 'succeeded' || !v) {
        failed += 1;
        continue;
      }
      ranked.push({
        ...c.hit,
        similarity: Math.round(cosine(qv, v) * 1e4) / 1e4,
        lexical_match: c.lexical,
      });
    }
    ranked.sort(
      (a, b) =>
        b.similarity - a.similarity ||
        b.occurred_at.localeCompare(a.occurred_at),
    );
    const hits = ranked.slice(0, req.limit);
    if (failed)
      return result(
        'partial',
        'some_embeddings_failed',
        `${failed} of ${candidates.length} candidates could not be embedded and were left out of the ranking.`,
        hits,
        ranked.length,
      );
    return result(
      'ranked',
      'ranked',
      candidates.length
        ? `Ranked ${candidates.length} readable candidates by similarity to the query${fixture ? ' (fixture embedding: character trigrams, not meaning)' : ''}.`
        : 'No readable candidates to rank.',
      hits,
      ranked.length,
    );
  }

  /** Answers an audit question; the model compiler is metered and its plan re-validated. */
  async askQuestion(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<AuditAnswer> {
    const req = parse(AuditQuestionRequestSchema, raw);
    if (req.compiler === 'rules') return this.store.askQuestion(ctx, ws, req);
    const m = req.model_call;
    if (!m)
      throw new ContractError('INVALID_CONTRACT', 'model_call is required.');
    const call = await this.broker.callModel(ctx, ws, m.run_id, m.model, {
      envelope_id: m.envelope_id,
      action_type: 'model.generate',
      task_id: null,
      logical_operation_id: m.operation_id,
      pricing_snapshot_id: m.pricing_snapshot_id,
      data_class: m.data_class,
      input: auditCompilerInput(req.question, req.tz, req.limit),
      max_output_tokens: 800,
      output_format: 'json',
      tool: null,
      max_attempts: 1,
      timeout_ms: 60000,
      justification: 'Compile an audit question into a read-only plan.',
    });
    const base = {
      question: req.question,
      compiler: 'model' as const,
      compile_call: call,
    };
    if (call.status !== 'succeeded' || !call.output)
      return this.store.unanswered(ctx, ws, {
        ...base,
        status: 'compile_failed',
        explanation: `The compile call did not succeed (${call.status}: ${call.explanation}).`,
      });
    const accepted = acceptModelPlan(call.output.text);
    if (accepted.status === 'refused')
      return this.store.unanswered(ctx, ws, {
        ...base,
        status: 'refused_plan',
        explanation: `${accepted.reason} Nothing was run.`,
      });
    if (accepted.status === 'unsupported')
      return this.store.unanswered(ctx, ws, {
        ...base,
        status: 'unsupported',
        explanation: accepted.reason,
      });
    return this.store.answerPlan(ctx, ws, accepted.plan, base);
  }
}
