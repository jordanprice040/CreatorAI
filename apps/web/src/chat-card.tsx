import { useEffect, useId, useRef, useState } from 'react';
import {
  ChatActionFillSchema,
  ChatActionSchema,
  ChatActionSentSchema,
  fillableKey,
  z,
  type ChatAction,
  type ChatActionFill,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, ApiError, message as errorText, when } from './oversight.js';
import { useViewMode } from './view-mode.js';
import { WhatWillHappen } from './routine.js';
import type { View } from './pages.js';
import { loadCard } from './chat-card-load.js';
import {
  FixOutcome,
  FixRow,
  routeFixes,
  useQualifyOffers,
} from './fix-buttons.js';
import { Explore, type ExploredPick } from './explore.js';
import {
  FORM_VIEW,
  LABEL,
  answersFromPick,
  cardView,
  exploreWaitNote,
  fill,
  fillOutcomeNote,
  fillPath,
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
  owner = false,
  reload,
  open,
  again,
  modelHelp = null,
  next = null,
  workspace = null,
}: {
  card: ChatAction;
  session: SessionInfo;
  workspaceId: string;
  fixture: boolean;
  canWrite: boolean;
  /** ADR-0087: the workspace owner sees fixes for the card's blockers in place. */
  owner?: boolean;
  /** Reads the conversation again (the card's new state). */
  reload: () => Promise<void>;
  open: (view: View) => void;
  /** Makes a new draft card with the same answers. */
  again: (card: ChatAction) => Promise<void>;
  /**
   * ADR-0096 (P31): the owner's chat model, offered to propose this card's text answers
   * ("Fill in with <model>"), with this card's fills so far. Null when chat answers are off
   * or the person is not the owner.
   */
  modelHelp?: {
    model: string;
    fills: ChatActionFill[];
    /** How long to wait for the plan's reply. */
    wait: () => Promise<number>;
  } | null;
  /** ADR-0096: "Next step" on a finished card adds the Path's next card (or opens its tab). */
  next?: {
    label: string;
    /** Null when the next card is already open; `note` says so. */
    run: (() => void) | null;
    busy: boolean;
    note?: string;
  } | null;
  /** ADR-0096: the workspace, for Explore for me on a discovery card. */
  workspace?: Workspace | null;
}) {
  const { standard } = useViewMode();
  // ADR-0087: the server's discovery benchmarks, so a fix can qualify a discovery task.
  useQualifyOffers(`workspaces/${workspaceId}`);
  const base = `workspaces/${workspaceId}/chats/${card.conversation_id}/actions/${card.id}`;
  const [data, setData] = useState<CardData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(minute);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [changing, setChanging] = useState<string | null>(null);
  const [exploring, setExploring] = useState(false);
  // One id per Fill press, reused if the same press is retried, so it never asks twice.
  // Review N-2: only for the same card version; an edited card asks afresh.
  const fillId = useRef<{ id: string; version: number } | null>(null);
  // Review N-3: one pick saved at a time.
  const picking = useRef(false);
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
  // Review L-2: time on a decision counts from when this card was shown on this page.
  const shownAt = useRef(Date.now());
  useEffect(() => {
    if (!draft || !canWrite || named.current) return;
    if (typeof input._op === 'string') return;
    named.current = true;
    void save({}, null).catch(() => undefined);
  }, [draft, canWrite]);

  const view: CardView = cardView(card.kind, input, data, ctx);
  const fixFacts =
    card.kind === 'start_discovery' && data && 'routeFix' in data
      ? data.routeFix
      : undefined;
  const asking: Question | null =
    (changing ? view.questions.find((q) => q.key === changing) : null) ??
    view.current;
  // ADR-0096: the questions a model may propose text for (never a pick, judgment or routine).
  const fillable = view.questions.filter(
    (q) =>
      (q.type === 'text' || q.type === 'long') &&
      !q.routine &&
      fillableKey(card.kind, q.key),
  );
  const lastFill = modelHelp?.fills.at(-1) ?? null;
  const applied = lastFill !== null && input._fill === lastFill.id;
  /**
   * Proposals for questions this card still asks, by key, that the card's answer does not
   * already hold. Re-review R2-N2: after "Use the N for unanswered questions" the ones that
   * would replace a typed answer stay on offer, without another Fill in.
   */
  const proposed: Record<string, string> =
    lastFill?.state === 'completed'
      ? Object.fromEntries(
          Object.entries(lastFill.values).filter(
            ([k, v]) => fillable.some((q) => q.key === k) && input[k] !== v,
          ),
        )
      : {};
  const proposedKeys = Object.keys(proposed);
  const used = applied && proposedKeys.length === 0;
  /** Re-review R3-N1: proposals that equal the card's answers already. */
  const matching =
    lastFill?.state === 'completed'
      ? Object.entries(lastFill.values).filter(
          ([k, v]) => fillable.some((q) => q.key === k) && input[k] === v,
        ).length
      : 0;
  const exploreWait = exploreWaitNote(data !== null, loadError);
  // Review L-4: a proposal never replaces a typed answer unless the person asks for that.
  const typed = (k: string) => {
    const v = input[k];
    return typeof v === 'string' && v.trim() !== '';
  };
  const freshKeys = proposedKeys.filter((k) => !typed(k));
  const replacing = proposedKeys.filter((k) => typed(k));

  async function save(patch: Input, viewFor: CardView | null) {
    const next: Input = {
      ...input,
      ...patch,
      _op: typeof input._op === 'string' ? input._op : crypto.randomUUID(),
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

  /** ADR-0096: asks the chat model to propose this card's text answers. Nothing is saved. */
  async function fillIn() {
    if (!modelHelp || fillable.length === 0) return;
    setBusy('fill');
    setError('');
    if (fillId.current?.version !== card.version)
      fillId.current = { id: crypto.randomUUID(), version: card.version };
    try {
      const done = await api(ChatActionFillSchema, `${base}/fill`, {
        csrf: session.csrf_token,
        body: {
          client_id: fillId.current.id,
          expected_version: card.version,
          questions: fillable.map((q) => {
            const cur = input[q.key];
            return {
              key: q.key,
              label: q.label.slice(0, 200),
              prompt: q.prompt.slice(0, 600),
              ...(q.help ? { help: q.help.slice(0, 1200) } : {}),
              type: q.type as 'text' | 'long',
              ...(typeof cur === 'string' && cur.trim()
                ? { current: cur.slice(0, 4000) }
                : {}),
            };
          }),
        },
        timeoutMs: await modelHelp.wait(),
      });
      fillId.current = null;
      if (done.state !== 'completed') setError(done.reason ?? 'No proposals.');
      await reload();
    } catch (e) {
      // Review N-1: a refusal the server gave is final; a lost answer or a server error
      // (5xx, re-review R2-N3) is worth a retry.
      setError(
        e instanceof ApiError && e.status < 500
          ? errorText(e)
          : `${errorText(e)} Press Fill in again to retry; it will not be sent twice.`,
      );
    } finally {
      setBusy('');
    }
  }

  /** The person's click: the proposals become this card's answers, still to check and send. */
  async function useProposals(replace: boolean) {
    const keys = replace ? proposedKeys : freshKeys;
    if (!lastFill || keys.length === 0) return;
    setBusy(replace ? 'use-all' : 'use');
    setError('');
    try {
      const patch: Input = {
        ...Object.fromEntries(keys.map((k) => [k, proposed[k]!])),
        _fill: lastFill.id,
      };
      await save(patch, cardView(card.kind, { ...input, ...patch }, data, ctx));
      setChanging(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  }

  /** ADR-0096: an Explore for me pick fills the discovery card (the person's "Use this"). */
  async function usePick(pick: ExploredPick) {
    if (picking.current) return;
    picking.current = true;
    setBusy('pick');
    setError('');
    try {
      const known = new Set(
        data && 'claims' in data && Array.isArray(data.claims)
          ? data.claims.map((c) => c.id)
          : [],
      );
      const patch = answersFromPick(pick.brief, pick.claims, known);
      await save(patch, cardView(card.kind, { ...input, ...patch }, data, ctx));
      setExploring(false);
      setChanging(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      picking.current = false;
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
      const got: Record<string, unknown> = {
        time_spent_ms: Math.max(
          0,
          Math.min(86_400_000, Date.now() - shownAt.current),
        ),
      };
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
          res = await api(z.unknown(), fillPath(step.path, got), {
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
        {origin} ·{' '}
        {card.outcome?.code === 'needs_human' && card.state === 'done'
          ? 'Held for a decision'
          : STATE_TEXT[card.state]}
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
          {(modelHelp && fillable.length > 0) ||
          (card.kind === 'start_discovery' && workspace) ? (
            <p className="chat-actions chat-card-help">
              {modelHelp && fillable.length > 0 && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy !== '' || lastFill?.state === 'pending'}
                  onClick={() => void fillIn()}
                >
                  {busy === 'fill' || lastFill?.state === 'pending'
                    ? `Asking ${modelHelp.model}…`
                    : `Fill in with ${modelHelp.model}`}
                </button>
              )}
              {card.kind === 'start_discovery' && workspace && (
                <button
                  type="button"
                  className="secondary"
                  aria-expanded={exploring}
                  // Re-review R2-N1: a pick needs the card's records to keep its claims.
                  disabled={busy !== '' || exploreWait !== null}
                  title={exploreWait ?? undefined}
                  onClick={() => setExploring((x) => !x)}
                >
                  {exploring ? 'Hide Explore for me' : 'Explore for me'}
                </button>
              )}
            </p>
          ) : null}
          {modelHelp && fillable.length > 0 && (
            <p className="small">
              {modelHelp.model} proposes text for this card&apos;s descriptive
              questions from this conversation, as one chat request. It never
              picks, rates or decides anything; you check each proposal, and
              nothing is sent until you press Send.
            </p>
          )}
          {lastFill && lastFill.state !== 'pending' && !used && (
            <FillResult
              fill={lastFill}
              model={modelHelp?.model ?? lastFill.model_id}
              proposed={proposed}
              replacing={replacing}
              matching={matching}
              partly={applied}
              labels={Object.fromEntries(fillable.map((q) => [q.key, q.label]))}
              busy={busy}
              use={(replace) => void useProposals(replace)}
            />
          )}
          {applied && lastFill && (
            <p className="small">
              Answers below include {lastFill.model_id}&apos;s proposals; check
              each before you send.
            </p>
          )}
          {exploring && workspace && (
            <div className="chat-card-explore">
              <p className="small">
                The same Explore for me as on Discover. “Use this” on a problem
                fills this card with its brief and the claims that support it;
                you still check every answer and press Send.
              </p>
              <Explore
                session={session}
                workspace={workspace}
                onUse={(pick) => void usePick(pick)}
                open={(v) => open(v)}
              />
            </div>
          )}
          {asking && (
            <QuestionField
              key={`${asking.key}:${card.version}`}
              q={asking}
              start={
                Object.hasOwn(input, asking.key)
                  ? view.values[asking.key]!
                  : (proposed[asking.key] ??
                    asking.fallback ??
                    (asking.type === 'multi' ? [] : ''))
              }
              proposedBy={
                !Object.hasOwn(input, asking.key) && proposed[asking.key]
                  ? (modelHelp?.model ?? null)
                  : null
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
          {view.blockers.length > 0 && draft && fixFacts && (
            <FixRow
              acts={routeFixes({
                ...fixFacts,
                dataClass: 'public',
                role: 'discovery',
              })}
              fix={{
                base: `workspaces/${workspaceId}`,
                place: `card:${card.id}`,
                csrf: session.csrf_token,
                owner,
                onDone: () => void read(),
              }}
            />
          )}
          {draft && fixFacts && (
            <FixOutcome
              fix={{
                base: `workspaces/${workspaceId}`,
                place: `card:${card.id}`,
                owner,
              }}
            />
          )}
          {!asking && view.happen.length > 0 && (
            <WhatWillHappen
              items={view.happen.map((l) => ({
                label: l.label,
                value: l.value,
                ...(l.source ? { source: l.source } : {}),
              }))}
              note="Nothing happens until you press Send. It makes only the requests listed below, through the form's own routes, which check them exactly as for the form."
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
      {next && card.state === 'done' && (
        <p className="chat-actions">
          {next.run ? (
            <button
              type="button"
              className="secondary strong"
              disabled={next.busy}
              onClick={next.run}
            >
              {next.label}
            </button>
          ) : (
            <span className="small">
              {next.label}. {next.note}
            </span>
          )}
        </p>
      )}
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
  proposedBy = null,
  busy,
  cancel,
  submit,
}: {
  q: Question;
  start: Value;
  /** ADR-0096: the model whose proposal the field starts from, if it does. */
  proposedBy?: string | null;
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
          {proposedBy && (
            <p className="small source">
              Proposed by {proposedBy}; change it as you like before Next.
            </p>
          )}
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
              {/* Review N-2: name the source only when it adds something. */}
              {!Object.hasOwn(input, q.key) &&
                (q.source ?? 'studio default').toLowerCase() !==
                  label(q, v).toLowerCase() && (
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

/** ADR-0096: how a fill ended, its proposals and exactly what was sent. */
function FillResult({
  fill,
  model,
  proposed,
  replacing,
  matching,
  partly,
  labels,
  busy,
  use,
}: {
  fill: ChatActionFill;
  model: string;
  proposed: Record<string, string>;
  /** Proposals for questions that already have the person's answer. */
  replacing: string[];
  /** Some of these proposals are already the card's answers. */
  partly: boolean;
  /** How many proposals equal the card's answers already. */
  matching: number;
  labels: Record<string, string>;
  /** The card's busy state: 'use' or 'use-all' while this saves. */
  busy: string;
  use: (replace: boolean) => void;
}) {
  const keys = Object.keys(proposed);
  const fresh = keys.length - replacing.length;
  return (
    <div className="chat-card-fill" role="group" aria-label="Proposals">
      {keys.length > 0 ? (
        <>
          <p className="chat-meta">
            Proposed by {model} · {when(fill.created_at)} ·{' '}
            {partly ? 'partly used' : 'not used yet'}
          </p>
          <dl className="chat-card-answers">
            {keys.map((k) => (
              <div key={k}>
                <dt>{labels[k] ?? k}</dt>
                <dd>
                  {proposed[k]}
                  {replacing.includes(k) && (
                    <span className="source"> · you already answered this</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {fill.reason && <p className="small">{fill.reason}</p>}
          <p className="chat-actions">
            {fresh > 0 && (
              <button
                type="button"
                className="secondary strong"
                disabled={busy !== ''}
                onClick={() => use(false)}
              >
                {busy === 'use'
                  ? 'Saving…'
                  : replacing.length
                    ? `Use the ${fresh} for unanswered questions`
                    : 'Use these'}
              </button>
            )}
            {replacing.length > 0 && (
              <button
                type="button"
                className="secondary"
                disabled={busy !== ''}
                onClick={() => use(true)}
              >
                {busy === 'use-all'
                  ? 'Saving…'
                  : fresh > 0
                    ? 'Use all, replacing my answers'
                    : 'Replace my answers with these'}
              </button>
            )}
          </p>
          <p className="small">
            Using them saves them as this card&apos;s answers, which you can
            change. Nothing is sent until you press Send.
          </p>
        </>
      ) : (
        <p className="small">{fillOutcomeNote(fill, matching)}</p>
      )}
      {fill.sent && (
        <details className="chat-sent">
          <summary>What was sent to {fill.model_id}</summary>
          <p className="small">
            {fill.sent.input_chars} characters
            {fill.sent.records
              ? ', including studio records the owner allows in chat answers'
              : ', without studio records'}
            ; instructions {fill.sent.instructions_version}.
          </p>
          <pre>{fill.sent.input}</pre>
        </details>
      )}
    </div>
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
        A whole value in braces, such as {'"{run}"'}, is filled in from the
        answer to an earlier request of this card; {'"{time_spent_ms}"'} is the
        time since this card was shown, measured when you press Send.
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
              {r.in_trail === false && (
                <span className="small">
                  {' '}
                  (reported by the page; no audit event names it)
                </span>
              )}
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
