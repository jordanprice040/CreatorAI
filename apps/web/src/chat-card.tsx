import { useEffect, useId, useRef, useState } from 'react';
import {
  ChatActionSchema,
  ChatActionSentSchema,
  z,
  type ChatAction,
  type SessionInfo,
} from '@creator/contracts';
import { api, ApiError, message as errorText, when } from './oversight.js';
import { useViewMode } from './view-mode.js';
import { WhatWillHappen } from './routine.js';
import type { View } from './pages.js';
import { loadCard } from './chat-card-load.js';
import {
  FORM_VIEW,
  LABEL,
  cardView,
  fill,
  pick,
  type CardData,
  type CardView,
  type Input,
  type Question,
  type Step,
  type Value,
} from './chat-cards.js';

// ADR-0083 (P20): one action card in Chat. The card asks the form's questions one at a time,
// says what it still needs, shows exactly which requests Send makes and, when the person
// presses Send, makes them from this browser through the form's own routes, each naming the
// card's send as its cause. The server decides; the card reports what it answered.

const STATE_TEXT: Record<ChatAction['state'], string> = {
  draft: 'Not sent',
  sending: 'Sending',
  done: 'Done',
  refused: 'Refused',
  partial: 'Refused; part of it was recorded',
  unconfirmed: 'Not confirmed',
  stale: 'Not sent: out of date',
  dismissed: 'Put away',
};

const minute = () => Math.floor(Date.now() / 60_000) * 60_000;
const shown = (v: Value) => (Array.isArray(v) ? v.join(', ') : v);
/** How a route that records its refusals answered: held, refused, or neither. */
function answeredAs(
  kind: Step['answer'],
  res: unknown,
): { held: boolean; code: string; text: string } | null {
  const a = AnsweredSchema.safeParse(res);
  if (!kind || !a.success) return null;
  if (kind === 'admission') {
    const s = a.data.status;
    return s && s !== 'recorded'
      ? {
          held: s === 'needs_human',
          code: s,
          text: a.data.admission?.explanation ?? '',
        }
      : null;
  }
  const s = a.data.state;
  return s && s !== 'fetched'
    ? {
        held: s === 'needs_human',
        code: a.data.reason_code ?? s,
        text: a.data.explanation ?? s.replaceAll('_', ' '),
      }
    : null;
}
const AnsweredSchema = z.object({
  status: z.string().optional(),
  state: z.string().optional(),
  reason_code: z.string().optional(),
  explanation: z.string().optional(),
  admission: z.object({ explanation: z.string() }).nullish(),
});

export function ActionCard({
  card,
  session,
  workspaceId,
  fixture,
  canWrite,
  reload,
  open,
  again,
}: {
  card: ChatAction;
  session: SessionInfo;
  workspaceId: string;
  fixture: boolean;
  canWrite: boolean;
  /** Reads the conversation again (the card's new state). */
  reload: () => Promise<void>;
  open: (view: View) => void;
  /** Makes a new draft card with the same answers. */
  again: (card: ChatAction) => Promise<void>;
}) {
  const { standard } = useViewMode();
  const base = `workspaces/${workspaceId}/chats/${card.conversation_id}/actions/${card.id}`;
  const [data, setData] = useState<CardData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(minute);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [changing, setChanging] = useState<string | null>(null);
  const draft = card.state === 'draft';
  const input = card.input as Input;
  const ctx = {
    ws: workspaceId,
    fixture,
    advanced: !standard,
    reviewer: session.display_name,
    now,
  };

  async function read() {
    setLoadError('');
    try {
      setData(
        await loadCard(
          card.kind,
          workspaceId,
          fixture,
          input,
          session.display_name,
        ),
      );
    } catch (e) {
      setLoadError(
        `${errorText(e)} The card cannot be filled in until it reads them.`,
      );
    }
  }
  // The records a draft is shown with, read again whenever its answers change.
  const answers = JSON.stringify(input);
  useEffect(() => {
    if (draft && canWrite) void read();
  }, [card.kind, answers, draft, canWrite, workspaceId]);
  // Plan times (grant expiry, time on a decision) move with the clock, a minute at a time.
  useEffect(() => {
    if (!draft) return;
    const t = window.setInterval(() => setNow(minute()), 30_000);
    return () => window.clearInterval(t);
  }, [draft]);
  // A card the model suggested (or one made elsewhere) gets its own request ids once opened.
  const named = useRef(false);
  useEffect(() => {
    if (!draft || !canWrite || named.current) return;
    if (typeof input._op === 'string' && typeof input._opened === 'number')
      return;
    named.current = true;
    void save({}, null).catch(() => undefined);
  }, [draft, canWrite]);

  const view: CardView = cardView(card.kind, input, data, ctx);
  const asking: Question | null =
    (changing ? view.questions.find((q) => q.key === changing) : null) ??
    view.current;

  async function save(patch: Input, viewFor: CardView | null) {
    const next: Input = {
      ...input,
      ...patch,
      _op: typeof input._op === 'string' ? input._op : crypto.randomUUID(),
      _opened: typeof input._opened === 'number' ? input._opened : Date.now(),
    };
    const subjects = (viewFor ?? cardView(card.kind, next, data, ctx)).subjects;
    await api(ChatActionSchema, base, {
      csrf: session.csrf_token,
      body: { expected_version: card.version, input: next, subjects },
    });
    await reload();
  }

  async function answer(q: Question, value: Value) {
    setBusy('answer');
    setError('');
    try {
      const next = { ...input, [q.key]: value };
      await save({ [q.key]: value }, cardView(card.kind, next, data, ctx));
      setChanging(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  async function dismiss() {
    setBusy('dismiss');
    setError('');
    try {
      await api(ChatActionSchema, `${base}/dismiss`, {
        csrf: session.csrf_token,
        body: { expected_version: card.version },
      });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  /** Reports how the routes answered; the server checks it against the audit trail. */
  async function report(outcome: {
    ok: boolean | null;
    code: string | null;
    message: string | null;
    records: { id: string; kind: string; label: string }[];
  }) {
    await api(ChatActionSchema, `${base}/outcome`, {
      csrf: session.csrf_token,
      body: outcome,
    });
  }

  async function sendCard() {
    if (view.current || view.blockers.length || view.steps.length === 0) return;
    setBusy('send');
    setError('');
    const steps: Step[] = view.steps;
    let version = card.version;
    try {
      // A card answered only with defaults has not saved what it is about yet.
      if (card.subjects.length === 0 && view.subjects.length > 0) {
        const saved = await api(ChatActionSchema, base, {
          csrf: session.csrf_token,
          body: {
            expected_version: version,
            input,
            subjects: view.subjects,
          },
        });
        version = saved.version;
      }
      let sent;
      try {
        sent = await api(ChatActionSentSchema, `${base}/send`, {
          csrf: session.csrf_token,
          body: { expected_version: version },
        });
      } catch (e) {
        // Stale (or changed elsewhere): the card's new state says why; nothing was sent.
        setError(errorText(e));
        await reload();
        return;
      }
      const trace = { causation: sent.causation_id, correlation: card.id };
      const got: Record<string, unknown> = {};
      const records: { id: string; kind: string; label: string }[] = [];
      let held: { code: string; message: string } | null = null;
      let failure: {
        ok: false | null;
        code: string | null;
        message: string;
      } | null = null;
      for (const step of steps) {
        let res: unknown;
        try {
          res = await api(z.unknown(), String(fill(step.path, got)), {
            csrf: session.csrf_token,
            body: fill(step.body, got),
            trace,
            ...(step.idempotencyKey
              ? { idempotencyKey: step.idempotencyKey }
              : {}),
            ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
          });
        } catch (e) {
          failure =
            e instanceof ApiError
              ? {
                  ok: false,
                  code: e.code,
                  message: `${step.label}: ${e.message}`,
                }
              : {
                  ok: null,
                  code: null,
                  message: `${step.label}: ${errorText(e)} The page lost track of this request; it may still have been saved.`,
                };
          break;
        }
        for (const [name, field] of Object.entries(step.capture ?? {}))
          got[name] = pick(res, field);
        if (step.record) {
          const rid = pick(res, step.record.from);
          if (typeof rid === 'string')
            records.push({
              id: rid,
              kind: step.record.kind,
              label: step.record.label.slice(0, 200),
            });
        }
        const h = answeredAs(step.answer, res);
        if (h?.held) {
          held = {
            code: 'needs_human',
            message: `Held for a decision: ${h.text} It waits in Approvals; answer it, then send this card again.`,
          };
          break;
        }
        if (h) {
          failure = {
            ok: false,
            code: h.code,
            message: `${step.label}: ${h.text}`,
          };
          break;
        }
      }
      await report(
        failure
          ? { ...failure, message: failure.message.slice(0, 2000), records }
          : {
              ok: true,
              code: held?.code ?? null,
              message: held?.message.slice(0, 2000) ?? null,
              records,
            },
      );
      await reload();
    } catch (e) {
      setError(errorText(e));
      await reload().catch(() => undefined);
    } finally {
      setBusy('');
    }
  }

  async function checkLost() {
    setBusy('check');
    setError('');
    try {
      await report({
        ok: null,
        code: null,
        message: 'The page that sent this card lost track of it.',
        records: [],
      });
      await reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  const origin =
    card.origin === 'model'
      ? 'Suggested by the model answer above. Check every answer: only your Send sends it.'
      : 'Studio card, filled in from this conversation. Only your Send sends it.';
  const title = draft ? view.title : LABEL[card.kind];
  const formButton = (
    <button
      type="button"
      className="secondary"
      onClick={() => open(FORM_VIEW[card.kind] as View)}
    >
      Use the form instead
    </button>
  );

  return (
    <div
      className={`chat-studio chat-card chat-card-${card.state}`}
      role="group"
      aria-label={`${LABEL[card.kind]} card`}
    >
      <p className="chat-meta">
        {origin} · {STATE_TEXT[card.state]}
      </p>
      <h4 className="chat-card-title">{title}</h4>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {draft && !canWrite && (
        <p className="small">
          Only editors and owners can fill in and send cards.
        </p>
      )}
      {draft && canWrite && (
        <>
          {loadError && (
            <p className="error" role="alert">
              {loadError}{' '}
              <button
                type="button"
                className="text"
                onClick={() => void read()}
              >
                Read again
              </button>
            </p>
          )}
          {asking && (
            <QuestionField
              key={`${asking.key}:${card.version}`}
              q={asking}
              start={
                Object.hasOwn(input, asking.key)
                  ? view.values[asking.key]!
                  : (asking.fallback ?? (asking.type === 'multi' ? [] : ''))
              }
              busy={busy !== ''}
              cancel={changing ? () => setChanging(null) : null}
              submit={(v) => void answer(asking, v)}
            />
          )}
          {view.missing.length > 0 && (
            <p className="small chat-card-missing">
              Still needed: {view.missing.join(', ')}.
            </p>
          )}
          <Answered
            view={view}
            input={input}
            advanced={!standard}
            change={(k) => setChanging(k)}
            busy={busy !== ''}
          />
          {view.blockers.length > 0 && (
            <ul className="chat-card-blockers">
              {view.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {!asking && view.happen.length > 0 && (
            <WhatWillHappen
              items={view.happen.map((l) => ({
                label: l.label,
                value: l.value,
                ...(l.source ? { source: l.source } : {}),
              }))}
              note="Nothing happens until you press Send. Each request goes through the form's own route, which checks it again exactly as for the form; this card cannot add permissions, money or approvals."
            />
          )}
          {view.steps.length > 0 && <Requests steps={view.steps} />}
          <p className="chat-actions">
            <button
              type="button"
              className="primary"
              disabled={
                busy !== '' ||
                Boolean(asking) ||
                view.blockers.length > 0 ||
                view.steps.length === 0
              }
              onClick={() => void sendCard()}
            >
              {busy === 'send' ? 'Sending…' : 'Send'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy !== ''}
              onClick={() => void dismiss()}
            >
              Put away
            </button>
            {formButton}
          </p>
        </>
      )}
      {card.state === 'sending' && (
        <>
          <p role="status">
            {busy === 'send'
              ? 'Sending through the form’s routes…'
              : `Sent ${card.sent_at ? when(card.sent_at) : ''}; the result was not reported yet.`}
          </p>
          {busy !== 'send' && card.sent_by === session.actor_id && (
            <p className="chat-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy !== ''}
                onClick={() => void checkLost()}
              >
                Check what happened
              </button>
            </p>
          )}
        </>
      )}
      {!draft && card.state !== 'sending' && <Finished card={card} />}
      {['refused', 'partial', 'unconfirmed', 'stale'].includes(card.state) ||
      (card.state === 'done' && card.outcome?.code === 'needs_human')
        ? canWrite && (
            <p className="chat-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy !== ''}
                onClick={() => {
                  setBusy('again');
                  again(card)
                    .catch((e: unknown) => setError(errorText(e)))
                    .finally(() => setBusy(''));
                }}
              >
                Send again with the same answers
              </button>
              {formButton}
            </p>
          )
        : null}
    </div>
  );
}

function QuestionField({
  q,
  start,
  busy,
  cancel,
  submit,
}: {
  q: Question;
  start: Value;
  busy: boolean;
  cancel: (() => void) | null;
  submit: (v: Value) => void;
}) {
  const id = useId();
  const [v, setV] = useState<Value>(start);
  const empty = Array.isArray(v) ? v.length === 0 : !v.trim();
  return (
    <form
      className="chat-card-question"
      data-question={q.key}
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty || q.optional) submit(typeof v === 'string' ? v.trim() : v);
      }}
    >
      {q.type === 'choice' || q.type === 'multi' ? (
        <fieldset>
          <legend>{q.prompt}</legend>
          {q.help && <p className="small">{q.help}</p>}
          {(q.choices ?? []).map((c) => {
            const on = Array.isArray(v) ? v.includes(c.value) : v === c.value;
            return (
              <label key={c.value} className="chat-card-choice">
                <input
                  type={q.type === 'multi' ? 'checkbox' : 'radio'}
                  name={id}
                  value={c.value}
                  checked={on}
                  disabled={Boolean(c.blocked)}
                  onChange={() =>
                    setV(
                      q.type === 'multi'
                        ? on
                          ? (v as string[]).filter((x) => x !== c.value)
                          : [...(Array.isArray(v) ? v : []), c.value]
                        : c.value,
                    )
                  }
                />
                <span>
                  {c.label}
                  {c.detail && <small> · {c.detail}</small>}
                  {c.blocked && <small className="warn"> · {c.blocked}</small>}
                </span>
              </label>
            );
          })}
          {(q.choices ?? []).length === 0 && (
            <p className="small">Nothing to choose from yet.</p>
          )}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id}>{q.prompt}</label>
          {q.help && <p className="small">{q.help}</p>}
          {q.type === 'long' ? (
            <textarea
              id={id}
              rows={3}
              value={v as string}
              onChange={(e) => setV(e.target.value)}
            />
          ) : (
            <input
              id={id}
              value={v as string}
              onChange={(e) => setV(e.target.value)}
            />
          )}
        </>
      )}
      <p className="chat-actions">
        <button className="secondary strong" disabled={busy || empty}>
          Next
        </button>
        {q.optional && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => submit(q.type === 'multi' ? [] : '')}
          >
            Skip
          </button>
        )}
        {cancel && (
          <button type="button" className="text" onClick={cancel}>
            Keep the answer
          </button>
        )}
      </p>
    </form>
  );
}

/** The answers so far (and, in Standard, the routine defaults), each with Change. */
function Answered({
  view,
  input,
  advanced,
  change,
  busy,
}: {
  view: CardView;
  input: Input;
  advanced: boolean;
  change: (key: string) => void;
  busy: boolean;
}) {
  const rows = view.questions.filter(
    (q) =>
      q.key !== view.current?.key &&
      (Object.hasOwn(input, q.key) || (q.routine && !advanced)),
  );
  if (rows.length === 0) return null;
  const label = (q: Question, v: Value) => {
    if (q.type === 'choice' || q.type === 'multi') {
      const names = (Array.isArray(v) ? v : [v])
        .filter(Boolean)
        .map((x) => q.choices?.find((c) => c.value === x)?.label ?? x);
      return names.join(', ');
    }
    return shown(v);
  };
  return (
    <dl className="chat-card-answers">
      {rows.map((q) => {
        const v = view.values[q.key] ?? '';
        return (
          <div key={q.key}>
            <dt>{q.label}</dt>
            <dd>
              {label(q, v) || '—'}
              {!Object.hasOwn(input, q.key) && (
                <span className="source">
                  {' '}
                  · {q.source ?? 'studio default'}
                </span>
              )}{' '}
              <button
                type="button"
                className="text"
                disabled={busy}
                onClick={() => change(q.key)}
              >
                Change
              </button>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Exactly the requests Send makes, in order, as they will be sent. */
function Requests({ steps }: { steps: Step[] }) {
  return (
    <details className="chat-sent">
      <summary>
        Exactly what will be sent ({steps.length}{' '}
        {steps.length === 1 ? 'request' : 'requests'})
      </summary>
      <ol>
        {steps.map((s, i) => (
          <li key={`${i}:${s.path}`}>
            <p>
              <strong>{s.label}</strong>: POST /api/{s.path}
            </p>
            <pre>{JSON.stringify(s.body, null, 2)}</pre>
          </li>
        ))}
      </ol>
      <p className="small">
        A value in braces, such as {'{run}'}, is filled in from the answer to an
        earlier request of this card.
      </p>
    </details>
  );
}

function Finished({ card }: { card: ChatAction }) {
  const o = card.outcome;
  return (
    <div className="chat-card-result">
      {card.reason && <p>{card.reason}</p>}
      {o?.message && o.message !== card.reason && <p>{o.message}</p>}
      {o && o.records.length > 0 && (
        <ul>
          {o.records.map((r) => (
            <li key={r.id}>
              {r.kind}: {r.label}
            </li>
          ))}
        </ul>
      )}
      {card.sent_at && (
        <p className="small">
          Sent {when(card.sent_at)}
          {o
            ? ` · ${o.events} audit ${o.events === 1 ? 'event names' : 'events name'} this send as their cause`
            : ''}
          {card.state === 'unconfirmed' &&
            '. The page reported success but no event confirms it; check the tab before relying on it.'}
        </p>
      )}
    </div>
  );
}
