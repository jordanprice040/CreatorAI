import { useRef, useState } from 'react';
import {
  SpecDraftSchema,
  checkedAgainst,
  draftCounts,
  formatBrowserStep,
  planWaitMs,
  z,
  type SessionInfo,
  type SpecCaseProblem,
  type SpecContent,
  type SpecDraft,
  type SpecDraftCheck,
  type SpecProduct,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { usePoll } from './page-active.js';
import { StaleNote, useLoad } from './ui.js';
import { draftRoute } from './spec-fields.js';

// ADR-0107 (B2): model-drafted build specs on Build › Write a spec. A model qualified for
// drafting specs (spec-cases-v1) proposes the spec and its suggested cases, one more edge case
// for a check, or an explanation of a case. Every reply is a draft shown beside the form: the
// studio checks the cases' shape and picks about a third as held out at random, and nothing is
// saved, frozen or built until the person saves the form and freezes the spec.

/** A plan answer can take as long as the connection allows; this is the wait when unread. */
const DRAFT_TIMEOUT_MS = 330_000;
const RouteSchema = z.object({
  connection_id: z.string(),
  connection_kind: z.string(),
  label: z.string(),
  model_id: z.string(),
  fixture: z.boolean(),
});
export type DraftRouteOption = z.infer<typeof RouteSchema>;
const RoutesSchema = z.object({ routes: z.array(RouteSchema) });
const ConnectionTimeoutSchema = z.object({
  connection: z.object({
    settings: z.object({
      caps: z.object({
        responses: z.object({ request_timeout_ms: z.number() }),
      }),
    }),
  }),
});

/** The option's drafts, newest first; read again while one is on its way. None without an option. */
export function useSpecDrafts(base: string, alternativeId: string) {
  const drafts = useLoad(
    () =>
      alternativeId
        ? api(
            z.array(SpecDraftSchema),
            `${base}/spec-drafts?alternative=${encodeURIComponent(alternativeId)}`,
          )
        : Promise.resolve([] as SpecDraft[]),
    [base, alternativeId],
  );
  usePoll(
    drafts.refresh,
    3000,
    !!drafts.data?.some((d) => d.state === 'pending'),
  );
  return drafts;
}

/**
 * Where drafts go: the models qualified for drafting specs, the person's current one first,
 * and one press of a draft (each press gets a fresh id, so a retried click never asks twice).
 */
export function useDraftAsk({
  base,
  session,
  choice,
  owner,
  selection,
  drafted,
}: {
  base: string;
  session: SessionInfo;
  choice: { connection_id: string; model_id: string } | null;
  owner: boolean;
  /** The selection the spec is for: only connections allowing its data class are listed. */
  selection: string;
  drafted: () => void;
}) {
  const routes = useLoad(
    () =>
      owner
        ? api(
            RoutesSchema,
            `${base}/spec-drafts/routes?selection=${encodeURIComponent(selection)}`,
          )
        : Promise.resolve({ routes: [] }),
    [base, owner, selection],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; text: string } | null>(
    null,
  );
  const ids = useRef(new Map<string, string>());
  const route = draftRoute(routes.data?.routes ?? [], choice, picked);

  async function wait(connectionId: string): Promise<number> {
    try {
      const d = await api(
        ConnectionTimeoutSchema,
        `${base}/plan-connections/${connectionId}`,
      );
      return Math.max(
        DRAFT_TIMEOUT_MS,
        planWaitMs(d.connection.settings.caps.responses.request_timeout_ms),
      );
    } catch {
      return DRAFT_TIMEOUT_MS;
    }
  }
  /** Sends one draft request; `key` names the button, so its busy state and error stay with it. */
  async function ask(
    key: string,
    body: {
      kind: SpecDraft['kind'];
      selection_id: string;
      alternative: { id: string; version: number };
      product: SpecProduct;
      check: SpecDraftCheck | null;
      case_index: number | null;
    },
  ): Promise<SpecDraft | null> {
    if (!route) return null;
    if (!ids.current.has(key)) ids.current.set(key, crypto.randomUUID());
    setBusy(key);
    setError(null);
    try {
      const d = await api(SpecDraftSchema, `${base}/spec-drafts`, {
        csrf: session.csrf_token,
        body: {
          ...body,
          client_id: ids.current.get(key),
          connection_id: route.connection_id,
          model_id: route.model_id,
        },
        timeoutMs: await wait(route.connection_id),
      });
      ids.current.delete(key);
      return d;
    } catch (e) {
      setError({ key, text: message(e) });
      return null;
    } finally {
      setBusy(null);
      drafted();
    }
  }
  return {
    routes,
    route,
    pick: setPicked,
    busy,
    error,
    ask,
  };
}
export type DraftAsk = ReturnType<typeof useDraftAsk>;

/** The model a draft goes to, with a picker when more than one may draft. */
export function DraftRoutePicker({ ask }: { ask: DraftAsk }) {
  const list = ask.routes.data?.routes ?? [];
  if (list.length < 2 || !ask.route) return null;
  const key = (r: DraftRouteOption) => `${r.connection_id}/${r.model_id}`;
  return (
    <div className="inline-form">
      <label htmlFor="sd-route" className="inline">
        Draft with
      </label>
      <select
        id="sd-route"
        value={key(ask.route)}
        onChange={(e) => ask.pick(e.target.value)}
      >
        {list.map((r) => (
          <option key={key(r)} value={key(r)}>
            {r.model_id} · {r.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** What a draft reply became, in one line. */
export function draftLine(d: SpecDraft): string {
  if (d.state === 'pending')
    return `Drafting with ${d.model_id} since ${when(d.created_at)}…`;
  if (d.state === 'refused') return 'The last draft was not sent.';
  if (d.state === 'failed') return 'The last draft failed.';
  if (!d.result) return `${d.model_id} answered, but nothing could be used.`;
  if (d.result.kind === 'spec') {
    const n = draftCounts(d.result.content);
    return `${d.model_id} drafted ${n.checks} acceptance check${n.checks === 1 ? '' : 's'} with ${n.cases} suggested case${n.cases === 1 ? '' : 's'} ${when(d.finished_at ?? d.created_at)}. The studio held out ${n.held_out} at random.`;
  }
  return `${d.model_id} answered ${when(d.finished_at ?? d.created_at)}.`;
}

/** The fixed notes every drafted spec carries: what the studio can and cannot check. */
export function DraftHonesty() {
  return (
    <ul className="small draft-honesty">
      <li>
        The cases are yours to check. The studio checks their shape and finds
        repeats and contradictions; it cannot know whether an expected output is
        right.
      </li>
      <li>
        A model of the same family may write the code, and the two can share
        blind spots. The independent reviewer and the held-out cases (which
        neither builder nor reviewer sees) stay in place.
      </li>
      <li>
        Nothing is saved, frozen or built until you save the spec, freeze it and
        start a build.
      </li>
    </ul>
  );
}

/** The newest whole-spec draft of this option: its outcome, notes, problems and preview. */
export function SpecDraftOffer({
  draft: d,
  used,
  replaces,
  use,
}: {
  draft: SpecDraft;
  /** This draft is the one the form now holds. */
  used: boolean;
  /** Using it replaces edits made in the form. */
  replaces: boolean;
  use: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const r = d.result?.kind === 'spec' ? d.result : null;
  return (
    <div
      className="model-draft"
      role="group"
      aria-label={`Model draft by ${d.model_id}`}
    >
      <p className="small" role="status">
        <strong>Model draft</strong> · {draftLine(d)}
        {d.fixture
          ? ' Fixture connection: the text is canned, not a model’s.'
          : ''}
      </p>
      {d.reason && <p className={r ? 'small' : 'error'}>{d.reason}</p>}
      {r && (
        <>
          <p>
            <strong>{r.title}</strong>
          </p>
          {r.notes && (
            <p className="model-draft-text small">
              <strong>The model’s notes:</strong> {r.notes}
            </p>
          )}
          <CaseProblems
            problems={d.problems}
            title="The studio’s checks of the drafted cases"
          />
          <CheckedAgainst content={r.content} />
          <DraftHonesty />
          <div className="actions">
            {used ? (
              <span className="small">
                In the form below. Check every case.
              </span>
            ) : replaces && !confirm ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setConfirm(true)}
              >
                Use this draft
              </button>
            ) : (
              <button type="button" className="secondary" onClick={use}>
                {replaces
                  ? 'Replace what I typed with this draft'
                  : 'Use this draft'}
              </button>
            )}
            {confirm && !used && (
              <button
                type="button"
                className="text"
                onClick={() => setConfirm(false)}
              >
                Keep what I typed
              </button>
            )}
          </div>
          {confirm && !used && (
            <p className="small notice">
              This replaces everything typed in the form below with the draft;
              who maintains it and how often it is reviewed stay as they are.
            </p>
          )}
        </>
      )}
      {d.sent && <SentInput draft={d} />}
    </div>
  );
}

export function SentInput({ draft: d }: { draft: SpecDraft }) {
  if (!d.sent) return null;
  return (
    <details className="small">
      <summary>What was sent</summary>
      <p>
        Instructions {d.sent.instructions_version} (hash{' '}
        {d.sent.instructions_hash.slice(0, 12)}), to {d.model_id}:
      </p>
      <pre className="sent-input">{d.sent.input}</pre>
    </details>
  );
}

/** Problems in plain words: errors first. */
export function CaseProblems({
  problems,
  title,
}: {
  problems: readonly SpecCaseProblem[];
  title: string;
}) {
  if (!problems.length) return <p className="small">{title}: nothing found.</p>;
  const sorted = [...problems].sort(
    (a, b) => Number(a.level === 'warning') - Number(b.level === 'warning'),
  );
  const errors = problems.filter((p) => p.level === 'error').length;
  return (
    <div className="case-problems small">
      <p>
        <strong>{title}:</strong>{' '}
        {errors
          ? `${errors} to fix${problems.length > errors ? `, ${problems.length - errors} to look at` : ''}`
          : `${problems.length} to look at`}
      </p>
      <ul>
        {sorted.map((p, i) => (
          <li key={i} className={p.level === 'error' ? 'error' : undefined}>
            {p.level === 'error' ? 'Fix: ' : 'Look: '}
            {p.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "What the build will be checked against", one line per case. */
export function CheckedAgainst({
  content,
  open = false,
}: {
  content: SpecContent;
  open?: boolean;
}) {
  const list = checkedAgainst(content);
  if (!list.length) return null;
  const n = draftCounts(content);
  return (
    <details className="small checked-against" open={open}>
      <summary>
        What the build will be checked against ({n.cases} case
        {n.cases === 1 ? '' : 's'}, {n.held_out} held out)
      </summary>
      {list.map((c) => (
        <div key={c.check}>
          <p>
            <strong>{c.check}</strong> {c.statement}
          </p>
          <ul>
            {c.lines.map((l, i) => (
              <li key={i}>
                {l.held_out && (
                  <span className="tag">held out, only QA runs it</span>
                )}{' '}
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

/** An edge case a model suggested for one check, with Add and Dismiss. */
export function EdgeCaseOffer({
  draft: d,
  add,
  dismiss,
}: {
  draft: SpecDraft;
  add: (() => void) | null;
  dismiss: () => void;
}) {
  const r = d.result?.kind === 'edge_case' ? d.result : null;
  return (
    <div
      className="model-draft"
      role="group"
      aria-label={`Edge case suggested by ${d.model_id}`}
    >
      <p className="small" role="status">
        <strong>Suggested edge case</strong> · {draftLine(d)}
      </p>
      {d.reason && <p className={r ? 'small' : 'error'}>{d.reason}</p>}
      {r && (
        <>
          {r.why && <p className="model-draft-text small">{r.why}</p>}
          <pre className="sent-input mono">
            {r.case
              ? `args: ${JSON.stringify(r.case.args)}\nstdin: ${JSON.stringify(r.case.stdin)}\nexpected stdout: ${JSON.stringify(r.case.stdout)}\nexit code: ${r.case.exit_code}`
              : r.browser_case
                ? `page: ${r.browser_case.page}\n${r.browser_case.steps.map(formatBrowserStep).join('\n')}`
                : ''}
          </pre>
          {d.problems.length > 0 && (
            <CaseProblems problems={d.problems} title="The studio’s checks" />
          )}
          <p className="small">
            Work the expected result out yourself before adding it; the studio
            cannot tell whether it is right.
          </p>
        </>
      )}
      <div className="actions">
        {r && add && (
          <button type="button" className="secondary" onClick={add}>
            Add this case
          </button>
        )}
        <button type="button" className="text" onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <SentInput draft={d} />
    </div>
  );
}

/** A model's explanation of one case, with Dismiss. */
export function Explanation({
  draft: d,
  dismiss,
}: {
  draft: SpecDraft;
  dismiss: () => void;
}) {
  const r = d.result?.kind === 'explain_case' ? d.result : null;
  return (
    <div
      className="model-draft"
      role="group"
      aria-label={`Explanation by ${d.model_id}`}
    >
      <p className="small" role="status">
        <strong>Explanation</strong> · {draftLine(d)} It describes the case as
        it was when you asked.
      </p>
      {d.reason && <p className={r ? 'small' : 'error'}>{d.reason}</p>}
      {r && <p className="model-draft-text small">{r.explanation}</p>}
      <div className="actions">
        <button type="button" className="text" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

/** A failed read of the drafts or of the models that may draft, said in place. */
export function DraftReads({
  drafts,
  ask,
}: {
  drafts: ReturnType<typeof useSpecDrafts>;
  ask: DraftAsk;
}) {
  const routes = ask.routes;
  return (
    <>
      {routes.error && (
        <p className="error" role="alert">
          Could not read which models may draft specs: {routes.error}
        </p>
      )}
      {drafts.error && (
        <p className="error" role="alert">
          Could not read this option’s drafts: {drafts.error}
        </p>
      )}
      <StaleNote stale={drafts.stale || routes.stale} />
    </>
  );
}
