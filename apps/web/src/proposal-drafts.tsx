import { useRef, useState } from 'react';
import {
  ChatSettingsSchema,
  PROPOSAL_DRAFTABLE_SECTIONS,
  PROPOSAL_SECTION_LABELS,
  ProposalSectionDraftSchema,
  planWaitMs,
  z,
  type DraftableSection,
  type ProposalDetail,
  type ProposalSectionDraft,
  type SessionInfo,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { usePoll } from './page-active.js';
import { StaleNote, useLoad } from './ui.js';
import type { Offer } from './proposal-draft-rules.js';

// ADR-0101 (UX pass P-5): "Draft the missing sections". The owner asks the workspace's chat
// model to draft a saved proposal's unknown plan sections; each draft shows under its section
// as a model draft, and nothing changes until the person uses one and saves a new version.

/** A plan answer can take as long as the connection allows; this is the wait when unread. */
const DRAFT_TIMEOUT_MS = 330_000;
const ConnectionTimeoutSchema = z.object({
  connection: z.object({
    settings: z.object({
      caps: z.object({
        responses: z.object({ request_timeout_ms: z.number() }),
      }),
    }),
  }),
});

/** The proposal's model drafts, newest first; read again while one is on its way. */
export function useSectionDrafts(base: string, proposalId: string | null) {
  const drafts = useLoad(
    async () =>
      proposalId
        ? api(
            z.array(ProposalSectionDraftSchema),
            `${base}/proposals/${proposalId}/section-drafts`,
          )
        : [],
    [base, proposalId],
  );
  usePoll(
    drafts.refresh,
    3000,
    !!drafts.data?.some((d) => d.state === 'pending'),
  );
  return drafts;
}

const label = (k: string) =>
  PROPOSAL_SECTION_LABELS[k as DraftableSection] ?? k;

/** The button, what it sends, and how the newest draft ended. Owner only. */
export function DraftMissing({
  base,
  session,
  detail,
  owner,
  dirty,
  drafts,
  drafted,
}: {
  base: string;
  session: SessionInfo;
  /** The current saved version (never an older one). */
  detail: ProposalDetail;
  owner: boolean;
  dirty: boolean;
  /** The proposal's drafts as `useSectionDrafts` reads them. */
  drafts: { data: ProposalSectionDraft[] | null; stale: string };
  drafted: () => void;
}) {
  const body = detail.proposal.body;
  const missing = PROPOSAL_DRAFTABLE_SECTIONS.filter(
    (k) => body.sections[k].state === 'unknown',
  );
  const [picked, setPicked] = useState<Set<DraftableSection>>(
    () => new Set(missing),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clientId = useRef<string>(crypto.randomUUID());
  const settings = useLoad(
    () => api(ChatSettingsSchema, `${base}/chat-settings`).catch(() => null),
    [base],
  );
  const s = settings.data;
  const ready =
    !!s && s.enabled && !!s.connection_id && !!s.model_id && s.include_snapshot;
  const newest = drafts.data?.[0];
  const asked = missing.filter((k) => picked.has(k));
  if (missing.length === 0 && !newest) return null;

  async function wait(): Promise<number> {
    if (!s?.connection_id) return DRAFT_TIMEOUT_MS;
    try {
      const d = await api(
        ConnectionTimeoutSchema,
        `${base}/plan-connections/${s.connection_id}`,
      );
      return Math.max(
        DRAFT_TIMEOUT_MS,
        planWaitMs(d.connection.settings.caps.responses.request_timeout_ms),
      );
    } catch {
      return DRAFT_TIMEOUT_MS;
    }
  }
  async function draft() {
    if (!asked.length) return;
    setBusy(true);
    setError('');
    try {
      await api(
        ProposalSectionDraftSchema,
        `${base}/proposals/${detail.proposal.id}/section-drafts`,
        {
          csrf: session.csrf_token,
          body: {
            client_id: clientId.current,
            version: detail.proposal.version,
            sections: asked,
          },
          timeoutMs: await wait(),
        },
      );
      // A finished press gets a fresh id, so the next press asks again.
      clientId.current = crypto.randomUUID();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      drafted();
    }
  }

  return (
    <section className="proposal-drafts" aria-labelledby="draft-missing-h">
      <h3 id="draft-missing-h">Draft the missing sections</h3>
      {missing.length > 0 && (
        <>
          <p className="small">
            Asks your chat model
            {s?.model_id ? ` (${s.model_id})` : ''} to draft the plan sections
            that are still Unknown yet. It sends this version’s title, summary,
            written sections and the statements of its cited claims. Each draft
            appears under its section labelled as a model draft; nothing changes
            until you use a draft and save. Facts the records do not support
            stay Unknown yet. It counts toward the daily chat limit.
          </p>
          {owner ? (
            <>
              <fieldset className="draft-picks">
                <legend className="small">Sections to draft</legend>
                {missing.map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={picked.has(k)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(k);
                          else n.delete(k);
                          return n;
                        })
                      }
                    />{' '}
                    {label(k)}
                  </label>
                ))}
              </fieldset>
              {s && !ready && (
                <p className="notice small">
                  {!s.enabled || !s.connection_id || !s.model_id
                    ? 'Drafting uses your chat model, and Chat answers are off. Turn them on under Models and connections.'
                    : 'Your chat setting keeps studio records in the studio, so a proposal cannot be sent. Allow studio records in Chat answers under Models and connections to draft.'}
                </p>
              )}
              {dirty && (
                <p className="small">
                  Save your changes first; the model drafts from the saved
                  version.
                </p>
              )}
              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    busy ||
                    dirty ||
                    !asked.length ||
                    (!!s && !ready) ||
                    newest?.state === 'pending'
                  }
                  onClick={() => void draft()}
                >
                  {busy || newest?.state === 'pending'
                    ? `Drafting with ${s?.model_id ?? 'your chat model'}…`
                    : `Draft ${asked.length === missing.length ? 'the missing sections' : `${asked.length} of ${missing.length} sections`}`}
                </button>
              </div>
            </>
          ) : (
            <p className="small">
              Only the workspace owner can ask the chat model to draft.
            </p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
      <StaleNote stale={drafts.stale || settings.stale} />
      {newest && (
        <DraftOutcome draft={newest} current={detail.proposal.version} />
      )}
    </section>
  );
}

function DraftOutcome({
  draft: d,
  current,
}: {
  draft: ProposalSectionDraft;
  current: number;
}) {
  const written = Object.values(d.values).filter(
    (v) => v?.state === 'written',
  ).length;
  return (
    <div className="small" role="status">
      <p>
        {d.state === 'pending'
          ? `Drafting with ${d.model_id} since ${when(d.created_at)}…`
          : d.state === 'completed'
            ? `${d.model_id} drafted ${written} of ${d.sections.length} ${d.sections.length === 1 ? 'section' : 'sections'} ${when(d.finished_at ?? d.created_at)}${d.proposal_version !== current ? ` (from version ${d.proposal_version})` : ''}. ${written ? 'Each shows under its section; use the ones you agree with, then save.' : ''}`
            : `The last draft ${d.state === 'refused' ? 'was not sent' : 'failed'}.`}
        {d.fixture
          ? ' Fixture connection: the text is canned, not a model’s.'
          : ''}
      </p>
      {d.reason && (
        <p className={d.state === 'completed' ? undefined : 'error'}>
          {d.reason}
        </p>
      )}
      {d.sent && (
        <details>
          <summary>What was sent</summary>
          <p>
            Instructions {d.sent.instructions_version} (hash{' '}
            {d.sent.instructions_hash.slice(0, 12)}), with{' '}
            {d.sent.sections_sent} written{' '}
            {d.sent.sections_sent === 1 ? 'section' : 'sections'}:
          </p>
          <pre className="sent-input">{d.sent.input}</pre>
        </details>
      )}
    </div>
  );
}

/** Under one section: the model's draft, with Use and Dismiss. */
export function SectionDraftOffer({
  offer,
  section,
  editable,
  use,
  dismiss,
}: {
  offer: Offer;
  section: string;
  editable: boolean;
  use: () => void;
  dismiss: () => void;
}) {
  const v = offer.value;
  return (
    <div
      className="model-draft"
      role="group"
      aria-label={`Model draft of ${label(section)}`}
    >
      <p className="small">
        <strong>Model draft</strong> by {offer.model} · {when(offer.at)} · not
        part of the proposal until you use it
      </p>
      {v.state === 'written' ? (
        <p className="model-draft-text">{v.text}</p>
      ) : (
        <p className="small">
          <strong>Unknown yet.</strong> The model could not draft this from the
          records{v.text ? `: ${v.text}` : '.'}
        </p>
      )}
      {editable && (
        <div className="actions">
          {v.state === 'written' && (
            <button type="button" className="secondary" onClick={use}>
              Use this draft
            </button>
          )}
          <button type="button" className="text" onClick={dismiss}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
