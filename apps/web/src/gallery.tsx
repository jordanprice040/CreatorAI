import { useEffect, useState, type FormEvent } from 'react';
import {
  ArtifactComparisonSchema,
  ArtifactDetailSchema,
  ArtifactSummarySchema,
  FeedbackSchema,
  PreviewSchema,
  PreviewStartSchema,
  z,
  type ArtifactComparison,
  type ArtifactDetail,
  type ArtifactSummary,
  type Feedback,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { NO_CLI_IN_DESKTOP, useDesktopApp } from './desktop-app.js';
import { Empty, Status, shortId, useLoad, type View } from './ui.js';
import { newestFirst } from './versions.js';

const LABELS = {
  source_archive: 'Source archive',
  runnable_demo: 'Runnable demo',
  native_installer: 'Native installer',
} as const;
const nano = (n: string) =>
  n === '0' ? '$0' : `$${(Number(n) / 1e9).toFixed(6)}`;

/**
 * Verified artifacts from the local product store. Every download and preview start is
 * rechecked on the server against the manifest hash; nothing here runs generated code.
 */
export function Gallery({
  workspace,
  session,
  focus,
  open,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
  focus?: string | undefined;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  // Newest first: the latest package is listed on top and opens by default.
  const list = useLoad(
    async () =>
      newestFirst(
        await api(z.array(ArtifactSummarySchema), `${base}/artifacts`),
      ),
    [workspace.id],
  );
  const selected =
    list.data?.find((a) => a.id === focus) ?? list.data?.[0] ?? null;
  return (
    <section className="panel" aria-labelledby="gal-title">
      <h2 id="gal-title">Try</h2>
      <p className="small">
        Packages of verified task candidates. Each one was re-extracted from its
        archive and started again in the isolated worker before it is offered as
        a demo. Old versions stay here after a revision.
      </p>
      <Status loading={list.loading} error={list.error} retry={list.reload}>
        {list.data && list.data.length === 0 && (
          <Empty>
            No packaged artifacts yet. Package a verified build with its Package
            button under Build.{' '}
            <button
              type="button"
              className="text"
              onClick={() => open('build')}
            >
              Open Build
            </button>
          </Empty>
        )}
        {list.data && list.data.length > 0 && (
          <div className="gallery">
            <ul className="rows artifact-list" aria-label="Artifacts">
              {list.data.map((a) => (
                <li key={a.id}>
                  <button
                    className={`text${a.id === selected?.id ? ' selected' : ''}`}
                    aria-current={a.id === selected?.id ? 'true' : undefined}
                    onClick={() => open('gallery', a.id)}
                  >
                    Spec v{a.spec.version} · {a.commit.slice(0, 10)}
                  </button>{' '}
                  <span className={`badge art-${a.state}`}>{a.state}</span>{' '}
                  <small>
                    {a.current ? 'current' : 'superseded'} ·{' '}
                    {when(a.created_at)}
                  </small>
                </li>
              ))}
            </ul>
            {selected && (
              <ArtifactPanel
                key={selected.id}
                base={base}
                summary={selected}
                all={list.data}
                session={session}
                open={open}
                reloadList={list.reload}
              />
            )}
          </div>
        )}
      </Status>
    </section>
  );
}

function ArtifactPanel({
  base,
  summary,
  all,
  session,
  open,
  reloadList,
}: {
  base: string;
  summary: ArtifactSummary;
  all: ArtifactSummary[];
  session: SessionInfo | null;
  open: (view: View, id?: string) => void;
  reloadList: () => void;
}) {
  const detail = useLoad(
    () => api(ArtifactDetailSchema, `${base}/artifacts/${summary.id}`),
    [summary.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ttl, setTtl] = useState('15');
  const csrf = session?.csrf_token ?? '';
  async function act(work: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
      detail.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const d = detail.data;
  return (
    <article className="artifact" aria-labelledby="art-title">
      <Status
        loading={detail.loading}
        error={detail.error}
        retry={detail.reload}
      >
        {d && (
          <>
            <h3 id="art-title">
              Package {d.manifest.repository.commit.slice(0, 10)} · spec v
              {d.manifest.spec.version}
            </h3>
            <p
              className={`integrity ${d.integrity.ok ? 'ok' : 'error'}`}
              role="status"
            >
              {d.integrity.ok ? 'Integrity checked: ' : 'Integrity failed: '}
              {d.integrity.detail}
            </p>
            {d.manifest.toolchain.backend !== 'wsl2-bwrap-systemd' && (
              <aside className="notice" role="note">
                <strong>Not isolation evidence.</strong>
                <span>
                  This package ran on “{d.manifest.toolchain.backend}”, not the
                  reviewed isolated worker.
                </span>
              </aside>
            )}
            <ul className="availability" aria-label="Availability">
              {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => (
                <li key={k} className={d.manifest.availability[k].state}>
                  <strong>{LABELS[k]}</strong>{' '}
                  <span>{words(d.manifest.availability[k].state)}</span>
                  <small>{d.manifest.availability[k].reason}</small>
                </li>
              ))}
            </ul>
            <div className="actions">
              {d.integrity.ok && session ? (
                <a
                  className="button"
                  href={`/api/${base}/artifacts/${summary.id}/download?sha256=${summary.manifest_sha256}`}
                  download
                >
                  Download source archive
                </a>
              ) : (
                <span className="small">
                  Download unavailable
                  {session ? ' until integrity passes' : ': sign in'}.
                </span>
              )}
              {d.manifest.availability.runnable_demo.state === 'available' && (
                <form
                  className="inline"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    void act(async () => {
                      const r = await api(
                        PreviewStartSchema,
                        `${base}/artifacts/${summary.id}/previews`,
                        {
                          body: {
                            expected_manifest_sha256: summary.manifest_sha256,
                            ttl_minutes: Number(ttl),
                            max_runs: 10,
                          },
                          csrf,
                          timeoutMs: 120000,
                        },
                      );
                      setPreviewUrl(r.url);
                      return r.url
                        ? 'Preview is ready on its own origin.'
                        : `Preview ${r.preview.state}: ${JSON.stringify(r.preview.readiness)}`;
                    });
                  }}
                >
                  <label>
                    Expires after{' '}
                    <select
                      value={ttl}
                      onChange={(e) => setTtl(e.target.value)}
                    >
                      <option value="5">5 min</option>
                      <option value="15">15 min</option>
                      <option value="60">60 min</option>
                    </select>
                  </label>
                  <button className="primary" disabled={busy || !csrf}>
                    Start private preview
                  </button>
                </form>
              )}
            </div>
            {previewUrl && (
              <p className="notice ok">
                <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                  Open the private preview
                </a>{' '}
                (one-time link; it opens on a separate origin).
              </p>
            )}
            {notice && (
              <p className="small" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Facts d={d} />
            <Previews
              d={d}
              busy={busy}
              stop={(id, version, revoke) =>
                act(async () => {
                  const p = await api(
                    PreviewSchema,
                    `${base}/previews/${id}/stop`,
                    {
                      body: {
                        expected_version: version,
                        revoke,
                        reason: revoke
                          ? 'Owner revoked preview access'
                          : 'Owner stopped preview',
                      },
                      csrf,
                    },
                  );
                  return `Preview ${p.state}.`;
                })
              }
            />
            <FeedbackPanel
              d={d}
              busy={busy || !csrf}
              act={act}
              submit={(category, text) =>
                api(
                  FeedbackSchema,
                  `${base}/artifacts/${summary.id}/feedback`,
                  {
                    body: {
                      expected_manifest_sha256: summary.manifest_sha256,
                      category,
                      text,
                    },
                    csrf,
                  },
                )
              }
              decide={(f, decision, rationale) =>
                api(FeedbackSchema, `${base}/feedback/${f.id}/decide`, {
                  body: { expected_version: f.version, decision, rationale },
                  csrf,
                })
              }
            />
            <Compare
              base={base}
              summary={summary}
              all={all}
              open={open}
              reloadList={reloadList}
            />
          </>
        )}
      </Status>
    </article>
  );
}

function Facts({ d }: { d: ArtifactDetail }) {
  const m = d.manifest;
  return (
    <details open>
      <summary>Manifest</summary>
      <dl className="facts">
        <dt>Manifest sha256</dt>
        <dd>
          <code>{d.artifact.manifest_sha256}</code>
        </dd>
        <dt>Archive sha256</dt>
        <dd>
          <code>{m.package.sha256}</code> ({m.package.bytes} bytes,{' '}
          {m.package.files.length} files)
        </dd>
        <dt>Commit</dt>
        <dd>
          <code>{m.repository.commit}</code>
        </dd>
        <dt>Spec</dt>
        <dd>
          v{m.spec.version} · task {m.task.key} · freeze{' '}
          {shortId(m.spec.freeze_id)}
        </dd>
        <dt>Toolchain</dt>
        <dd>
          {m.toolchain.recipe} on {m.toolchain.backend}
          {m.toolchain.python ? ` · Python ${m.toolchain.python}` : ''} · Node{' '}
          {m.toolchain.supervisor_node}
        </dd>
        <dt>Dependencies</dt>
        <dd>{m.dependencies.note}</dd>
        <dt>Start</dt>
        <dd>
          <code>{m.startup.command.join(' ')}</code> · network{' '}
          {m.startup.network} · {m.startup.requirements.join('; ')}
        </dd>
        <dt>Cost</dt>
        <dd>
          {m.costs.plan_requests
            ? `${m.costs.plan_requests.request_ids.length} ChatGPT-plan requests (${m.costs.plan_requests.model_id}, plan quota), `
            : ''}
          {m.costs.broker_calls} broker calls, {nano(m.costs.settled_nano_usd)}{' '}
          settled
          {m.costs.unsettled_attempts
            ? `, ${m.costs.unsettled_attempts} unsettled`
            : ''}
          ; local compute not metered
          {m.build.fixture_roles ? ' · fixture roles' : ''}
        </dd>
        {m.lineage.previous && (
          <>
            <dt>Revision of</dt>
            <dd>
              {shortId(m.lineage.previous.artifact_id)} after{' '}
              {m.lineage.feedback_ids.length} feedback item(s)
            </dd>
          </>
        )}
      </dl>
      <table className="tests">
        <caption>Acceptance cases</caption>
        <thead>
          <tr>
            <th scope="col">Case</th>
            <th scope="col">Arguments</th>
            <th scope="col">Build QA</th>
            <th scope="col">Exported package</th>
          </tr>
        </thead>
        <tbody>
          {m.tests.cases.map((c) => {
            const qa = m.tests.build_qa.find(
              (t) => t.check_key === c.check_key,
            );
            const pkg = m.tests.package.find(
              (t) => t.check_key === c.check_key,
            );
            return (
              <tr key={c.check_key}>
                <th scope="row">{c.check_key}</th>
                <td>
                  <code>{c.args.join(' ') || '(none)'}</code> → exit{' '}
                  {c.exit_code}
                </td>
                <td>{qa ? (qa.passed ? 'passed' : 'failed') : '—'}</td>
                <td>
                  {pkg
                    ? `${pkg.passed ? 'passed' : 'failed'} (${pkg.state})`
                    : 'not run'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4>Limitations</h4>
      <ul className="limitations">
        {m.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </details>
  );
}

function Previews({
  d,
  busy,
  stop,
}: {
  d: ArtifactDetail;
  busy: boolean;
  stop: (id: string, version: number, revoke: boolean) => void;
}) {
  if (!d.previews.length) return null;
  return (
    <div>
      <h4>Previews</h4>
      <ul className="rows">
        {d.previews.map((p) => (
          <li key={p.id}>
            <span className={`badge preview-${p.state}`}>{p.state}</span>{' '}
            {p.runs_used}/{p.max_runs} runs · expires {when(p.expires_at)}
            {p.end_reason ? ` · ${p.end_reason}` : ''}
            {(p.state === 'ready' || p.state === 'starting') && (
              <>
                {' '}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => stop(p.id, p.version, false)}
                >
                  Stop
                </button>{' '}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => stop(p.id, p.version, true)}
                >
                  Revoke access
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeedbackPanel({
  d,
  busy,
  act,
  submit,
  decide,
}: {
  d: ArtifactDetail;
  busy: boolean;
  act: (work: () => Promise<string>) => Promise<void>;
  submit: (category: Feedback['category'], text: string) => Promise<Feedback>;
  decide: (
    f: Feedback,
    decision: 'accept' | 'decline',
    rationale: string,
  ) => Promise<Feedback>;
}) {
  const desktop = useDesktopApp();
  const [category, setCategory] =
    useState<Feedback['category']>('change_request');
  const [text, setText] = useState('');
  // One "works as intended" per version: a second click would only add a duplicate note.
  const praised = d.feedback.some((f) => f.category === 'praise');
  return (
    <div className="feedback">
      <h4>Feedback on this exact version</h4>
      {praised ? (
        <p className="small">
          You recorded that this version works as intended, so trying it is
          done.
        </p>
      ) : (
        <p className="small">
          Recording feedback is what finishes trying a package. Nothing to
          change? Say so in one click.{' '}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await submit('praise', 'Tried it: works as intended.');
                return 'Recorded: works as intended.';
              })
            }
          >
            It works as intended
          </button>
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await submit(category, text.trim());
            setText('');
            return 'Feedback recorded against this manifest.';
          });
        }}
      >
        <label htmlFor="fb-cat">Kind</label>
        <select
          id="fb-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value as Feedback['category'])}
        >
          <option value="change_request">Change request</option>
          <option value="defect">Defect</option>
          <option value="question">Question</option>
          <option value="praise">Praise</option>
        </select>
        <label htmlFor="fb-text">What should change, and why?</label>
        <textarea
          id="fb-text"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="primary" disabled={busy || !text.trim()}>
          Submit feedback
        </button>
      </form>
      {d.feedback.length === 0 ? (
        <Empty>No feedback on this version.</Empty>
      ) : (
        <ul className="rows">
          {d.feedback.map((f) => (
            <li key={f.id}>
              <span className="kind">{words(f.category)}</span> {f.text}{' '}
              <span className={`badge fb-${f.status}`}>{f.status}</span>
              {f.revision && (
                <small> · became spec v{f.revision.version}</small>
              )}
              {/* Praise is an answer, not a change to accept or decline (review M-1). */}
              {f.status === 'submitted' && f.category !== 'praise' && (
                <>
                  {' '}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await decide(
                          f,
                          'accept',
                          'Owner accepted for revision',
                        );
                        return desktop
                          ? `Accepted. Revising the spec from it ${NO_CLI_IN_DESKTOP}.`
                          : 'Accepted. Revise the spec from it with pnpm cli feedback-revise.';
                      })
                    }
                  >
                    Accept
                  </button>{' '}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await decide(f, 'decline', 'Owner declined');
                        return 'Declined.';
                      })
                    }
                  >
                    Decline
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Compare({
  base,
  summary,
  all,
  open,
}: {
  base: string;
  summary: ArtifactSummary;
  all: ArtifactSummary[];
  open: (view: View, id?: string) => void;
  reloadList: () => void;
}) {
  const others = all.filter((a) => a.id !== summary.id);
  const [other, setOther] = useState(
    summary.previous_id ?? others[0]?.id ?? '',
  );
  const [result, setResult] = useState<ArtifactComparison | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setResult(null);
    setError('');
    if (!other) return;
    api(
      ArtifactComparisonSchema,
      `${base}/artifacts/${other}/compare?with=${summary.id}`,
    ).then(setResult, (e: unknown) => setError(message(e)));
  }, [other, summary.id]);
  if (!others.length) return null;
  return (
    <div className="compare-artifacts">
      <h4>Compare versions</h4>
      <label>
        Earlier version{' '}
        <select value={other} onChange={(e) => setOther(e.target.value)}>
          {others.map((a) => (
            <option key={a.id} value={a.id}>
              spec v{a.spec.version} · {a.commit.slice(0, 10)}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {result && (
        <div>
          <p className="small">
            {result.linked
              ? 'This version is a recorded revision of that one.'
              : 'Not a direct revision of that version.'}{' '}
            Spec v{result.spec_versions[0]} → v{result.spec_versions[1]};
            changed tasks: {result.changed_tasks.join(', ') || 'none'}; cost{' '}
            {nano(result.costs.base_nano_usd)} ({result.costs.base_calls} calls)
            → {nano(result.costs.candidate_nano_usd)} (
            {result.costs.candidate_calls} calls).
          </p>
          <table className="tests">
            <caption>Exported-package results</caption>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Earlier</th>
                <th scope="col">This version</th>
              </tr>
            </thead>
            <tbody>
              {result.tests.map((t) => (
                <tr key={t.check_key}>
                  <th scope="row">{t.check_key}</th>
                  <td>
                    {t.base === null
                      ? 'not defined'
                      : t.base
                        ? 'passed'
                        : 'failed'}
                  </td>
                  <td>
                    {t.candidate === null
                      ? 'not defined'
                      : t.candidate
                        ? 'passed'
                        : 'failed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small">
            Files:{' '}
            {result.files
              .filter((f) => f.change !== 'same')
              .map((f) => `${f.path} (${f.change})`)
              .join(', ') || 'identical'}
          </p>
          {result.feedback.map((f) => (
            <p key={f.id} className="small">
              From feedback: “{f.text}”
            </p>
          ))}
          <button className="text" onClick={() => open('gallery', other)}>
            Open the earlier version
          </button>
        </div>
      )}
    </div>
  );
}
