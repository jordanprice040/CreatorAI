import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ArtifactSupervisor,
  ProductSupervisor,
  ExecutionSupervisor,
  BuildSupervisor,
  buildPlanSchema,
  planRoleResultSchema,
  digest,
  pathSchema,
  runStudyBuild,
  type BuildPorts,
  bindingSchema,
  type Binding,
} from '@creator/executor';
import {
  ContractError,
  ArtifactComparisonSchema,
  ArtifactDetailSchema,
  ArtifactSummarySchema,
  FeedbackSchema,
  PreviewSchema,
  PreviewStartSchema,
  AdmissionSchema,
  BuildApprovalResultSchema,
  BrokerCallResultSchema,
  BrokerStatusSchema,
  EnvelopeSchema,
  PricingSnapshotSchema,
  ReservationSchema,
  DecisionSchema,
  GrantSchema,
  HumilityVerdictSchema,
  RunControlSchema,
  SessionInfoSchema,
  HealthSchema,
  FixtureResponseSchema,
  FixtureRequestSchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  WorkspaceSchema,
  StoredEntitySchema,
  StoredLinkSchema,
  EntityDetailSchema,
  HistoryEntrySchema,
  ClaimEvidenceSchema,
  ClaimSupportSchema,
  RetrievalSchema,
  SourceBrokerStatusSchema,
  SourceDetailSchema,
  SourceSummarySchema,
  EvidencePacketSchema,
  FreezeOutcomeSchema,
  SelectOutcomeSchema,
  SelectionReportSchema,
  SelectionSchema,
  SpecStatusSchema,
  SpecBodySchema,
  ActivityPageSchema,
  OverviewSchema,
  ProblemComparisonSchema,
  SearchResultSchema,
  SemanticSearchResultSchema,
  SavedQuerySchema,
  AuditAnswerSchema,
  LineageGraphSchema,
  LineageExportSchema,
  LineageVerifyResultSchema,
  ModelRegistrySchema,
  RoutePolicySchema,
  RouteBenchmarkSchema,
  PromotionSchema,
  RouteDecisionSchema,
  RouteOutcomeSchema,
  ModelRefSchema,
  CapabilityRegistrySchema,
  IndexEntrySchema,
  IndexResultSchema,
  ContextPackSchema,
  CompactionSchema,
  HandoffSchema,
  ContextCallResultSchema,
  CacheEntrySchema,
  BatchSchema,
  ContextEvaluationSchema,
  ContextUsageReportSchema,
  type SelectionReport,
  type SpecStatus,
  type WorkflowDetail,
  z,
  parse,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  fixtureSpecRevision,
  registryRequestFromConfig,
  capabilitiesRequestFromConfig,
} from '@creator/domain';
import { batchesOf, readCorpus } from './context-index.js';
import {
  CREDITS_OFF_STATEMENT,
  buildBlockers,
  connectionDataBlocker,
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  PlanConnectionSchema,
  PlanConnectionDetailSchema,
  PlanQualificationSchema,
  PlanRequestSchema,
  PlanVerificationGrantSchema,
} from '@creator/contracts';
import {
  GitHubConnectionSchema,
  GitHubDeliverySchema,
  GitHubOperationSchema,
  GitHubRepositorySchema,
  GitHubReviewSchema,
  AllocationSchema,
  CapacitySchema,
  CheckoutSchema,
  EntitlementSchema,
  LedgerEntrySchema,
  OfferSchema,
  PaymentConnectionSchema,
  ReinvestmentPolicySchema,
} from '@creator/contracts';

const USAGE = `Usage:
  pnpm cli product-init <workspace> <frozen-spec-id> [--from <artifact-id>]
  pnpm cli product-task <product-id> <Tn> <expected-integration-commit>
  pnpm cli product-patch <product-id> <task-id> <changes.json>
  pnpm cli product-integrate <product-id> <task-id> <expected-integration-commit> <expected-task-commit>
  pnpm cli product-build <product-id> <task-id> <expected-task-commit>
  pnpm cli build-task <product-id> <task-id> <expected-task-commit> <build-plan.json>
  pnpm cli build-status <product-id> <build-id>
  pnpm cli product-status <product-id>
  pnpm cli artifact-package <product-id> <build-id> [--previous <artifact-id>] [--feedback <feedback-id> ...]
  pnpm cli artifacts <workspace>
  pnpm cli artifact <workspace> <artifact-id>
  pnpm cli artifact-download <workspace> <artifact-id> <manifest-sha256> <output.tar>
  pnpm cli artifact-compare <workspace> <base-artifact-id> <candidate-artifact-id>
  pnpm cli preview-start <workspace> <artifact-id> <manifest-sha256> [ttl-minutes] [max-runs]
  pnpm cli preview-stop <workspace> <preview-id> <expected-version> <reason> [--revoke]
  pnpm cli feedback-submit <workspace> <artifact-id> <manifest-sha256> <defect|change_request|question|praise> <text>
  pnpm cli feedback-decide <workspace> <feedback-id> <expected-version> <accept|decline> <rationale>
  pnpm cli feedback-revise <workspace> <feedback-id> <revision.json>
  pnpm cli product-cancel <product-id> <execution-id>
  pnpm cli product-reconcile <product-id> <execution-id>
  pnpm cli study-seed <workspace>
  pnpm cli studies <workspace>
  pnpm cli study <workspace> <study-id>
  pnpm cli study-create <workspace> <manifest.json>
  pnpm cli study-assign <workspace> <study-id> <assignment.json>
  pnpm cli study-export <workspace> <study-id> <output.json>
  pnpm cli study-execute <workspace> <attempt-id>
  pnpm cli study-context <workspace> <attempt-id>
  pnpm cli study-write <workspace> <attempt-id> <artifacts|tests|interventions|finish|deviations|helpers> <entry.json>
  pnpm cli study-build <workspace> <attempt-id>
  pnpm cli study-code <workspace> <attempt-id> <files.json>
  pnpm cli protocol-proposal <workspace>
  pnpm cli protocol-freeze <workspace> <decisions.json> [freeze.json]
  pnpm cli health
  pnpm cli demo [outcome] [goal]
  pnpm cli workspaces
  pnpm cli workspace-create <name> <fixture|real>
  pnpm cli list <workspace> [kind]
  pnpm cli create <workspace> <kind> <title> <body-json>
  pnpm cli show <workspace> <id>
  pnpm cli revise <workspace> <id> <expected-version> <title> <body-json> <reason>
  pnpm cli archive <workspace> <id> <expected-version> <reason>
  pnpm cli link <workspace> <relation> <from-id>@<version> <to-id>@<version> <rationale>
  pnpm cli lineage <workspace> <id> [upstream|downstream] [depth 1-8]
  pnpm cli search <workspace> <query> [record,passage,decision,activity,code_version,model,cost] [kind] [status] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--tz Area/City]
  pnpm cli search-semantic <workspace> <semantic-request-json|file.json>
  pnpm cli saved-query-save <workspace> <name> <search|question> <body-json|file.json>
  pnpm cli saved-queries <workspace>
  pnpm cli saved-query-run <workspace> <saved-query-id>
  pnpm cli saved-query-archive <workspace> <saved-query-id>
  pnpm cli ask <workspace> <question> [time-zone]
  pnpm cli ask-model <workspace> <question-request-json|file.json>
  pnpm cli audit-plan <workspace> <plan-json|file.json>
  pnpm cli lineage-graph <workspace> <id> [upstream|downstream|both] [depth 1-8] [max-nodes]
  pnpm cli lineage-export <workspace> <id> <output.json> [upstream|downstream|both] [depth 1-8]
  pnpm cli lineage-verify <workspace> <export.json>
  pnpm cli member-add <workspace> <actor-id> <owner|editor|viewer>
  pnpm cli member-remove <workspace> <actor-id> <reason>
  pnpm cli activity <workspace> [query] [action-prefix]
  pnpm cli overview <workspace>
  pnpm cli compare <workspace> <problem-id>
  pnpm cli history <workspace> [subject-id]
  pnpm cli seed-lineage
  pnpm cli login <code> | logout | whoami
  pnpm cli runs <workspace>
  pnpm cli run-register <workspace> <run-id>@<version> <mode> [grant-id@version ...]
  pnpm cli run-cancel <workspace> <run-id> <reason>
  pnpm cli admit <workspace> <run-id> <action-json>
  pnpm cli decisions <workspace> [status]
  pnpm cli decision <workspace> <decision-id>
  pnpm cli answer <workspace> <decision-id> <coverage-hash> <choice> [option-id] <rationale> [--standing-days <n>]
  pnpm cli grants <workspace>
  pnpm cli grant-create <workspace> <grant-json>
  pnpm cli grant-revoke <workspace> <grant-id> <expected-version> <reason>
  pnpm cli humility-gate <workspace> <review-id>
  pnpm cli broker-status
  pnpm cli pricing <workspace>
  pnpm cli pricing-add <workspace> <pricing-file.json>
  pnpm cli marketing-list <workspace>
  pnpm cli portfolio <workspace>
  pnpm cli portfolio-command <workspace> <policy|runs|tick|reconcile|health|scheduler-resume> <json|file.json>
  pnpm cli portfolio-schedule <workspace> <json|file.json>
  pnpm cli portfolio-cancel <workspace> <schedule-id> <reason>
  pnpm cli knowledge-propose <workspace> <json|file.json>
  pnpm cli knowledge-activate <workspace> <json|file.json>
  pnpm cli knowledge-command <workspace> <candidate-id> <verify|review|revoke> <json|file.json>
  pnpm cli marketing-get <workspace> <campaign-id>
  pnpm cli marketing-draft <workspace> <campaign-json|file.json>
  pnpm cli marketing-suppress <workspace> <suppression-json|file.json>
  pnpm cli marketing-action <workspace> <campaign-id> <grant|cancel|revoke|deliver|reconcile|observe> <action-json|file.json>
  pnpm cli github-connect <workspace> <connection-json|file.json>
  pnpm cli github-connections <workspace>
  pnpm cli github-verify <workspace> <connection-id>
  pnpm cli github-revoke <workspace> <connection-id> <expected-version> <reason>
  pnpm cli github-deliveries <workspace> <connection-id>
  pnpm cli github-repos <workspace>
  pnpm cli github-op <workspace> <operation-json|file.json>
  pnpm cli github-ops <workspace>
  pnpm cli github-reconcile <workspace> <operation-id>
  pnpm cli github-review <workspace> <review-json|file.json>
  pnpm cli pay-connect <workspace> <connection-json|file.json>
  pnpm cli pay-connections <workspace>
  pnpm cli pay-verify <workspace> <connection-id>
  pnpm cli pay-revoke <workspace> <connection-id> <expected-version> <reason>
  pnpm cli pay-events <workspace> <connection-id>
  pnpm cli offer-create <workspace> <offer-json|file.json>
  pnpm cli offers <workspace>
  pnpm cli offer-archive <workspace> <offer-id>
  pnpm cli checkout <workspace> <checkout-json|file.json>
  pnpm cli pay-reconcile <workspace> <connection-id> <payment-id>
  pnpm cli payout-reconcile <workspace> <connection-id> <payout-id>
  pnpm cli ledger <workspace>
  pnpm cli ledger-balances <workspace>
  pnpm cli owner-funding <workspace> <amount-nano-usd> <evidence>
  pnpm cli entitlements <workspace>
  pnpm cli entitlement-check <workspace> <artifact-id> <customer-ref>
  pnpm cli rails <workspace>
  pnpm cli rail-add <workspace> <rail-json|file.json>
  pnpm cli rail-status <workspace> <rail-id> <available|unavailable> <reason>
  pnpm cli rail-attest <workspace> <rail-id> <available-nano-usd> <evidence>
  pnpm cli rail-observe <workspace> <rail-id>
  pnpm cli commitments <workspace>
  pnpm cli commitment-add <workspace> <commitment-json|file.json>
  pnpm cli commitment-close <workspace> <commitment-id>
  pnpm cli reinvest <workspace>
  pnpm cli reinvest-policy <workspace> [policy-json|file.json]
  pnpm cli reinvest-allocate <workspace> <allocation-json|file.json>
  pnpm cli reinvest-allocations <workspace>
  pnpm cli reinvest-tranches <workspace>
  pnpm cli reinvest-settle <workspace>
  pnpm cli route-registry-add <workspace> <config/routing/model-registry*.json>
  pnpm cli route-registries <workspace>
  pnpm cli route-policy-set <workspace> <policy-json|file.json> [project-id]
  pnpm cli route-policies <workspace>
  pnpm cli route-benchmark-add <workspace> <benchmark-manifest.json>
  pnpm cli route-promotion-create <workspace> <request-json|file.json>
  pnpm cli route-promotions <workspace>
  pnpm cli route-promotion <workspace> <promotion-id>
  pnpm cli route-benchmark-run <workspace> <promotion-id> <run-id> <envelope-id> [timeout-ms]
  pnpm cli route-advance|route-rollback <workspace> <promotion-id> <expected-version> <reason>
  pnpm cli route-decide <workspace> <route-request-json|file.json>
  pnpm cli route-decisions <workspace> [run-id]
  pnpm cli route-call <workspace> <decision-id> <broker-request-json|file.json> [--shadow]
  pnpm cli plan-connect <workspace> <label> [config/connections/chatgpt-plan.json]
  pnpm cli plan-connections <workspace>
  pnpm cli plan-connection <workspace> <connection-id>
  pnpm cli plan-settings <workspace> <connection-id> <expected-version> <settings.json>
  pnpm cli plan-accept-caps <workspace> <connection-id> <expected-version> <settings-hash>
  pnpm cli plan-credits-off <workspace> <connection-id> <expected-version> <checked-on YYYY-MM-DD>
  pnpm cli plan-credits-withdraw <workspace> <connection-id> <expected-version> <reason>
  pnpm cli plan-sign-in|plan-sign-out <workspace> <connection-id>
  pnpm cli plan-verify-approve <workspace> <connection-id> <expected-version> <model-id> [minutes]
  pnpm cli plan-verify <workspace> <connection-id> <grant-id> <model-id>
  pnpm cli plan-qualify <workspace> <connection-id> <expected-version> <model-id> <manifest.json> <min-held-out> <floor n/d>
  pnpm cli plan-qualify-run|plan-qualify-finish <workspace> <qualification-id>
  pnpm cli plan-requests <workspace> <connection-id>
  pnpm cli plan-reconcile <workspace> <connection-id> <request-id> <expected-version> <did_not_run|ran> <note>
  pnpm cli plan-quota-recheck <workspace> <connection-id> <expected-version>
  pnpm cli claude-connect <workspace> <label> [config/connections/claude-code.json]
  pnpm cli claude-check <workspace> <connection-id>
  pnpm cli claude-usage-off <workspace> <connection-id> <expected-version> <checked-on YYYY-MM-DD>
  pnpm cli route-outcome <workspace> <decision-id> <outcome-json|file.json>
  pnpm cli route-escalate <workspace> <decision-id> [new-operation-id]
  pnpm cli context-capabilities-add <workspace> <config/context/provider-capabilities*.json>
  pnpm cli context-capabilities <workspace>
  pnpm cli context-index <workspace> <corpus> <code|note|source> <data-class> <folder|items.json>
  pnpm cli context-index-records <workspace> <corpus> <data-class> <kind,kind,...>
  pnpm cli context-entries <workspace> [corpus]
  pnpm cli context-pack <workspace> <pack-request-json|file.json>
  pnpm cli context-packs <workspace> [run-id]
  pnpm cli context-pack-show <workspace> <pack-id>
  pnpm cli context-compact <workspace> <pack-id> <compact-request-json|file.json>
  pnpm cli context-compactions <workspace> <pack-id>
  pnpm cli context-handoff <workspace> <handoff-json|file.json>
  pnpm cli context-call <workspace> <call-request-json|file.json>
  pnpm cli context-cache <workspace>
  pnpm cli context-cache-invalidate <workspace> <entry-id> <reason>
  pnpm cli context-batch <workspace> <batch-request-json|file.json>
  pnpm cli context-batch-show|context-batch-poll <workspace> <batch-id>
  pnpm cli context-eval-create <workspace> <evaluation-request-json|file.json>
  pnpm cli context-eval-run|context-eval <workspace> <evaluation-id>
  pnpm cli context-usage <workspace> [run-id]
  pnpm cli budgets <workspace>
  pnpm cli budget <workspace> <envelope-id>
  pnpm cli budget-create <workspace> <envelope-json>
  pnpm cli budget-close <workspace> <envelope-id> <expected-version> <reason>
  pnpm cli reservations <workspace> [envelope-id]
  pnpm cli model-call <workspace> <run-id> <request-json>
  pnpm cli reconcile <workspace> <reservation-id> <reconcile-json>
  pnpm cli workflow-start <workspace> <run-id> <request-json>
  pnpm cli workflows <workspace> [run-id]
  pnpm cli workflow <workspace> <workflow-id> [--wait]
  pnpm cli workflow-pause|workflow-resume|workflow-cancel <workspace> <workflow-id> <expected-version> <reason>
  pnpm cli source-status
  pnpm cli source-fetch <workspace> <run-id> <url> [justification]
  pnpm cli sources <workspace>
  pnpm cli source <workspace> <source-id>
  pnpm cli retrievals <workspace> [run-id]
  pnpm cli claim-support <workspace> <claim-id> <support-json>
  pnpm cli claim-evidence <workspace> <claim-id> [max-age-days]
  pnpm cli support-retract <workspace> <support-id> <reason>
  pnpm cli seed-research
  pnpm cli discovery-start <workspace> <run-id> <request-json>
  pnpm cli discovery <workspace> <workflow-id> [--wait]
  pnpm cli discovery-packet <workspace> <workflow-id>
  pnpm cli seed-discovery
  pnpm cli scorecard <workspace> <scorecard-json>
  pnpm cli report <workspace> <problem-id> [shortlist-size]
  pnpm cli select <workspace> <run-id> <select-json>
  pnpm cli selections <workspace> <problem-id>
  pnpm cli spec-create <workspace> <spec-json>
  pnpm cli spec <workspace> <spec-id>
  pnpm cli spec-revise <workspace> <spec-id> <revise-json>
  pnpm cli spec-freeze <workspace> <run-id> <freeze-json>
  pnpm cli seed-selection

Workflows run on the API server's worker (or \`pnpm worker\`), not in this command: exiting the
CLI or closing the web page does not stop or cancel them.

Sign-in state is kept in CREATOR_SESSION_FILE (default .creator/cli-session.json).`;
interface Saved {
  origin: string;
  token: string;
  csrf: string;
}
function sessionFile(): string {
  return process.env.CREATOR_SESSION_FILE ?? '.creator/cli-session.json';
}
function loadSession(origin: string): Saved | null {
  try {
    const saved = JSON.parse(readFileSync(sessionFile(), 'utf8')) as Saved;
    return saved.origin === origin ? saved : null;
  } catch {
    return null;
  }
}

function json(raw: string | undefined, label: string): unknown {
  try {
    return JSON.parse(raw ?? '') as unknown;
  } catch {
    throw new Error(`${label} must be JSON.`);
  }
}
/** JSON given inline, or read from a .json file (easier to quote in PowerShell). */
function jsonArg(raw: string | undefined, label: string): unknown {
  return raw?.endsWith('.json')
    ? json(readFileSync(raw, 'utf8'), label)
    : json(raw, label);
}
function ref(raw: string | undefined) {
  const [id, version] = (raw ?? '').split('@');
  if (!id || !version || !/^[1-9][0-9]*$/.test(version))
    throw new Error('Link endpoints use <id>@<version>.');
  return { id, version: Number(version) };
}
function version(raw: string | undefined) {
  if (!raw || !/^[1-9][0-9]*$/.test(raw))
    throw new Error('Expected version must be a positive integer.');
  return Number(raw);
}

export async function runCli(
  args: string[],
  base = 'http://127.0.0.1:4310',
  write: (value: string) => void = console.log,
): Promise<number> {
  try {
    const url = new URL(base);
    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error('CLI requires a loopback HTTP API origin.');
    const saved = loadSession(url.origin);
    let lastResponse: Response | null = null;
    async function call<T>(
      schema: z.ZodType<T>,
      path: string,
      body?: unknown,
      timeoutMs = 5000,
    ): Promise<T> {
      const auth: Record<string, string> = saved
        ? { Cookie: `creator_session=${saved.token}` }
        : {};
      const response = await fetch(`${url.origin}/api/${path}`, {
        ...(body === undefined
          ? { headers: auth }
          : {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...auth,
                ...(saved ? { 'X-CSRF-Token': saved.csrf } : {}),
              },
              body: JSON.stringify(body),
            }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastResponse = response;
      const value: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          `API returned ${response.status}: ${JSON.stringify(value)}`,
        );
      return parse(schema, value);
    }
    const ws = (raw: string | undefined) => {
      if (!raw) throw new Error(USAGE);
      return `workspaces/${encodeURIComponent(raw)}`;
    };
    const [command = 'health', ...rest] = args;
    // Same product store as the API: the dev studio launcher sets CREATOR_PRODUCTS_ROOT to
    // .creator/studio/products, and a CLI run from that shell must see the same products.
    const local = new ProductSupervisor(
      process.env.CREATOR_PRODUCTS_ROOT ?? '.creator/products',
    );
    const executor = new ExecutionSupervisor(
      local,
      process.env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
    );
    const artifacts = new ArtifactSupervisor(local, executor);
    const flagged = (flag: string) => {
      const out: string[] = [];
      rest.forEach((v, i) => {
        if (v === flag && rest[i + 1]) out.push(rest[i + 1]!);
      });
      return out;
    };
    const localOwner = async (workspace: string) => {
      const [session, workspaces] = await Promise.all([
        call(SessionInfoSchema, 'auth/session'),
        call(z.array(WorkspaceSchema), 'workspaces'),
      ]);
      if (!workspaces.some((w) => w.id === workspace && w.role === 'owner'))
        throw new Error('Workspace owner authorization required');
      return session.actor_id;
    };
    const frozenBinding = async (
      workspace: string,
      specId: string,
    ): Promise<Binding> => {
      const owner = await localOwner(workspace);
      const [status, detail] = await Promise.all([
        call(
          SpecStatusSchema,
          `${ws(workspace)}/specs/${encodeURIComponent(specId)}`,
        ),
        call(
          EntityDetailSchema,
          `${ws(workspace)}/entities/${encodeURIComponent(specId)}`,
        ),
      ]);
      const freeze = status.latest_freeze;
      if (
        !status.frozen_current ||
        !freeze ||
        status.spec.status !== 'active' ||
        status.problems.length ||
        status.blockers.length ||
        detail.entity.version !== status.spec.version ||
        detail.entity.content_hash !== status.spec.content_hash ||
        freeze.content_hash !== status.spec.content_hash
      )
        throw new Error('A current active frozen specification is required');
      const spec = parse(SpecBodySchema, detail.entity.body);
      return parse(bindingSchema, {
        workspace_id: workspace,
        owner_id: owner,
        spec_id: specId,
        spec_version: status.spec.version,
        spec_hash: status.spec.content_hash,
        freeze_id: freeze.id,
        tasks: spec.tasks
          .filter((t) => t.file_scope.length)
          .map((t) => ({
            key: t.key,
            hash: freeze.task_hashes[t.key],
            file_scope: t.file_scope,
          })),
      });
    };
    const currentBinding = async (productId: string) => {
      const p = await local.product(productId);
      const binding = await frozenBinding(
        p.binding.workspace_id,
        p.binding.spec_id,
      );
      local.assertBinding(p, binding);
      return binding;
    };
    const buildPorts = (productId: string): BuildPorts => {
      let coverage: { grant_id: string; grant_version: number } | null = null;
      let humility: { id: string; version: number } | null = null;
      return {
        current: async () => {
          const binding = await currentBinding(productId);
          const detail = await call(
            EntityDetailSchema,
            `${ws(binding.workspace_id)}/entities/${binding.spec_id}`,
          );
          if (
            detail.entity.version !== binding.spec_version ||
            detail.entity.content_hash !== binding.spec_hash
          )
            throw new Error(
              'Specification changed while reading build context',
            );
          return { binding, spec: parse(SpecBodySchema, detail.entity.body) };
        },
        assertActive: async (runId) => {
          const p = await local.product(productId);
          const runs = await call(
            z.array(RunControlSchema),
            `${ws(p.binding.workspace_id)}/runs`,
          );
          const run = runs.find((r) => r.run_id === runId);
          if (
            !run ||
            run.state !== 'active' ||
            run.experiment_condition === 'human_only' ||
            run.autonomy_mode === 'human_only'
          )
            throw new Error(
              'An active non-human-only registered run is required',
            );
          if (coverage && humility) {
            const [grants, review] = await Promise.all([
              call(
                z.array(GrantSchema),
                `${ws(p.binding.workspace_id)}/grants`,
              ),
              call(
                EntityDetailSchema,
                `${ws(p.binding.workspace_id)}/entities/${humility.id}`,
              ),
            ]);
            const grant = grants.find((g) => g.id === coverage!.grant_id);
            if (
              !grant ||
              grant.version !==
                coverage.grant_version + (grant.scope === 'once' ? 1 : 0) ||
              grant.status !==
                (grant.scope === 'once' ? 'consumed' : 'active') ||
              Date.parse(grant.expires_at) <= Date.now() ||
              review.entity.version !== humility.version ||
              review.entity.status !== 'active'
            )
              throw new Error(
                'Build authority or humility review changed or expired',
              );
          }
        },
        // ADR-0054: the build's one approval, recorded by the studio with its stated limits.
        authorize: async (plan, scope) => {
          const p = await local.product(productId);
          const { admission, approval } = await call(
            BuildApprovalResultSchema,
            `${ws(p.binding.workspace_id)}/runs/${plan.run_id}/build-approvals`,
            {
              build_id: scope.build_id,
              product_id: scope.product_id,
              task_id: scope.task_id,
              spec: {
                id: p.binding.spec_id,
                version: p.binding.spec_version,
              },
              spec_hash: p.binding.spec_hash,
              plan_hash: scope.plan_hash,
              route: scope.route,
              connection_id: scope.connection_id,
              model_id: scope.model_id,
              data_class: plan.data_class,
              humility_review: plan.humility_review,
              request_limit: scope.request_limit,
              max_repairs: scope.max_repairs,
              expires_at: scope.expires_at,
            },
          );
          if (admission.verdict !== 'allow' || !approval)
            throw new Error(
              `Build admission ${admission.outcome}; decision ${admission.decision_id ?? 'none'}`,
            );
          if (!admission.covered_by)
            throw new Error('Build admission has no covering grant');
          coverage = admission.covered_by;
          humility = plan.humility_review;
          return { admission, approval };
        },
        call: async (runId, request) => {
          const p = await local.product(productId);
          return call(
            BrokerCallResultSchema,
            `${ws(p.binding.workspace_id)}/runs/${runId}/model-calls`,
            request,
            request.timeout_ms + 5000,
          );
        },
        // ADR-0042: the API holds the ChatGPT sign-in, relay and Codex jail; T12 keeps review and QA.
        codexBuilder: async (target, packet) => {
          const p = await local.product(productId);
          const { evidence: _, ...out } = await call(
            z.object({ evidence: z.unknown() }).passthrough(),
            `${ws(p.binding.workspace_id)}/plan-connections/${target.connection_id}/codex-builds`,
            {
              build_id: target.build_id,
              run_id: target.run_id,
              model_id: target.model_id,
              data_class: target.data_class,
              packet,
            },
            1_900_000,
          );
          return out;
        },
        // ADR-0048: the API holds the ChatGPT sign-in and admits each fresh role request.
        planRole: async (target, request) => {
          const p = await local.product(productId);
          return call(
            planRoleResultSchema,
            `${ws(p.binding.workspace_id)}/plan-connections/${target.connection_id}/build-calls`,
            {
              role: target.role,
              run_id: target.run_id,
              build_id: target.build_id,
              model_id: target.model_id,
              data_class: target.data_class,
              ...request,
            },
            request.timeout_ms + 5000,
          );
        },
        planRolesReady: async (target) => {
          const p = await local.product(productId);
          return (
            await call(
              z.strictObject({ blockers: z.array(z.string()) }),
              `${ws(p.binding.workspace_id)}/plan-connections/${target.connection_id}/build-roles-ready`,
              {
                model_id: target.model_id,
                run_id: target.run_id,
                data_class: target.data_class,
              },
              10_000,
            )
          ).blockers;
        },
      };
    };
    let data: unknown;
    switch (command) {
      case 'build-task': {
        const ports = buildPorts(rest[0]!);
        const raw = JSON.parse(readFileSync(rest[3]!, 'utf8')) as unknown;
        // Why the frozen spec can't be built, said in words before the plan's own schema
        // reports it (e.g. "cases: Too small"); the supervisor enforces the same rules.
        const { spec } = await ports.current();
        const task = await local.task(rest[0]!, rest[1]!);
        const cls = (raw as { data_class?: unknown } | null)?.data_class;
        const blockers = buildBlockers(
          spec,
          task.key,
          cls === 'synthetic' || cls === 'public' || cls === 'private_approved'
            ? cls
            : undefined,
        );
        if (blockers.length)
          throw new Error(`This build can't start yet. ${blockers.join(' ')}`);
        const plan = parse(buildPlanSchema, raw);
        // As the studio route does: a plan connection that doesn't allow the data class refuses
        // here, before the build is recorded or its approval is asked for.
        const target = plan.plan_roles ?? plan.codex_plan_builder;
        if (target) {
          const p = await local.product(rest[0]!);
          const detail = await call(
            PlanConnectionDetailSchema.extend({ sign_in_attempt: z.unknown() }),
            `${ws(p.binding.workspace_id)}/plan-connections/${target.connection_id}`,
          );
          const refusal = connectionDataBlocker(
            detail.connection.settings.allowed_data_classes,
            plan.data_class,
            detail.connection.label,
          );
          if (refusal)
            throw new Error(`This build can't start yet. ${refusal}`);
        }
        data = await new BuildSupervisor(local, executor).run(
          rest[0]!,
          rest[1]!,
          rest[2]!,
          plan,
          ports,
          (build_id) => write(JSON.stringify({ build_id, state: 'running' })),
        );
        break;
      }
      case 'build-status':
        data = await new BuildSupervisor(local, executor).status(
          rest[0]!,
          rest[1]!,
          buildPorts(rest[0]!),
        );
        break;
      case 'product-init': {
        const binding = await frozenBinding(rest[0]!, rest[1]!);
        const [from] = flagged('--from');
        if (!from) {
          data = await local.create(binding);
          break;
        }
        // A revision starts from the exact verified package bytes, re-hashed against the index.
        const detail = await call(
          ArtifactDetailSchema,
          `${ws(rest[0])}/artifacts/${encodeURIComponent(from)}`,
        );
        if (
          detail.manifest.state !== 'verified' ||
          detail.manifest.spec.id !== binding.spec_id
        )
          throw new Error(
            'Revision base must be a verified package of the same specification',
          );
        const opened = await artifacts.open(
          detail.manifest.product_id,
          from,
          detail.artifact.manifest_sha256,
        );
        data = await local.create(binding, {
          files: opened.files,
          lineage: {
            artifact_id: from,
            manifest_sha256: detail.artifact.manifest_sha256,
            product_id: detail.manifest.product_id,
            commit: detail.manifest.repository.commit,
          },
        });
        break;
      }
      case 'artifact-package': {
        const p = await local.product(rest[0]!);
        const [previous] = flagged('--previous');
        const prior = previous
          ? await call(
              ArtifactDetailSchema,
              `${ws(p.binding.workspace_id)}/artifacts/${encodeURIComponent(previous)}`,
            )
          : null;
        const packaged = await artifacts.package(
          p.id,
          rest[1]!,
          buildPorts(p.id),
          {
            previous: prior
              ? {
                  artifact_id: prior.artifact.id,
                  manifest_sha256: prior.artifact.manifest_sha256,
                }
              : null,
            feedback_ids: flagged('--feedback'),
          },
          (artifact_id) =>
            write(JSON.stringify({ artifact_id, state: 'verifying' })),
        );
        const registered = await call(
          ArtifactSummarySchema,
          `${ws(p.binding.workspace_id)}/artifacts`,
          {
            product_id: p.id,
            artifact_id: packaged.manifest.id,
            manifest_sha256: packaged.manifest_sha256,
          },
        );
        data = {
          artifact: registered,
          state: packaged.manifest.state,
          package_checks: packaged.manifest.tests.package,
          limitations: packaged.manifest.limitations,
        };
        break;
      }
      case 'artifacts':
        data = await call(
          z.array(ArtifactSummarySchema),
          `${ws(rest[0])}/artifacts`,
        );
        break;
      case 'artifact':
        data = await call(
          ArtifactDetailSchema,
          `${ws(rest[0])}/artifacts/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'artifact-download': {
        if (!rest[3]) throw new Error(USAGE);
        const response = await fetch(
          `${url.origin}/api/${ws(rest[0])}/artifacts/${encodeURIComponent(rest[1]!)}/download?sha256=${encodeURIComponent(rest[2]!)}`,
          {
            headers: saved ? { Cookie: `creator_session=${saved.token}` } : {},
            signal: AbortSignal.timeout(10000),
          },
        );
        if (!response.ok)
          throw new Error(
            `API returned ${response.status}: ${await response.text()}`,
          );
        const bytes = Buffer.from(await response.arrayBuffer());
        const { createHash } = await import('node:crypto');
        const got = createHash('sha256').update(bytes).digest('hex');
        if (got !== response.headers.get('x-content-sha256'))
          throw new Error('Downloaded bytes do not match the manifest sha256');
        mkdirSync(dirname(rest[3]), { recursive: true });
        writeFileSync(rest[3], bytes, { flag: 'wx' });
        data = { path: rest[3], sha256: got, bytes: bytes.length };
        break;
      }
      case 'artifact-compare':
        data = await call(
          ArtifactComparisonSchema,
          `${ws(rest[0])}/artifacts/${encodeURIComponent(rest[1] ?? '')}/compare?with=${encodeURIComponent(rest[2] ?? '')}`,
        );
        break;
      case 'preview-start':
        data = await call(
          PreviewStartSchema,
          `${ws(rest[0])}/artifacts/${encodeURIComponent(rest[1] ?? '')}/previews`,
          {
            expected_manifest_sha256: rest[2],
            ttl_minutes: Number(rest[3] ?? 15),
            max_runs: Number(rest[4] ?? 10),
          },
          120000,
        );
        break;
      case 'preview-stop':
        data = await call(
          PreviewSchema,
          `${ws(rest[0])}/previews/${encodeURIComponent(rest[1] ?? '')}/stop`,
          {
            expected_version: version(rest[2]),
            revoke: rest.includes('--revoke'),
            reason: rest[3],
          },
        );
        break;
      case 'feedback-submit':
        data = await call(
          FeedbackSchema,
          `${ws(rest[0])}/artifacts/${encodeURIComponent(rest[1] ?? '')}/feedback`,
          {
            expected_manifest_sha256: rest[2],
            category: rest[3],
            text: rest.slice(4).join(' '),
          },
        );
        break;
      case 'feedback-decide':
        data = await call(
          FeedbackSchema,
          `${ws(rest[0])}/feedback/${encodeURIComponent(rest[1] ?? '')}/decide`,
          {
            expected_version: version(rest[2]),
            decision: rest[3],
            rationale: rest.slice(4).join(' '),
          },
        );
        break;
      case 'feedback-revise':
        data = await call(
          FeedbackSchema,
          `${ws(rest[0])}/feedback/${encodeURIComponent(rest[1] ?? '')}/revision`,
          json(rest[2] && readFileSync(rest[2], 'utf8'), 'revision.json'),
        );
        break;
      case 'product-task':
        data = await local.createTask(
          rest[0]!,
          rest[1]!,
          rest[2]!,
          await currentBinding(rest[0]!),
        );
        break;
      case 'product-patch':
        data = await local.apply(
          rest[0]!,
          rest[1]!,
          JSON.parse(readFileSync(rest[2]!, 'utf8')),
          await currentBinding(rest[0]!),
        );
        break;
      case 'product-integrate':
        data = await local.integrate(
          rest[0]!,
          rest[1]!,
          rest[2]!,
          rest[3]!,
          await currentBinding(rest[0]!),
        );
        break;
      case 'product-build':
        data = await executor.run(
          rest[0]!,
          rest[1]!,
          rest[2]!,
          await currentBinding(rest[0]!),
          (execution_id) =>
            write(JSON.stringify({ execution_id, state: 'running' })),
        );
        break;
      case 'product-status': {
        const p = await local.product(rest[0]!);
        local.assertOwner(p, await localOwner(p.binding.workspace_id));
        data = {
          product: p,
          tasks: await local.tasks(p.id),
          executions: await executor.executions(p.id),
          builds: await new BuildSupervisor(local, executor).list(p.id),
        };
        break;
      }
      case 'product-cancel':
      case 'product-reconcile': {
        const p = await local.product(rest[0]!);
        const owner = await localOwner(p.binding.workspace_id);
        data =
          command === 'product-cancel'
            ? await executor
                .cancel(p.id, rest[1]!, owner)
                .then(() => ({ cancellation_requested: true }))
            : await executor.reconcile(p.id, rest[1]!, owner);
        break;
      }
      case 'studies':
        data = await call(z.unknown(), `${ws(rest[0])}/studies`);
        break;
      case 'study':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/studies/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'study-seed':
        data = await call(z.unknown(), `${ws(rest[0])}/studies/seed`, {});
        break;
      case 'study-create':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/studies`,
          JSON.parse(readFileSync(rest[1]!, 'utf8')),
        );
        break;
      case 'study-assign':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/studies/${encodeURIComponent(rest[1] ?? '')}/assign`,
          JSON.parse(readFileSync(rest[2]!, 'utf8')),
        );
        break;
      case 'study-execute':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/study-attempts/${encodeURIComponent(rest[1] ?? '')}/execute`,
          {},
        );
        break;
      case 'study-context':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/study-attempts/${encodeURIComponent(rest[1] ?? '')}/context`,
        );
        break;
      case 'study-write':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/study-attempts/${encodeURIComponent(rest[1] ?? '')}/${encodeURIComponent(rest[2] ?? '')}`,
          JSON.parse(readFileSync(rest[3]!, 'utf8')),
        );
        break;
      case 'study-build':
        // AI arms of an implementation task: the T12 builder, in a fresh per-attempt product.
        data = await runStudyBuild(
          new BuildSupervisor(local, executor),
          (path, body, timeoutMs) => call(z.unknown(), path, body, timeoutMs),
          rest[0]!,
          rest[1]!,
          (build_id) => write(JSON.stringify({ build_id, state: 'running' })),
        );
        break;
      case 'study-code': {
        // Human-only arm: the participant's files are committed to a per-attempt product and
        // the server runs every frozen case (held-out included) in the product worker.
        const attemptPath = `${ws(rest[0])}/study-attempts/${encodeURIComponent(rest[1] ?? '')}`;
        const bound = await call(
          z.object({
            task_key: z.string(),
            binding: bindingSchema,
          }),
          `${attemptPath}/binding`,
        );
        const submitted = parse(
          z.strictObject({
            files: z
              .array(z.strictObject({ path: pathSchema, content: z.string() }))
              .min(1)
              .max(100),
          }),
          JSON.parse(readFileSync(rest[2]!, 'utf8')),
        );
        const p = await local.create(bound.binding);
        const task = await local.createTask(
          p.id,
          bound.task_key,
          p.initial_commit,
          bound.binding,
        );
        const tree = local.worktree(p.id, task.id);
        const before = (path: string) => {
          try {
            return digest(readFileSync(`${tree}/${path}`, 'utf8'));
          } catch {
            return null;
          }
        };
        const applied = await local.apply(
          p.id,
          task.id,
          {
            expected_commit: p.initial_commit,
            changes: submitted.files.map((f) => ({
              path: f.path,
              before_hash: before(f.path),
              content: f.content,
            })),
          },
          bound.binding,
        );
        data = await call(
          z.unknown(),
          `${attemptPath}/code-check`,
          { product_id: p.id, task_id: task.id, commit: applied.commit },
          120000,
        );
        break;
      }
      case 'study-export':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/studies/${encodeURIComponent(rest[1] ?? '')}/export`,
        );
        if (!rest[2]) throw new Error('Supply an export filename.');
        writeFileSync(rest[2], JSON.stringify(data, null, 2) + '\n', {
          flag: 'wx',
        });
        break;
      case 'protocol-proposal':
        data = await call(z.unknown(), `${ws(rest[0])}/protocol-freezes`);
        break;
      case 'protocol-freeze':
        // decisions.json: { proposal_hash, decisions: [{ id, choice, rationale }] }, owner-authored.
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/protocol-freezes`,
          JSON.parse(readFileSync(rest[1]!, 'utf8')),
        );
        if (rest[2])
          writeFileSync(rest[2], JSON.stringify(data, null, 2) + '\n', {
            flag: 'wx',
          });
        break;
      case 'health':
        data = await call(HealthSchema, 'health');
        break;
      case 'demo':
        data = await call(
          FixtureResponseSchema,
          'fixture',
          parse(FixtureRequestSchema, {
            outcome: rest[0] ?? 'use_existing',
            goal:
              rest.slice(1).join(' ') ||
              'Compare a shared checklist with custom software',
          }),
        );
        break;
      case 'workspaces':
        data = await call(z.array(WorkspaceSchema), 'workspaces');
        break;
      case 'workspace-create':
        data = await call(WorkspaceSchema, 'workspaces', {
          name: rest[0],
          record_mode: rest[1],
        });
        break;
      case 'list':
        data = await call(
          z.array(StoredEntitySchema),
          `${ws(rest[0])}/entities${rest[1] ? `?kind=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'create':
        data = await call(StoredEntitySchema, `${ws(rest[0])}/entities`, {
          kind: rest[1],
          title: rest[2],
          body: json(rest[3], 'Body'),
        });
        break;
      case 'show':
        data = await call(
          EntityDetailSchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'revise':
        data = await call(
          StoredEntitySchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/revisions`,
          {
            expected_version: version(rest[2]),
            title: rest[3],
            body: json(rest[4], 'Body'),
            reason: rest[5],
            corrects_version: null,
          },
        );
        break;
      case 'archive':
        data = await call(
          StoredEntitySchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/archive`,
          { expected_version: version(rest[2]), reason: rest[3] },
        );
        break;
      case 'link':
        data = await call(StoredLinkSchema, `${ws(rest[0])}/links`, {
          relation: rest[1],
          from: ref(rest[2]),
          to: ref(rest[3]),
          rationale: rest.slice(4).join(' '),
        });
        break;
      case 'lineage':
        data = await call(
          z.array(
            z.strictObject({ depth: z.number(), link: StoredLinkSchema }),
          ),
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/lineage?direction=${rest[2] ?? 'upstream'}${rest[3] ? `&depth=${encodeURIComponent(rest[3])}` : ''}`,
        );
        break;
      case 'history':
        data = await call(
          z.array(HistoryEntrySchema),
          `${ws(rest[0])}/history${rest[1] ? `?subject=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'search': {
        const pos = rest.filter(
          (v, i) =>
            !v.startsWith('--') &&
            !['--from', '--to', '--tz'].includes(rest[i - 1] ?? ''),
        );
        const p = new URLSearchParams({ q: pos[1] ?? '' });
        if (pos[2]) p.set('types', pos[2]);
        if (pos[3]) p.set('kind', pos[3]);
        if (pos[4]) p.set('status', pos[4]);
        for (const f of ['from', 'to', 'tz']) {
          const v = flagged(`--${f}`)[0];
          if (v) p.set(f, v);
        }
        const r = await call(SearchResultSchema, `${ws(pos[0])}/search?${p}`);
        data = {
          mode: r.mode,
          fixture: r.fixture,
          counts: r.counts,
          truncated: r.truncated,
          coverage: r.coverage,
          freshness: r.freshness,
          hits: r.hits.map((h) => ({
            occurred_local: h.occurred_local,
            ...(h.amounts ? { amounts: h.amounts } : {}),
            type: h.type,
            id: h.id,
            match: h.match,
            kind: h.kind,
            title: h.title,
            status: h.status,
            snippet: h.snippet
              .map((x) => (x.match ? `[${x.text}]` : x.text))
              .join(''),
          })),
        };
        break;
      }
      case 'search-semantic':
        data = await call(
          SemanticSearchResultSchema,
          `${ws(rest[0])}/semantic-search`,
          jsonArg(rest[1], 'Semantic search request'),
          120_000,
        );
        break;
      case 'saved-query-save':
        data = await call(SavedQuerySchema, `${ws(rest[0])}/saved-queries`, {
          name: rest[1],
          kind: rest[2],
          body: jsonArg(rest[3], 'Saved query body'),
        });
        break;
      case 'saved-queries':
        data = await call(
          z.array(SavedQuerySchema),
          `${ws(rest[0])}/saved-queries`,
        );
        break;
      case 'saved-query-run':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/saved-queries/${encodeURIComponent(rest[1] ?? '')}/run`,
        );
        break;
      case 'saved-query-archive':
        data = await call(
          SavedQuerySchema,
          `${ws(rest[0])}/saved-queries/${encodeURIComponent(rest[1] ?? '')}/archive`,
          {},
        );
        break;
      case 'ask':
        data = await call(
          AuditAnswerSchema,
          `${ws(rest[0])}/audit-questions`,
          {
            question: rest[1] ?? '',
            ...(rest[2] ? { tz: rest[2] } : {}),
          },
          30_000,
        );
        break;
      case 'ask-model':
        data = await call(
          AuditAnswerSchema,
          `${ws(rest[0])}/audit-questions`,
          jsonArg(rest[1], 'Question request'),
          120_000,
        );
        break;
      case 'audit-plan':
        data = await call(
          AuditAnswerSchema,
          `${ws(rest[0])}/audit-plans`,
          { plan: jsonArg(rest[1], 'Plan') },
          30_000,
        );
        break;
      case 'lineage-graph':
      case 'lineage-export': {
        const exporting = command === 'lineage-export';
        const [dir, depth, maxNodes] = exporting
          ? [rest[3], rest[4], undefined]
          : [rest[2], rest[3], rest[4]];
        const p = new URLSearchParams();
        if (dir) p.set('direction', dir);
        if (depth) p.set('depth', depth);
        if (maxNodes) p.set('max_nodes', maxNodes);
        const path = `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/${command}?${p}`;
        if (!exporting) {
          data = await call(LineageGraphSchema, path);
          break;
        }
        if (!rest[2]) throw new Error(USAGE);
        const bundle = await call(LineageExportSchema, path);
        // Never overwrite: an earlier export may be the only copy someone relies on.
        writeFileSync(rest[2], JSON.stringify(bundle, null, 2) + '\n', {
          flag: 'wx',
        });
        data = {
          written: rest[2],
          graph_sha256: bundle.graph_sha256,
          nodes: bundle.graph.nodes.length,
          edges: bundle.graph.edges.length,
          truncated: bundle.graph.truncated,
        };
        break;
      }
      case 'lineage-verify':
        data = await call(
          LineageVerifyResultSchema,
          `${ws(rest[0])}/lineage-verify`,
          jsonArg(rest[1], 'Lineage export'),
        );
        break;
      case 'member-add':
        data = await call(z.unknown(), `${ws(rest[0])}/members`, {
          actor_id: rest[1],
          role: rest[2],
        });
        break;
      case 'member-remove':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/members/${encodeURIComponent(rest[1] ?? '')}/remove`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'activity': {
        const p = new URLSearchParams();
        if (rest[1]) p.set('q', rest[1]);
        if (rest[2]) p.set('action', rest[2]);
        data = (
          await call(ActivityPageSchema, `${ws(rest[0])}/activity?${p}`)
        ).entries.map((e) => ({
          at: e.occurred_at,
          actor: `${e.actor.display_name} (${e.actor.kind})`,
          action: e.action,
          summary: e.summary,
          subject: `${e.subject_kind} ${e.subject_id}`,
        }));
        break;
      }
      case 'overview':
        data = await call(OverviewSchema, `${ws(rest[0])}/overview`);
        break;
      case 'compare':
        data = await call(
          ProblemComparisonSchema,
          `${ws(rest[0])}/problems/${encodeURIComponent(rest[1] ?? '')}/comparison`,
        );
        break;
      case 'seed-lineage':
        data = await seedLineage(call);
        break;
      case 'login': {
        const session = await call(SessionInfoSchema, 'auth/dev-login', {
          code: rest[0],
        });
        const cookie = (lastResponse as Response | null)?.headers
          .getSetCookie()
          .find((c) => c.startsWith('creator_session='));
        const value = cookie?.split(';')[0]?.slice('creator_session='.length);
        if (!value) throw new Error('The API did not start a session.');
        mkdirSync(dirname(sessionFile()), { recursive: true });
        writeFileSync(
          sessionFile(),
          JSON.stringify({
            origin: url.origin,
            token: value,
            csrf: session.csrf_token,
          }),
          { mode: 0o600 },
        );
        data = { signed_in: true, expires_at: session.expires_at };
        break;
      }
      case 'logout':
        data = await call(
          z.strictObject({ signed_out: z.literal(true) }),
          'auth/logout',
          {},
        );
        rmSync(sessionFile(), { force: true });
        break;
      case 'whoami':
        data = await call(SessionInfoSchema, 'auth/session');
        break;
      case 'runs':
        data = await call(z.array(RunControlSchema), `${ws(rest[0])}/runs`);
        break;
      case 'run-register':
        data = await call(RunControlSchema, `${ws(rest[0])}/runs`, {
          run: ref(rest[1]),
          autonomy_mode: rest[2],
          stage_gates: null,
          initial_grants: rest.slice(3).map(ref),
        });
        break;
      case 'run-cancel':
        data = await call(
          RunControlSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/cancel`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'admit':
        data = await call(
          AdmissionSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/actions`,
          json(rest[2], 'Action'),
        );
        break;
      case 'decisions':
        data = await call(
          z.array(DecisionSchema),
          `${ws(rest[0])}/decisions${rest[1] ? `?status=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'decision':
        data = await call(
          DecisionSchema,
          `${ws(rest[0])}/decisions/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'answer': {
        const [workspace, decision, coverage, choice, ...tail] = rest;
        const days = tail.indexOf('--standing-days');
        const standingDays = days >= 0 ? Number(tail.splice(days, 2)[1]) : null;
        const option =
          choice === 'choose_option' ? (tail.shift() ?? null) : null;
        data = await call(
          DecisionSchema,
          `${ws(workspace)}/decisions/${encodeURIComponent(decision ?? '')}/answer`,
          {
            choice,
            option_id: option,
            rationale: tail.join(' '),
            coverage_hash: coverage,
            standing_expires_at:
              standingDays === null
                ? null
                : new Date(
                    Date.now() + standingDays * 86_400_000,
                  ).toISOString(),
            time_spent_ms: null,
            interruption: null,
          },
        );
        break;
      }
      case 'grants':
        data = await call(z.array(GrantSchema), `${ws(rest[0])}/grants`);
        break;
      case 'grant-create':
        data = await call(
          GrantSchema,
          `${ws(rest[0])}/grants`,
          json(rest[1], 'Grant'),
        );
        break;
      case 'grant-revoke':
        data = await call(
          GrantSchema,
          `${ws(rest[0])}/grants/${encodeURIComponent(rest[1] ?? '')}/revoke`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'humility-gate':
        data = await call(
          HumilityVerdictSchema,
          `${ws(rest[0])}/entities/${encodeURIComponent(rest[1] ?? '')}/humility-gate`,
        );
        break;
      case 'broker-status':
        data = await call(BrokerStatusSchema, 'broker/status');
        break;
      case 'github-connect':
        data = await call(
          GitHubConnectionSchema,
          `${ws(rest[0])}/github-connections`,
          jsonArg(rest[1], 'Connection'),
        );
        break;
      case 'github-connections':
        data = await call(
          z.array(GitHubConnectionSchema),
          `${ws(rest[0])}/github-connections`,
        );
        break;
      case 'github-verify':
        data = await call(
          z.strictObject({
            connection: GitHubConnectionSchema,
            repositories: z.array(GitHubRepositorySchema),
          }),
          `${ws(rest[0])}/github-connections/${encodeURIComponent(rest[1] ?? '')}/verify`,
          {},
        );
        break;
      case 'github-revoke':
        data = await call(
          GitHubConnectionSchema,
          `${ws(rest[0])}/github-connections/${encodeURIComponent(rest[1] ?? '')}/revoke`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'github-deliveries':
        data = await call(
          z.array(GitHubDeliverySchema),
          `${ws(rest[0])}/github-connections/${encodeURIComponent(rest[1] ?? '')}/deliveries`,
        );
        break;
      case 'github-repos':
        data = await call(
          z.array(GitHubRepositorySchema),
          `${ws(rest[0])}/github-repositories`,
        );
        break;
      case 'github-op':
        data = await call(
          GitHubOperationSchema,
          `${ws(rest[0])}/github-operations`,
          jsonArg(rest[1], 'Operation'),
        );
        break;
      case 'github-ops':
        data = await call(
          z.array(GitHubOperationSchema),
          `${ws(rest[0])}/github-operations`,
        );
        break;
      case 'github-reconcile':
        data = await call(
          GitHubOperationSchema,
          `${ws(rest[0])}/github-operations/${encodeURIComponent(rest[1] ?? '')}/reconcile`,
          {},
        );
        break;
      case 'github-review':
        data = await call(
          GitHubReviewSchema,
          `${ws(rest[0])}/github-reviews`,
          jsonArg(rest[1], 'Review'),
        );
        break;
      case 'portfolio':
        data = await call(z.unknown(), `${ws(rest[0])}/portfolio`);
        break;
      case 'portfolio-command': {
        const operation = rest[1];
        if (
          ![
            'policy',
            'runs',
            'tick',
            'reconcile',
            'health',
            'scheduler-resume',
          ].includes(operation ?? '')
        )
          throw new Error('Unknown portfolio command.');
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/portfolio/${operation}`,
          jsonArg(rest[2], 'Portfolio command'),
        );
        break;
      }
      case 'portfolio-schedule':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/portfolio-schedules`,
          jsonArg(rest[1], 'Schedule'),
        );
        break;
      case 'portfolio-cancel':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/portfolio-schedules/${encodeURIComponent(rest[1] ?? '')}/cancel`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'knowledge-propose':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/reusable-knowledge`,
          jsonArg(rest[1], 'Knowledge'),
        );
        break;
      case 'knowledge-activate':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/reusable-knowledge/activate`,
          jsonArg(rest[1], 'Activation'),
        );
        break;
      case 'knowledge-command': {
        const action = rest[2];
        if (!['verify', 'review', 'revoke'].includes(action ?? ''))
          throw new Error('Unknown knowledge command.');
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/reusable-knowledge/${encodeURIComponent(rest[1] ?? '')}/${action}`,
          jsonArg(rest[3], 'Knowledge command'),
        );
        break;
      }
      case 'marketing-list':
        data = await call(z.unknown(), `${ws(rest[0])}/marketing-campaigns`);
        break;
      case 'marketing-get':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/marketing-campaigns/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'marketing-draft':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/marketing-campaigns`,
          jsonArg(rest[1], 'Campaign'),
        );
        break;
      case 'marketing-suppress':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/marketing-suppressions`,
          jsonArg(rest[1], 'Suppression'),
        );
        break;
      case 'marketing-action': {
        const action = rest[2];
        if (
          ![
            'grant',
            'cancel',
            'revoke',
            'deliver',
            'reconcile',
            'observe',
          ].includes(action ?? '')
        )
          throw new Error('Unknown marketing action.');
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/marketing-campaigns/${encodeURIComponent(rest[1] ?? '')}/${action}`,
          jsonArg(rest[3], 'Action'),
        );
        break;
      }
      // X07 payments, entitlements and reinvestment.
      case 'pay-connect':
        data = await call(
          PaymentConnectionSchema,
          `${ws(rest[0])}/payment-connections`,
          jsonArg(rest[1], 'Connection'),
        );
        break;
      case 'pay-connections':
        data = await call(
          z.array(PaymentConnectionSchema),
          `${ws(rest[0])}/payment-connections`,
        );
        break;
      case 'pay-verify':
        data = await call(
          PaymentConnectionSchema,
          `${ws(rest[0])}/payment-connections/${encodeURIComponent(rest[1] ?? '')}/verify`,
          {},
        );
        break;
      case 'pay-revoke':
        data = await call(
          PaymentConnectionSchema,
          `${ws(rest[0])}/payment-connections/${encodeURIComponent(rest[1] ?? '')}/revoke`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'pay-events':
        data = await call(
          z.array(z.unknown()),
          `${ws(rest[0])}/payment-connections/${encodeURIComponent(rest[1] ?? '')}/events`,
        );
        break;
      case 'offer-create':
        data = await call(
          OfferSchema,
          `${ws(rest[0])}/payment-offers`,
          jsonArg(rest[1], 'Offer'),
        );
        break;
      case 'offers':
        data = await call(
          z.array(OfferSchema),
          `${ws(rest[0])}/payment-offers`,
        );
        break;
      case 'offer-archive':
        data = await call(
          OfferSchema,
          `${ws(rest[0])}/payment-offers/${encodeURIComponent(rest[1] ?? '')}/archive`,
          {},
        );
        break;
      case 'checkout':
        data = await call(
          CheckoutSchema,
          `${ws(rest[0])}/payment-checkouts`,
          jsonArg(rest[1], 'Checkout'),
        );
        break;
      case 'pay-reconcile':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/payments/${encodeURIComponent(rest[1] ?? '')}/reconcile`,
          { payment_id: rest[2] ?? '' },
        );
        break;
      case 'payout-reconcile':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/payouts/${encodeURIComponent(rest[1] ?? '')}/reconcile`,
          { payout_id: rest[2] ?? '' },
        );
        break;
      case 'ledger':
        data = await call(z.array(LedgerEntrySchema), `${ws(rest[0])}/ledger`);
        break;
      case 'ledger-balances':
        data = await call(z.unknown(), `${ws(rest[0])}/ledger/balances`);
        break;
      case 'owner-funding':
        data = await call(z.unknown(), `${ws(rest[0])}/ledger/owner-funding`, {
          amount_nano_usd: rest[1] ?? '',
          evidence: rest.slice(2).join(' '),
        });
        break;
      case 'entitlements':
        data = await call(
          z.array(EntitlementSchema),
          `${ws(rest[0])}/entitlements`,
        );
        break;
      case 'entitlement-check':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/entitlements/check?${new URLSearchParams({ artifact_id: rest[1] ?? '', customer_ref: rest[2] ?? '' }).toString()}`,
        );
        break;
      case 'rails':
        data = await call(z.array(z.unknown()), `${ws(rest[0])}/funding-rails`);
        break;
      case 'rail-add':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/funding-rails`,
          jsonArg(rest[1], 'Rail'),
        );
        break;
      case 'rail-status':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/funding-rails/${encodeURIComponent(rest[1] ?? '')}/status`,
          {
            status: rest[2],
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'rail-attest':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/funding-rails/${encodeURIComponent(rest[1] ?? '')}/attest`,
          {
            available_nano_usd: rest[2] ?? '',
            evidence: rest.slice(3).join(' '),
          },
        );
        break;
      case 'rail-observe':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/funding-rails/${encodeURIComponent(rest[1] ?? '')}/observe`,
          {},
        );
        break;
      case 'commitments':
        data = await call(z.array(z.unknown()), `${ws(rest[0])}/commitments`);
        break;
      case 'commitment-add':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/commitments`,
          jsonArg(rest[1], 'Commitment'),
        );
        break;
      case 'commitment-close':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/commitments/${encodeURIComponent(rest[1] ?? '')}/close`,
          {},
        );
        break;
      case 'reinvest':
        data = await call(CapacitySchema, `${ws(rest[0])}/reinvestment`);
        break;
      case 'reinvest-policy':
        data = await call(
          ReinvestmentPolicySchema.nullable(),
          `${ws(rest[0])}/reinvestment/policy`,
          rest[1] ? jsonArg(rest[1], 'Policy') : undefined,
        );
        break;
      case 'reinvest-allocate':
        data = await call(
          AllocationSchema,
          `${ws(rest[0])}/reinvestment/allocations`,
          jsonArg(rest[1], 'Allocation'),
        );
        break;
      case 'reinvest-allocations':
        data = await call(
          z.array(z.unknown()),
          `${ws(rest[0])}/reinvestment/allocations`,
        );
        break;
      case 'reinvest-tranches':
        data = await call(
          z.array(z.unknown()),
          `${ws(rest[0])}/reinvestment/tranches`,
        );
        break;
      case 'reinvest-settle':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/reinvestment/settle-losses`,
          {},
        );
        break;
      case 'plan-connect':
        data = await call(
          PlanConnectionSchema,
          `${ws(rest[0])}/plan-connections`,
          {
            label: rest[1],
            settings: jsonArg(
              rest[2] ?? 'config/connections/chatgpt-plan.json',
              'Plan settings',
            ),
          },
        );
        break;
      case 'claude-connect':
        // ADR-0050: the owner's own signed-in Claude Code CLI; the plan-* commands then apply.
        data = await call(
          PlanConnectionSchema,
          `${ws(rest[0])}/plan-connections`,
          {
            kind: 'claude_code',
            label: rest[1],
            settings: jsonArg(
              rest[2] ?? 'config/connections/claude-code.json',
              'Claude Code settings',
            ),
          },
        );
        break;
      case 'claude-check':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/claude-code-check`,
          {},
          60000,
        );
        break;
      case 'claude-usage-off':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/credits`,
          {
            expected_version: version(rest[2]),
            statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
            checked_on: rest[3],
          },
        );
        break;
      case 'plan-connections':
        data = await call(
          z.array(PlanConnectionSchema),
          `${ws(rest[0])}/plan-connections`,
        );
        break;
      case 'plan-connection':
        data = await call(
          PlanConnectionDetailSchema.extend({ sign_in_attempt: z.unknown() }),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'plan-settings':
      case 'plan-accept-caps':
      case 'plan-credits-off':
      case 'plan-credits-withdraw':
      case 'plan-quota-recheck': {
        const expected_version = version(rest[2]);
        const [action, body]: [string, unknown] =
          command === 'plan-settings'
            ? [
                'settings',
                {
                  expected_version,
                  settings: jsonArg(rest[3], 'Plan settings'),
                },
              ]
            : command === 'plan-accept-caps'
              ? ['accept-caps', { expected_version, settings_hash: rest[3] }]
              : command === 'plan-credits-off'
                ? [
                    'credits',
                    {
                      expected_version,
                      statement: CREDITS_OFF_STATEMENT,
                      checked_on: rest[3],
                    },
                  ]
                : command === 'plan-credits-withdraw'
                  ? ['credits-withdraw', { expected_version, reason: rest[3] }]
                  : ['quota-recheck', { expected_version }];
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/${action}`,
          body,
        );
        break;
      }
      case 'plan-sign-in':
      case 'plan-sign-out':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/${command.slice(5)}`,
          command === 'plan-sign-in' ? { open_browser: true } : {},
          20000,
        );
        break;
      case 'plan-verify-approve':
        data = await call(
          PlanVerificationGrantSchema,
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/verification-grants`,
          {
            expected_version: version(rest[2]),
            model_id: rest[3],
            path: 'responses',
            expires_in_minutes: rest[4] ? Number(rest[4]) : 30,
          },
        );
        break;
      case 'plan-verify':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/verify`,
          { grant_id: rest[2], model_id: rest[3] },
          330000,
        );
        break;
      case 'plan-qualify': {
        const [n, d] = (rest[6] ?? '').split('/').map(Number);
        data = await call(
          PlanQualificationSchema,
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/qualifications`,
          {
            expected_version: version(rest[2]),
            model_id: rest[3],
            manifest: jsonArg(rest[4], 'Benchmark manifest'),
            min_held_out_cases: Number(rest[5]),
            floor: { numerator: n, denominator: d },
          },
        );
        break;
      }
      case 'plan-qualify-run':
      case 'plan-qualify-finish':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-qualifications/${encodeURIComponent(rest[1] ?? '')}/${command === 'plan-qualify-run' ? 'run' : 'finish'}`,
          {},
          command === 'plan-qualify-run' ? 3_600_000 : 5000,
        );
        break;
      case 'plan-requests':
        data = await call(
          z.array(PlanRequestSchema),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/requests`,
        );
        break;
      case 'plan-reconcile':
        data = await call(
          z.unknown(),
          `${ws(rest[0])}/plan-connections/${encodeURIComponent(rest[1] ?? '')}/reconcile`,
          {
            request_id: rest[2],
            expected_version: version(rest[3]),
            outcome: rest[4],
            note: rest[5],
          },
        );
        break;
      case 'route-registry-add':
        data = await call(
          ModelRegistrySchema,
          `${ws(rest[0])}/route-registries`,
          registryRequestFromConfig(jsonArg(rest[1], 'Registry config'), (f) =>
            json(readFileSync(f, 'utf8'), f),
          ),
        );
        break;
      case 'route-registries':
        data = await call(
          z.array(ModelRegistrySchema),
          `${ws(rest[0])}/route-registries`,
        );
        break;
      case 'route-policy-set':
        data = await call(RoutePolicySchema, `${ws(rest[0])}/route-policies`, {
          scope: rest[2]
            ? { kind: 'project', project_id: rest[2] }
            : { kind: 'workspace' },
          body: jsonArg(rest[1], 'Policy'),
        });
        break;
      case 'route-policies':
        data = await call(
          z.array(RoutePolicySchema),
          `${ws(rest[0])}/route-policies`,
        );
        break;
      case 'route-benchmark-add':
        data = await call(
          RouteBenchmarkSchema,
          `${ws(rest[0])}/route-benchmarks`,
          jsonArg(rest[1], 'Benchmark manifest'),
        );
        break;
      case 'route-promotion-create':
        data = await call(
          PromotionSchema,
          `${ws(rest[0])}/route-promotions`,
          jsonArg(rest[1], 'Promotion request'),
        );
        break;
      case 'route-promotions':
        data = await call(
          z.array(PromotionSchema),
          `${ws(rest[0])}/route-promotions`,
        );
        break;
      case 'route-promotion':
        data = await call(
          PromotionSchema,
          `${ws(rest[0])}/route-promotions/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'route-benchmark-run': {
        const timeout = Number(rest[4] ?? 60000);
        data = await call(
          PromotionSchema,
          `${ws(rest[0])}/route-promotions/${encodeURIComponent(rest[1] ?? '')}/benchmark`,
          { run_id: rest[2], envelope_id: rest[3], timeout_ms: timeout },
          // Every case for both arms, each bounded by the timeout.
          1_900_000,
        );
        break;
      }
      case 'route-advance':
      case 'route-rollback':
        data = await call(
          PromotionSchema,
          `${ws(rest[0])}/route-promotions/${encodeURIComponent(rest[1] ?? '')}/${command === 'route-advance' ? 'advance' : 'rollback'}`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'route-decide':
        data = await call(
          RouteDecisionSchema,
          `${ws(rest[0])}/route-decisions`,
          jsonArg(rest[1], 'Route request'),
        );
        break;
      case 'route-decisions':
        data = await call(
          z.array(RouteDecisionSchema),
          `${ws(rest[0])}/route-decisions${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'route-call':
        data = await call(
          BrokerCallResultSchema.extend({
            served: z.boolean(),
            model: ModelRefSchema,
          }),
          `${ws(rest[0])}/route-decisions/${encodeURIComponent(rest[1] ?? '')}/call${rest.includes('--shadow') ? '?variant=shadow' : ''}`,
          jsonArg(rest[2], 'Broker request'),
          1_900_000,
        );
        break;
      case 'route-outcome':
        data = await call(
          z.strictObject({
            outcome: RouteOutcomeSchema,
            promotion: PromotionSchema.nullable(),
          }),
          `${ws(rest[0])}/route-decisions/${encodeURIComponent(rest[1] ?? '')}/outcomes`,
          jsonArg(rest[2], 'Outcome'),
        );
        break;
      case 'route-escalate':
        data = await call(
          RouteDecisionSchema,
          `${ws(rest[0])}/route-decisions/${encodeURIComponent(rest[1] ?? '')}/escalate`,
          { logical_operation_id: rest[2] ?? randomUUID() },
        );
        break;
      case 'context-capabilities-add':
        data = await call(
          CapabilityRegistrySchema,
          `${ws(rest[0])}/context-capabilities`,
          capabilitiesRequestFromConfig(
            jsonArg(rest[1], 'Capability config'),
            (f) => json(readFileSync(f, 'utf8'), f),
          ),
        );
        break;
      case 'context-capabilities':
        data = await call(
          z.array(CapabilityRegistrySchema),
          `${ws(rest[0])}/context-capabilities`,
        );
        break;
      case 'context-index': {
        const [w, corpus, kind, dataClass, path] = rest;
        if (!w || !corpus || !kind || !dataClass || !path)
          throw new Error(USAGE);
        const items = readCorpus(path);
        const local = new Set(items.map((i) => i.key));
        const current = await call(
          z.array(IndexEntrySchema),
          `${ws(w)}/context-index?corpus=${encodeURIComponent(corpus)}`,
        );
        // Files gone from the folder are removed explicitly (the snapshot spans requests).
        const removed = current
          .filter((e) => e.status === 'current' && !local.has(e.key))
          .map((e) => e.key);
        const parts = batchesOf(items);
        if (!parts.length) parts.push([]);
        const totals = {
          corpus,
          added: 0,
          updated: 0,
          unchanged: 0,
          removed: 0,
          current: 0,
        };
        for (const [n, part] of parts.entries()) {
          const r = await call(
            IndexResultSchema,
            `${ws(w)}/context-index`,
            {
              corpus,
              kind,
              data_class: dataClass,
              items: part,
              complete: false,
              removed_keys: n === parts.length - 1 ? removed : [],
            },
            60000,
          );
          totals.added += r.added;
          totals.updated += r.updated;
          totals.unchanged += r.unchanged;
          totals.removed += r.removed;
          totals.current = r.current;
        }
        data = totals;
        break;
      }
      case 'context-index-records':
        data = await call(
          IndexResultSchema,
          `${ws(rest[0])}/context-index/records`,
          {
            corpus: rest[1],
            data_class: rest[2],
            kinds: (rest[3] ?? '').split(',').filter(Boolean),
          },
          60000,
        );
        break;
      case 'context-entries':
        data = await call(
          z.array(IndexEntrySchema),
          `${ws(rest[0])}/context-index${rest[1] ? `?corpus=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'context-pack':
        data = await call(
          ContextPackSchema,
          `${ws(rest[0])}/context-packs`,
          jsonArg(rest[1], 'Pack request'),
          30000,
        );
        break;
      case 'context-packs':
        data = await call(
          z.array(ContextPackSchema),
          `${ws(rest[0])}/context-packs${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'context-pack-show':
        data = await call(
          ContextPackSchema,
          `${ws(rest[0])}/context-packs/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'context-compact':
        data = await call(
          z.strictObject({
            compaction: CompactionSchema,
            pack: ContextPackSchema.nullable(),
            broker: BrokerCallResultSchema.optional(),
          }),
          `${ws(rest[0])}/context-packs/${encodeURIComponent(rest[1] ?? '')}/compact`,
          jsonArg(rest[2], 'Compact request'),
          700_000,
        );
        break;
      case 'context-compactions':
        data = await call(
          z.array(CompactionSchema),
          `${ws(rest[0])}/context-packs/${encodeURIComponent(rest[1] ?? '')}/compactions`,
        );
        break;
      case 'context-handoff':
        data = await call(
          HandoffSchema,
          `${ws(rest[0])}/context-handoffs`,
          jsonArg(rest[1], 'Handoff'),
        );
        break;
      case 'context-call':
        data = await call(
          ContextCallResultSchema,
          `${ws(rest[0])}/context-calls`,
          jsonArg(rest[1], 'Context call'),
          1_900_000,
        );
        break;
      case 'context-cache':
        data = await call(
          z.array(CacheEntrySchema),
          `${ws(rest[0])}/context-cache`,
        );
        break;
      case 'context-cache-invalidate':
        data = await call(
          CacheEntrySchema,
          `${ws(rest[0])}/context-cache/${encodeURIComponent(rest[1] ?? '')}/invalidate`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'context-batch':
        data = await call(
          BatchSchema,
          `${ws(rest[0])}/context-batches`,
          jsonArg(rest[1], 'Batch request'),
          180_000,
        );
        break;
      case 'context-batch-show':
      case 'context-batch-poll':
        data = await call(
          BatchSchema,
          `${ws(rest[0])}/context-batches/${encodeURIComponent(rest[1] ?? '')}${command === 'context-batch-poll' ? '/poll' : ''}`,
          command === 'context-batch-poll' ? {} : undefined,
          180_000,
        );
        break;
      case 'context-eval-create':
        data = await call(
          ContextEvaluationSchema,
          `${ws(rest[0])}/context-evaluations`,
          jsonArg(rest[1], 'Evaluation request'),
        );
        break;
      case 'context-eval-run':
      case 'context-eval':
        data = await call(
          ContextEvaluationSchema,
          `${ws(rest[0])}/context-evaluations/${encodeURIComponent(rest[1] ?? '')}${command === 'context-eval-run' ? '/run' : ''}`,
          command === 'context-eval-run' ? {} : undefined,
          // Every case for both packs, each bounded by its timeout.
          1_900_000,
        );
        break;
      case 'context-usage':
        data = await call(
          ContextUsageReportSchema,
          `${ws(rest[0])}/context-usage${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'pricing':
        data = await call(
          z.array(PricingSnapshotSchema),
          `${ws(rest[0])}/pricing`,
        );
        break;
      case 'pricing-add':
        data = await call(
          PricingSnapshotSchema,
          `${ws(rest[0])}/pricing`,
          json(readFileSync(rest[1] ?? '', 'utf8'), 'Pricing file'),
        );
        break;
      case 'budgets':
        data = await call(z.array(EnvelopeSchema), `${ws(rest[0])}/budgets`);
        break;
      case 'budget':
        data = await call(
          EnvelopeSchema,
          `${ws(rest[0])}/budgets/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'budget-create':
        data = await call(
          EnvelopeSchema,
          `${ws(rest[0])}/budgets`,
          json(rest[1], 'Envelope'),
        );
        break;
      case 'budget-close':
        data = await call(
          EnvelopeSchema,
          `${ws(rest[0])}/budgets/${encodeURIComponent(rest[1] ?? '')}/close`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'reservations':
        data = await call(
          z.array(ReservationSchema),
          `${ws(rest[0])}/reservations${rest[1] ? `?envelope=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'model-call': {
        const request = json(rest[2], 'Request') as { timeout_ms?: unknown };
        const wait =
          typeof request.timeout_ms === 'number' ? request.timeout_ms : 0;
        data = await call(
          BrokerCallResultSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/model-calls`,
          request,
          // Up to three attempts plus retry waits; the server bounds each attempt.
          Math.min(wait * 3 + 10_000, 1_900_000),
        );
        break;
      }
      case 'reconcile':
        data = await call(
          ReservationSchema,
          `${ws(rest[0])}/reservations/${encodeURIComponent(rest[1] ?? '')}/reconcile`,
          json(rest[2], 'Reconciliation'),
        );
        break;
      case 'workflow-start':
        data = await call(
          WorkflowDetailSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/workflows`,
          json(rest[2], 'Workflow request'),
        );
        break;
      case 'workflows':
        data = await call(
          z.array(WorkflowSchema),
          `${ws(rest[0])}/workflows${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'workflow': {
        const path = `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}`;
        let detail = await call(WorkflowDetailSchema, path);
        // --wait polls the durable state; it observes the worker, it does not drive it.
        const until = Date.now() + 120_000;
        while (
          rest.includes('--wait') &&
          !detail.workflow.finished_at &&
          !['waiting_human', 'paused_operator', 'reconciling'].includes(
            detail.workflow.state,
          ) &&
          Date.now() < until
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          detail = await call(WorkflowDetailSchema, path);
        }
        data = detail;
        break;
      }
      case 'workflow-pause':
      case 'workflow-resume':
      case 'workflow-cancel':
        data = await call(
          WorkflowDetailSchema,
          `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}/${command.slice(9)}`,
          {
            expected_version: version(rest[2]),
            reason: rest.slice(3).join(' '),
          },
        );
        break;
      case 'source-status':
        data = await call(SourceBrokerStatusSchema, 'sources/status');
        break;
      case 'source-fetch':
        data = await call(
          RetrievalSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/source-fetches`,
          {
            url: rest[2],
            task_id: null,
            logical_operation_id: randomUUID(),
            justification: rest.slice(3).join(' ') || 'Requested from the CLI.',
          },
          // The server bounds each fetch by its policy time limit (15 s live).
          30_000,
        );
        break;
      case 'sources':
        data = await call(
          z.array(SourceSummarySchema),
          `${ws(rest[0])}/sources`,
        );
        break;
      case 'source':
        data = await call(
          SourceDetailSchema,
          `${ws(rest[0])}/sources/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'retrievals':
        data = await call(
          z.array(RetrievalSchema),
          `${ws(rest[0])}/retrievals${rest[1] ? `?run=${encodeURIComponent(rest[1])}` : ''}`,
        );
        break;
      case 'claim-support':
        data = await call(
          ClaimSupportSchema,
          `${ws(rest[0])}/claims/${encodeURIComponent(rest[1] ?? '')}/support`,
          json(rest[2], 'Support'),
        );
        break;
      case 'claim-evidence':
        data = await call(
          ClaimEvidenceSchema,
          `${ws(rest[0])}/claims/${encodeURIComponent(rest[1] ?? '')}/evidence${rest[2] ? `?max_age_days=${encodeURIComponent(rest[2])}` : ''}`,
        );
        break;
      case 'support-retract':
        data = await call(
          ClaimSupportSchema,
          `${ws(rest[0])}/claim-support/${encodeURIComponent(rest[1] ?? '')}/retract`,
          { reason: rest.slice(2).join(' ') },
        );
        break;
      case 'seed-research':
        data = await seedResearch(call);
        break;
      case 'discovery-start':
        data = await call(
          WorkflowDetailSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/discoveries`,
          json(rest[2], 'Discovery request'),
        );
        break;
      case 'discovery': {
        const path = `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}`;
        let detail = await call(WorkflowDetailSchema, path);
        const until = Date.now() + 120_000;
        while (
          rest.includes('--wait') &&
          !detail.workflow.finished_at &&
          !['waiting_human', 'paused_operator', 'reconciling'].includes(
            detail.workflow.state,
          ) &&
          Date.now() < until
        ) {
          await new Promise((r) => setTimeout(r, 1000));
          detail = await call(WorkflowDetailSchema, path);
        }
        data = discoverySummary(detail);
        break;
      }
      case 'discovery-packet':
        data = await call(
          z.strictObject({
            packet: EvidencePacketSchema,
            packet_hash: z.string(),
          }),
          `${ws(rest[0])}/workflows/${encodeURIComponent(rest[1] ?? '')}/packet`,
        );
        break;
      case 'seed-discovery':
        data = await seedDiscovery(call);
        break;
      case 'scorecard':
        data = await call(
          StoredEntitySchema,
          `${ws(rest[0])}/scorecards`,
          json(rest[1], 'Scorecard'),
        );
        break;
      case 'report':
        data = reportSummary(
          await call(
            SelectionReportSchema,
            `${ws(rest[0])}/problems/${encodeURIComponent(rest[1] ?? '')}/report${rest[2] ? `?shortlist=${encodeURIComponent(rest[2])}` : ''}`,
          ),
        );
        break;
      case 'select':
        data = await call(
          SelectOutcomeSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/selections`,
          json(rest[2], 'Selection'),
        );
        break;
      case 'selections':
        data = await call(
          z.array(SelectionSchema),
          `${ws(rest[0])}/problems/${encodeURIComponent(rest[1] ?? '')}/selections`,
        );
        break;
      case 'spec-create':
        data = await call(
          SpecStatusSchema,
          `${ws(rest[0])}/specs`,
          json(rest[1], 'Spec'),
        );
        break;
      case 'spec':
        data = await call(
          SpecStatusSchema,
          `${ws(rest[0])}/specs/${encodeURIComponent(rest[1] ?? '')}`,
        );
        break;
      case 'spec-revise':
        data = await call(
          SpecStatusSchema,
          `${ws(rest[0])}/specs/${encodeURIComponent(rest[1] ?? '')}/revisions`,
          json(rest[2], 'Spec revision'),
        );
        break;
      case 'spec-freeze':
        data = await call(
          FreezeOutcomeSchema,
          `${ws(rest[0])}/runs/${encodeURIComponent(rest[1] ?? '')}/spec-freezes`,
          json(rest[2], 'Freeze request'),
        );
        break;
      case 'seed-selection':
        data = await seedSelection(call);
        break;
      default:
        throw new Error(USAGE);
    }
    write(JSON.stringify(data, null, 2));
    return 0;
  } catch (error) {
    write(
      JSON.stringify({
        error: error instanceof ContractError ? error.code : 'CLI_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return 1;
  }
}

type Call = <T>(
  schema: z.ZodType<T>,
  path: string,
  body?: unknown,
) => Promise<T>;
/**
 * Creates a labeled fixture workspace showing many-to-many provenance: two ideas feed one
 * product, one idea feeds two products, and a task produces an artifact. Synthetic records only.
 */
async function seedLineage(call: Call) {
  const ws = await call(WorkspaceSchema, 'workspaces', {
    name: 'Fixture lineage demonstration',
    record_mode: 'fixture',
  });
  const base = `workspaces/${ws.id}`;
  const zero = '0'.repeat(64);
  const make = (kind: string, title: string, body: unknown) =>
    call(StoredEntitySchema, `${base}/entities`, { kind, title, body });
  const link = (
    relation: string,
    from: { id: string; version: number },
    to: { id: string; version: number },
  ) =>
    call(StoredLinkSchema, `${base}/links`, {
      relation,
      from: { id: from.id, version: from.version },
      to: { id: to.id, version: to.version },
      rationale: 'Synthetic fixture lineage',
    });
  const uncertainty = 'Synthetic fixture; no research performed.';
  const source = await make('source', 'Fixture volunteer report', {
    url: 'https://example.org/fixture-report',
    retrieval_status: 'inaccessible',
    content_hash: null,
    retrieved_at: new Date().toISOString(),
    published_at: null,
    independent_origin: 'example.org (fixture)',
    observation: 'Fixture placeholder; not retrieved.',
    uncertainty,
  });
  const claim = await make('claim', 'Volunteers miss shifts', {
    statement: 'Volunteers miss shifts when schedules change.',
    basis: 'inference',
    uncertainty,
  });
  const problem = await make('problem', 'Shift coverage gaps', {
    statement: 'Shifts go uncovered after schedule changes.',
    affected_group: 'Food bank volunteers (fixture)',
    uncertainty,
  });
  const ideaA = await make('idea', 'Shared roster', {
    summary: 'One shared roster.',
    uncertainty,
  });
  const ideaB = await make('idea', 'Reminder messages', {
    summary: 'Reminders before shifts.',
    uncertainty,
  });
  const combined = await make('product', 'Roster with reminders', {
    stage: 'captured',
    summary: 'Combines both ideas.',
  });
  const paper = await make('product', 'Printable roster kit', {
    stage: 'captured',
    summary: 'Non-software descendant of the roster idea.',
  });
  const run = await make('run', 'Fixture packaging run', {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  });
  const task = await make('task', 'Package roster kit', {
    state: 'queued',
    role: 'fixture-builder',
    goal: 'Package the printable roster.',
  });
  const artifact = await make('artifact', 'Roster kit bundle', {
    storage_uri: 'fixture://artifacts/roster-kit.zip',
    sha256: zero,
    bytes: 0,
    media_type: 'application/zip',
  });
  await link('supports', source, claim);
  await link('supports', claim, problem);
  await link('derived_from', ideaA, problem);
  await link('derived_from', ideaB, problem);
  await link('derived_from', combined, ideaA);
  await link('derived_from', combined, ideaB);
  await link('derived_from', paper, ideaA);
  await link('part_of', task, run);
  await link('derived_from', artifact, task);
  return {
    workspace: ws,
    product_from_two_ideas: combined.id,
    idea_with_two_descendants: ideaA.id,
    artifact: artifact.id,
  };
}

const FIXTURE = {
  report: 'https://health.fixture.test/reports/clinic-access-2025',
  wire: 'https://wire.fixture.test/stories/clinic-waits',
  repost: 'https://news.fixture.test/2026/03/clinic-waits',
  copy: 'https://blog.fixture.test/posts/clinic-waits-copy',
  survey: 'https://journal.fixture.test/articles/wait-time-survey',
  paywalled: 'https://journal.fixture.test/articles/paywalled-study',
  staffing: 'https://health.fixture.test/reports/staffing-brief',
  metadataRedirect: 'https://health.fixture.test/go/latest-report',
  forum: 'https://forum.fixture.test/threads/clinic-tips',
};
/**
 * Builds a labeled fixture workspace that walks through T06: fetches from the synthetic corpus
 * (reposts, a conflicting survey, a correction, a paywall, a removal, an inward redirect and a
 * page with injected instructions), two claims with passage-level evidence, and their status.
 */
async function seedResearch(call: Call) {
  const ws = await call(WorkspaceSchema, 'workspaces', {
    name: 'Fixture research demonstration',
    record_mode: 'fixture',
  });
  const base = `workspaces/${ws.id}`;
  const run = await call(StoredEntitySchema, `${base}/entities`, {
    kind: 'run',
    title: 'Fixture research run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  await call(RunControlSchema, `${base}/runs`, {
    run: { id: run.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  await call(GrantSchema, `${base}/grants`, {
    run_id: run.id,
    action_types: ['source.fetch'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['public'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Fetch the fixture corpus for this demonstration run.',
  });
  const fetch = (url: string) =>
    call(RetrievalSchema, `${base}/runs/${run.id}/source-fetches`, {
      url,
      task_id: null,
      logical_operation_id: randomUUID(),
      justification: 'Fixture research demonstration.',
    });
  const retrievals: Record<string, string> = {};
  const got: Record<string, z.infer<typeof RetrievalSchema>> = {};
  for (const [name, url] of Object.entries(FIXTURE)) {
    got[name] = await fetch(url);
    retrievals[name] = `${got[name].state} (${got[name].reason_code})`;
  }
  const passage = async (sourceId: string | null, needle: string) => {
    const detail = await call(
      SourceDetailSchema,
      `${base}/sources/${sourceId}`,
    );
    const p = detail.passages.find((x) => x.excerpt?.includes(needle));
    if (!p) throw new Error(`Fixture passage "${needle}" not found.`);
    return p.id;
  };
  const claim = (statement: string) =>
    call(StoredEntitySchema, `${base}/entities`, {
      kind: 'claim',
      title: statement.slice(0, 120),
      body: {
        statement,
        basis: 'observation',
        uncertainty: 'Synthetic fixture claim.',
      },
    });
  const support = (claimId: string, body: Record<string, unknown>) =>
    call(ClaimSupportSchema, `${base}/claims/${claimId}/support`, {
      claim_version: 1,
      rationale: 'Assessed against the passage text (fixture).',
      ...body,
    });
  const waits = await claim(
    'Rural first-appointment waits rose between 2022 and 2025.',
  );
  for (const name of ['wire', 'repost', 'copy'])
    await support(waits.id, {
      evidence: 'passage',
      passage_id: await passage(got[name]!.source_id, '41 days'),
      stance: 'supports',
      support_type: 'source_assertion',
      quote: 'was 41 days in 2025, up from 29 days in 2022',
    });
  await support(waits.id, {
    evidence: 'passage',
    passage_id: await passage(got.report!.source_id, '41 days'),
    stance: 'supports',
    support_type: 'observation',
    quote: 'was 41 days, up from 29 days in 2022',
  });
  await support(waits.id, {
    evidence: 'passage',
    passage_id: await passage(got.survey!.source_id, 'fell slightly'),
    stance: 'contradicts',
    support_type: 'observation',
    quote: 'fell slightly, from a mean of 35 days in 2022 to 33 days in 2025',
  });
  const triage = await claim(
    'A randomized study found shorter waits after triage changes.',
  );
  await support(triage.id, {
    evidence: 'inaccessible_source',
    source_id: got.paywalled!.source_id,
    source_version: got.paywalled!.source_version,
  });
  const vacancies = await claim(
    'Rural clinics had many vacant nursing posts in 2025.',
  );
  await support(vacancies.id, {
    evidence: 'passage',
    passage_id: await passage(got.staffing!.source_id, '18 percent'),
    stance: 'supports',
    support_type: 'observation',
    quote: '18 percent of nursing posts vacant in 2025',
  });
  // Second fetches: the report is corrected (new version) and the brief is removed.
  const corrected = await fetch(FIXTURE.report);
  const removed = await fetch(FIXTURE.staffing);
  const evidence = async (id: string) => {
    const e = await call(ClaimEvidenceSchema, `${base}/claims/${id}/evidence`);
    return { status: e.status, labels: e.labels };
  };
  return {
    workspace: ws,
    run: run.id,
    retrievals,
    refetch: {
      report: `${corrected.reason_code} → source v${corrected.source_version}`,
      staffing: `${removed.state} → source v${removed.source_version}`,
    },
    claims: {
      [waits.id]: await evidence(waits.id),
      [triage.id]: await evidence(triage.id),
      [vacancies.id]: await evidence(vacancies.id),
    },
  };
}

/** The parts of a discovery run a person reads first; the full detail stays in `workflow`. */
function discoverySummary(detail: WorkflowDetail) {
  const r = detail.workflow.result;
  const d = r?.discovery;
  return {
    workflow: detail.workflow.id,
    state: detail.workflow.state,
    reason: detail.workflow.reason,
    fixture: detail.workflow.fixture,
    outcome: r?.outcome ?? null,
    explanation: r?.explanation ?? null,
    discovery: d
      ? {
          outcome: d.outcome,
          sufficiency: d.sufficiency.verdict,
          gaps: d.sufficiency.reasons,
          cross_field: d.locator?.mechanism_support ?? null,
          independence: d.independence.verified,
          proposals: d.proposals.map((p) => ({
            proposal: `${p.proposal} ${p.perspective}`,
            disposition: p.disposition,
            title: p.title,
            recommendation: p.recommendation,
            skeptic: p.verdict,
            revisions: p.revisions,
            reasons: p.reasons,
            dissent: p.dissent,
          })),
          excluded: d.excluded,
          catalog_records: d.catalog_records,
        }
      : null,
    usage: detail.usage,
  };
}

/**
 * Builds a labeled fixture workspace that runs the three T07 scenarios through the API: a
 * software-suitable case with cross-field reasoning and a known duplicate, an existing-tool
 * case, and insufficient evidence. Requires the API worker (on by default).
 */
async function seedDiscovery(
  call: Call,
  name = 'Fixture discovery demonstration',
) {
  const ws = await call(WorkspaceSchema, 'workspaces', {
    name,
    record_mode: 'fixture',
  });
  const base = `workspaces/${ws.id}`;
  const pricing = await call(
    PricingSnapshotSchema,
    `${base}/pricing`,
    JSON.parse(
      readFileSync(
        new URL(
          '../../../config/pricing/fixture-model-v1.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown,
  );
  const envelope = await call(EnvelopeSchema, `${base}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Fixture discovery budget',
    cap_nano_usd: '100000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 8,
  });
  const expires = new Date(Date.now() + 86_400_000).toISOString();
  const started: { scenario: string; workflow: string; run: string }[] = [];
  for (const s of DISCOVERY_SCENARIOS) {
    const run = await call(StoredEntitySchema, `${base}/entities`, {
      kind: 'run',
      title: `Fixture discovery: ${s.title}`,
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    await call(RunControlSchema, `${base}/runs`, {
      run: { id: run.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
    for (const [action_types, data_classes, max] of [
      [['source.fetch'], ['public'], null],
      [['model.generate', 'model.summarize'], ['synthetic'], '2000000000'],
    ] as const)
      await call(GrantSchema, `${base}/grants`, {
        run_id: run.id,
        action_types,
        target_kind: null,
        max_amount_nano_usd: max,
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes,
        expires_at: expires,
        rationale: 'Fixture discovery demonstration run.',
      });
    const sourceOf: Record<string, { id: string; version: number }> = {};
    for (const url of s.fetch) {
      const r = await call(
        RetrievalSchema,
        `${base}/runs/${run.id}/source-fetches`,
        {
          url,
          task_id: null,
          logical_operation_id: randomUUID(),
          justification: `Evidence for ${s.title} (fixture).`,
        },
      );
      if (!r.source_id || !r.source_version)
        throw new Error(
          `Fixture fetch of ${url} recorded no source (${r.state}).`,
        );
      sourceOf[url] = { id: r.source_id, version: r.source_version };
    }
    const evidence = [];
    for (const c of s.claims) {
      const claim = await call(StoredEntitySchema, `${base}/entities`, {
        kind: 'claim',
        title: c.statement.slice(0, 120),
        body: {
          statement: c.statement,
          basis: 'observation',
          uncertainty: 'Synthetic fixture claim.',
        },
      });
      for (const e of c.support) {
        const src = sourceOf[e.url]!;
        if (e.evidence === 'inaccessible_source') {
          await call(ClaimSupportSchema, `${base}/claims/${claim.id}/support`, {
            evidence: 'inaccessible_source',
            claim_version: 1,
            source_id: src.id,
            source_version: src.version,
            rationale: 'The page could not be read (fixture).',
          });
          continue;
        }
        const detail = await call(
          SourceDetailSchema,
          `${base}/sources/${src.id}`,
        );
        const passage = detail.passages.find((x) =>
          x.excerpt?.includes(e.needle),
        );
        if (!passage)
          throw new Error(`Fixture passage "${e.needle}" not found.`);
        await call(ClaimSupportSchema, `${base}/claims/${claim.id}/support`, {
          evidence: 'passage',
          claim_version: 1,
          passage_id: passage.id,
          stance: e.stance,
          support_type: e.support_type,
          quote: e.quote,
          rationale: 'Assessed against the passage text (fixture).',
        });
      }
      evidence.push({ claim_id: claim.id, bears_on: c.bears_on });
    }
    for (const k of s.catalog)
      await call(StoredEntitySchema, `${base}/entities`, {
        kind: k.kind,
        title: k.title,
        body: { summary: k.summary, uncertainty: 'Synthetic catalog entry.' },
      });
    const brief = await call(StoredEntitySchema, `${base}/entities`, {
      kind: 'search_brief',
      title: s.title,
      body: s.brief,
    });
    const detail = await call(
      WorkflowDetailSchema,
      `${base}/runs/${run.id}/discoveries`,
      {
        brief: { id: brief.id, version: 1 },
        evidence,
        perspectives: s.perspectives,
        excluded: s.excluded,
        max_revisions: 1,
        max_age_days: 180,
        envelope_id: envelope.id,
        pricing_snapshot_id: pricing.id,
        data_class: 'synthetic',
        limits: {
          max_children: 5,
          max_concurrency: 2,
          max_depth: 1,
          max_attempts: 1,
          max_repairs: 1,
          max_calls: 24,
          max_output_tokens: 4000,
          call_timeout_ms: 10_000,
          max_wall_seconds: 900,
        },
      },
    );
    started.push({
      scenario: s.key,
      workflow: detail.workflow.id,
      run: run.id,
    });
  }
  // The API's worker runs them; this only waits to report what happened.
  const results = [];
  for (const { scenario, workflow, run } of started) {
    const path = `${base}/workflows/${workflow}`;
    let detail = await call(WorkflowDetailSchema, path);
    const until = Date.now() + 90_000;
    while (!detail.workflow.finished_at && Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      detail = await call(WorkflowDetailSchema, path);
    }
    results.push({ scenario, run, ...discoverySummary(detail) });
  }
  return { workspace: ws, results };
}

function reportSummary(r: SelectionReport) {
  const rows = (k: 'opportunity' | 'suitability') =>
    r[k].candidates.map((c) => ({
      alternative: c.alternative.id,
      kind: c.alternative.kind,
      title: c.alternative.title,
      status: c.status,
      rank: c.rank,
      score: c.score?.display ?? null,
      range: c.range
        ? `${c.range.lower.display}–${c.range.upper.display}`
        : null,
      unknown: c.unknown_criteria,
      disagreements: c.disagreements.map((d) => d.criterion),
      gates: c.gates,
    }));
  return {
    problem: r.problem,
    report_hash: r.report_hash,
    opportunity: rows('opportunity'),
    opportunity_excluded: r.opportunity.excluded,
    suitability: rows('suitability'),
    sensitivity: {
      opportunity_stable: r.opportunity.sensitivity.stable,
      suitability_stable: r.suitability.sensitivity.stable,
      suitability_changes: r.suitability.sensitivity.scenarios
        .filter((s) => s.shortlist_changed)
        .map((s) => s.name),
    },
  };
}
const specSummary = (s: SpecStatus) => ({
  spec: s.spec,
  frozen_current: s.frozen_current,
  frozen_version: s.latest_freeze?.spec.version ?? null,
  tasks: s.tasks.map((t) => `${t.key} ${t.status}`),
  removed_tasks: s.removed_tasks,
  problems: s.problems,
  blockers: s.blockers,
});

/**
 * Runs the T07 seed, then scores the clinic case with labeled fixture reviewers, records a
 * humility review, selects (with an override and its reason), writes and freezes a spec, and
 * revises one task to show which tasks the change invalidates. Every authorization the run
 * asks for is answered here as the signed-in owner, approve-once, for the exact version shown.
 */
async function seedSelection(call: Call) {
  // Full audit N-2: its own name, so the two seeds differ in the workspace picker.
  const seeded = await seedDiscovery(
    call,
    'Fixture selection and spec demonstration',
  );
  const clinic = seeded.results.find((r) => r.scenario === 'software');
  const problemId = clinic?.discovery?.catalog_records.problem?.id;
  if (!clinic || !problemId)
    throw new Error('The software discovery scenario wrote no problem record.');
  const base = `workspaces/${seeded.workspace.id}`;
  const runId = clinic.run;
  const packet = await call(
    z.strictObject({ packet: EvidencePacketSchema, packet_hash: z.string() }),
    `${base}/workflows/${clinic.workflow}/packet`,
  );
  const evidence = packet.packet.claims
    .filter((c) => c.status === 'supported')
    .map((c) => ({ id: c.claim_id, version: c.version }));
  const report = () =>
    call(SelectionReportSchema, `${base}/problems/${problemId}/report`);
  const before = await report();
  const alts = before.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await call(StoredEntitySchema, `${base}/scorecards`, card);
  const build = alts.find((a) => a.kind === 'build');
  if (!build) throw new Error('No software alternative to select.');
  await call(StoredEntitySchema, `${base}/entities`, {
    kind: 'humility_review',
    title: `Humility review: ${build.title}`.slice(0, 300),
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      evidence,
    ),
  });
  const scored = await report();
  const approveOnce = async (decisionId: string | null) => {
    if (!decisionId) throw new Error('Expected a decision request.');
    const d = await call(DecisionSchema, `${base}/decisions/${decisionId}`);
    await call(DecisionSchema, `${base}/decisions/${decisionId}/answer`, {
      choice: 'approve_once',
      option_id: null,
      rationale:
        'Fixture seed: approved as the signed-in owner for this exact version.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    });
  };
  const selectRequest = {
    problem: { id: scored.problem.id, version: scored.problem.version },
    report_hash: scored.report_hash,
    dispositions: fixtureDispositions(scored),
    override_reason:
      'The human-led option is deferred only because no coordinator is funded this quarter (fixture).',
    rationale:
      'Recommend turning on reminders now and prototype risk flags against a manual baseline (fixture).',
    shortlist_size: 3,
    data_class: 'synthetic',
  };
  const asked = await call(
    SelectOutcomeSchema,
    `${base}/runs/${runId}/selections`,
    selectRequest,
  );
  await approveOnce(asked.admission.decision_id);
  const selected = await call(
    SelectOutcomeSchema,
    `${base}/runs/${runId}/selections`,
    selectRequest,
  );
  if (!selected.selection)
    throw new Error(
      `Selection not recorded: ${selected.admission.explanation}`,
    );
  const created = await call(SpecStatusSchema, `${base}/specs`, {
    selection_id: selected.selection.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show risk flags prototype (fixture)',
    content: FIXTURE_SPEC,
  });
  const freezeRequest = {
    spec: { id: created.spec.id, version: created.spec.version },
    justification: 'Freeze the prototype spec for a bounded build (fixture).',
    data_class: 'synthetic',
  };
  const freezeAsked = await call(
    FreezeOutcomeSchema,
    `${base}/runs/${runId}/spec-freezes`,
    freezeRequest,
  );
  await approveOnce(freezeAsked.admission.decision_id);
  const frozen = await call(
    FreezeOutcomeSchema,
    `${base}/runs/${runId}/spec-freezes`,
    freezeRequest,
  );
  const afterFreeze = await call(
    SpecStatusSchema,
    `${base}/specs/${created.spec.id}`,
  );
  const revised = await call(
    SpecStatusSchema,
    `${base}/specs/${created.spec.id}/revisions`,
    {
      expected_version: created.spec.version,
      title: created.spec.title,
      content: fixtureSpecRevision(FIXTURE_SPEC),
      reason: 'A printable list was requested (fixture).',
    },
  );
  return {
    workspace: seeded.workspace,
    run: runId,
    problem: problemId,
    report: reportSummary(scored),
    selection: {
      status: selected.status,
      id: selected.selection.id,
      first_attempt: asked.status,
      dispositions: selected.selection.dispositions.map((d) => ({
        alternative: d.alternative.id,
        disposition: d.disposition,
        reasons: d.reasons,
        reverse_if: d.reverse_if,
      })),
      overrides: selected.selection.overrides,
      override_reason: selected.selection.override_reason,
    },
    spec: {
      id: created.spec.id,
      first_attempt: freezeAsked.status,
      freeze: frozen.status,
      after_freeze: specSummary(afterFreeze),
      after_revision: specSummary(revised),
    },
  };
}
