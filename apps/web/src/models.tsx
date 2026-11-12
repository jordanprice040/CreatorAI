import { useEffect, useRef, useState } from 'react';
import {
  z,
  CREDITS_OFF_STATEMENT,
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  planWaitMs,
  type PlanConnection,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message } from './oversight.js';
import { STALE_NOTE } from './owner-actions.js';
import { usePageActive } from './page-drafts.js';
import { QualificationResults } from './qualification-results.js';
import { QualifyModel } from './qualify.js';
import { rowLatest } from './qualification-role.js';
import { useModelChoice } from './model-switch.js';
import {
  capChanges,
  capHint,
  capFieldsFor,
  capsLine,
  capsToDraft,
  classChanges,
  classErrors,
  classSummary,
  DATA_CLASS_CHOICES,
  defaultTaskClasses,
  missingTaskClasses,
  orderedClasses,
  taskChoicesFor,
  draftToCaps,
} from './caps-fields.js';
import { ChatAnswersCard } from './chat-answers.js';
import { OpenRequests } from './open-requests.js';
import { ApiKeyCheck } from './api-key-check-panel.js';
import { AllowTasks } from './allow-tasks.js';
import { DailyCapNotice } from './extra-requests.js';

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
  // ADR-0084 (Decision A): every task this kind can take; the owner can untick any.
  allowed_task_classes: defaultTaskClasses('chatgpt_plan'),
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
  // ADR-0084 (Decision A): every task Claude Code can take, so no code build.
  allowed_task_classes: defaultTaskClasses('claude_code'),
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
  const base = `workspaces/${workspace.id}`;
  // PR #118 review L1: every connection change is owner-only on the server, so the actions are
  // offered to the owner only; other members see the state.
  const owner = workspace.role === 'owner';
  const choice = useModelChoice(workspace);
  const active = usePageActive();
  const [loaded, setLoaded] = useState(false);
  const [list, setList] = useState<PlanConnection[]>([]);
  const [selected, setSelected] = useState('');
  const [detail, setDetail] = useState<DetailT | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // "Usage has reset" error and request, per connection (PR #129 review N-2).
  const [quotaError, setQuotaError] = useState({ id: '', text: '' });
  const [quotaBusy, setQuotaBusy] = useState(false);
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
  // "Change caps" draft: kept apart from the 2 s refresh so typing is never overwritten.
  const [capsDraft, setCapsDraft] = useState<{
    connection_id: string;
    settings_hash: string;
    values: Record<string, string>;
    /** Allowed data and task classes (full audit 2026-11-02). */
    data: string[];
    tasks: string[];
  } | null>(null);
  const [capsErrors, setCapsErrors] = useState<Record<string, string>>({});
  // P23 (handed over from P26): each Refresh press also reloads the Chat answers card, even
  // when nothing in the connection list changed (a model verified elsewhere, for example).
  const [refreshes, setRefreshes] = useState(0);
  const loadSequence = useRef(0);
  async function load(id = selected) {
    const sequence = ++loadSequence.current;
    // PR #125 review N-2: a failed read of the open connection no longer keeps the list from
    // updating; the list is shown, and the error after it.
    let failed: unknown = null;
    const [rows, next] = await Promise.all([
      api(z.array(PlanConnectionSchema), `${base}/plan-connections`),
      id
        ? api(Detail, `${base}/plan-connections/${id}`).catch((e: unknown) => {
            failed = e;
            return null;
          })
        : Promise.resolve(null),
    ]);
    if (sequence !== loadSequence.current) return;
    setList(rows);
    setLoaded(true);
    if (failed) {
      // The open connection is gone from the list: open the first one instead.
      if (!rows.some((r) => r.id === id) && rows[0]) {
        setSelected(rows[0].id);
        await load(rows[0].id);
        return;
      }
      throw failed;
    }
    setDetail(next);
    if (!id && rows[0]) {
      setSelected(rows[0].id);
      await load(rows[0].id);
    }
  }
  // Read when first shown and again on each return (audit L-10). A return keeps the open
  // connection and what is on screen; only a new workspace or person starts over.
  const loadedFor = useRef('');
  useEffect(() => {
    if (!active || !session) return;
    const key = `${workspace.id}:${session.actor_id}`;
    const again = loadedFor.current === key;
    loadedFor.current = key;
    if (!again) {
      setSelected('');
      setDetail(null);
      setLoaded(false);
    }
    setError('');
    load(again ? selected : '').catch((e) => setError(message(e)));
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
  /**
   * Posts one action and reloads. With `local`, the error goes to the caller instead of the
   * page-level alert, and the page is not locked (a qualification run can take an hour).
   */
  async function act(
    path: string,
    body: unknown,
    timeoutMs = 5000,
    local?: (error: string) => void,
  ) {
    if (!session) return null;
    if (!local) setBusy(true);
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
      // PR #129 re-review N-6: a stale version is read again, so a retry sends the current one
      // instead of failing the same way until the page is refreshed.
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        await load().catch(() => {});
        (local ?? setError)(message(e) + STALE_NOTE);
      } else (local ?? setError)(message(e));
      return null;
    } finally {
      if (!local) setBusy(false);
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
        onClick={() => {
          setRefreshes((n) => n + 1);
          void load().catch((e) => setError(message(e)));
        }}
      >
        Refresh connection status
      </button>
      <ChatAnswersCard
        workspace={workspace}
        session={session}
        // What changes this stamp makes the card reload its connection details: a connection's
        // version, caps acceptance, sign-in or credits, or a Refresh press. Empty while there is
        // nothing to read and Refresh was not pressed, so the card's own first read is not
        // repeated (review of PR #172, N-4).
        stamp={
          list.length || refreshes
            ? `${refreshes}#${list
                .map(
                  (x) =>
                    `${x.id}:${x.version}:${x.caps_accepted_at ?? ''}:${x.sign_in.state}:${x.credits.state}`,
                )
                .join('|')}`
            : ''
        }
        onChanged={() => void load().catch((e) => setError(message(e)))}
      />
      <h3>Other routes</h3>
      <ApiKeyCheck workspace={workspace} session={session} />
      <p>Local models (Ollama): not available yet.</p>
      <h3>Plan connections</h3>
      <p>
        These use the usage included in a plan you already pay for, with no
        per-request charge, while extra paid usage stays off.
      </p>
      {!loaded && <p role="status">Loading saved connections…</p>}
      {!owner && (
        <p className="small">
          Only the workspace owner can add connections, sign in, change caps or
          allowed work, approve model checks and qualify models. You can see
          where each connection stands.
        </p>
      )}
      {loaded &&
        owner &&
        (!hasKind('chatgpt_plan') || !hasKind('claude_code')) && (
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
          {/* PR #118 re-review N-a: only the owner has Check Claude Code and signs in. */}
          {claude &&
            owner &&
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
                rel="noopener noreferrer"
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
              {capsLine(c.kind, c.settings.caps)}
            </dd>
            <dt>Allowed</dt>
            <dd>
              {classSummary(
                c.settings.allowed_data_classes,
                c.settings.allowed_task_classes,
              )}
              {owner &&
                missingTaskClasses(c.kind, c.settings.allowed_task_classes)
                  .length > 0 && (
                  <>
                    {' '}
                    <AllowTasks
                      connection={c}
                      tasks={missingTaskClasses(
                        c.kind,
                        c.settings.allowed_task_classes,
                      )}
                      label="Allow all tasks"
                      busy={busy || !session}
                      act={act}
                      onError={setError}
                    />
                  </>
                )}
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
          {/* ADR-0064: shown before the forms, since it blocks every request here. */}
          <OpenRequests
            connection={c}
            open={detail.open_requests}
            owner={owner}
            busy={busy || !session}
            act={act}
          />
          {owner && (
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
                  Accept these caps and allowed work
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
              {capsDraft?.connection_id !== c.id && (
                <button
                  className="secondary"
                  disabled={busy || !session}
                  onClick={() => {
                    setCapsErrors({});
                    setCapsDraft({
                      connection_id: c.id,
                      settings_hash: c.settings_hash,
                      values: capsToDraft(c.settings.caps),
                      data: [...c.settings.allowed_data_classes],
                      tasks: [...c.settings.allowed_task_classes],
                    });
                  }}
                >
                  Change caps or allowed work
                </button>
              )}
            </div>
          )}
          {owner &&
            capsDraft?.connection_id === c.id &&
            (() => {
              const fields = capFieldsFor(c.kind);
              const stale = capsDraft.settings_hash !== c.settings_hash;
              const parsed = draftToCaps(
                c.settings.caps,
                capsDraft.values,
                c.kind,
              );
              const taskChoices = taskChoicesFor(c.kind);
              const data = orderedClasses(DATA_CLASS_CHOICES, capsDraft.data);
              const tasks = orderedClasses(taskChoices, capsDraft.tasks);
              const classIssues = classErrors(data, tasks, c.kind);
              const changes = parsed.caps
                ? [
                    ...capChanges(c.settings.caps, parsed.caps, c.kind),
                    ...classChanges(
                      {
                        data: c.settings.allowed_data_classes,
                        tasks: c.settings.allowed_task_classes,
                      },
                      { data, tasks },
                    ),
                  ]
                : [];
              const toggle = (
                field: 'data' | 'tasks',
                key: string,
                on: boolean,
              ) =>
                setCapsDraft((d) =>
                  d
                    ? {
                        ...d,
                        [field]: on
                          ? [...d[field], key]
                          : d[field].filter((k) => k !== key),
                      }
                    : d,
                );
              return (
                <form
                  className="caps-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (stale) return;
                    if (!parsed.caps || Object.keys(classIssues).length) {
                      setCapsErrors({
                        ...(parsed.caps ? {} : parsed.errors),
                        ...classIssues,
                      });
                      return;
                    }
                    setCapsErrors({});
                    const out = await act(`${p}/settings`, {
                      expected_version: c.version,
                      settings: {
                        ...c.settings,
                        caps: parsed.caps,
                        allowed_data_classes: data,
                        allowed_task_classes: tasks,
                      },
                    });
                    if (out) setCapsDraft(null);
                  }}
                >
                  <fieldset>
                    <legend>Change caps or allowed work</legend>
                    <p>
                      These are Creator Agent's own limits for this connection.
                      Your plan can still refuse requests on its own allowance.
                      Saving withdraws your acceptance, so model calls stay
                      blocked until you accept the new caps.
                    </p>
                    {(
                      [
                        [
                          'data',
                          'Data it may receive',
                          DATA_CLASS_CHOICES,
                          capsDraft.data,
                        ],
                        [
                          'tasks',
                          'Tasks it may do',
                          taskChoices,
                          capsDraft.tasks,
                        ],
                      ] as const
                    ).map(([field, title, choices, ticked]) => (
                      <fieldset
                        key={field}
                        className="class-choices"
                        aria-describedby={
                          capsErrors[field]
                            ? `caps-${c.id}-${field}-error`
                            : undefined
                        }
                      >
                        <legend>{title}</legend>
                        {field === 'tasks' && (
                          // ADR-0084: tasks only. Data classes stay one by one, so approved
                          // private data is never ticked by a bulk choice.
                          <div className="actions">
                            <button
                              type="button"
                              className="text"
                              disabled={ticked.length === choices.length}
                              onClick={() => {
                                setCapsDraft((d) =>
                                  d
                                    ? { ...d, tasks: choices.map((x) => x.key) }
                                    : d,
                                );
                                setCapsErrors(({ tasks: _, ...rest }) => rest);
                              }}
                            >
                              Select all
                            </button>
                            <button
                              type="button"
                              className="text"
                              disabled={ticked.length === 0}
                              onClick={() =>
                                setCapsDraft((d) =>
                                  d ? { ...d, tasks: [] } : d,
                                )
                              }
                            >
                              Deselect all
                            </button>
                          </div>
                        )}
                        {choices.map((x) => (
                          <label key={x.key} className="check">
                            <input
                              type="checkbox"
                              checked={ticked.includes(x.key)}
                              onChange={(e) => {
                                toggle(field, x.key, e.target.checked);
                                setCapsErrors(
                                  ({ [field]: _, ...rest }) => rest,
                                );
                              }}
                            />{' '}
                            {x.label}
                          </label>
                        ))}
                        {field === 'data' && (
                          <p className="small">
                            Approved private data is sent to the plan's
                            provider; allow it only if you accept that for this
                            plan.
                          </p>
                        )}
                        {capsErrors[field] && (
                          <span
                            id={`caps-${c.id}-${field}-error`}
                            className="error"
                          >
                            {capsErrors[field]}
                          </span>
                        )}
                      </fieldset>
                    ))}
                    {fields.map((x) => {
                      const id = `caps-${c.id}-${x.key.replace('.', '-')}`;
                      const err = capsErrors[x.key];
                      return (
                        <label key={x.key} htmlFor={id}>
                          {x.label} ({capHint(x)})
                          <input
                            id={id}
                            inputMode="numeric"
                            value={capsDraft.values[x.key] ?? ''}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? `${id}-error` : undefined}
                            onChange={(e) => {
                              const value = e.target.value;
                              // PR #103 review L2: an error is about the value it was shown
                              // for; clear it once the value changes.
                              setCapsErrors(({ [x.key]: _, ...rest }) => rest);
                              setCapsDraft((d) =>
                                d
                                  ? {
                                      ...d,
                                      values: { ...d.values, [x.key]: value },
                                    }
                                  : d,
                              );
                            }}
                          />
                          {err && (
                            <span id={`${id}-error`} className="error">
                              {err}
                            </span>
                          )}
                          {x.key === 'codex.build_timeout_ms' && (
                            <span className="small">
                              A build approval lasts at most 24 hours, so a
                              build's turns (one, plus one per repair round)
                              must fit in that time.
                            </span>
                          )}
                        </label>
                      );
                    })}
                    {stale && (
                      <p role="alert">
                        These caps changed since you opened this form. Cancel
                        and open it again to start from the saved values.
                      </p>
                    )}
                    {!stale &&
                      parsed.caps &&
                      !classIssues.data &&
                      !classIssues.tasks && (
                        <p role="status">
                          {changes.length
                            ? `Will change: ${changes.join('; ')}.`
                            : 'No changes yet.'}
                        </p>
                      )}
                    <div className="actions">
                      <button
                        type="submit"
                        disabled={
                          busy ||
                          !session ||
                          stale ||
                          (!!parsed.caps &&
                            Object.keys(classIssues).length === 0 &&
                            changes.length === 0)
                        }
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => {
                          setCapsDraft(null);
                          setCapsErrors({});
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </fieldset>
                </form>
              );
            })()}
          {!owner ? null : c.credits.state !== 'confirmed_off' ? (
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
          {owner && c.quota.state === 'exhausted' && (
            <fieldset className="quota-recheck">
              <legend>Plan usage limit reached</legend>
              <p>
                {claude ? 'Claude' : 'ChatGPT'} reported that this plan's usage
                limit was reached
                {c.quota.observed_at
                  ? ` on ${new Date(c.quota.observed_at).toLocaleString()}`
                  : ''}
                , so every request on this connection is paused. Once your{' '}
                {claude ? 'Claude usage settings' : 'ChatGPT usage settings'}{' '}
                show the limit has reset, allow requests again. The next request
                records the plan's answer, so if the limit is still reached it
                pauses again.
              </p>
              <button
                disabled={busy || quotaBusy || !session}
                onClick={() => {
                  const id = c.id;
                  setQuotaError({ id: '', text: '' });
                  setQuotaBusy(true);
                  void act(
                    `${p}/quota-recheck`,
                    { expected_version: c.version },
                    5000,
                    (text) => setQuotaError({ id, text }),
                  ).finally(() => setQuotaBusy(false));
                }}
              >
                Usage has reset: allow requests again
              </button>
              {/* PR #129 review N-2: a refusal shows here, next to the button. */}
              {quotaError.id === c.id && quotaError.text && (
                <p className="error" role="alert">
                  {quotaError.text}
                </p>
              )}
            </fieldset>
          )}
          <h4>Model access</h4>
          {detail.model_access.length ? (
            <ul>
              {detail.model_access.map((a) => (
                <li key={`${a.model_id}-${a.path}`}>
                  {a.model_id} · {a.path} · {a.access} ·{' '}
                  {new Date(a.verified_at).toLocaleString()}
                  {(() => {
                    // P22 review L-6: a recheck keeps the original record, so say when it ran.
                    const r = detail.last_rechecks.find(
                      (x) => x.model_id === a.model_id && x.path === a.path,
                    );
                    return r
                      ? ` · last availability recheck ${new Date(r.finished_at).toLocaleString()}: ${
                          r.state === 'completed'
                            ? 'available'
                            : `${r.state}${r.reason_code ? ` (${r.reason_code})` : ''}`
                        }`
                      : '';
                  })()}
                </li>
              ))}
            </ul>
          ) : (
            <p>No model has been checked on this connection.</p>
          )}
          {owner && (
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
                    claude
                      ? 'Full model id, e.g. claude-sonnet-5-5'
                      : 'Full model id, e.g. gpt-6-astra'
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
                      // Fourth review L-1: the call runs under the connection's request
                      // timeout, which has no 300 s maximum any more (ADR-0062).
                      Math.max(
                        330_000,
                        planWaitMs(
                          c?.settings.caps.responses.request_timeout_ms ?? 0,
                        ),
                      ),
                    )
                  }
                >
                  {grantCheck === 'availability_recheck'
                    ? 'Recheck availability once'
                    : 'Run the verification call'}
                </button>
              )}
            </fieldset>
          )}
          {/* P23 item 1: right below the model check, above the list of results. Keyed on
              the workspace and connection, so a switch starts it fresh (items 4 and 10). */}
          {owner && (
            <QualifyModel
              key={`${workspace.id}:${c.id}`}
              base={base}
              connection={c}
              models={detail.model_access
                .filter(
                  (a) => a.path === 'responses' && a.access === 'verified',
                )
                .map((a) => a.model_id)}
              qualifications={detail.qualifications}
              queue={detail.qualification_queue ?? null}
              requestsLeft={
                c.settings.caps.shared.max_model_requests_per_day +
                detail.usage.extra_requests -
                detail.usage.last_24h_requests
              }
              busy={busy || !session}
              preferred={
                choice?.connection_id === c.id ? choice.model_id : null
              }
              act={act}
            />
          )}
          <h4>Qualified tasks</h4>
          {detail.qualifications.length ? (
            <ul>
              {detail.qualifications.map((q) => {
                // PR #175 review M-1: a row counts against its own role only, as the server
                // admits it (a failed assessment scoring run never withdraws a discovery pass).
                const latest = rowLatest(detail.qualifications, q);
                return (
                  <li key={q.id}>
                    <QualificationResults base={base} q={q} />
                    {q.state === 'qualified' && latest?.state === 'failed' && (
                      <p className="small">
                        No longer counts: a newer qualification of this model
                        for the same job and role failed.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>No qualification yet.</p>
          )}
          <h4>Recent requests</h4>
          <p>
            {detail.usage.last_24h_requests} in the last 24 hours ·{' '}
            {detail.usage.in_flight} running · {detail.usage.unresolved} with an
            unknown outcome
          </p>
          <DailyCapNotice
            path={`${base}/${p}`}
            csrf={session?.csrf_token ?? ''}
            connection={c}
            usage={detail.usage}
            onDone={() => void load()}
          />
        </>
      )}
    </section>
  );
}
