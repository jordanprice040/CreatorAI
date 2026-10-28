import { useEffect, useRef, useState } from 'react';
import {
  z,
  CREDITS_OFF_STATEMENT,
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  type PlanConnection,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { NO_CLI_IN_DESKTOP, useDesktopApp } from './desktop-app.js';
import { usePageActive } from './page-drafts.js';

// §2.2 Models and connections. Sign-in, model access and task qualification are shown as
// separate states; nothing here can enable credits or a paid fallback. A Claude Code
// connection (ADR-0050) uses the owner's own signed-in Claude Code on this computer: the
// studio never offers Claude sign-in or holds a Claude credential, it only checks status.

const Detail = PlanConnectionDetailSchema.extend({
  sign_in_attempt: z
    .discriminatedUnion('state', [
      z.object({ state: z.literal('pending'), started_at: z.string() }),
      z.object({
        state: z.literal('completed'),
        plan_usage_granted: z.boolean(),
        finished_at: z.string(),
      }),
      z.object({
        state: z.literal('failed'),
        code: z.string(),
        message: z.string(),
        finished_at: z.string(),
      }),
    ])
    .nullable(),
});
type DetailT = z.infer<typeof Detail>;
const PROPOSED_SETTINGS = {
  format: 'chatgpt-plan-settings/1',
  plan_type: 'plus',
  shared_allowance_note:
    "ChatGPT Plus: the five-hour usage allowance is shared with Jordan's personal ChatGPT and Codex use. Credits after the limit stay off for Creator Agent.",
  allowed_data_classes: ['synthetic', 'public'],
  allowed_task_classes: ['summarization', 'specification'],
  caps: {
    responses: {
      max_requests_per_run: 10,
      request_timeout_ms: 120000,
      max_output_chars: 16000,
      max_input_chars: 24000,
    },
    codex: {
      max_builds_per_day: 2,
      max_turns_per_build: 1,
      max_model_requests_per_build: 25,
      build_timeout_ms: 600000,
    },
    shared: { max_model_requests_per_day: 40, max_in_flight: 1 },
  },
} as const;

const PROPOSED_CLAUDE_SETTINGS = {
  format: 'chatgpt-plan-settings/1',
  plan_type: 'unknown',
  shared_allowance_note:
    "Claude Pro/Max: the five-hour and weekly usage limits are shared with Jordan's own Claude and Claude Code use. Extra usage after the limit stays off.",
  allowed_data_classes: ['synthetic', 'public'],
  allowed_task_classes: ['summarization', 'specification'],
  caps: {
    responses: {
      max_requests_per_run: 10,
      request_timeout_ms: 180000,
      max_output_chars: 16000,
      max_input_chars: 24000,
    },
    codex: {
      max_builds_per_day: 0,
      max_turns_per_build: 1,
      max_model_requests_per_build: 1,
      build_timeout_ms: 60000,
    },
    shared: { max_model_requests_per_day: 30, max_in_flight: 1 },
  },
} as const;

const SIGN_IN_TEXT: Record<PlanConnection['sign_in']['state'], string> = {
  not_signed_in: 'Not signed in',
  signed_in: 'Signed in',
  reauthorization_required: 'Sign in again',
  signed_out: 'Signed out',
};

export function Models({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
}) {
  const desktop = useDesktopApp();
  const base = `workspaces/${workspace.id}`;
  const active = usePageActive();
  const [loaded, setLoaded] = useState(false);
  const [list, setList] = useState<PlanConnection[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<DetailT | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkedOn, setCheckedOn] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [confirmCredits, setConfirmCredits] = useState(false);
  const [model, setModel] = useState('');
  const [grantId, setGrantId] = useState('');
  const [grantCheck, setGrantCheck] = useState<
    'model_access' | 'availability_recheck'
  >('model_access');
  const [grantModel, setGrantModel] = useState('');
  const [claudeFolder, setClaudeFolder] = useState('');
  const loadSequence = useRef(0);
  async function load(id = selected) {
    const sequence = ++loadSequence.current;
    const [rows, next] = await Promise.all([
      api(z.array(PlanConnectionSchema), `${base}/plan-connections`),
      id
        ? api(Detail, `${base}/plan-connections/${id}`)
        : Promise.resolve(null),
    ]);
    if (sequence !== loadSequence.current) return;
    setList(rows);
    setLoaded(true);
    setDetail(next);
    if (!id && rows[0]) {
      setSelected(rows[0].id);
      await load(rows[0].id);
    }
  }
  useEffect(() => {
    if (!active || !session) return;
    setSelected('');
    setDetail(null);
    setLoaded(false);
    setError('');
    load('').catch((e) => setError(message(e)));
    return () => {
      loadSequence.current++;
    };
  }, [workspace.id, session?.actor_id, active]);
  useEffect(() => {
    if (!active || !session || !selected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        await load(selected);
      } catch (e) {
        if (!stopped) setError(message(e));
      }
      if (!stopped) timer = setTimeout(refresh, 2000);
    };
    timer = setTimeout(refresh, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      loadSequence.current++;
    };
  }, [workspace.id, selected, active, session?.actor_id]);
  async function act(path: string, body: unknown, timeoutMs = 5000) {
    if (!session) return null;
    setBusy(true);
    setError('');
    try {
      const out = await api(z.unknown(), `${base}/${path}`, {
        body,
        csrf: session.csrf_token,
        timeoutMs,
      });
      await load();
      return out;
    } catch (e) {
      setError(message(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  const c = detail?.connection;
  const attempt = detail?.sign_in_attempt;
  const p = c ? `plan-connections/${c.id}` : '';
  const claude = c?.kind === 'claude_code';
  const usageStatement = claude
    ? CLAUDE_EXTRA_USAGE_OFF_STATEMENT
    : CREDITS_OFF_STATEMENT;
  const hasKind = (k: PlanConnection['kind']) => list.some((x) => x.kind === k);
  return (
    <section className="panel" aria-labelledby="models-title">
      <h2 id="models-title">Models and connections</h2>
      <p>
        Creator Agent uses a model only through a connection you approve here.
        Signing in, verifying a model and qualifying it for a kind of task are
        separate steps, and each is recorded.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        className="secondary"
        disabled={busy || !session}
        onClick={() => void load().catch((e) => setError(message(e)))}
      >
        Refresh connection status
      </button>
      <h3>Other routes</h3>
      <ul>
        <li>
          OpenAI API key: used only when the API's live opt-in and a verified
          model registry entry are set. This screen does not change it.
        </li>
        <li>Local models (Ollama): not available yet.</li>
      </ul>
      <h3>Plan connections</h3>
      <p>
        These use the usage included in a plan you already pay for, with no
        per-request charge, while extra paid usage stays off.
      </p>
      {!loaded && <p role="status">Loading saved connections…</p>}
      {loaded && (!hasKind('chatgpt_plan') || !hasKind('claude_code')) && (
        <div className="actions">
          {!hasKind('chatgpt_plan') && (
            <button
              disabled={busy || !session}
              onClick={() =>
                void act('plan-connections', {
                  kind: 'chatgpt_plan',
                  label: 'ChatGPT plan',
                  settings: PROPOSED_SETTINGS,
                })
              }
            >
              Add a ChatGPT plan connection
            </button>
          )}
          {!hasKind('claude_code') && (
            <button
              className={list.length ? 'secondary' : undefined}
              disabled={busy || !session}
              onClick={() =>
                void act('plan-connections', {
                  kind: 'claude_code',
                  label: 'Claude Code on this computer',
                  settings: PROPOSED_CLAUDE_SETTINGS,
                })
              }
            >
              Add Claude Code on this computer
            </button>
          )}
        </div>
      )}
      {list.length > 1 && (
        <label>
          Connection
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              load(e.target.value).catch((x) => setError(message(x)));
            }}
          >
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
                {x.kind === 'claude_code' ? ' (Claude)' : ' (ChatGPT)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {c && detail && (
        <>
          {attempt?.state === 'pending' && (
            <p role="status">
              Waiting for ChatGPT sign-in to finish. Complete the browser step,
              then return here.
            </p>
          )}
          {attempt?.state === 'failed' && (
            <p role="alert">
              ChatGPT sign-in failed ({attempt.code}): {attempt.message}
            </p>
          )}
          {claude &&
            !(
              c.sign_in.state === 'signed_in' && c.sign_in.plan_usage_granted
            ) && (
              <fieldset>
                <legend>Sign in to Claude Code yourself</legend>
                <p>
                  Creator Agent never asks for your Claude password or token.
                  Claude Code keeps its own sign-in in a folder used only for
                  the studio, so your personal Claude Code settings, plugins and
                  history are not used. Press <b>Check Claude Code</b> to see
                  that folder, then sign in once in PowerShell:
                </p>
                <pre>
                  <code>
                    {`$env:CLAUDE_CONFIG_DIR = "${claudeFolder || '<folder shown after the check>'}"\nclaude auth login\nRemove-Item Env:CLAUDE_CONFIG_DIR`}
                  </code>
                </pre>
                <p>
                  The last line puts that PowerShell window back on your own
                  Claude Code. Choose your Claude account (not Console), then
                  check again. An API key or long-lived token is refused so
                  nothing is billed outside your plan.
                </p>
              </fieldset>
            )}
          <dl>
            <dt>Sign-in</dt>
            <dd>
              {claude && c.sign_in.state === 'not_signed_in'
                ? 'Not checked or not signed in'
                : SIGN_IN_TEXT[c.sign_in.state]}
              {c.sign_in.account_label ? ` · ${c.sign_in.account_label}` : ''}
              {c.sign_in.state === 'signed_in' && !c.sign_in.plan_usage_granted
                ? claude
                  ? ' · not a Claude subscription login'
                  : ' · plan usage was not granted'
                : ''}
              {claude && c.sign_in.issued_client_id
                ? ` · ${c.sign_in.issued_client_id.replace('/', ' ')}`
                : ''}
              {claude && c.sign_in.verified_at
                ? ` · checked ${new Date(c.sign_in.verified_at).toLocaleString()}`
                : ''}
            </dd>
            {c.status_reason && (
              <>
                <dt>Note</dt>
                <dd>{c.status_reason}</dd>
              </>
            )}
            <dt>{claude ? 'Account status' : 'Plan eligibility'}</dt>
            <dd>{c.eligibility.state.replaceAll('_', ' ')}</dd>
            <dt>Usage allowance</dt>
            <dd>
              {c.quota.state.replaceAll('_', ' ')} · shared with your own{' '}
              {claude ? 'Claude and Claude Code' : 'ChatGPT and Codex'} use ·{' '}
              <a
                href={
                  claude
                    ? 'https://claude.ai/settings/usage'
                    : 'https://chatgpt.com/settings/usage'
                }
                target="_blank"
                rel="noreferrer"
              >
                {claude ? 'Claude usage settings' : 'ChatGPT usage settings'}
              </a>
            </dd>
            <dt>
              {claude
                ? 'Extra usage after the limit'
                : 'Credits after the limit'}
            </dt>
            <dd>
              {c.credits.state === 'confirmed_off'
                ? `Confirmed off on ${c.credits.checked_on ?? ''}`
                : 'Not confirmed off · inference is blocked'}
            </dd>
            <dt>Caps</dt>
            <dd>
              {c.caps_accepted_at ? 'Accepted' : 'Proposed, not accepted'} ·{' '}
              {c.settings.caps.shared.max_model_requests_per_day} requests a day
              · {c.settings.caps.responses.max_requests_per_run} per run ·{' '}
              {Math.round(c.settings.caps.responses.request_timeout_ms / 1000)}s
              timeout · {c.settings.caps.responses.max_output_chars} output
              characters
              {claude
                ? ''
                : ` · ${c.settings.caps.codex.max_builds_per_day} Codex builds a day`}
            </dd>
            <dt>Allowed</dt>
            <dd>
              {c.settings.allowed_data_classes.join(', ')} data ·{' '}
              {c.settings.allowed_task_classes.join(', ')}
            </dd>
          </dl>
          {detail.blockers.length > 0 && (
            <>
              <h4>Why model calls are blocked</h4>
              <ul>
                {detail.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </>
          )}
          <div className="actions">
            {claude ? (
              <button
                disabled={busy || !session}
                onClick={async () => {
                  const out = (await act(
                    `${p}/claude-code-check`,
                    {},
                    60000,
                  )) as { config_dir?: string } | null;
                  if (out?.config_dir) setClaudeFolder(out.config_dir);
                }}
              >
                Check Claude Code
              </button>
            ) : (
              <button
                disabled={busy || !session || attempt?.state === 'pending'}
                onClick={() =>
                  void act(`${p}/sign-in`, { open_browser: true }, 20000)
                }
              >
                {c.sign_in.state === 'signed_in'
                  ? 'Sign in again'
                  : 'Continue with ChatGPT'}
              </button>
            )}
            {!c.caps_accepted_at && (
              <button
                disabled={busy || !session}
                onClick={() =>
                  void act(`${p}/accept-caps`, {
                    expected_version: c.version,
                    settings_hash: c.settings_hash,
                  })
                }
              >
                Accept these caps
              </button>
            )}
            {c.sign_in.state === 'signed_in' && (
              <button
                className="secondary"
                disabled={busy || !session}
                onClick={() => void act(`${p}/sign-out`, {})}
              >
                Disconnect
              </button>
            )}
          </div>
          {c.credits.state !== 'confirmed_off' ? (
            <fieldset>
              <legend>
                {claude
                  ? 'Confirm extra usage is off'
                  : 'Confirm credits are off'}
              </legend>
              <p>
                {claude
                  ? 'Open Claude Settings, then Usage, and make sure extra usage (usage credits) is turned off, so reaching your plan limit stops requests instead of charging you.'
                  : 'Open ChatGPT Settings, then Usage, and make sure Creator Agent is not allowed to use credits after reaching plan limits.'}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmCredits}
                  onChange={(e) => setConfirmCredits(e.target.checked)}
                />{' '}
                {usageStatement}
              </label>
              <label>
                Checked on
                <input
                  type="date"
                  value={checkedOn}
                  onChange={(e) => setCheckedOn(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !session || !confirmCredits}
                onClick={() =>
                  void act(`${p}/credits`, {
                    expected_version: c.version,
                    statement: usageStatement,
                    checked_on: checkedOn,
                  })
                }
              >
                Record confirmation
              </button>
            </fieldset>
          ) : (
            <button
              className="secondary"
              disabled={busy || !session}
              onClick={() =>
                void act(`${p}/credits-withdraw`, {
                  expected_version: c.version,
                  reason: claude
                    ? 'Owner withdrew the extra-usage confirmation.'
                    : 'Owner withdrew the credits confirmation.',
                })
              }
            >
              {claude
                ? 'Withdraw extra-usage confirmation'
                : 'Withdraw credits confirmation'}
            </button>
          )}
          <h4>Model access</h4>
          {detail.model_access.length ? (
            <ul>
              {detail.model_access.map((a) => (
                <li key={`${a.model_id}-${a.path}`}>
                  {a.model_id} · {a.path} · {a.access}
                </li>
              ))}
            </ul>
          ) : (
            <p>No model has been checked on this connection.</p>
          )}
          <fieldset>
            <legend>One approved model check</legend>
            <p>
              Approving allows exactly one short request (“Reply with exactly:
              ok”) to the model you name, within 30 minutes. Already-verified
              models use an availability recheck, preserving their recorded
              access and task qualifications. This uses one plan request and
              does not start a workflow.
            </p>
            <label>
              Model
              <input
                value={model}
                placeholder={
                  claude ? 'Full model id, e.g. claude-sonnet-5-5' : ''
                }
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <button
              disabled={
                busy || !session || !model || detail.blockers.length > 0
              }
              onClick={async () => {
                const intent = detail.model_access.some(
                  (a) =>
                    a.model_id === model &&
                    a.path === 'responses' &&
                    a.access === 'verified',
                )
                  ? 'availability_recheck'
                  : 'model_access';
                const g = (await act(`${p}/verification-grants`, {
                  expected_version: c.version,
                  model_id: model,
                  path: 'responses',
                  expires_in_minutes: 30,
                  intent,
                })) as { id?: string } | null;
                if (g?.id) {
                  setGrantId(g.id);
                  setGrantCheck(intent);
                  setGrantModel(model);
                }
              }}
            >
              Approve one call
            </button>
            {grantId && (
              <button
                disabled={busy || !session}
                onClick={() =>
                  void act(
                    `${p}/${grantCheck === 'availability_recheck' ? 'availability-recheck' : 'verify'}`,
                    { grant_id: grantId, model_id: grantModel },
                    330000,
                  )
                }
              >
                {grantCheck === 'availability_recheck'
                  ? 'Recheck availability once'
                  : 'Run the verification call'}
              </button>
            )}
          </fieldset>
          <h4>Qualified tasks</h4>
          {detail.qualifications.length ? (
            <ul>
              {detail.qualifications.map((q) => (
                <li key={q.id}>
                  {q.model_id} · {q.task_class} · {q.state}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No qualification yet.{' '}
              {desktop ? (
                <>Starting one {NO_CLI_IN_DESKTOP}.</>
              ) : (
                <>
                  Start one from the CLI with a frozen benchmark manifest (
                  <code>pnpm cli plan-qualify</code>).
                </>
              )}
            </p>
          )}
          <h4>Recent requests</h4>
          <p>
            {detail.usage.last_24h_requests} in the last 24 hours ·{' '}
            {detail.usage.in_flight} running · {detail.usage.unresolved} with an
            unknown outcome
          </p>
        </>
      )}
    </section>
  );
}
