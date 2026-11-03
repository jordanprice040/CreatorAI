import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArtifactComparisonSchema,
  ArtifactDetailSchema,
  ArtifactGuideSchema,
  ArtifactSummarySchema,
  EntityDetailSchema,
  FeedbackSchema,
  PreviewSchema,
  PreviewStartSchema,
  SpecStatusSchema,
  TerminalSessionSchema,
  terminalCommand,
  z,
  type ArtifactComparison,
  type ArtifactDetail,
  type ArtifactGuide,
  type ArtifactSummary,
  type Feedback,
  type SessionInfo,
  type TerminalSession,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { SpecForm, type SpecFormMode } from './spec-form.js';
import { feedbackRevisionBlocker, feedbackSuperseded } from './spec-fields.js';
import { Empty, Status, shortId, useLoad, type View } from './ui.js';
import { newestFirst } from './versions.js';
import { argsToSend, needsExactArgs } from './terminal-args.js';

const LABELS = {
  source_archive: 'Source archive',
  runnable_demo: 'Runnable demo',
  native_installer: 'Native installer',
} as const;
const nano = (n: string) =>
  n === '0' ? '$0' : `$${(Number(n) / 1e9).toFixed(6)}`;

/**
 * Verified artifacts from the local product store. Every download, preview start and
 * terminal run is rechecked on the server against the manifest hash; generated code runs
 * only in the isolated worker, never in this page.
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
                owner={workspace.role === 'owner'}
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
  owner,
  open,
  reloadList,
}: {
  base: string;
  summary: ArtifactSummary;
  all: ArtifactSummary[];
  session: SessionInfo | null;
  owner: boolean;
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
            {d.integrity.ok &&
              d.manifest.state === 'verified' &&
              d.manifest.availability.runnable_demo.state === 'available' && (
                <TerminalPanel base={base} summary={summary} csrf={csrf} />
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
              base={base}
              session={session}
              owner={owner}
              open={open}
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

const TERMINAL_STATES: Record<TerminalSession['state'], string> = {
  running: 'Open',
  ended: 'Ended',
  stopped: 'Stopped',
  timed_out: 'Ended at 15 minutes',
  window_closed: 'Window closed',
  lost: 'Lost',
  blocked: 'Could not start',
  cleanup_required: 'Needs cleanup',
};

const duration = (seconds: number) =>
  seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;

/** A command-line option as it would be typed: `--fps FPS`, `-n, --count N`. */
export function optionUsage(o: ArtifactGuide['options'][number]): string {
  const names = o.names.join(', ');
  return o.value ? `${names} ${o.value}` : names;
}

/**
 * ADR-0059: how to use the package and which arguments it takes, beside the terminal button.
 * Steps and examples come from the frozen spec (visible cases only); the options are read
 * from the package's source text on the server, never by running it.
 */
function UsageGuide({
  base,
  summary,
  use,
}: {
  base: string;
  summary: ArtifactSummary;
  use: (args: string[]) => void;
}) {
  const guide = useLoad(
    () =>
      api(ArtifactGuideSchema, `${base}/artifacts/${summary.id}/guide`, {
        timeoutMs: 30000,
      }),
    [base, summary.id, summary.manifest_sha256],
  );
  const g = guide.data;
  return (
    <details className="usage-guide" open>
      <summary>How to use it</summary>
      {guide.loading && <p className="small">Reading the spec and source…</p>}
      {guide.error && (
        <p className="small error" role="alert">
          The guide could not be loaded: {guide.error}
        </p>
      )}
      {g && (
        <>
          {g.spec && g.spec.flows.length > 0 && (
            <>
              <h5>What it does</h5>
              <ul className="usage-flows">
                {g.spec.flows.map((f) => (
                  <li key={f.key}>
                    <strong>{f.name}</strong>
                    <ol>
                      {f.steps.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            </>
          )}
          <h5>Arguments it takes</h5>
          {g.options.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="tests usage-options">
                  <thead>
                    <tr>
                      <th scope="col">Argument</th>
                      <th scope="col">What it does</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.options.map((o) => (
                      <tr key={o.names.join(' ')}>
                        <th scope="row">
                          <code>{optionUsage(o)}</code>
                        </th>
                        <td>
                          {o.help ?? (
                            <span className="hint">No description</span>
                          )}
                          {o.required && (
                            <span className="hint"> (required)</span>
                          )}
                          {o.default !== null &&
                            !/default/i.test(o.help ?? '') && (
                              <span className="hint">
                                {' '}
                                (default {o.default})
                              </span>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small">
                {g.options_source === 'argparse'
                  ? "Read from the program's source (its argparse options), not by running it."
                  : "Found as option names in the program's source, not by running it; descriptions are not available."}
                {g.options_truncated
                  ? ' More options exist than are listed here.'
                  : ''}
                {g.help_flag && (
                  <>
                    {' '}
                    Run it with <code>--help</code> for its own description.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="small">
              No options were found in the program&apos;s source.{' '}
              {g.help_flag ? (
                <>
                  Run it with <code>--help</code> for its own description.
                </>
              ) : (
                'Try running it with no arguments.'
              )}
            </p>
          )}
          {g.spec && g.spec.examples.length > 0 && (
            <>
              <h5>
                {g.spec.examples.length === 1 ? 'Example' : 'Examples'} from the
                spec
              </h5>
              <ul className="usage-examples">
                {g.spec.examples.map((x) => (
                  <li key={x.check_key}>
                    <p>
                      <strong>{x.check_key}</strong> {x.statement}
                    </p>
                    <pre>
                      <code>{terminalCommand(x.args)}</code>
                    </pre>
                    {x.stdin && (
                      <>
                        <p className="small">Then type:</p>
                        <pre>
                          <code>{x.stdin.trimEnd()}</code>
                        </pre>
                      </>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => use(x.args)}
                    >
                      Use these arguments
                    </button>
                  </li>
                ))}
              </ul>
              {g.spec.more_examples > 0 && (
                <p className="small">
                  {g.spec.more_examples} more visible{' '}
                  {g.spec.more_examples === 1 ? 'case is' : 'cases are'} in the
                  spec.
                </p>
              )}
            </>
          )}
          {!g.spec && (
            <p className="small">
              The spec version this package was built from is not available, so
              no steps or examples can be shown.
            </p>
          )}
          {g.spec?.held_out_hidden && (
            <p className="small">
              Held-out cases are not shown; QA uses them to check the build.
            </p>
          )}
        </>
      )}
      <h5>In the terminal window</h5>
      <ul className="usage-window">
        <li>
          When the program ends, press <kbd>Enter</kbd> to run it again with the
          same arguments, or type new ones and press <kbd>Enter</kbd>. The{' '}
          <kbd>Up</kbd> arrow recalls earlier ones; type <code>.</code> to run
          with none.
        </li>
        <li>
          Type <code>q</code> to close; Stop above also closes it. Quit a run
          with the program&apos;s own keys: <kbd>Ctrl+C</kbd> may end it at
          once, before it prints a final report.
        </li>
        <li>
          Each run may take 15 minutes. The session ends after 60 minutes in
          all, 50 runs, or 10 minutes without input at the prompt; the window
          then waits for <kbd>Enter</kbd> so you can read the last screen.
        </li>
      </ul>
    </details>
  );
}
/**
 * ADR-0058: run the verified package interactively in a console window on this computer,
 * inside the isolated worker. The owner confirms the exact command every time.
 */
function TerminalPanel({
  base,
  summary,
  csrf,
}: {
  base: string;
  summary: ArtifactSummary;
  csrf: string;
}) {
  const path = `${base}/artifacts/${summary.id}/terminals`;
  const sessions = useLoad(
    () => api(z.array(TerminalSessionSchema), path),
    [path],
  );
  const [text, setText] = useState('');
  const [example, setExample] = useState<{
    args: string[];
    text: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const open = sessions.data?.some((x) => x.state === 'running') ?? false;
  const reloadRef = useRef(sessions.reload);
  reloadRef.current = sessions.reload;
  const reload = () => reloadRef.current();
  // While a window is open, follow it so the list shows when it ends.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => reloadRef.current(), 3000);
    return () => clearInterval(t);
  }, [open]);
  const args = argsToSend(text, example);
  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      reload();
    }
  }
  return (
    <section className="terminal-panel" aria-labelledby="term-title">
      <h4 id="term-title">Run in a terminal</h4>
      <p className="small">
        Opens a terminal window on this computer and runs this exact package
        there, in the isolated worker: no network, no studio files. Use it for
        programs that need you at the keyboard. What it prints stays in the
        window and is not saved; these runs are your own tries, not test
        results.
      </p>
      <UsageGuide
        base={base}
        summary={summary}
        use={(a) => {
          setText(a.join('\n'));
          setExample({ args: a, text: a.join('\n') });
          setConfirming(false);
          setError('');
          setNotice(
            needsExactArgs(a)
              ? 'Arguments filled in below. One of them is empty or has a line break, so it is sent exactly as in the spec while the box is unchanged.'
              : 'Arguments filled in below.',
          );
        }}
      />
      {!confirming ? (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setError('');
            setNotice('');
            setConfirming(true);
          }}
        >
          <label htmlFor={`term-args-${summary.id}`}>
            Arguments, one per line (optional)
          </label>
          <textarea
            id={`term-args-${summary.id}`}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="actions">
            <button className="primary" disabled={busy || !csrf || open}>
              Run in a terminal…
            </button>
            {open && (
              <span className="small">
                A terminal for this product is open. Stop it or close its window
                first.
              </span>
            )}
          </div>
        </form>
      ) : (
        <div className="notice" role="group" aria-label="Confirm terminal run">
          <p>
            <strong>Run this in an isolated terminal window?</strong>
          </p>
          <pre>
            <code>{terminalCommand(args)}</code>
          </pre>
          <p className="small">
            Package {summary.archive_sha256.slice(0, 12)}… · the window opens on
            this computer.
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !csrf}
              onClick={() =>
                void run(async () => {
                  const r = await api(TerminalSessionSchema, path, {
                    body: {
                      manifest_sha256: summary.manifest_sha256,
                      args,
                    },
                    csrf,
                    timeoutMs: 30000,
                  });
                  setConfirming(false);
                  return r.state === 'running'
                    ? "The terminal window is open. If you don't see it, check the taskbar."
                    : `${TERMINAL_STATES[r.state]}: ${r.reason ?? ''}`;
                })
              }
            >
              Open terminal
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
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
      {sessions.data && sessions.data.length > 0 && (
        <ul className="rows" aria-label="Recent terminal runs">
          {sessions.data.slice(0, 5).map((x) => (
            <li key={x.id}>
              <span className={`badge terminal-${x.state}`}>
                {TERMINAL_STATES[x.state]}
              </span>{' '}
              <code>{x.command}</code> · {when(x.started_at)}
              {(x.run_count ?? 1) > 1 ? ` · ${x.run_count} runs` : ''}
              {x.exit_code !== null
                ? ` · ${(x.run_count ?? 1) > 1 ? 'last ' : ''}exit ${x.exit_code}`
                : ''}
              {x.reason && x.state !== 'ended' ? ` · ${x.reason}` : ''}
              {x.runs && x.runs.length > 1 && (
                <details className="terminal-runs">
                  <summary>Runs in this window</summary>
                  <ol>
                    {x.runs.map((r, i) => (
                      <li key={i}>
                        <code>{terminalCommand(r.args)}</code> · exit{' '}
                        {r.exit_code ?? '—'} · {duration(r.seconds)}
                      </li>
                    ))}
                  </ol>
                  {(x.run_count ?? 0) > x.runs.length && (
                    <p className="small">
                      Only the last {x.runs.length} of {x.run_count} runs are
                      kept.
                    </p>
                  )}
                </details>
              )}
              {x.state === 'running' && (
                <>
                  {' '}
                  <button
                    className="secondary"
                    disabled={busy || !csrf}
                    onClick={() =>
                      void run(async () => {
                        const r = await api(
                          TerminalSessionSchema,
                          `${base}/terminals/${x.id}/stop`,
                          {
                            body: { artifact_id: summary.id },
                            csrf,
                            timeoutMs: 15000,
                          },
                        );
                        return `Terminal ${TERMINAL_STATES[r.state].toLowerCase()}.`;
                      })
                    }
                  >
                    Stop
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {sessions.error && (
        <p className="small error" role="alert">
          {sessions.error}
        </p>
      )}
    </section>
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
  base,
  session,
  owner,
  open,
  busy,
  act,
  submit,
  decide,
}: {
  d: ArtifactDetail;
  base: string;
  session: SessionInfo | null;
  owner: boolean;
  open: (view: View, id?: string) => void;
  busy: boolean;
  act: (work: () => Promise<string>) => Promise<void>;
  submit: (category: Feedback['category'], text: string) => Promise<Feedback>;
  decide: (
    f: Feedback,
    decision: 'accept' | 'decline',
    rationale: string,
  ) => Promise<Feedback>;
}) {
  const [category, setCategory] =
    useState<Feedback['category']>('change_request');
  const [text, setText] = useState('');
  // One "works as intended" per version: a second click would only add a duplicate note.
  const praised = d.feedback.some((f) => f.category === 'praise');
  // The spec form for one accepted item, and why another item can't open it (audit L-8).
  const [revising, setRevising] = useState<
    (SpecFormMode & { kind: 'revise' }) | null
  >(null);
  const [blocked, setBlocked] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [loading, setLoading] = useState('');
  async function startRevision(f: Feedback) {
    setBlocked(null);
    setLoading(f.id);
    try {
      const [spec, detail] = await Promise.all([
        api(SpecStatusSchema, `${base}/specs/${f.spec.id}`),
        api(EntityDetailSchema, `${base}/entities/${f.spec.id}`),
      ]);
      const entity = detail.entity;
      const why =
        entity.version === spec.spec.version
          ? feedbackRevisionBlocker(
              f,
              {
                status: spec.spec.status,
                version: spec.spec.version,
                format: entity.body?.format,
              },
              owner,
            )
          : 'The spec changed while it was loading. Try again.';
      if (why) setBlocked({ id: f.id, text: why });
      else
        setRevising({
          kind: 'revise',
          spec,
          entity,
          feedback: {
            id: f.id,
            version: f.version,
            text: f.text,
            others: d.feedback
              .filter(
                (x) =>
                  x.id !== f.id &&
                  x.status === 'accepted' &&
                  x.spec.version === f.spec.version,
              )
              .map((x) => x.text),
          },
        });
    } catch (e) {
      setBlocked({ id: f.id, text: message(e) });
    } finally {
      setLoading('');
    }
  }
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
                        return owner
                          ? 'Accepted. Press “Revise the spec from this feedback” to write the next spec version.'
                          : 'Accepted. The workspace owner can now revise the spec from it.';
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
              {f.status === 'accepted' &&
                session &&
                owner &&
                !feedbackSuperseded(f, d.feedback) &&
                revising?.feedback?.id !== f.id && (
                  <>
                    {' '}
                    <button
                      className="secondary"
                      disabled={busy || loading === f.id || Boolean(revising)}
                      onClick={() => void startRevision(f)}
                    >
                      {loading === f.id
                        ? 'Opening the spec…'
                        : 'Revise the spec from this feedback'}
                    </button>
                  </>
                )}
              {owner && feedbackSuperseded(f, d.feedback) && (
                <p className="small" role="status">
                  {feedbackSuperseded(f, d.feedback)}{' '}
                  <button
                    type="button"
                    className="text"
                    onClick={() => open('build')}
                  >
                    Open Build
                  </button>
                </p>
              )}
              {blocked?.id === f.id && (
                <p className="small" role="status">
                  {blocked.text}{' '}
                  <button
                    type="button"
                    className="text"
                    onClick={() => open('build')}
                  >
                    Open Build
                  </button>
                </p>
              )}
              {revising?.feedback?.id === f.id && session && (
                <SpecForm
                  key={`fb:${f.id}:${revising.spec.spec.version}`}
                  base={base}
                  session={session}
                  mode={revising}
                  cancel={() => setRevising(null)}
                  openBuild={() => open('build')}
                  saved={(s) => {
                    setRevising(null);
                    // The panel's notice outlives the reload that shows "became spec vN".
                    void act(
                      async () =>
                        `${s.spec.title} v${s.spec.version} saved from this feedback.${s.problems.length ? ` Fix before freezing: ${s.problems.map((p) => p.detail).join(' ')}` : ' Freeze it under Scores and specs, then build it on Build.'}`,
                    );
                  }}
                />
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
