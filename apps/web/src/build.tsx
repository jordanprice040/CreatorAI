import { SpecForm, type SpecFormMode } from './spec-form.js';
import { HumilityForm } from './humility.js';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArtifactSummarySchema,
  EnvelopeSchema,
  GrantSchema,
  PlanConnectionSchema,
  PlanModelAccessSchema,
  PricingSnapshotSchema,
  RunControlSchema,
  SelectionSchema,
  SpecStatusSchema,
  StoredEntitySchema,
  z,
  type SessionInfo,
  type SpecStatus,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { Empty, Status, runNames, shortId, useLoad, type View } from './ui.js';
import { newestFirst, productVersions } from './versions.js';
import { recordLabel, runLabel } from './labels.js';
import {
  artifactForBuild,
  envelopeFor,
  modelGrantCovers,
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
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  const owner = workspace.role === 'owner';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // The product the last failed action was about, so a lock notice shows only there.
  const [failed, setFailed] = useState('');
  const data = useLoad(async () => {
    const [
      specs,
      products,
      reviews,
      runs,
      budgets,
      pricing,
      grants,
      artifacts,
      names,
    ] = await Promise.all([
      api(z.array(StoredEntitySchema), `${base}/entities?kind=specification`),
      api(z.array(ProductEntrySchema), `${base}/products`),
      api(z.array(StoredEntitySchema), `${base}/entities?kind=humility_review`),
      api(z.array(RunControlSchema), `${base}/runs`),
      api(z.array(EnvelopeSchema), `${base}/budgets`),
      api(z.array(PricingSnapshotSchema), `${base}/pricing`),
      api(z.array(GrantSchema), `${base}/grants`),
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
          z.object({ model_access: z.array(PlanModelAccessSchema) }),
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
      })),
    );
    const now = Date.now();
    return {
      specs: status,
      specEntities: specs,
      selections,
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
      // Runs a standing grant admits plan-role model requests on: plan builds need one.
      modelRuns: new Set(
        runs
          .filter((r) =>
            grants.some((g) =>
              modelGrantCovers(g, r, fixture ? 'synthetic' : 'public', now),
            ),
          )
          .map((r) => r.run_id),
      ),
      artifacts,
    };
  }, [workspace.id]);
  const d = data.data;
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
  const unwritten =
    d?.selections.filter(
      (u) =>
        !d.specEntities.some((e) => {
          const a = e.body?.alternative as
            { id: string; version: number } | undefined;
          return (
            e.status === 'active' &&
            a?.id.toLowerCase() === u.alternative.id.toLowerCase() &&
            a.version === u.alternative.version
          );
        }),
    ) ?? [];
  // useLoad reads again, quietly, each time this page is shown (coming back from Decisions
  // or anywhere), so the current state shows without a manual refresh; typed fields are kept.
  // While a build or package runs on the server, keep the page current.
  const running = d?.products.some((p) =>
    p.builds.some(
      (b) => b.state === 'running' || b.package?.state === 'running',
    ),
  );
  useEffect(() => {
    if (!running) return;
    const t = setInterval(data.refresh, 2000);
    return () => clearInterval(t);
  }, [running]);

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
                      {u.option?.title ?? u.alternative.id.slice(0, 8)}{' '}
                      <small>v{u.alternative.version}</small>{' '}
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
                  const made = d.products.filter(
                    (p) =>
                      p.product.binding.spec_id === s.spec.id &&
                      p.product.binding.spec_version === s.spec.version,
                  );
                  return (
                    <li key={s.spec.id}>
                      <strong>{s.spec.title}</strong> v{s.spec.version} ·{' '}
                      {s.frozen_current
                        ? 'frozen'
                        : s.latest_freeze
                          ? 'changed since its last freeze'
                          : 'not frozen'}
                      {s.blockers.length > 0 && (
                        <small> · {s.blockers.join('; ')}</small>
                      )}{' '}
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
                      {writer &&
                        !specForm &&
                        s.spec.status === 'active' &&
                        entityOf(s) && (
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
                      {!s.frozen_current && (
                        <button className="text" onClick={() => open('scores')}>
                          Freeze it under Scores and specs
                        </button>
                      )}
                      {s.spec.status === 'active' && (
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
                {`v${v.product.binding.spec_version} · product ${shortId(v.product.id)}${
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
  }[];
  /** Run ids whose standing grants admit plan-role model requests. */
  modelRuns: ReadonlySet<string>;
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
}) {
  const p = entry.product;
  // Only the newest: once a later build ran, an old interruption needs nothing more.
  const newest = entry.builds[0];
  const interrupted =
    newest?.state === 'interrupted' ||
    /locked|needs reconciliation/i.test(newest?.reason ?? '');
  const current =
    spec?.frozen_current && spec.spec.version === p.binding.spec_version;
  /** The Gallery artifact for a build: this run's package job, else the artifact store. */
  const packaged = (b: Build) =>
    b.package?.state === 'done'
      ? b.package.artifact_id
      : artifactForBuild(data.artifacts, b, p.binding)?.id;
  return (
    <article className="artifact">
      <h4>
        {spec?.spec.title ?? 'Spec'} v{p.binding.spec_version} · product{' '}
        {shortId(p.id)}
      </h4>
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
                    ...reconciled.map(
                      (id) => `test run ${shortId(id)} confirmed stopped`,
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
                  candidate ({task.head.slice(0, 8)}) under a new approval.
                </p>
              )}
            {task && owner && current && (
              <StartBuild
                key={task.id}
                specId={p.binding.spec_id}
                specVersion={p.binding.spec_version}
                data={data}
                fixture={fixture}
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
                    <span className="badge">{STATE_LABEL[b.state]}</span> build{' '}
                    {shortId(b.id)} · started {when(b.started_at)}
                    {b.fixture && ' · fixture'}
                    {b.reason && (
                      <small> · {b.reason.replace(/^Error: /, '')}</small>
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

/** The build plan: which run, budget, pricing, humility review and builder; limits in range. */
function StartBuild({
  specId,
  specVersion,
  data,
  fixture,
  busy,
  start,
}: {
  specId: string;
  specVersion: number;
  data: Data;
  fixture: boolean;
  busy: boolean;
  start: (plan: unknown) => Promise<void>;
}) {
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
  const [repairs, setRepairs] = useState(1);
  const planDefault = data.builders.find((b) => b.kind === 'roles');
  // Once the plan route is shown as the default, it counts as chosen: if it later stops being
  // verified, the form says so instead of quietly switching to the metered broker.
  useEffect(() => {
    if (!builder && planDefault) setBuilder(planDefault.key);
  }, [builder, planDefault?.key]);
  const connection =
    builder && builder !== 'broker'
      ? data.builders.find((b) => b.key === builder)
      : builder
        ? undefined
        : planDefault;
  /** A plan builder that was chosen and is no longer verified: nothing is sent until re-chosen. */
  const lostBuilder =
    builder !== '' && builder !== 'broker' && !connection ? builder : '';
  // The newest run that can build; on the plan route, preferably one whose standing grant
  // admits the role requests, so the default is a run the build can actually use.
  const usable = data.runs.filter((r) => r.autonomy_mode !== 'human_only');
  const granted = usable.find((r) => data.modelRuns.has(r.run_id));
  const runId = data.runs.some((r) => r.run_id === run)
    ? run
    : ((connection?.kind === 'roles' ? granted : undefined)?.run_id ??
      usable[0]?.run_id ??
      '');
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
  const missing = [
    !runId && 'an active run (register one under Sources or Discover)',
    !budgetId && 'an active budget (Monitor › Budgets)',
    !priceId && 'a pricing snapshot (Monitor › Budgets)',
    !chosen && 'a humility review of this spec version',
    lostBuilder &&
      `a builder: the plan model chosen (${lostBuilder.split(':').slice(2).join(':')}) is no longer verified, so choose again (Models and connections shows why)`,
  ].filter(Boolean);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (missing.length || !chosen) return;
    void start({
      format: 'build-plan/1',
      run_id: runId,
      envelope_id: budgetId,
      pricing_snapshot_id: priceId,
      humility_review: { id: chosen.id, version: chosen.version },
      data_class: fixture ? 'synthetic' : 'public',
      max_repairs: repairs,
      max_calls: 2 + 2 * repairs,
      // A streamed plan answer can take up to the plan's 120 s request timeout.
      timeout_ms: connection?.kind === 'roles' ? 120000 : 30000,
      max_output_tokens: 3000,
      deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
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
      <label htmlFor="bp-run">Run</label>
      <select
        id="bp-run"
        value={runId}
        onChange={(e) => setRun(e.target.value)}
      >
        {data.runs.length === 0 && <option value="">No active run</option>}
        {data.runs.map((r) => (
          <option key={r.run_id} value={r.run_id}>
            {`${runLabel(r, data.names)}${
              connection?.kind === 'roles' && !data.modelRuns.has(r.run_id)
                ? ' · no model grant'
                : ''
            }`}
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
      <label htmlFor="bp-builder">Builder</label>
      <select
        id="bp-builder"
        value={connection ? connection.key : lostBuilder || 'broker'}
        onChange={(e) => setBuilder(e.target.value)}
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
              ? 'Builder and reviewer on ChatGPT plan'
              : 'Codex on ChatGPT plan'}{' '}
            · {b.label}
          </option>
        ))}
      </select>
      {connection?.kind === 'codex' && (
        <p className="small">
          This is a live call on your ChatGPT plan. It runs only if a grant you
          approve covers this build; otherwise the build stops and asks under
          Monitor › Approvals.
        </p>
      )}
      {connection?.kind === 'roles' && (
        <p className="small">
          Live requests on your ChatGPT plan, with no metered spend: up to{' '}
          {2 + 2 * repairs} builder and reviewer requests, each counted against
          the plan caps in Settings. One approval covers the whole build, its
          repair rounds and both roles within that limit. Both roles must be
          qualified and the run must have room for at least one of each first
          (repair rounds need more room); if not, the build stops before
          anything is sent or any approval is used. The budget and pricing
          chosen above are recorded with the build, but nothing is reserved or
          charged on this route.
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
      {missing.length > 0 && (
        <p className="small">Still needed: {missing.join(', ')}.</p>
      )}
      <div className="actions">
        <button className="primary" disabled={busy || missing.length > 0}>
          Start build
        </button>
      </div>
    </form>
  );
}
