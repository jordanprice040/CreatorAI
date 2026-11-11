// ADR-0083 (P20): reads the records each kind of Chat card is shown with. The same routes the
// forms read; nothing here writes. Fixture pricing is the same bundled file Budgets offers.
import {
  DISCOVERY_TASK_CLASSES,
  DecisionSchema,
  EnvelopeSchema,
  GrantSchema,
  ModelChoiceSchema,
  PROPOSAL_KINDS,
  PROPOSAL_SECTIONS,
  PROPOSAL_SECTION_LABELS,
  CORE_PROPOSAL_SECTIONS,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  PricingSnapshotSchema,
  ProblemComparisonSchema,
  ProposalDraftSchema,
  ProposalSummarySchema,
  RUBRICS,
  RunControlSchema,
  SelectionReportSchema,
  SelectionSchema,
  SourceDetailSchema,
  SourceSummarySchema,
  StoredEntitySchema,
  isDiscoveryQualified,
  z,
  type Decision,
  type StoredEntity,
} from '@creator/contracts';
import fixturePricing from '../../../config/pricing/fixture-model-v1.json';
import { api } from './oversight.js';
import { newestFirst } from './versions.js';
import { envelopesFor } from './build-defaults.js';
import { runNames } from './ui.js';
import { missingTaskTexts } from './discover-defaults.js';
import type {
  CardData,
  CardKind,
  ChoiceData,
  CiteData,
  DecisionData,
  DiscoverData,
  FetchData,
  FundData,
  Input,
  ProposalData,
  ScoreData,
  ScoreOptionData,
} from './chat-cards.js';

/** A few pages of the synthetic corpus, as Sources suggests them. */
const FIXTURE_PAGES = [
  'https://health.fixture.test/reports/clinic-access-2025',
  'https://wire.fixture.test/stories/clinic-waits',
  'https://journal.fixture.test/articles/wait-time-survey',
  'https://health.fixture.test/reports/staffing-brief',
  'https://forum.fixture.test/threads/clinic-tips',
];
const DISCOVERY_CLASSES = [...new Set(Object.values(DISCOVERY_TASK_CLASSES))];
const entities = (base: string, kind: string) =>
  api(
    z.array(StoredEntitySchema),
    `${base}/entities?kind=${kind}&status=active`,
  ).then(newestFirst);

/** In words, what approving a decision once permits. */
export function coverageWords(d: Decision): string {
  const b = d.coverage.once;
  if (!b) return 'it cannot be approved once';
  return `${b.action_type.replaceAll('.', ' ').replaceAll('_', ' ')}${b.target ? ` on ${b.target.kind} v${b.target.version}` : ''}, ${b.data_class.replace('_', ' ')} data${b.amount_nano_usd ? `, up to ${Number(BigInt(b.amount_nano_usd) / 1_000_000n) / 1000}` : ''}`;
}

export async function loadCard(
  kind: CardKind,
  ws: string,
  fixture: boolean,
  input: Input,
  reviewer: string,
): Promise<CardData> {
  const base = `workspaces/${ws}`;
  switch (kind) {
    case 'fund_budget': {
      const [budgets, pricing] = await Promise.all([
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
      ]);
      return {
        budgets: budgets.filter((e) => e.status === 'active').length,
        fixturePricing: pricing.some(
          (p) => p.body.model_id === fixturePricing.model_id,
        ),
        pricingBody: fixturePricing,
      } satisfies FundData;
    }
    case 'fetch_source': {
      const [runs, grants, names] = await Promise.all([
        api(z.array(RunControlSchema), `${base}/runs`),
        api(z.array(GrantSchema), `${base}/grants`),
        runNames(base),
      ]);
      const now = Date.now();
      const fetching = new Set(
        grants
          .filter(
            (g) =>
              g.status === 'active' &&
              g.run_id &&
              Date.parse(g.expires_at) > now &&
              g.action_types.includes('source.fetch'),
          )
          .map((g) => g.run_id!.toLowerCase()),
      );
      return {
        runs: newestFirst(
          runs.filter(
            (r) => r.state === 'active' && fetching.has(r.run_id.toLowerCase()),
          ),
        ).map((r) => ({
          id: r.run_id,
          label: names.get(r.run_id) ?? `Run ${r.run_id.slice(0, 8)}`,
        })),
        pages: fixture ? FIXTURE_PAGES : [],
      } satisfies FetchData;
    }
    case 'cite_claim': {
      const sources = (
        await api(z.array(SourceSummarySchema), `${base}/sources`)
      )
        .filter((s) => s.retrieval_status === 'available')
        .slice(0, 6);
      const details = await Promise.all(
        sources.map((s) =>
          api(SourceDetailSchema, `${base}/sources/${s.id}`).catch(() => null),
        ),
      );
      const passages: CiteData['passages'] = [];
      for (const d of details)
        for (const p of d?.passages ?? []) {
          if (!p.excerpt) continue;
          passages.push({
            id: p.id,
            label: `${d!.source.title || d!.source.url} ¶${p.locator.paragraph}`,
            excerpt: p.excerpt,
          });
          if (passages.length >= 40) break;
        }
      return { passages } satisfies CiteData;
    }
    case 'start_discovery': {
      const [claims, envelopes, pricing, connections, choice] =
        await Promise.all([
          entities(base, 'claim'),
          api(z.array(EnvelopeSchema), `${base}/budgets`),
          api(z.array(PricingSnapshotSchema), `${base}/pricing`),
          fixture
            ? Promise.resolve([])
            : api(
                z.array(PlanConnectionSchema),
                `${base}/plan-connections`,
              ).catch(() => []),
          fixture
            ? Promise.resolve(null)
            : api(ModelChoiceSchema, `${base}/model-choice`).catch(() => null),
        ]);
      const out: DiscoverData = {
        claims: claims.map((c) => ({
          id: c.id,
          version: c.version,
          title: c.title,
        })),
        route: null,
        routeBlockers: [],
      };
      if (fixture) {
        const env = newestFirst(
          envelopesFor(
            envelopes.filter((e) => e.status === 'active'),
            '',
          ),
        )[0];
        const price = newestFirst(pricing)[0];
        if (!env)
          out.routeBlockers.push(
            'No budget a new run can use. Set one up first (“Set up a budget”).',
          );
        if (!price)
          out.routeBlockers.push(
            'No pricing yet. Setting up a budget here adds the fixture pricing.',
          );
        if (env && price)
          out.route = {
            kind: 'api',
            envelope: env.id,
            pricing: price.id,
            label: `Fixture · budget ${env.name}`,
          };
        return out;
      }
      // A real workspace runs discovery on the current model (the picker beside usage) when it
      // is ready and qualified for every discovery step; otherwise the card says why and
      // Discover offers the other routes.
      const want = choice
        ? { connection_id: choice.connection_id, model_id: choice.model_id }
        : null;
      const conn = want
        ? connections.find((c) => c.id === want.connection_id)
        : connections[0];
      if (!conn) {
        out.routeBlockers.push(
          'No plan connection is set up. Connect one under Models and connections, or start the discovery from Discover.',
        );
        return out;
      }
      const d = await api(
        PlanConnectionDetailSchema.passthrough(),
        `${base}/plan-connections/${conn.id}`,
      ).catch(() => null);
      if (!d) {
        out.routeBlockers.push('Could not read the plan connection.');
        return out;
      }
      const verified = d.model_access
        .filter((a) => a.path === 'responses' && a.access === 'verified')
        .map((a) => a.model_id);
      const model = want?.model_id ?? verified[0] ?? '';
      if (d.blockers.length) out.routeBlockers.push(...d.blockers);
      if (!d.connection.settings.allowed_data_classes.includes('public'))
        out.routeBlockers.push(
          'The connection does not allow public data, which discovery sends.',
        );
      if (!verified.includes(model))
        out.routeBlockers.push(
          `${model || 'No model'} is not verified on this connection. Pick another model beside the usage indicator.`,
        );
      const missing = DISCOVERY_CLASSES.filter(
        (tc) => !isDiscoveryQualified(d.qualifications, model, tc),
      );
      // P23 item 8: a task the connection does not allow can't be qualified, so say that
      // instead of a plain "not qualified" with no way forward.
      const allowed = d.connection.settings
        .allowed_task_classes as readonly string[];
      const blockers = missingTaskTexts(model, missing, allowed);
      out.routeBlockers.push(...blockers);
      if (blockers.length)
        out.routeBlockers.push(
          'Or pick a model qualified for every discovery step beside the usage indicator, or start the discovery from Discover.',
        );
      if (out.routeBlockers.length === 0)
        out.route = {
          kind: 'subscription',
          connection: d.connection.id,
          model,
          settings_hash: d.connection.settings_hash,
          max_output_chars:
            d.connection.settings.caps.responses.max_output_chars,
          timeout_ms: d.connection.settings.caps.responses.request_timeout_ms,
          max_requests:
            d.connection.settings.caps.responses.max_requests_per_run,
          label: `${model} on your plan${want ? ' (your current model)' : ''}`,
        };
      return out;
    }
    case 'answer_decision': {
      const decisions = await api(
        z.array(DecisionSchema),
        `${base}/decisions?status=pending`,
      );
      return {
        decisions: decisions.map((d) => ({
          id: d.id,
          version: d.version,
          question: d.question,
          reason: d.reason.replaceAll('_', ' '),
          covers: coverageWords(d),
          current: d.coverage.current,
          coverage_hash: d.coverage.coverage_hash,
          recommendation: d.recommendation,
        })),
      } satisfies DecisionData;
    }
    case 'score_option': {
      const [problems, cards] = await Promise.all([
        entities(base, 'problem'),
        entities(base, 'scorecard'),
      ]);
      const cmp = new Map<string, z.infer<typeof ProblemComparisonSchema>>();
      await Promise.all(
        problems.map((p) =>
          api(ProblemComparisonSchema, `${base}/problems/${p.id}/comparison`)
            .then((c) => cmp.set(p.id, c))
            .catch(() => undefined),
        ),
      );
      const options: ScoreOptionData[] = [];
      for (const p of problems) {
        const c = cmp.get(p.id);
        if (!c) continue;
        const brief = c.brief?.body as { outcome_measure?: string } | undefined;
        const pb = p.body as { affected_group?: string } | undefined;
        for (const a of c.alternatives) {
          const mine = cards.find((s) => scored(s, a.entity.id, reviewer));
          const system = cards.find((s) => assessed(s, a.entity.id));
          options.push({
            id: a.entity.id,
            version: a.entity.version,
            title: a.entity.title,
            kind: String((a.entity.body as { kind?: string })?.kind ?? ''),
            problem: p.title,
            target_users: pb?.affected_group ?? '',
            outcome: brief?.outcome_measure ?? '',
            claims: c.claims.map((x) => ({
              id: x.evidence.claim.id,
              version: x.evidence.claim.version,
              title: x.evidence.claim.statement ?? x.evidence.claim.title,
            })),
            ...(mine
              ? { skip: 'You already scored it; revise that under Decide.' }
              : system
                ? {
                    skip: 'It has an automatic assessment; edit that under Decide.',
                  }
                : {}),
          });
        }
      }
      const def = RUBRICS.suitability;
      return {
        options,
        rubricVersion: def.version,
        criteria: def.criteria.map((c) => ({
          key: c.key,
          label: c.label,
          anchors: c.anchors,
        })),
      } satisfies ScoreData;
    }
    case 'record_choice': {
      const [problems, runs, names] = await Promise.all([
        entities(base, 'problem'),
        api(z.array(RunControlSchema), `${base}/runs`),
        runNames(base),
      ]);
      const active = newestFirst(runs.filter((r) => r.state === 'active'));
      const out: ChoiceData = { problems: [] };
      for (const p of problems.slice(0, 10)) {
        const [cmp, report, selections] = await Promise.all([
          api(ProblemComparisonSchema, `${base}/problems/${p.id}/comparison`),
          api(SelectionReportSchema, `${base}/problems/${p.id}/report`),
          api(z.array(SelectionSchema), `${base}/problems/${p.id}/selections`),
        ]);
        const suit = new Map(
          report.suitability.candidates.map((c) => [c.alternative.id, c]),
        );
        const defaultRun =
          cmp.run_id && active.some((r) => r.run_id === cmp.run_id)
            ? cmp.run_id
            : (active[0]?.run_id ?? '');
        out.problems.push({
          id: p.id,
          version: p.version,
          title: p.title,
          report_hash: report.report_hash,
          report,
          runs: active.map((r) => ({
            id: r.run_id,
            label: names.get(r.run_id) ?? `Run ${r.run_id.slice(0, 8)}`,
          })),
          defaultRun,
          alternatives: cmp.alternatives.map((a) => {
            const s = suit.get(a.entity.id);
            return {
              id: a.entity.id,
              version: a.entity.version,
              title: a.entity.title,
              kind: String((a.entity.body as { kind?: string })?.kind ?? ''),
              rank: s?.rank ?? null,
              blocked: (s?.gates.blocked ?? {}) as Record<string, string[]>,
            };
          }),
          ...(selections.some((s) => s.current)
            ? {
                skip: 'A choice is already recorded for it; change it under Decide, where the earlier decisions are carried over.',
              }
            : cmp.alternatives.length === 0
              ? { skip: 'Its discovery proposed no options.' }
              : {}),
        });
      }
      return out;
    }
    case 'save_proposal': {
      const [proposals, problems, alts] = await Promise.all([
        api(z.array(ProposalSummarySchema), `${base}/proposals`),
        entities(base, 'problem'),
        entities(base, 'alternative'),
      ]);
      const selections = await Promise.all(
        problems.map((p) =>
          api(z.array(SelectionSchema), `${base}/problems/${p.id}/selections`),
        ),
      );
      const eligible: ProposalData['eligible'] = [];
      selections.forEach((sels, i) => {
        const current = sels.find((s) => s.current);
        for (const d of current?.dispositions ?? []) {
          if (
            d.disposition !== 'recommend_alternative' &&
            d.disposition !== 'proceed_to_validation'
          )
            continue;
          const a = alts.find((x) => x.id === d.alternative.id.toLowerCase());
          const kind = String(a?.body?.kind ?? '');
          if (!a || !(PROPOSAL_KINDS as readonly string[]).includes(kind))
            continue;
          if (proposals.some((p) => p.alternative.id === a.id)) continue;
          eligible.push({
            option: { id: a.id, version: a.version, title: a.title, kind },
            problem: problems[i]!.title,
          });
        }
      });
      const picked =
        typeof input.option === 'string' &&
        eligible.some((e) => e.option.id === input.option)
          ? input.option
          : null;
      const draft = picked
        ? await api(
            ProposalDraftSchema,
            `${base}/proposals/draft?alternative=${picked}`,
          )
        : null;
      return {
        eligible,
        draft: draft as ProposalData['draft'],
        sections: PROPOSAL_SECTIONS.map((k) => ({
          key: k,
          label: PROPOSAL_SECTION_LABELS[k],
          core: CORE_PROPOSAL_SECTIONS.includes(k),
        })),
      } satisfies ProposalData;
    }
  }
}

type CardBody = {
  rubric?: string;
  subject?: { id: string };
  reviewer?: { kind: string; label: string };
  assessment?: unknown;
};
const scored = (s: StoredEntity, option: string, reviewer: string) => {
  const b = s.body as CardBody | undefined;
  return (
    b?.rubric === 'suitability' &&
    b.subject?.id.toLowerCase() === option &&
    b.reviewer?.kind === 'human' &&
    b.reviewer.label === reviewer
  );
};
const assessed = (s: StoredEntity, option: string) => {
  const b = s.body as CardBody | undefined;
  return (
    b?.rubric === 'suitability' &&
    b.subject?.id.toLowerCase() === option &&
    !!b.assessment
  );
};
