import { useEffect, useState } from 'react';
import { useOnShow } from './page-active.js';
import {
  CHAT_DAILY_LIMIT_DEFAULT,
  CHAT_DAILY_LIMIT_MAX,
  ChatSettingsSchema,
  PlanConnectionDetailSchema,
  PLAN_RECONCILE_HINT,
  PlanConnectionSchema,
  z,
  type ChatAnswer,
  type ChatSettings,
  type PlanConnection,
  type PlanConnectionDetail,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { Markdown } from './markdown-view.js';
import { api, message, when } from './oversight.js';

// ADR-0057: chat answers from a connected plan. The answer view labels every answer as a model
// answer that nobody checked and shows exactly what was sent; the settings card is the owner's
// one switch. The server decides every request; nothing here can start, approve or spend.

export const planName = (kind: ChatAnswer['connection_kind']) =>
  kind === 'claude_code' ? 'Claude' : 'ChatGPT';

/** A model answer, or why there is none, with the "What was sent" panel. */
export function AnswerView({
  a,
  openModels,
}: {
  a: ChatAnswer;
  /** ADR-0064: where a request blocked by an earlier one can be closed. */
  openModels?: () => void;
}) {
  const who = `${planName(a.connection_kind)} · ${a.model_id}`;
  return (
    <div className={`chat-studio chat-model chat-model-${a.state}`}>
      <p className="chat-meta">
        {who}
        {a.fixture ? ' · fixture stand-in, not a real model' : ''} · model
        answer, not checked
        {a.finished_at && (
          <>
            {' '}
            · <time dateTime={a.finished_at}>{when(a.finished_at)}</time>
          </>
        )}
      </p>
      {a.state === 'completed' && <Markdown text={a.text ?? ''} />}
      {a.state === 'pending' && (
        <p role="status">Waiting for {planName(a.connection_kind)}…</p>
      )}
      {a.state === 'refused' && (
        <p>
          <strong>Not asked.</strong> Nothing was sent. {a.reason}
          {openModels && (a.reason ?? '').includes(PLAN_RECONCILE_HINT) && (
            <>
              {' '}
              <button type="button" className="text" onClick={openModels}>
                Open Models and connections
              </button>
            </>
          )}
        </p>
      )}
      {a.state === 'failed' && (
        <p>
          <strong>No answer.</strong> {a.reason}
        </p>
      )}
      {a.sent && (
        <details className="chat-sent">
          <summary>What was sent</summary>
          <p className="small">
            {a.sent.input_chars.toLocaleString()} characters to{' '}
            {planName(a.connection_kind)}, with the fixed instructions{' '}
            {a.sent.instructions_version}.{' '}
            {a.sent.snapshot
              ? 'Included a studio snapshot (names, states and counts only).'
              : 'No studio snapshot.'}{' '}
            {a.sent.history_items === 0
              ? 'No earlier messages.'
              : `${a.sent.history_items} earlier ${a.sent.history_items === 1 ? 'message' : 'messages and answers'}.`}
          </p>
          <pre>{a.sent.input}</pre>
        </details>
      )}
    </div>
  );
}

const Detail = PlanConnectionDetailSchema.extend({
  sign_in_attempt: z.unknown().optional(),
});
const label = (c: PlanConnection) =>
  `${c.label} (${c.kind === 'claude_code' ? 'Claude' : 'ChatGPT'}${c.fixture ? ', fixture' : ''})`;

/**
 * The owner's switch for chat answers (Models and connections). It shows why the chosen
 * connection would refuse right now, and offers the one settings change chat needs: allowing
 * the owner's private text on that connection, which asks for the caps to be accepted again.
 */
export function ChatAnswersCard({
  workspace,
  session,
  stamp = '',
  onChanged,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
  /** Changes when a connection's state changes on the page, to refresh the readiness list. */
  stamp?: string;
  onChanged?: () => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const owner = workspace.role === 'owner';
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [details, setDetails] = useState<PlanConnectionDetail[]>([]);
  const [form, setForm] = useState({
    enabled: false,
    connection_id: '',
    model_id: '',
    include_snapshot: true,
    daily_limit: CHAT_DAILY_LIMIT_DEFAULT,
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadDetails() {
    const conns = await api(
      z.array(PlanConnectionSchema),
      `${base}/plan-connections`,
    );
    setDetails(
      await Promise.all(
        conns.map((c) => api(Detail, `${base}/plan-connections/${c.id}`)),
      ),
    );
  }
  async function load() {
    const [s, conns] = await Promise.all([
      api(ChatSettingsSchema, `${base}/chat-settings`),
      api(z.array(PlanConnectionSchema), `${base}/plan-connections`),
    ]);
    const d = await Promise.all(
      conns.map((c) => api(Detail, `${base}/plan-connections/${c.id}`)),
    );
    setSettings(s);
    setDetails(d);
    const first = d[0]?.connection.id ?? '';
    const connection_id = s.connection_id ?? first;
    setForm({
      enabled: s.enabled,
      connection_id,
      model_id: s.model_id ?? verifiedModels(d, connection_id)[0] ?? '',
      include_snapshot: s.include_snapshot,
      daily_limit: s.daily_limit,
    });
  }
  useEffect(() => {
    if (!session) return;
    load().catch((e) => setError(message(e)));
  }, [workspace.id, session?.actor_id]);
  useEffect(() => {
    if (!session || !settings || !stamp) return;
    loadDetails().catch((e) => setError(message(e)));
  }, [stamp]);
  // Connections checked or changed elsewhere show when the page is shown again (audit L-10);
  // the settings form keeps what the owner typed.
  useOnShow(() => {
    if (session && settings) loadDetails().catch((e) => setError(message(e)));
  });

  const chosen = details.find((d) => d.connection.id === form.connection_id);
  const models = verifiedModels(details, form.connection_id);
  const privateAllowed =
    chosen?.connection.settings.allowed_data_classes.includes(
      'private_approved',
    ) ?? false;
  const problems = [
    ...(chosen?.blockers ?? []),
    ...(chosen && !privateAllowed
      ? [
          'This connection does not allow your private text yet, which chat needs.',
        ]
      : []),
    ...(chosen && models.length === 0
      ? ['No model is verified on this connection yet.']
      : []),
    // ADR-0064: one request at a time, and an open one blocks chat until it is closed.
    // A request this studio is still waiting on is a normal running request, not a problem.
    ...(chosen?.open_requests.some((o) => !o.waiting)
      ? [
          'A request on this connection has no recorded outcome yet (it may be running, or a stopped studio left it). See "Requests without a recorded outcome" under Plan connections.',
        ]
      : []),
  ];

  async function save() {
    if (!session || !settings) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const next = await api(ChatSettingsSchema, `${base}/chat-settings`, {
        csrf: session.csrf_token,
        body: {
          expected_version: settings.version,
          enabled: form.enabled,
          connection_id: form.connection_id || null,
          model_id: form.model_id || null,
          include_snapshot: form.include_snapshot,
          daily_limit: form.daily_limit,
        },
      });
      setSettings(next);
      setSaved(next.enabled ? 'Chat answers are on.' : 'Chat answers are off.');
      onChanged?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function allowPrivate() {
    if (!session || !chosen) return;
    setBusy(true);
    setError('');
    try {
      const c = chosen.connection;
      await api(z.unknown(), `${base}/plan-connections/${c.id}/settings`, {
        csrf: session.csrf_token,
        body: {
          expected_version: c.version,
          settings: {
            ...c.settings,
            allowed_data_classes: [
              ...c.settings.allowed_data_classes,
              'private_approved',
            ],
          },
        },
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat-answers-card" aria-labelledby="chat-answers-title">
      <h3 id="chat-answers-title">Chat answers</h3>
      <p>
        Let Chat answer open questions with one of your plans. Each answer uses
        your plan&apos;s own allowance at no extra cost, never a paid route, and
        is labelled as a model answer nobody checked. Answers are words only:
        they cannot start, approve or spend anything.
      </p>
      {error && <p role="alert">{error}</p>}
      {saved && <p role="status">{saved}</p>}
      {!settings ? (
        <p role="status">Loading…</p>
      ) : details.length === 0 ? (
        <p>Add a ChatGPT plan or Claude Code connection below first.</p>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={!owner}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Answer questions in Chat with a model</span>
          </label>
          <label>
            Connection
            <select
              value={form.connection_id}
              disabled={!owner}
              onChange={(e) =>
                setForm({
                  ...form,
                  connection_id: e.target.value,
                  model_id: verifiedModels(details, e.target.value)[0] ?? '',
                })
              }
            >
              {details.map((d) => (
                <option key={d.connection.id} value={d.connection.id}>
                  {label(d.connection)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <select
              value={form.model_id}
              disabled={!owner || models.length === 0}
              onChange={(e) => setForm({ ...form, model_id: e.target.value })}
            >
              {models.length === 0 && (
                <option value="">No verified model</option>
              )}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.include_snapshot}
              disabled={!owner}
              onChange={(e) =>
                setForm({ ...form, include_snapshot: e.target.checked })
              }
            />
            <span>
              Send a short studio snapshot with each question (workspace name,
              runs, ideas, specs, products, waiting approvals; names, states and
              counts only)
            </span>
          </label>
          <label>
            Answers a day
            <input
              type="number"
              min={1}
              max={CHAT_DAILY_LIMIT_MAX}
              value={form.daily_limit}
              disabled={!owner}
              onChange={(e) =>
                setForm({
                  ...form,
                  daily_limit: Math.max(
                    1,
                    Math.min(CHAT_DAILY_LIMIT_MAX, Number(e.target.value) || 1),
                  ),
                })
              }
            />
          </label>
          <p className="small">
            {settings.used_24h} of {settings.daily_limit} chat answers used in
            the last 24 hours. They also count toward the connection&apos;s own
            daily cap
            {chosen
              ? ` (${chosen.connection.settings.caps.shared.max_model_requests_per_day} requests)`
              : ''}
            .
          </p>
          {problems.length > 0 && (
            <div className="chat-problems">
              <p>This connection would refuse chat right now:</p>
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {owner && chosen && !privateAllowed && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !session}
                  onClick={() => void allowPrivate()}
                >
                  Allow my private text on this connection
                </button>
              )}
              {owner && chosen && !privateAllowed && (
                <p className="small">
                  This changes the whole connection, not just chat: discovery
                  tasks and builds on it may then use private data too, and a
                  workflow already set up on its old settings stops. You will
                  need to accept its caps again under Plan connections.
                </p>
              )}
            </div>
          )}
          {owner ? (
            <button
              className="primary"
              disabled={busy || !session || (form.enabled && !form.model_id)}
            >
              Save chat answers
            </button>
          ) : (
            <p className="small">Only the owner changes this.</p>
          )}
        </form>
      )}
    </section>
  );
}

function verifiedModels(details: PlanConnectionDetail[], id: string) {
  const d = details.find((x) => x.connection.id === id);
  return [
    ...new Set(
      (d?.model_access ?? [])
        .filter((a) => a.access === 'verified' && a.path === 'responses')
        .map((a) => a.model_id),
    ),
  ];
}
