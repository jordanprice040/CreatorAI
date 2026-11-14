import { plainReason } from './plain-words.js';
import { SpecForm, type SpecFormMode } from './spec-form.js';
import { useViewMode } from './view-mode.js';
import { usePoll } from './page-active.js';
import { HumilityForm } from './humility.js';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArtifactSummarySchema,
  buildDeadlineMs,
  EnvelopeSchema,
  PlanConnectionSchema,
  PlanModelAccessSchema,
  PlanQualificationSchema,
  isQualified,
  PricingSnapshotSchema,
  RunControlSchema,
  SelectionSchema,
  SpecBodySchema,
  SpecStatusSchema,
  StoredEntitySchema,
  buildBlockers,
  connectionDataBlocker,
  contractDataClass,
  z,
  type SessionInfo,
  type SpecBody,
  type SpecStatus,
  type StoredEntity,
  type Workspace,
  PINNED_BROWSER,
  browserRecheckDue,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import {
  Empty,
  Status,
  clip,
  runNames,
  shortId,
  useLoad,
  type View,
} from './ui.js';
import { Blocked, type BlockedReason } from './blocked.js';
import { FixOutcome, canQualifyFor, type FixContext } from './fix-buttons.js';
import { missingTaskFixes } from './fix-here.js';
import { Routine, WhatWillHappen } from './routine.js';
import { unwrittenOptions } from './spec-fields.js';
import { newestFirst, productVersions } from './versions.js';
import { recordLabel, runLabel } from './labels.js';
import { RunbookExport } from './runbook.js';
import {
  BUILD_ROLE_CLASSES,
  builderAfterChoiceChange,
  planBuilderDefault,
  taskWords,
  type Choice,
} from './model-choice.js';
import { useModelChoice } from './model-switch.js';
import {
  artifactForBuild,
  builderSummary,
  buildRunDefault,
  envelopeFor,
  needsRecover,
} from './build-defaults.js';

// What GET /products returns (apps/api/src/products.ts, ADR-0046).
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const JobSchema = z.object({
  state: z.enum(['running', 'failed', 'done']),
  error: z.string().optional(),
  artifact_id: z.string().optional(),
});
const BuildSchema = z.object({
  id: z.string(),
  task_id: z.string(),
  started_at: z.string(),
  state: z.enum([
    'running',
    'failed',
    'interrupted',
    'verified_candidate',
    'checkpoint',
  ]),
  reason: z.string().nullable(),
  commit: sha.nullable(),
  fixture: z.boolean().nullable(),
  finished_at: z.string().nullable(),
  package: JobSchema.nullable(),
});
const ProductEntrySchema = z.object({
  product: z.object({
    id: z.string(),
    initial_commit: sha,
    /** ADR-0078: absent means python-build/1. */
    recipe: z.literal('static-web/1').optional(),
    binding: z.object({
      spec_id: z.string(),
      spec_version: z.number(),
      tasks: z.array(z.object({ key: z.string() })),
    }),
  }),
  tasks: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      base_commit: sha,
      // The task's current candidate; a build continues from it (F12, ADR-0054).
      head: sha.nullable().optional(),
    }),
  ),
  builds: z.array(BuildSchema),
});
type ProductEntry = z.infer<typeof ProductEntrySchema>;
type Build = z.infer<typeof BuildSchema>;
const Started = z.object({ build_id: z.string(), state: z.literal('running') });

const STATE_LABEL: Record<Build['state'], string> = {
  running: 'running',
  failed: 'failed',
  interrupted: 'interrupted (not resent)',
  verified_candidate: 'verified',
  checkpoint: 'stopped at a checkpoint',
};

/**
 * Builds and packages from frozen specs, run by the studio itself (ADR-0046). Every gate is on
 * the server: owner, frozen spec, admission with a grant and humility review, budgets. Generated
 * code runs only in the execution worker; this page starts work and shows what happened.
 */
export function BuildView({
  workspace,
  session,
  open,
}: {
  workspace: Workspace;
  session: SessionInfo;
  open: (view: View, id?: string) => void;
}) {
  const { standard } = useViewMode();
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  const owner = workspace.role === 'owner';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // The product the last failed action was about, so a lock notice shows only there.
  const [failed, setFailed] = useState('');
  const data = useLoad(async () => {
    const [specs, products, reviews, runs, budgets, pricing, artifacts, names] =
      await Promise.all([
        api(z.array(StoredEntitySchema), `${base}/entities?kind=specification`),
        api(z.array(ProductEntrySchema), `${base}/products`),
        api(
          z.array(StoredEntitySchema),
          `${base}/entities?kind=humility_review`,
        ),
        api(z.array(RunControlSchema), `${base}/runs`),
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
        // The record of what is packaged: the products route forgets package jobs on restart.
        api(z.array(ArtifactSummarySchema), `${base}/artifacts`),
        runNames(base),
      ]);
    // The spec changed most recently first: that is the one being worked on.
    const recent = [...specs].sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
    const status = await Promise.all(
      recent.map((s) => api(SpecStatusSchema, `${base}/specs/${s.id}`)),
    );
    // Current selections that chose an option to build: a spec can be written from one.
    const [problems, alternatives] = await Promise.all([
      api(z.array(StoredEntitySchema), `${base}/entities?kind=problem`),
      api(z.array(StoredEntitySchema), `${base}/entities?kind=alternative`),
    ]);
    const lists = await Promise.all(
      problems.map((p) =>
        api(z.array(SelectionSchema), `${base}/problems/${p.id}/selections`),
      ),
    );
    const selections = lists.flatMap((list, i) =>
      list
        .filter((x) => x.current)
        .flatMap((x) =>
          x.dispositions
            .filter((d) => d.disposition === 'select_for_build')
            .map((d) => ({
              selection_id: x.id,
              alternative: d.alternative,
              problem: problems[i]!,
              option: alternatives.find(
                (a) => a.id === d.alternative.id.toLowerCase(),
              ),
            })),
        ),
    );
    // Codex builders: plan connections with a verified Codex model (real workspaces only).
    const connections = fixture
      ? []
      : await api(z.array(PlanConnectionSchema), `${base}/plan-connections`);
    const access = await Promise.all(
      connections.map((c) =>
        api(
          z.object({
            model_access: z.array(PlanModelAccessSchema),
            qualifications: z.array(PlanQualificationSchema),
          }),
          `${base}/plan-connections/${c.id}`,
        ),
      ),
    );
    // Plan roles (ADR-0048): a verified Responses model serves builder and reviewer requests.
    // Listed first: the $0 plan route is the default builder when there is one.
    const builders = connections.flatMap((c, i) =>
      access[i]!.model_access.filter(
        (m) =>
          (m.path === 'codex' || m.path === 'responses') &&
          m.access === 'verified',
      ).map((m) => ({
        key: `${m.path}:${c.id}:${m.model_id}`,
        kind: m.path === 'codex' ? ('codex' as const) : ('roles' as const),
        connection_id: c.id,
        model_id: m.model_id,
        label: `${c.label} · ${m.model_id}`,
        connection_label: c.label,
        plan: c.kind,
        data_classes: c.settings.allowed_data_classes,
        /** ADR-0087: so a role task the connection does not allow gets "allow", not "qualify". */
        allowed_tasks: c.settings.allowed_task_classes as readonly string[],
        build_timeout_ms: c.settings.caps.codex.build_timeout_ms,
        // ADR-0081: whether the plan roles can run on this model (both roles qualified).
        unqualified:
          m.path === 'responses'
            ? BUILD_ROLE_CLASSES.filter(
                (tc) => !isQualified(access[i]!.qualifications, m.model_id, tc),
              )
            : [],
      })),
    );
    return {
      specs: status,
      specEntities: specs,
      /** ADR-0077: hybrid options, so a spec written from one is reviewed as a hybrid. */
      hybridOptions: new Set(
        alternatives
          .filter((a) => a.body?.kind === 'hybrid')
          .map((a) => a.id.toLowerCase()),
      ),
      selections,
      // Every current selection, whatever it chose: a spec from any other can't be frozen.
      currentSelections: new Set(
        lists.flatMap((l) =>
          l.filter((x) => x.current).map((x) => x.id.toLowerCase()),
        ),
      ),
      products,
      reviews: newestFirst(reviews),
      // Newest first everywhere, so each choice opens on the latest one.
      runs: newestFirst(runs.filter((r) => r.state === 'active')),
      names,
      budgets: newestFirst(budgets.filter((b) => b.status === 'active')),
      pricing: newestFirst(pricing),
      builders: [
        ...builders.filter((b) => b.kind === 'roles'),
        ...builders.filter((b) => b.kind !== 'roles'),
      ],
      artifacts,
    };
  }, [workspace.id]);
  // ADR-0081: the current model from the top bar; Build starts from it (StartBuild).
  const choice = useModelChoice(workspace);
  const d = data.data ? { ...data.data, choice } : null;
  const writer = workspace.role !== 'viewer';
  const [specForm, setSpecForm] = useState<SpecFormMode | null>(null);
  /** The stored current version of a spec/1 spec: what a revision starts from. */
  const entityOf = (s: SpecStatus) =>
    d?.specEntities.find(
      (e) =>
        e.id === s.spec.id &&
        e.version === s.spec.version &&
        e.body?.format === 'spec/1',
    );
  const [humilityFor, setHumilityFor] = useState<SpecStatus | null>(null);
  const reviewOf = (id: string, version?: number) =>
    d?.reviews.find((r) => {
      const sub = r.body?.subject as
        { id: string; version: number } | undefined;
      return (
        r.status === 'active' &&
        sub?.id.toLowerCase() === id.toLowerCase() &&
        (version === undefined || sub.version === version)
      );
    });
  /** The review to start from: this spec's newest (any version), else its option's. */
  const startFrom = (s: SpecStatus) => {
    const alt = entityOf(s)?.body?.alternative as { id: string } | undefined;
    return reviewOf(s.spec.id) ?? (alt ? reviewOf(alt.id) : undefined);
  };
  // Options chosen for build that have no spec of that exact version yet.
  const unwritten = d ? unwrittenOptions(d.selections, d.specEntities) : [];
  /** A spec written from a selection that has since been recorded again or replaced. */
  const stale = (s: SpecStatus) => {
    const sel = entityOf(s)?.body?.selection_id;
    return (
      typeof sel === 'string' && !d?.currentSelections.has(sel.toLowerCase())
    );
  };
  // useLoad reads again, quietly, each time this page is shown (coming back from Decisions
  // or anywhere), so the current state shows without a manual refresh; typed fields are kept.
  // While a build or package runs on the server, keep the page current.
  const running = d?.products.some((p) =>
    p.builds.some(
      (b) => b.state === 'running' || b.package?.state === 'running',
    ),
  );
  usePoll(data.refresh, 2000, running ?? false);

  async function act(
    what: () => Promise<unknown>,
    done?: string | ((result: unknown) => string),
    product?: string,
  ) {
    setBusy(true);
    setError('');
    setNote('');
    setFailed('');
    try {
      const result = await what();
      if (done) setNote(typeof done === 'string' ? done : done(result));
    } catch (e) {
      setError(message(e));
      setFailed(product ?? '');
    } finally {
      setBusy(false);
      data.reload();
    }
  }
  const post = (path: string, body: unknown) =>
    api(z.unknown(), `${base}/${path}`, {
      csrf: session.csrf_token,
      body,
      timeoutMs: 60_000,
    });

  return (
    <section className="panel" aria-labelledby="build-title">
      <h2 id="build-title">Build and package</h2>
      <p className="small">
        A product is built from a frozen spec, one task at a time. The studio
        writes the patch through the builder, runs the acceptance cases in the
        isolated worker and has the result reviewed; a verified build can then
        be packaged and tried under Try. Closing this page stops nothing.
      </p>
      {fixture && (
        <p className="notice">
          Fixture workspace: the deterministic builder only answers for the
          synthetic checklist sample, and every amount is simulated.
        </p>
      )}
      {!owner && <p className="notice">Only the workspace owner can build.</p>}
      <Status
        loading={data.loading && !d}
        error={data.error}
        stale={data.stale}
        retry={data.reload}
      >
        {d && (
          <>
            {fixture && owner && (
              <Sample
                specs={d.specs}
                selections={d.selections}
                write={(body) =>
                  act(
                    () => post('products/sample-spec', body),
                    'Sample spec written; freeze it next.',
                  )
                }
                reviews={d.reviews}
                busy={busy}
                run={(path, specId, done) =>
                  act(() => post(`products/${path}`, { spec_id: specId }), done)
                }
                open={open}
              />
            )}
            <h3>Specs</h3>
            {writer && !specForm && unwritten.length > 0 && (
              <div className="cite">
                <p className="small">
                  Your current selection chose{' '}
                  {unwritten.length === 1
                    ? 'an option'
                    : `${unwritten.length} options`}{' '}
                  to build with no spec yet:
                </p>
                <ul className="rows">
                  {unwritten.map((u) => (
                    <li key={`${u.selection_id}:${u.alternative.id}`}>
                      {u.option?.title ??
                        (standard
                          ? 'An option no longer listed'
                          : u.alternative.id.slice(0, 8))}{' '}
                      {!standard && <small>v{u.alternative.version} </small>}
                      <button
                        className="secondary"
                        onClick={() => {
                          setNote('');
                          setSpecForm({
                            kind: 'create',
                            selection_id: u.selection_id,
                            alternative: u.alternative,
                            prefill: {
                              title: u.option?.title ?? '',
                              audience: String(
                                u.problem.body?.affected_group ?? '',
                              ),
                              problem_statement: String(
                                u.problem.body?.statement ?? '',
                              ),
                            },
                          });
                        }}
                      >
                        Write a spec
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {specForm && (
              <SpecForm
                key={
                  specForm.kind === 'create'
                    ? `new:${specForm.alternative.id}`
                    : `rev:${specForm.spec.spec.id}:${specForm.spec.spec.version}`
                }
                base={base}
                session={session}
                mode={specForm}
                cancel={() => setSpecForm(null)}
                saved={(s) => {
                  setSpecForm(null);
                  setNote(
                    `${s.spec.title} v${s.spec.version} saved.${s.problems.length ? ` Fix before freezing: ${s.problems.map((p) => p.detail).join(' ')}` : ' Freeze it under Scores and specs next.'}`,
                  );
                  data.reload();
                }}
              />
            )}
            {d.specs.length === 0 ? (
              <Empty>
                No specs yet.{' '}
                {unwritten.length
                  ? 'Write one for the option your selection chose to build.'
                  : 'Record a selection that chooses an option to build under Projects › Decide; then write its spec here.'}
              </Empty>
            ) : (
              <ul className="rows">
                {d.specs.map((s) => {
                  const cannot = unbuildable(s, entityOf(s), fixture);
                  const revisable =
                    writer &&
                    !specForm &&
                    s.spec.status === 'active' &&
                    !stale(s) &&
                    !!entityOf(s);
                  const made = d.products.filter(
                    (p) =>
                      p.product.binding.spec_id === s.spec.id &&
                      p.product.binding.spec_version === s.spec.version,
                  );
                  return (
                    <li key={s.spec.id}>
                      <strong title={s.spec.title}>
                        {clip(s.spec.title, 90)}
                      </strong>{' '}
                      v{s.spec.version} ·{' '}
                      {s.frozen_current
                        ? 'frozen'
                        : s.latest_freeze
                          ? 'changed since its last freeze'
                          : 'not frozen'}
                      {s.blockers.length > 0 && (
                        <small> · {s.blockers.join('; ')}</small>
                      )}
                      {cannot && <small> · Can't be built yet: {cannot}</small>}{' '}
                      {owner && s.frozen_current && made.length === 0 && (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () => post('products', { spec_id: s.spec.id }),
                              'Product created from the frozen spec.',
                            )
                          }
                        >
                          Create product
                        </button>
                      )}
                      {s.spec.status === 'active' && stale(s) && (
                        <small>
                          {' '}
                          {s.frozen_current
                            ? '· Frozen before its selection was recorded again; you can still build from it.'
                            : "· Its selection was recorded again, so it can't be frozen: write a new spec from the current selection above."}
                        </small>
                      )}
                      {revisable && (
                        <button
                          className="text"
                          onClick={() => {
                            setNote('');
                            setSpecForm({
                              kind: 'revise',
                              spec: s,
                              entity: entityOf(s)!,
                            });
                          }}
                        >
                          Revise
                        </button>
                      )}{' '}
                      {!s.frozen_current &&
                        s.spec.status === 'active' &&
                        !stale(s) && (
                          <>
                            {/* Full audit N-1: keep the two actions apart. */}
                            {revisable && <span aria-hidden="true">· </span>}
                            <button
                              className="text"
                              onClick={() => open('scores')}
                            >
                              Freeze it under Scores and specs
                            </button>
                          </>
                        )}
                      {s.spec.status === 'active' &&
                        s.problems.length === 0 && (
                          <div>
                            <RunbookExport
                              key={`${s.spec.id}:${s.spec.version}`}
                              base={base}
                              session={session}
                              subject="specs"
                              id={s.spec.id}
                              version={s.spec.version}
                              frozenVersion={
                                s.latest_freeze?.spec.version ?? null
                              }
                              writer={writer}
                            />
                          </div>
                        )}
                      {s.spec.status === 'active' &&
                        (!stale(s) || s.frozen_current) && (
                          <div className="small">
                            {reviewOf(s.spec.id, s.spec.version) ? (
                              <>
                                Humility review of v{s.spec.version}:{' '}
                                {words(
                                  String(
                                    reviewOf(s.spec.id, s.spec.version)!.body
                                      ?.disposition ?? '',
                                  ),
                                )}
                              </>
                            ) : (
                              <>
                                No humility review of v{s.spec.version} yet; a
                                build needs one.
                              </>
                            )}{' '}
                            {writer && !humilityFor && (
                              <button
                                className="text"
                                onClick={() => {
                                  setNote('');
                                  setHumilityFor(s);
                                }}
                              >
                                {reviewOf(s.spec.id, s.spec.version)
                                  ? 'Review again'
                                  : 'Add a humility review'}
                              </button>
                            )}
                          </div>
                        )}
                      {humilityFor?.spec.id === s.spec.id && (
                        <HumilityForm
                          key={`${s.spec.id}:${s.spec.version}`}
                          base={base}
                          session={session}
                          subject={{
                            id: s.spec.id,
                            version: s.spec.version,
                            label: s.spec.title,
                          }}
                          {...(startFrom(s) ? { earlier: startFrom(s)! } : {})}
                          subjectKind={
                            d?.hybridOptions.has(
                              String(
                                (
                                  entityOf(s)?.body?.alternative as
                                    { id: string } | undefined
                                )?.id ?? '',
                              ).toLowerCase(),
                            )
                              ? 'hybrid'
                              : 'software'
                          }
                          prefill={{
                            whose_perspective: String(
                              entityOf(s)?.body?.audience ?? '',
                            ),
                          }}
                          cancel={() => setHumilityFor(null)}
                          saved={() => {
                            setHumilityFor(null);
                            setNote(
                              `Humility review of ${s.spec.title} v${s.spec.version} saved.`,
                            );
                            data.reload();
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <h3>Products</h3>
            {d.products.length === 0 ? (
              <Empty>No products yet. Create one from a frozen spec.</Empty>
            ) : (
              productVersions(d.products).map((g) => (
                <ProductVersions
                  key={g.specId}
                  versions={g.versions}
                  render={(p) => (
                    <Product
                      key={p.product.id}
                      entry={p}
                      spec={d.specs.find(
                        (s) => s.spec.id === p.product.binding.spec_id,
                      )}
                      data={d}
                      owner={owner}
                      fixture={fixture}
                      busy={busy}
                      act={act}
                      post={post}
                      open={open}
                      fixes={{
                        base,
                        place: `build:${p.product.id}`,
                        csrf: session.csrf_token,
                        owner,
                        onDone: () => data.refresh(),
                      }}
                      locked={
                        failed === p.product.id &&
                        /locked|needs reconciliation/i.test(error)
                      }
                    />
                  )}
                />
              ))
            )}
          </>
        )}
      </Status>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * One spec's products: the latest is shown, older versions are a choice away (F19). A pick
 * that disappears from the list falls back to the latest.
 */
function ProductVersions({
  versions,
  render,
}: {
  versions: ProductEntry[];
  render: (entry: ProductEntry) => ReactNode;
}) {
  const { standard } = useViewMode();
  const [pick, setPick] = useState('');
  const shown =
    versions.find((v) => v.product.id === pick) ?? versions[0] ?? null;
  if (!shown) return null;
  const id = `pv-${shown.product.binding.spec_id}`;
  return (
    <div className="product-versions">
      {versions.length > 1 && (
        <p className="filters">
          <label htmlFor={id} className="inline">
            Version
          </label>
          <select
            id={id}
            value={shown.product.id}
            onChange={(e) => setPick(e.target.value)}
          >
            {versions.map((v, i) => (
              <option key={v.product.id} value={v.product.id}>
                {`v${v.product.binding.spec_version}${standard ? '' : ` · product ${shortId(v.product.id)}`}${
                  v.builds[0] ? ` · ${STATE_LABEL[v.builds[0].state]}` : ''
                }${i === 0 ? ' (latest)' : ''}`}
              </option>
            ))}
          </select>{' '}
          <small>
            {versions.length - 1} older{' '}
            {versions.length === 2 ? 'version' : 'versions'}
          </small>
        </p>
      )}
      {render(shown)}
    </div>
  );
}

/** The $0 sample's three owner steps, in order, each saying what it does. */
function Sample({
  specs,
  selections,
  write,
  reviews,
  busy,
  run,
  open,
}: {
  specs: SpecStatus[];
  selections: {
    selection_id: string;
    alternative: { id: string; version: number };
  }[];
  write: (body: unknown) => void;
  reviews: StoredEntity[];
  busy: boolean;
  run: (path: string, specId: string, done: string) => void;
  open: (view: View, id?: string) => void;
}) {
  const [specId, setSpecId] = useState('');
  const spec = specs.find((s) => s.spec.id === specId) ?? specs[0];
  if (!spec)
    return selections[0] ? (
      <div className="cite">
        <h3>Try the $0 sample</h3>
        <p className="small">
          Write the synthetic checklist as a spec for the option you selected to
          build. Then freeze it, add the sample review and build it here.
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            write({
              selection_id: selections[0]!.selection_id,
              alternative: selections[0]!.alternative,
            })
          }
        >
          Write the sample spec
        </button>
      </div>
    ) : (
      <Empty>
        The sample needs a spec, or a selection that chose an option to build
        (Projects › Decide).
      </Empty>
    );
  const isSample = spec.spec.title === 'Synthetic checklist sample';
  const reviewed = reviews.some((r) => reviewOf(r, spec));
  return (
    <div className="cite">
      <h3>Try the $0 sample</h3>
      <label htmlFor="sample-spec">Spec</label>
      <select
        id="sample-spec"
        value={spec.spec.id}
        onChange={(e) => setSpecId(e.target.value)}
      >
        {specs.map((s) => (
          <option key={s.spec.id} value={s.spec.id}>
            {s.spec.title} v{s.spec.version}
          </option>
        ))}
      </select>
      <ol className="small">
        <li>
          Put the synthetic checklist into this spec as a new version.{' '}
          <button
            className="secondary"
            disabled={busy || isSample}
            onClick={() =>
              run(
                'sample-spec',
                spec.spec.id,
                'The spec now holds the synthetic checklist; freeze it next.',
              )
            }
          >
            {isSample ? 'Done' : 'Use the sample content'}
          </button>
        </li>
        <li>
          Freeze it under Scores and specs.{' '}
          {spec.frozen_current ? (
            'Done.'
          ) : (
            <button className="text" onClick={() => open('scores')}>
              Go to Scores and specs
            </button>
          )}
        </li>
        <li>
          Add the sample humility review of this version.{' '}
          <button
            className="secondary"
            disabled={busy || reviewed}
            onClick={() =>
              run(
                'sample-review',
                spec.spec.id,
                'Sample humility review added.',
              )
            }
          >
            {reviewed ? 'Done' : 'Add the sample review'}
          </button>
        </li>
        <li>Create the product, prepare its task and start a build below.</li>
      </ol>
    </div>
  );
}

const reviewOf = (r: StoredEntity, s: SpecStatus) => {
  const subject = (r.body as { subject?: { id?: string; version?: number } })
    .subject;
  return (
    r.status === 'active' &&
    subject?.id === s.spec.id &&
    subject.version === s.spec.version
  );
};

type Data = {
  reviews: StoredEntity[];
  /** Spec records (current versions): what a task's build would be tested against. */
  specEntities: StoredEntity[];
  runs: z.infer<typeof RunControlSchema>[];
  names: ReadonlyMap<string, string>;
  budgets: z.infer<typeof EnvelopeSchema>[];
  pricing: z.infer<typeof PricingSnapshotSchema>[];
  builders: {
    key: string;
    kind: 'codex' | 'roles';
    connection_id: string;
    model_id: string;
    label: string;
    connection_label: string;
    /** Which plan the connection uses, so the option names it (ChatGPT or Claude). */
    plan: 'chatgpt_plan' | 'claude_code';
    /** What the connection's settings allow; a build of another class is refused. */
    data_classes: readonly ('synthetic' | 'public' | 'private_approved')[];
    allowed_tasks: readonly string[];
    /** The connection's Codex build timeout (ADR-0062: no 30-minute maximum). */
    build_timeout_ms: number;
    /** Plan-role task classes this model is not qualified for (empty for Codex). */
    unqualified: readonly string[];
  }[];
  /** ADR-0081: the owner's current model from the top bar, if any. */
  choice: Choice | null;
  artifacts: z.infer<typeof ArtifactSummarySchema>[];
};

function Product({
  entry,
  spec,
  data,
  owner,
  fixture,
  busy,
  act,
  post,
  open,
  locked,
  fixes,
}: {
  entry: ProductEntry;
  spec: SpecStatus | undefined;
  data: Data;
  owner: boolean;
  fixture: boolean;
  busy: boolean;
  act: (
    what: () => Promise<unknown>,
    done?: string | ((result: unknown) => string),
    product?: string,
  ) => Promise<void>;
  post: (path: string, body: unknown) => Promise<unknown>;
  open: (view: View, id?: string) => void;
  /** The last action said a product was locked. */
  locked: boolean;
  /** ADR-0087: where the owner presses fixes for a refused build start. */
  fixes: FixContext;
}) {
  const { standard } = useViewMode();
  const p = entry.product;
  // Only the newest: once a later build ran, an old interruption needs nothing more.
  const newest = entry.builds[0];
  const interrupted = needsRecover(newest);
  const current =
    spec?.frozen_current && spec.spec.version === p.binding.spec_version;
  /** The Gallery artifact for a build: this run's package job, else the artifact store. */
  const packaged = (b: Build) =>
    b.package?.state === 'done'
      ? b.package.artifact_id
      : artifactForBuild(data.artifacts, b, p.binding)?.id;
  /** Review L-11: the trial wording comes from the newest package's own manifest. */
  const newestPackage = entry.builds
    .map((b) => packaged(b))
    .filter(Boolean)
    .map((id) => data.artifacts.find((a) => a.id === id))
    .find(Boolean);
  return (
    <article className="artifact">
      <h4>
        {spec?.spec.title ?? 'Spec'} v{p.binding.spec_version}
        {!standard && ` · product ${shortId(p.id)}`}
      </h4>
      {p.recipe === 'static-web/1' && (
        <p className="notice">
          Static web builds are unqualified trials unless the builder and
          reviewer on the build&apos;s own connection, model and role prompts
          passed the frozen web benchmark live; each package records which it
          is.{' '}
          {newestPackage
            ? `This product's newest package is ${newestPackage.role_qualification === 'unqualified_trial' ? 'an unqualified trial' : 'qualified'}.`
            : 'This product has no package yet.'}{' '}
          QA runs in the pinned {PINNED_BROWSER.name} {PINNED_BROWSER.version}{' '}
          (pinned {PINNED_BROWSER.pinned_on});{' '}
          {new Date().toISOString().slice(0, 10) > browserRecheckDue() ? (
            <strong>
              its security re-check was due {browserRecheckDue()} and is overdue
            </strong>
          ) : (
            <>its next security re-check is due {browserRecheckDue()}</>
          )}
          .
        </p>
      )}
      {!current && (
        <p className="notice">
          The spec changed or was unfrozen after this product was made, so it
          cannot be built or packaged. Create a product from the current frozen
          version.
        </p>
      )}
      {owner && (interrupted || locked) && (
        <p className="notice">
          {interrupted
            ? 'The last build did not finish (the app closed, or its test run was left unresolved). It is recorded and never resent; if Recover finds nothing locked, just build again.'
            : 'This product may be locked by work that stopped.'}{' '}
          Recover releases its locks only if the process that held them is gone;
          the next build re-checks the task's files.{' '}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  "Release this product's locks? Only locks whose process is gone are released, and an interrupted test run is first checked to have stopped.",
                )
              )
                return;
              void act(
                async () =>
                  z
                    .object({
                      released: z.array(z.string()),
                      reconciled: z.array(z.string()),
                      waiting: z.string().nullable(),
                    })
                    .parse(await post(`products/${p.id}/recover`, {})),
                (r: unknown) => {
                  const { released, reconciled, waiting } = r as {
                    released: string[];
                    reconciled: string[];
                    waiting: string | null;
                  };
                  if (waiting)
                    return released.length
                      ? `Released: ${released.map((l) => `${l} lock`).join(', ')}. ${waiting}`
                      : waiting;
                  if (!released.length && !reconciled.length)
                    return 'Nothing was locked, so nothing changed.';
                  return `Recovered: ${[
                    ...released.map((l) => `${l} lock released`),
                    ...reconciled.map((id) =>
                      standard
                        ? 'a test run confirmed stopped'
                        : `test run ${shortId(id)} confirmed stopped`,
                    ),
                  ].join(', ')}. You can build this product again.`;
                },
                p.id,
              );
            }}
          >
            Recover
          </button>
        </p>
      )}
      {p.binding.tasks.map(({ key }) => {
        const task = entry.tasks.find((t) => t.key === key);
        const builds = entry.builds.filter((b) => b.task_id === task?.id);
        return (
          <div key={key}>
            <p>
              <strong>Task {key}</strong>{' '}
              {!task &&
                owner &&
                current &&
                // A fresh product's tasks start from its first commit.
                (entry.tasks.length === 0 ? (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      act(
                        () =>
                          post(`products/${p.id}/tasks`, {
                            task_key: key,
                            expected_commit: p.initial_commit,
                          }),
                        `Task ${key} prepared.`,
                        p.id,
                      )
                    }
                  >
                    Prepare task
                  </button>
                ) : (
                  <small>one task per product for now</small>
                ))}
            </p>
            {task &&
              owner &&
              current &&
              task.head &&
              task.head !== task.base_commit &&
              builds[0]?.state === 'checkpoint' && (
                <p className="small">
                  The last build stopped. Building again continues from its last
                  candidate{standard ? '' : ` (${task.head.slice(0, 8)})`} under
                  a new approval.
                </p>
              )}
            {task && owner && current && (
              <StartBuild
                key={task.id}
                taskKey={key}
                specId={p.binding.spec_id}
                specVersion={p.binding.spec_version}
                specRun={
                  spec?.latest_freeze?.spec.version === p.binding.spec_version
                    ? spec.latest_freeze.run_id
                    : null
                }
                data={data}
                fixture={fixture}
                open={open}
                fixes={fixes}
                busy={busy || builds.some((b) => b.state === 'running')}
                start={(plan) =>
                  act(
                    async () => {
                      const r = Started.parse(
                        await post(`products/${p.id}/builds`, {
                          task_id: task.id,
                          expected_commit: task.head ?? task.base_commit,
                          plan,
                        }),
                      );
                      return r;
                    },
                    'Build started. This page updates while it runs.',
                    p.id,
                  )
                }
              />
            )}
            {builds.length > 0 && (
              <ul className="rows">
                {builds.map((b) => (
                  <li key={b.id}>
                    <span className="badge">{STATE_LABEL[b.state]}</span> build
                    {!standard && ` ${shortId(b.id)}`} · started{' '}
                    {when(b.started_at)}
                    {b.fixture && ' · fixture'}
                    {b.reason && (
                      <small>
                        {' '}
                        ·{' '}
                        {standard
                          ? plainReason(b.reason)
                          : b.reason.replace(/^Error: /, '')}
                      </small>
                    )}
                    {b.state === 'checkpoint' &&
                      b === builds[0] &&
                      /admission/i.test(b.reason ?? '') && (
                        <>
                          {' '}
                          <button
                            className="text"
                            onClick={() => open('decisions')}
                          >
                            Approve it once under Monitor › Approvals, then
                            build again
                          </button>
                        </>
                      )}
                    {b.package?.state === 'running' && (
                      <small> · packaging…</small>
                    )}
                    {b.package?.state === 'failed' && (
                      <small> · packaging failed: {b.package.error}</small>
                    )}
                    {packaged(b) && (
                      <>
                        {' '}
                        <button
                          className="text"
                          onClick={() => open('gallery', packaged(b))}
                        >
                          Packaged: open it under Try
                        </button>
                      </>
                    )}
                    {b.state === 'verified_candidate' &&
                      owner &&
                      current &&
                      b.package?.state !== 'running' &&
                      !packaged(b) && (
                        <>
                          {' '}
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              act(
                                () =>
                                  post(`products/${p.id}/package`, {
                                    build_id: b.id,
                                  }),
                                'Packaging started. It reruns the build from its archive first.',
                                p.id,
                              )
                            }
                          >
                            Package
                          </button>
                        </>
                      )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </article>
  );
}

/**
 * The data class a build is sent with. Fixture records are synthetic; a real workspace classifies
 * the build as its frozen data contracts need (at least public). The build's approval and grants
 * still decide whether that class is admitted.
 */
function buildDataClass(spec: SpecBody, fixture: boolean) {
  if (fixture) return 'synthetic' as const;
  return contractDataClass(spec) === 'private_approved'
    ? ('private_approved' as const)
    : ('public' as const);
}

/** A frozen spec none of whose tasks can be built: the first reason, said before Create product. */
function unbuildable(
  s: SpecStatus,
  entity: StoredEntity | undefined,
  fixture: boolean,
) {
  const body = SpecBodySchema.safeParse(entity?.body);
  if (!s.frozen_current || !body.success) return null;
  const spec = body.data;
  const dataClass = buildDataClass(spec, fixture);
  // Builder tasks first: their reasons are the ones an edit to the spec can fix.
  const tasks = [...spec.tasks].sort(
    (a, b) => Number(b.role === 'builder') - Number(a.role === 'builder'),
  );
  const why = tasks.map((t) => buildBlockers(spec, t.key, dataClass));
  return why.every((w) => w.length) ? why[0]![0]! : null;
}

/** ADR-0081: offers a plan-role builder qualified for both roles when the shown one is not. */
function BuilderAlternative({
  current,
  builders,
  fromChoice,
  use,
}: {
  current: Data['builders'][number];
  builders: Data['builders'];
  fromChoice: boolean;
  use: (key: string) => void;
}) {
  const ok = builders.filter(
    (b) => b.kind === 'roles' && b.unqualified.length === 0,
  );
  const alt =
    ok.find((b) => b.connection_id === current.connection_id) ?? ok[0];
  return (
    <p className="small model-note model-note-warn" role="note">
      {current.model_id}
      {fromChoice ? ' (your current model)' : ''} is not qualified for{' '}
      {current.unqualified.map(taskWords).join(' and ')}.{' '}
      {alt ? (
        <button type="button" className="text" onClick={() => use(alt.key)}>
          Use {alt.model_id} on {alt.connection_label} instead
        </button>
      ) : (
        `No plan model here is qualified for both ${BUILD_ROLE_CLASSES.map(taskWords).join(' and ')} yet.`
      )}
    </p>
  );
}

/** The build plan: which run, budget, pricing, humility review and builder; limits in range. */
function StartBuild({
  taskKey,
  specId,
  specVersion,
  specRun,
  data,
  fixture,
  busy,
  start,
  open,
  fixes,
}: {
  taskKey: string;
  specId: string;
  specVersion: number;
  /** The run the spec version was frozen in: the build's default run (P-10). */
  specRun: string | null;
  data: Data;
  fixture: boolean;
  busy: boolean;
  open: (view: View, id?: string) => void;
  start: (plan: unknown) => Promise<void>;
  /** ADR-0087: where the owner presses fixes for the reasons below in place. */
  fixes?: FixContext;
}) {
  const { standard } = useViewMode();
  const reviews = data.reviews.filter((r) => {
    const s = (r.body as { subject?: { id?: string; version?: number } })
      .subject;
    return (
      r.status === 'active' && s?.id === specId && s.version === specVersion
    );
  });
  const [run, setRun] = useState('');
  const [budget, setBudget] = useState('');
  const [price, setPrice] = useState('');
  const [review, setReview] = useState('');
  // '' until chosen: the $0 plan route when one is verified, else the broker.
  const [builder, setBuilder] = useState('');
  /** The person picked a builder on this form, so a switch in the top bar leaves it alone. */
  const [picked, setPicked] = useState(false);
  const [repairs, setRepairs] = useState(1);
  // ADR-0081: the current model's plan-role builder comes first, even when it is not
  // qualified: the form then says so and offers a qualified one, never switching quietly.
  const preferred = planBuilderDefault(data.builders, data.choice);
  const planDefault = preferred.builder;
  const chosenRoles = preferred.fromChoice ? preferred.builder : undefined;
  // Once the plan route is shown as the default, it counts as chosen: if it later stops being
  // verified, the form says so instead of quietly switching to the metered broker.
  useEffect(() => {
    if (!builder && planDefault) setBuilder(planDefault.key);
  }, [builder, planDefault?.key]);
  // The current model arriving (it may load after this form, review L-1) or a switch in the
  // top bar re-defaults a builder the person did not pick here.
  const choiceKey = data.choice
    ? `${data.choice.connection_id}:${data.choice.model_id}`
    : '';
  // Only a real change of the choice counts (re-review M-1): on mount the default stays locked,
  // so a locked builder that is no longer verified still says "choose again".
  const seenChoice = useRef(choiceKey);
  useEffect(() => {
    const next = builderAfterChoiceChange({
      builder,
      picked,
      previousChoice: seenChoice.current,
      choice: choiceKey,
      defaultKey: planDefault?.key ?? '',
    });
    seenChoice.current = choiceKey;
    if (next !== builder) setBuilder(next);
  }, [choiceKey]);
  const connection =
    builder && builder !== 'broker'
      ? data.builders.find((b) => b.key === builder)
      : builder
        ? undefined
        : planDefault;
  /** A plan builder that was chosen and is no longer verified: nothing is sent until re-chosen. */
  const lostBuilder =
    builder !== '' && builder !== 'broker' && !connection ? builder : '';
  // P-10: the spec's own run first, else the newest run that can build.
  const runId = data.runs.some((r) => r.run_id === run)
    ? run
    : buildRunDefault(data.runs, specRun);
  // A run or task budget belongs to its own run; the default is one this run may use.
  const budgetId = data.budgets.some(
    (b) => b.id === budget && (b.run_id === null || b.run_id === runId),
  )
    ? budget
    : (envelopeFor(data.budgets, runId)?.id ?? '');
  const priceId = data.pricing.some((p) => p.id === price)
    ? price
    : (data.pricing[0]?.id ?? '');
  const chosen = reviews.find((r) => r.id === review) ?? reviews[0];
  // What the frozen spec lacks for this task (e.g. test cases): the server refuses the same.
  const entity = data.specEntities.find(
    (e) =>
      e.id.toLowerCase() === specId.toLowerCase() && e.version === specVersion,
  );
  const body = SpecBodySchema.safeParse(entity?.body);
  const dataClass = body.success
    ? buildDataClass(body.data, fixture)
    : fixture
      ? 'synthetic'
      : 'public';
  const blockers = body.success
    ? buildBlockers(body.data, taskKey, dataClass)
    : [];
  const refusedClass = connection
    ? connectionDataBlocker(
        connection.data_classes,
        dataClass,
        connection.connection_label,
      )
    : null;
  // P04: the same blocked-reasons list as Discover, each with the tab that fixes it.
  const missing: BlockedReason[] = [
    ...(!runId
      ? [
          {
            text: 'Needs an active run: start one from Discover.',
            fix: { view: 'submit' as View, label: 'Open Discover' },
          },
        ]
      : []),
    ...(!budgetId
      ? [
          {
            text: 'Needs an active budget.',
            fix: { view: 'budgets' as View, label: 'Open Budgets' },
          },
        ]
      : []),
    ...(!priceId
      ? [
          {
            text: 'Needs a pricing snapshot.',
            fix: { view: 'budgets' as View, label: 'Open Budgets' },
          },
        ]
      : []),
    ...(!chosen
      ? [
          {
            text: 'Needs a humility review of this exact spec version.',
            fix: { view: 'scores' as View, label: 'Open Scores and specs' },
          },
        ]
      : []),
    // ADR-0081: a plan-role builder whose model is not qualified for both roles is refused
    // here with the reason, and a qualified one is offered below the builder choice.
    ...(connection?.kind === 'roles' && connection.unqualified.length
      ? [
          {
            text: `${connection.model_id} is not qualified for ${connection.unqualified.map(taskWords).join(' and ')}, so the plan builder and reviewer can't run on it.`,
            fix: {
              view: 'models' as View,
              label: 'Open Models and connections',
            },
            acts: missingTaskFixes(
              connection.connection_id,
              connection.model_id,
              connection.unqualified,
              connection.allowed_tasks,
              'plan',
              // A fixture workspace qualifies nothing in the app (P27 review N-3).
              fixture ? () => false : canQualifyFor('plan'),
            ),
          },
        ]
      : []),
    ...(lostBuilder
      ? [
          {
            text: `The plan model chosen as builder (${lostBuilder.split(':').slice(2).join(':')}) is no longer verified; choose a builder again.`,
            fix: {
              view: 'models' as View,
              label: 'Open Models and connections',
            },
          },
        ]
      : []),
  ];

  // ADR-0082 (P19): the records a build names, picked by default from what can build now.
  const sourceOf = (chosenHere: string) =>
    chosenHere ? 'changed here' : 'studio default';
  const runName = data.runs.find((r) => r.run_id === runId);
  const recordsSummary = [
    `Run: ${runName ? runLabel(runName, data.names, 48, !standard) : 'none'}`,
    `budget: ${data.budgets.find((b) => b.id === budgetId)?.name ?? 'none'}`,
    `review: ${chosen ? recordLabel(chosen) : 'none for this version'}`,
    sourceOf(run || budget || price || review),
  ].join(' · ');

  function submit(e: FormEvent) {
    e.preventDefault();
    if (missing.length || blockers.length || refusedClass || !chosen) return;
    void start({
      format: 'build-plan/1',
      run_id: runId,
      envelope_id: budgetId,
      pricing_snapshot_id: priceId,
      humility_review: { id: chosen.id, version: chosen.version },
      data_class: dataClass,
      max_repairs: repairs,
      max_calls: 2 + 2 * repairs,
      // A streamed plan answer can take up to the plan's 120 s request timeout.
      timeout_ms: connection?.kind === 'roles' ? 120000 : 30000,
      max_output_tokens: 3000,
      deadline: new Date(
        Date.now() +
          buildDeadlineMs(
            connection?.kind === 'codex' ? connection.build_timeout_ms : 0,
            repairs,
          ),
      ).toISOString(),
      ...(connection
        ? {
            [connection.kind === 'roles' ? 'plan_roles' : 'codex_plan_builder']:
              {
                connection_id: connection.connection_id,
                model_id: connection.model_id,
              },
          }
        : {}),
    });
  }
  return (
    <form className="cite" onSubmit={submit}>
      <Routine summary={recordsSummary}>
        <label htmlFor="bp-run">Run</label>
        <select
          id="bp-run"
          value={runId}
          onChange={(e) => setRun(e.target.value)}
        >
          {data.runs.length === 0 && <option value="">No active run</option>}
          {data.runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              {runLabel(r, data.names, 48, !standard)}
            </option>
          ))}
        </select>
        <label htmlFor="bp-budget">Budget</label>
        <select
          id="bp-budget"
          value={budgetId}
          onChange={(e) => setBudget(e.target.value)}
        >
          {data.budgets.length === 0 && (
            <option value="">No active budget</option>
          )}
          {data.budgets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <label htmlFor="bp-price">Pricing</label>
        <select
          id="bp-price"
          value={priceId}
          onChange={(e) => setPrice(e.target.value)}
        >
          {data.pricing.length === 0 && (
            <option value="">No pricing snapshot</option>
          )}
          {data.pricing.map((p) => (
            <option key={p.id} value={p.id}>
              {p.body.provider}/{p.body.model_id}
            </option>
          ))}
        </select>
        <label htmlFor="bp-review">Humility review</label>
        <select
          id="bp-review"
          value={chosen?.id ?? ''}
          onChange={(e) => setReview(e.target.value)}
        >
          {reviews.length === 0 && (
            <option value="">None for this version</option>
          )}
          {reviews.map((r) => (
            <option key={r.id} value={r.id} title={r.title}>
              {recordLabel(r)}
            </option>
          ))}
        </select>
      </Routine>
      <label htmlFor="bp-builder">Builder</label>
      <select
        id="bp-builder"
        value={connection ? connection.key : lostBuilder || 'broker'}
        onChange={(e) => {
          setBuilder(e.target.value);
          setPicked(true);
        }}
      >
        {lostBuilder && (
          <option value={lostBuilder} disabled>
            Chosen plan model unavailable: choose again
          </option>
        )}
        <option value="broker">
          {fixture ? 'Fixture builder (simulated)' : 'Model broker (metered)'}
        </option>
        {data.builders.map((b) => (
          <option key={b.key} value={b.key}>
            {b.kind === 'roles'
              ? `Builder and reviewer on ${b.plan === 'claude_code' ? 'Claude' : 'ChatGPT'} plan`
              : 'Codex on ChatGPT plan'}{' '}
            · {b.label}
          </option>
        ))}
      </select>
      {connection?.kind === 'roles' && connection.unqualified.length > 0 && (
        <BuilderAlternative
          current={connection}
          builders={data.builders}
          fromChoice={connection === chosenRoles && !picked}
          use={(key) => {
            setBuilder(key);
            setPicked(true);
          }}
        />
      )}
      {connection?.kind === 'roles' &&
        connection === chosenRoles &&
        !picked &&
        connection.unqualified.length === 0 && (
          <p className="small model-note">
            Your current model, from the top bar. Change the builder here for
            this build only.
          </p>
        )}
      {data.choice &&
        !preferred.fromChoice &&
        !picked &&
        !lostBuilder &&
        !fixture && (
          <p className="small model-note">
            Your current model ({data.choice.model_id}) is not verified on a
            plan connection here, so this form uses{' '}
            {connection?.kind === 'roles'
              ? connection.model_id
              : 'the builder above'}
            . Switch models from the top bar.
          </p>
        )}
      {connection?.kind === 'codex' && (
        <p className="small">
          This is a live call on your ChatGPT plan. It runs only if a grant you
          approve covers this build; otherwise the build stops and asks under
          Monitor › Approvals.
        </p>
      )}
      {connection?.kind === 'roles' && (
        <p className="small">
          Live requests on your{' '}
          {connection.plan === 'claude_code' ? 'Claude' : 'ChatGPT'} plan, with
          no metered spend: up to {2 + 2 * repairs} builder and reviewer
          requests, each counted against the plan caps in Settings. One approval
          covers the whole build, its repair rounds and both roles within that
          limit. Both roles must be qualified and the run must have room for at
          least one of each first (repair rounds need more room); if not, the
          build stops before anything is sent or any approval is used. The
          budget and pricing chosen above are recorded with the build, but
          nothing is reserved or charged on this route.
        </p>
      )}
      <label htmlFor="bp-repairs">Repair rounds after a failed check</label>
      <select
        id="bp-repairs"
        value={repairs}
        onChange={(e) => setRepairs(Number(e.target.value))}
      >
        <option value={0}>0</option>
        <option value={1}>1</option>
        <option value={2}>2</option>
      </select>
      {dataClass === 'private_approved' && (
        <p className="small">
          This spec's data contracts include approved private data, so the build
          is classified for it. A plan builder's connection must allow approved
          private data (Models and connections), and the build's approval and
          grants must cover it, or the build stops before anything is sent.
        </p>
      )}
      <WhatWillHappen
        items={[
          {
            label: 'Build',
            value: `Builds task ${taskKey} of spec v${specVersion}, then an independent review and the frozen checks run on the result`,
          },
          {
            label: 'Builder',
            value: builderSummary(connection, fixture),
          },
          {
            label: 'Limits',
            value: `At most ${2 + 2 * repairs} model requests, ${repairs} repair round${repairs === 1 ? '' : 's'} after a failed check`,
            source: repairs === 1 ? 'studio default' : 'changed here',
          },
          { label: 'Records', value: recordsSummary },
          { label: 'Data class', value: words(dataClass) },
        ]}
        note="Nothing is sent until you press Start build, and the server checks the run, grants, budget, review and every cap again. Defaults never add a grant or raise a cap."
      />
      <Blocked
        action="build this task from this spec version"
        reasons={[
          ...blockers.map((b) => ({
            text: b,
            fix: { view: 'scores' as View, label: 'Open Scores and specs' },
          })),
          ...(refusedClass
            ? [
                {
                  text: refusedClass,
                  fix: {
                    view: 'models' as View,
                    label: 'Open Models and connections',
                  },
                  ...(connection
                    ? {
                        acts: [
                          {
                            kind: 'allow_data' as const,
                            connection_id: connection.connection_id,
                            data_class: dataClass,
                          },
                        ],
                      }
                    : {}),
                },
              ]
            : []),
          ...missing,
        ]}
        open={open}
        fixes={fixes ?? null}
      />
      <FixOutcome fix={fixes} />
      <div className="actions">
        <button
          className="primary"
          disabled={
            busy || missing.length > 0 || blockers.length > 0 || !!refusedClass
          }
        >
          Start build
        </button>
      </div>
    </form>
  );
}
