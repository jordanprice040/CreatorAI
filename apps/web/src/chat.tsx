import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChatAnswerSchema,
  ChatConversationSchema,
  ChatDeletedSchema,
  ChatDetailSchema,
  ChatMessageSchema,
  ChatSettingsSchema,
  z,
  type ChatAnswer,
  type ChatSettings,
  type ChatConversation,
  type ChatDetail,
  type ChatMessage,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { announceActivity } from './activity-dots.js';
import { api, ApiError, message as errorText, when } from './oversight.js';
import { usePageActive } from './page-drafts.js';
import { pathStages, type StudioFacts } from './next-rules.js';
import {
  chatReply,
  type ReplyAction,
  type ReplyFacts,
} from './chat-replies.js';
import { placeLabel, type View } from './pages.js';
import { AnswerView } from './chat-answers.js';

/** A plan answer can take minutes (Claude Code's own timeout is up to 5 minutes). */
const ANSWER_TIMEOUT_MS = 330_000;

const EXAMPLES = [
  "What's next?",
  'Why is it blocked?',
  "What's waiting for me?",
  'Save this idea: ',
];

/** The facts a reply needs, from the same rules as the Path tab and the what's-next line. */
function replyFacts(facts: StudioFacts | null, latest: boolean): ReplyFacts {
  if (!facts) return { latest, step: null, blocked: null, pending: null };
  const { stages, step } = pathStages(facts);
  const blocked = stages.find((s) => s.state === 'blocked');
  return {
    latest,
    step: { tone: step.tone, text: step.text, view: step.action?.view ?? null },
    blocked: blocked
      ? { label: blocked.label, text: blocked.text ?? '', view: blocked.view }
      : null,
    pending: facts.pending,
  };
}

/**
 * Chat (ADR-0055, first version): the studio's front door. Conversations are saved per
 * workspace; the server sorts each message into an intent with fixed rules, and the replies
 * and cards here are worked out from current records each time they are shown. No model is
 * called. Cards open a tab or fill in a form there; every step still goes through that form
 * and the server's gates.
 */
export function Chat({
  session,
  workspace,
  facts,
  focus,
  onFocus,
  open,
  fill,
}: {
  session: SessionInfo;
  workspace: Workspace;
  facts: StudioFacts | null;
  /** The open conversation's id, kept in the page address. */
  focus: string;
  onFocus: (id: string) => void;
  open: (view: View) => void;
  fill: (view: 'evidence' | 'submit', value: string) => void;
}) {
  const base = `workspaces/${workspace.id}/chats`;
  const active = usePageActive();
  const canWrite = workspace.role !== 'viewer';
  const owner = workspace.role === 'owner';
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [asking, setAsking] = useState('');
  // One id per answer request, reused on retry so a resend never asks twice.
  const askIds = useRef(new Map<string, string>());
  const [list, setList] = useState<ChatConversation[] | null>(null);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<ChatDetail | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // One id per message being written, reused on retry so a resend never adds it twice.
  const clientId = useRef<string>(crypto.randomUUID());
  const listSeq = useRef(0);
  const detailSeq = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function loadList(q = query) {
    const mine = ++listSeq.current;
    try {
      const rows = await api(
        z.array(ChatConversationSchema),
        `${base}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`,
      );
      if (mine === listSeq.current) setList(rows);
    } catch (e) {
      if (mine === listSeq.current) setError(errorText(e));
    }
  }
  async function loadDetail(id: string) {
    const mine = ++detailSeq.current;
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const d = await api(ChatDetailSchema, `${base}/${id}`);
      if (mine === detailSeq.current) setDetail(d);
    } catch (e) {
      if (mine === detailSeq.current) {
        setDetail(null);
        // PR #124 review L-3: deleted elsewhere (another tab or member). Leave it, so the next
        // send starts a new conversation instead of failing against the gone one.
        if (
          e instanceof ApiError &&
          e.code === 'NOT_FOUND' &&
          id === focusRef.current
        ) {
          focusRef.current = '';
          onFocus('');
          setError(
            'That conversation was deleted. Your next message starts a new one.',
          );
          void loadList();
        } else setError(errorText(e));
      }
    }
  }
  // Reload whenever the tab is shown again, so conversations stay current.
  useEffect(() => {
    if (!active) return;
    void loadList();
    void loadDetail(focus);
    api(ChatSettingsSchema, `workspaces/${workspace.id}/chat-settings`)
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [active, focus, workspace.id]);
  const answersOn = Boolean(settings?.enabled && settings.model_id);

  /** ADR-0057: asks the chosen plan to answer one saved message. */
  async function ask(conversation: string, messageId: string) {
    if (!owner || asking) return;
    let cid = askIds.current.get(messageId);
    if (!cid) {
      cid = crypto.randomUUID();
      askIds.current.set(messageId, cid);
    }
    setAsking(messageId);
    setError('');
    try {
      await api(
        ChatAnswerSchema,
        `${base}/${conversation}/messages/${messageId}/answer`,
        {
          csrf: session.csrf_token,
          body: { client_id: cid },
          timeoutMs: ANSWER_TIMEOUT_MS,
        },
      );
      askIds.current.delete(messageId);
    } catch (err) {
      setError(
        `${errorText(err)} Ask again to retry; it will not be sent twice.`,
      );
    } finally {
      setAsking('');
      // The reply (or why there is none) is back: dot Chat if the person went elsewhere.
      announceActivity('chat', workspace.id);
      if (conversation === focusRef.current) await loadDetail(conversation);
    }
  }
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [detail?.messages.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy || !canWrite) return;
    setBusy(true);
    setError('');
    let id = focus;
    try {
      if (!id) {
        const created = await api(ChatConversationSchema, base, {
          csrf: session.csrf_token,
          body: {},
        });
        id = created.id;
        // PR #98 L-2: open the new conversation before posting, so a failed post is retried
        // into it instead of starting another empty one.
        focusRef.current = id;
        onFocus(id);
      }
      const posted = await api(ChatMessageSchema, `${base}/${id}/messages`, {
        csrf: session.csrf_token,
        body: { client_id: clientId.current, text },
      });
      clientId.current = crypto.randomUUID();
      setDraft('');
      if (id === focusRef.current) await loadDetail(id);
      await loadList();
      // ADR-0057: a message the rules keep as a note goes to the chosen plan when answers are on.
      if (answersOn && owner && posted.intent === 'note')
        void ask(id, posted.id);
    } catch (err) {
      // PR #124 re-review L-A: the open conversation was deleted elsewhere. Leave it (the same
      // check as on load), so the kept draft goes into a new conversation on the next send.
      if (
        err instanceof ApiError &&
        err.code === 'NOT_FOUND' &&
        id &&
        id === focusRef.current
      ) {
        await loadDetail(id);
        return;
      }
      // The draft and its id stay, so sending again cannot add the message twice.
      setError(
        `${errorText(err)} Your message is kept; send it again to retry.`,
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function act(a: ReplyAction) {
    if (a.kind === 'fill') fill(a.view, a.value);
    else open(a.view as View);
  }
  const actionLabel = (a: ReplyAction) =>
    a.kind === 'open' && a.label === 'Go there'
      ? `Open ${placeLabel(a.view as View, 'chat')}`
      : a.label;

  const messages = detail?.messages ?? [];
  const answersFor = new Map<string, ChatAnswer[]>();
  for (const a of detail?.answers ?? [])
    answersFor.set(a.message_id, [...(answersFor.get(a.message_id) ?? []), a]);
  const askLabel = settings?.connection_id
    ? `Ask ${settings.model_id ?? 'the model'}`
    : 'Ask the model';
  const latestOf = new Map<string, number>();
  for (const m of messages) latestOf.set(m.intent, m.seq);

  return (
    <section className="panel chat" aria-labelledby="chat-title">
      <h2 id="chat-title">Chat</h2>
      <p className="small">
        Ask what&apos;s next or why something is blocked, paste a web address,
        or save an idea. The studio answers those from your records by fixed
        rules, and nothing here starts work: buttons open the tab where you do
        it.{' '}
        {answersOn
          ? `Other questions are answered by ${settings?.model_id} through your plan, at no extra cost; those answers are labelled and never change anything.`
          : 'The owner can let a connected ChatGPT or Claude plan answer other questions (Models and connections › Chat answers).'}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="chat-layout">
        <aside className="chat-list" aria-label="Conversations">
          <form
            className="chat-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              void loadList(query);
            }}
          >
            <label htmlFor="chat-q" className="sr-only">
              Search conversations
            </label>
            <input
              id="chat-q"
              type="search"
              placeholder="Search conversations"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (!e.target.value) void loadList('');
              }}
            />
          </form>
          {canWrite && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                onFocus('');
                setDraft('');
                inputRef.current?.focus();
              }}
            >
              New conversation
            </button>
          )}
          {list === null ? (
            <p className="small">Loading…</p>
          ) : list.length === 0 ? (
            <p className="small">
              {query.trim()
                ? 'No conversation matches.'
                : 'No conversations yet.'}
            </p>
          ) : (
            <ul className="rows chat-convos">
              {list.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="chat-convo"
                    aria-current={c.id === focus ? 'true' : undefined}
                    onClick={() => onFocus(c.id)}
                  >
                    <strong>{c.title}</strong>
                    <small>
                      {c.messages} {c.messages === 1 ? 'message' : 'messages'} ·{' '}
                      {when(c.updated_at)}
                    </small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <div className="chat-main">
          {detail && (
            <ChatTitle
              key={detail.conversation.id}
              conversation={detail.conversation}
              canWrite={canWrite}
              canDelete={
                owner ||
                // PR #124 review L-2: editors only when every word in it is theirs.
                (canWrite &&
                  detail.conversation.created_by === session.actor_id &&
                  detail.messages.every(
                    (m) => m.author_id === session.actor_id,
                  ) &&
                  detail.answers.length === 0)
              }
              remove={async () => {
                const id = detail.conversation.id;
                await api(ChatDeletedSchema, `${base}/${id}/delete`, {
                  csrf: session.csrf_token,
                  body: {},
                });
                for (const m of detail.messages) askIds.current.delete(m.id);
                if (focusRef.current === id) {
                  focusRef.current = '';
                  setDetail(null);
                  onFocus('');
                }
                await loadList();
                // PR #124 review L-4: keyboard focus goes to the message box, not the page.
                inputRef.current?.focus();
              }}
              rename={async (title) => {
                await api(
                  ChatConversationSchema,
                  `${base}/${detail.conversation.id}/title`,
                  { csrf: session.csrf_token, body: { title } },
                );
                await loadDetail(detail.conversation.id);
                await loadList();
              }}
            />
          )}
          <ol className="chat-messages" aria-live="polite">
            {messages.length === 0 && (
              <li className="chat-empty">
                <p>Start with a question or an idea. For example:</p>
                <div className="chat-examples">
                  {EXAMPLES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      className="secondary"
                      disabled={!canWrite}
                      onClick={() => {
                        setDraft(x);
                        inputRef.current?.focus();
                      }}
                    >
                      {x.trim()}
                    </button>
                  ))}
                </div>
              </li>
            )}
            {messages.map((m) => (
              <MessageItem
                key={m.id}
                m={m}
                facts={{
                  ...replyFacts(facts, latestOf.get(m.intent) === m.seq),
                  model: answersOn ? (settings?.model_id ?? null) : null,
                }}
                act={act}
                label={actionLabel}
                answers={answersFor.get(m.id) ?? []}
                ask={
                  owner && answersOn && detail
                    ? () => void ask(detail.conversation.id, m.id)
                    : null
                }
                askLabel={askLabel}
                asking={asking === m.id}
                busy={Boolean(asking)}
              />
            ))}
          </ol>
          <div ref={endRef} />
          {canWrite ? (
            <form className="chat-compose" onSubmit={(e) => void send(e)}>
              <label htmlFor="chat-input" className="sr-only">
                Message
              </label>
              <textarea
                id="chat-input"
                ref={inputRef}
                rows={2}
                maxLength={4000}
                placeholder="Ask what's next, paste a link, or save an idea…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button
                type="submit"
                className="primary"
                disabled={busy || !draft.trim()}
              >
                {busy ? 'Sending…' : 'Send'}
              </button>
            </form>
          ) : (
            <p className="small">
              You can read these conversations; only editors and owners can
              write in them.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function MessageItem({
  m,
  facts,
  act,
  label,
  answers,
  ask,
  askLabel,
  asking,
  busy,
}: {
  m: ChatMessage;
  facts: ReplyFacts;
  act: (a: ReplyAction) => void;
  label: (a: ReplyAction) => string;
  answers: ChatAnswer[];
  ask: (() => void) | null;
  askLabel: string;
  asking: boolean;
  busy: boolean;
}) {
  const reply = chatReply(m.intent, m.target, m.text, facts);
  const live = answers.some(
    (a) => a.state === 'completed' || a.state === 'pending',
  );
  return (
    <li className="chat-turn">
      <div className="chat-you">
        <p className="chat-meta">
          You · <time dateTime={m.created_at}>{when(m.created_at)}</time>
        </p>
        <p className="chat-text">{m.text}</p>
      </div>
      <div className="chat-studio">
        <p className="chat-meta">Studio · from your records, no model</p>
        <p>{reply.text}</p>
        {reply.actions.length > 0 && (
          <p className="chat-actions">
            {reply.actions.map((a) => (
              <button
                key={`${a.kind}:${a.label}`}
                type="button"
                className="secondary"
                onClick={() => act(a)}
              >
                {label(a)}
              </button>
            ))}
          </p>
        )}
      </div>
      {answers.map((a) => (
        <AnswerView key={a.id} a={a} />
      ))}
      {asking && !live && (
        <div className="chat-studio chat-model">
          <p role="status">Asking {askLabel.replace(/^Ask /, '')}…</p>
        </div>
      )}
      {ask && !live && !asking && (
        <p className="chat-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={ask}
          >
            {answers.length ? `${askLabel} again` : askLabel}
          </button>
        </p>
      )}
    </li>
  );
}

function ChatTitle({
  conversation,
  canWrite,
  canDelete,
  rename,
  remove,
}: {
  conversation: ChatConversation;
  canWrite: boolean;
  /**
   * ADR-0063: owners delete any conversation; editors only ones they started that hold only
   * their own messages and no model answers.
   */
  canDelete: boolean;
  rename: (title: string) => Promise<void>;
  remove: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const [error, setError] = useState('');
  // PR #124 review L-4: the confirm takes focus when shown; cancelling returns it to Delete.
  const keepRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    // Also after a refused delete re-enables the buttons (PR #124 re-review N-A).
    if (confirming && !deleting) keepRef.current?.focus();
    else if (!confirming && returnFocus.current) {
      returnFocus.current = false;
      deleteRef.current?.focus();
    }
  }, [confirming, deleting]);
  if (confirming)
    return (
      <div
        className="chat-head chat-confirm"
        role="group"
        aria-label="Delete conversation"
      >
        <p>
          Delete “{conversation.title}” and its {conversation.messages}{' '}
          {conversation.messages === 1 ? 'message' : 'messages'}? Model answers
          in it go too. This cannot be undone.
        </p>
        <button
          type="button"
          className="secondary danger"
          disabled={deleting}
          onClick={() => {
            setDeleting(true);
            setError('');
            remove().catch((err: unknown) => {
              setError(errorText(err));
              setDeleting(false);
            });
          }}
        >
          {deleting ? 'Deleting…' : 'Delete conversation'}
        </button>
        <button
          type="button"
          className="secondary"
          ref={keepRef}
          disabled={deleting}
          onClick={() => {
            returnFocus.current = true;
            setConfirming(false);
            setError('');
          }}
        >
          Keep it
        </button>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  if (!editing)
    return (
      <div className="chat-head">
        <h3>{conversation.title}</h3>
        {canWrite && (
          <button
            type="button"
            className="text"
            onClick={() => {
              setTitle(conversation.title);
              setEditing(true);
            }}
          >
            Rename
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="text"
            ref={deleteRef}
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        )}
      </div>
    );
  return (
    <form
      className="chat-head inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError('');
        rename(title.trim())
          .then(() => setEditing(false))
          .catch((err: unknown) => setError(errorText(err)));
      }}
    >
      <label htmlFor="chat-title-input" className="sr-only">
        Conversation name
      </label>
      <input
        id="chat-title-input"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <button className="secondary strong" disabled={!title.trim()}>
        Save
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => setEditing(false)}
      >
        Cancel
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}
