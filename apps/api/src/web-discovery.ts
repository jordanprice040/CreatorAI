import { createHash } from 'node:crypto';
import {
  ContractError,
  WEB_DISCOVERY_TASK_CLASS,
  type WebDiscovery,
  type WebLead,
} from '@creator/contracts';
import {
  READER_PROMPT,
  SCOUT_PROMPT,
  blockedDomains,
  buildReaderPacket,
  canonicalHash,
  checkReaderOutput,
  checkScoutOutput,
  pageQuality,
  readerInput,
  scoutInput,
  type ReaderPage,
} from '@creator/domain';
import type { CommandContext, ConnectionStore } from '@creator/db';
import type { PlanConnectionService } from '@creator/broker';
import type { SourceBroker } from '@creator/research';

// ADR-0086 (P12): drives one web discovery through its stages in this studio process: one
// search request on the plan connection, the studio's own guarded fetch of the chosen pages,
// one reading request, the quote check, and (only where the run's routine policy covers the
// evidence stage) adding the checked claims. Every step re-reads and advances the record under
// a guard, so a cancel or a stopped studio leaves an honest state, never a silent retry.

/** Output bound for the search and reading answers (each is one JSON object). */
const ANSWER_MAX_CHARS = 16_000;
/** The reading packet never takes more than this, even on a larger input cap. */
const PACKET_MAX_CHARS = 60_000;

/** A stable operation id per discovery step: a repeat never dispatches twice. */
export function stepId(discoveryId: string, step: string): string {
  const h = createHash('sha256')
    .update(`web-discovery:${discoveryId.toLowerCase()}:${step}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The JSON object in a model answer. Only surrounding prose or a code fence is tolerated; the
 * object itself is still checked against the schema.
 */
export function answerJson(text: string): unknown {
  const tries = [
    text,
    /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1] ?? '',
    text.includes('{')
      ? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
      : '',
  ];
  for (const t of tries) {
    if (!t.trim()) continue;
    try {
      return JSON.parse(t);
    } catch {
      /* next */
    }
  }
  return null;
}

const refused = (e: unknown) =>
  e instanceof ContractError
    ? [e.message, ...e.details].join(' ').slice(0, 1100)
    : e instanceof Error
      ? e.message.slice(0, 300)
      : 'The step failed.';

export class WebDiscoveryRunner {
  readonly #live = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();

  constructor(
    private readonly store: ConnectionStore,
    private readonly plan: PlanConnectionService,
    private readonly sources: SourceBroker,
  ) {}

  isActive(id: string) {
    return this.#live.has(id.toLowerCase());
  }
  /** Test and shutdown helper: resolves when this discovery's driver has stopped. */
  async settled(id: string) {
    await this.#live.get(id.toLowerCase())?.done;
  }
  with(d: WebDiscovery): WebDiscovery {
    return { ...d, active: this.isActive(d.id) };
  }

  async start(ctx: CommandContext, ws: string, runId: string, body: unknown) {
    const d = await this.store.createWebDiscovery(ctx, ws, runId, body);
    this.#launch(ctx, ws, d.id);
    return this.with(d);
  }

  /**
   * Continues a discovery a stopped studio left working. A stage whose request was already
   * sent cannot be repeated (its outcome is unknown), so that discovery is marked interrupted.
   */
  async resume(ctx: CommandContext, ws: string, id: string) {
    let d = await this.store.getWebDiscovery(ctx, ws, id);
    if (d.created_by !== ctx.actorId.toLowerCase())
      throw new ContractError(
        'ACCESS_DENIED',
        'Only the person who started this discovery can resume it.',
      );
    if (this.isActive(d.id)) return this.with(d);
    const sent =
      (d.state === 'searching' && d.search_request_id) ||
      (d.state === 'reading' && d.read_request_id);
    if (sent) {
      d =
        (await this.store.advanceWebDiscovery(ctx, ws, d.id, d.state, {
          state: 'interrupted',
          explanation:
            'The studio stopped while a request was out, so its answer is unknown and it is not sent again. Reconcile that request under Models and connections if it shows as unknown, then start a new discovery.',
        })) ?? d;
      return this.with(d);
    }
    if (['searching', 'fetching', 'reading'].includes(d.state))
      this.#launch(ctx, ws, d.id);
    return this.with(d);
  }

  async cancel(ctx: CommandContext, ws: string, id: string, body: unknown) {
    const d = await this.store.cancelWebDiscovery(ctx, ws, id, body);
    this.#live.get(d.id)?.abort.abort(new Error('cancelled'));
    return this.with(d);
  }

  #launch(ctx: CommandContext, ws: string, id: string) {
    const key = id.toLowerCase();
    if (this.#live.has(key)) return;
    const abort = new AbortController();
    const done = this.#drive(ctx, ws, key, abort.signal)
      .catch(async (e: unknown) => {
        const d = await this.store
          .getWebDiscovery(ctx, ws, key)
          .catch(() => null);
        if (d && ['searching', 'fetching', 'reading'].includes(d.state))
          await this.store
            .advanceWebDiscovery(ctx, ws, key, d.state, {
              state: 'failed',
              explanation: `The ${d.state} step stopped: ${refused(e)}`,
            })
            .catch(() => null);
      })
      .finally(() => this.#live.delete(key));
    this.#live.set(key, { abort, done });
  }

  async #drive(
    ctx: CommandContext,
    ws: string,
    id: string,
    signal: AbortSignal,
  ) {
    let d: WebDiscovery | null = await this.store.getWebDiscovery(ctx, ws, id);
    if (d.state === 'searching') d = await this.#search(ctx, ws, d, signal);
    if (d?.state === 'fetching') d = await this.#fetch(ctx, ws, d, signal);
    if (d?.state === 'reading') d = await this.#read(ctx, ws, d, signal);
    // The unattended path: only the run's routine policy can add claims without the owner.
    if (d?.state === 'done' && d.outcome === 'claims_found')
      await this.store.admitWebClaimsByPolicy(ctx, ws, id);
  }

  async #caps(ctx: CommandContext, ws: string, d: WebDiscovery) {
    return (await this.store.planConnectionDetail(ctx, ws, d.connection_id))
      .connection.settings.caps.responses;
  }

  async #search(
    ctx: CommandContext,
    ws: string,
    d: WebDiscovery,
    signal: AbortSignal,
  ): Promise<WebDiscovery | null> {
    const caps = await this.#caps(ctx, ws, d);
    const blocked = blockedDomains(d.scope);
    let r;
    try {
      r = await this.plan.invoke(ctx, ws, {
        connection_id: d.connection_id,
        purpose: 'task',
        model_id: d.model_id,
        task_class: WEB_DISCOVERY_TASK_CLASS,
        data_class: 'public',
        run_id: d.run_id,
        logical_operation_id: stepId(d.id, 'search'),
        instructions: SCOUT_PROMPT,
        input: scoutInput(d.scope),
        max_output_chars: Math.min(ANSWER_MAX_CHARS, caps.max_output_chars),
        signal,
        web_search: {
          max_calls: d.scope.max_search_calls,
          ...(blocked.length ? { blocked_domains: blocked } : {}),
        },
        web_discovery: { discovery_id: d.id, stage: 'search' },
      });
    } catch (e) {
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'searching', {
        state: 'failed',
        explanation: `The search request was not admitted: ${refused(e)}`,
      });
    }
    const calls = r.outcome.search_calls ?? [];
    if (r.outcome.kind !== 'completed')
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'searching', {
        state: r.outcome.kind === 'unknown' ? 'interrupted' : 'failed',
        search_calls: calls,
        explanation:
          r.outcome.kind === 'unknown'
            ? `The search request's outcome is unknown (${r.outcome.reason_code}). It may have used plan usage; it is not sent again.`
            : `The search request ${r.outcome.kind === 'rejected' ? 'was refused' : 'failed'} (${r.outcome.reason_code}): ${r.outcome.message}`,
      });
    const known = await this.store.webDiscoveryKnown(ctx, ws);
    const checked = checkScoutOutput(
      answerJson(r.outcome.text),
      calls,
      d.scope,
      known.urls,
    );
    if (!checked.ok)
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'searching', {
        state: 'failed',
        search_calls: calls,
        explanation: `The search answer ${checked.problem}, so no page was chosen. ${calls.length} search call${calls.length === 1 ? '' : 's'} were recorded.`,
      });
    const selected = checked.leads.filter((l) => l.disposition === 'selected');
    if (!checked.searched || !selected.length)
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'searching', {
        state: 'done',
        outcome: checked.searched ? 'no_leads' : 'no_search',
        search_calls: calls,
        draft_summary: checked.summary,
        leads: checked.leads,
        explanation: checked.searched
          ? `The search listed ${checked.leads.length} page${checked.leads.length === 1 ? '' : 's'}, but none can be fetched (see each reason).`
          : 'The model answered without searching, so its URLs are only model suggestions and nothing was fetched.',
      });
    return this.store.advanceWebDiscovery(ctx, ws, d.id, 'searching', {
      state: 'fetching',
      search_calls: calls,
      draft_summary: checked.summary,
      leads: checked.leads,
      explanation: `${calls.length} search call${calls.length === 1 ? '' : 's'}; ${selected.length} page${selected.length === 1 ? '' : 's'} chosen to fetch.`,
    });
  }

  async #fetch(
    ctx: CommandContext,
    ws: string,
    d: WebDiscovery,
    signal: AbortSignal,
  ): Promise<WebDiscovery | null> {
    let current: WebDiscovery | null = d;
    for (const lead of d.leads) {
      if (lead.disposition !== 'selected' || lead.retrieval_id) continue;
      if (signal.aborted || !current) return null;
      let patch: Partial<WebLead>;
      try {
        const got = await this.sources.fetch(
          ctx,
          ws,
          d.run_id,
          {
            url: lead.url,
            task_id: null,
            logical_operation_id: stepId(d.id, `fetch:${lead.ordinal}`),
            justification:
              `Web discovery ${d.id}, page ${lead.ordinal + 1}: ${lead.why}`.slice(
                0,
                1200,
              ),
          },
          { webDiscoveryId: d.id },
        );
        patch = {
          retrieval_id: got.id,
          retrieval_state: got.state,
          source_id: got.source_id,
          source_version: got.source_version,
          quality: 'not_fetched',
          quality_note: got.explanation.slice(0, 300),
        };
        if (got.state === 'fetched' && got.source_id) {
          const source = await this.store.getSource(ctx, ws, got.source_id);
          const q = pageQuality(
            source.passages.filter(
              (p) => p.source_version === got.source_version,
            ),
          );
          patch = { ...patch, quality: q.quality, quality_note: q.note };
        }
      } catch (e) {
        patch = {
          retrieval_state: 'failed',
          quality: 'not_fetched',
          quality_note: refused(e).slice(0, 300),
        };
      }
      current = await this.store.advanceWebDiscovery(
        ctx,
        ws,
        d.id,
        'fetching',
        {
          leads: current.leads.map((l) =>
            l.ordinal === lead.ordinal ? { ...l, ...patch } : l,
          ),
        },
      );
    }
    if (!current) return null;
    const usable = current.leads.filter((l) => l.quality === 'usable');
    if (!usable.length)
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'fetching', {
        state: 'done',
        outcome: 'nothing_fetchable',
        explanation:
          'None of the chosen pages gave usable text (each page shows why: refused, a bot check, an empty app shell, too little text, or not an HTML page).',
      });
    return this.store.advanceWebDiscovery(ctx, ws, d.id, 'fetching', {
      state: 'reading',
      explanation: `${usable.length} of ${current.leads.filter((l) => l.disposition === 'selected').length} chosen pages gave usable text.`,
    });
  }

  async #read(
    ctx: CommandContext,
    ws: string,
    d: WebDiscovery,
    signal: AbortSignal,
  ): Promise<WebDiscovery | null> {
    const caps = await this.#caps(ctx, ws, d);
    const pages: ReaderPage[] = [];
    for (const l of d.leads)
      if (l.quality === 'usable' && l.source_id && l.source_version) {
        const s = await this.store.getSource(ctx, ws, l.source_id);
        pages.push({
          source_id: l.source_id,
          source_version: l.source_version,
          title: s.source.title,
          url: s.source.url,
          published_at: s.source.published_at,
          passages: s.passages
            .filter((p) => p.source_version === l.source_version)
            .map((p) => ({
              id: p.id,
              excerpt: p.excerpt,
              boilerplate: p.boilerplate,
              instruction_like: p.instruction_like,
            })),
        });
      }
    const packet = buildReaderPacket(
      pages,
      d.scope,
      Math.max(
        2000,
        Math.min(
          PACKET_MAX_CHARS,
          caps.max_input_chars - READER_PROMPT.length - 200,
        ),
      ),
    );
    const packetHash = canonicalHash(packet);
    if (signal.aborted) return null;
    let r;
    try {
      r = await this.plan.invoke(ctx, ws, {
        connection_id: d.connection_id,
        purpose: 'task',
        model_id: d.model_id,
        task_class: WEB_DISCOVERY_TASK_CLASS,
        data_class: 'public',
        run_id: d.run_id,
        logical_operation_id: stepId(d.id, 'read'),
        instructions: READER_PROMPT,
        input: readerInput(packet),
        max_output_chars: Math.min(ANSWER_MAX_CHARS, caps.max_output_chars),
        signal,
        web_discovery: { discovery_id: d.id, stage: 'read' },
      });
    } catch (e) {
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'reading', {
        state: 'failed',
        packet_hash: packetHash,
        explanation: `The reading request was not admitted: ${refused(e)}`,
      });
    }
    if (r.outcome.kind !== 'completed')
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'reading', {
        state: r.outcome.kind === 'unknown' ? 'interrupted' : 'failed',
        packet_hash: packetHash,
        explanation:
          r.outcome.kind === 'unknown'
            ? `The reading request's outcome is unknown (${r.outcome.reason_code}). It is not sent again; the fetched pages stay under Evidence.`
            : `The reading request ${r.outcome.kind === 'rejected' ? 'was refused' : 'failed'} (${r.outcome.reason_code}): ${r.outcome.message}`,
      });
    const known = await this.store.webDiscoveryKnown(ctx, ws);
    const checked = checkReaderOutput(
      answerJson(r.outcome.text),
      packet,
      d.scope,
      known.statements,
    );
    if (!checked.ok)
      return this.store.advanceWebDiscovery(ctx, ws, d.id, 'reading', {
        state: 'failed',
        packet_hash: packetHash,
        explanation: `The reading answer ${checked.problem}. The fetched pages stay under Evidence for citing by hand.`,
      });
    const verified = checked.proposals.filter((p) => p.check === 'verified');
    return this.store.finishWebDiscovery(ctx, ws, d.id, {
      proposals: checked.proposals,
      packet_hash: packetHash,
      not_covered: checked.not_covered,
      outcome: verified.length ? 'claims_found' : 'no_verified_claims',
      explanation: `${checked.proposals.length} claim${checked.proposals.length === 1 ? '' : 's'} proposed from ${packet.pages.length} page${packet.pages.length === 1 ? '' : 's'}; ${verified.length} passed the word-for-word quote check.`,
    });
  }
}
