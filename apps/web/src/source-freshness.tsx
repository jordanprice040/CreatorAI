import { useRef, useState } from 'react';
import {
  SOURCE_RECHECK_MAX,
  SourceRecheckResultSchema,
  type ClaimEvidence,
  type SessionInfo,
  type SourceRecheckResult,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { InlineApproval } from './inline-approval.js';
import type { View } from './ui.js';
import {
  FLAGGED,
  checkedAgo,
  claimFlags,
  claimFreshness,
  claimFreshnessLine,
  passageNote,
  recheckIntro,
  recheckSummary,
  recheckWaitMs,
} from './source-freshness-rules.js';
import './source-freshness.css';

// F8 (ADR-0126): source freshness on Decide. When each claim's sources were last checked, a
// flag when a newer fetch found a cited passage changed, a page gone or a page moved, and a
// button that refetches the cited sources (fetches only, under the run's permission and approved sites).

/** Beside a claim's one-line summary: when its sources were checked, and any flag. */
export function ClaimFreshnessNote({ c }: { c: ClaimEvidence }) {
  const f = claimFreshness(c);
  const line = claimFreshnessLine(f, Date.now());
  const flags = claimFlags(f);
  if (!line && !flags.length) return null;
  return (
    <>
      {line && (
        <small
          className="sf-checked"
          title={f.oldest ? `Oldest check: ${when(f.oldest)}` : undefined}
        >
          {' '}
          · {line}
        </small>
      )}
      {flags.map((x) => (
        <span key={x} className="sf-flag">
          {x}
        </span>
      ))}
    </>
  );
}

/** Beside one cited passage: when its source was checked and what the newest check found. */
export function PassageFreshness({
  row,
}: {
  row: ClaimEvidence['rows'][number];
}) {
  const note = passageNote(row.passage_check, row.freshness);
  return (
    <>
      {' · '}
      <span
        className="sf-checked"
        title={row.last_checked_at ? when(row.last_checked_at) : undefined}
      >
        {row.last_checked_at
          ? `checked ${checkedAgo(row.last_checked_at, Date.now())}`
          : 'never checked'}
      </span>
      {note && (
        <>
          {' · '}
          <span
            className={
              FLAGGED.has(row.passage_check) ? 'sf-row-flag' : 'sf-row-note'
            }
          >
            {note}
          </span>
        </>
      )}
    </>
  );
}

/**
 * "Refetch sources": fetches each source this problem's claims cite again, under the chosen
 * run. A fetch that needs approval stops the recheck and can be approved here.
 */
export function RecheckSources({
  session,
  workspace,
  problemId,
  runId,
  runName,
  sources,
  onDone,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  problemId: string;
  /** The run chosen on this page; its fetch permission and fetch limit apply. */
  runId: string;
  runName: string;
  /** Distinct sources the problem's claims cite. */
  sources: number;
  onDone: () => void;
  open: (view: View, id?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SourceRecheckResult | null>(null);
  // Review N-4: a press that got no answer is sent again with the same id, so the studio
  // replays the fetches it already made instead of fetching again; an answered press ends it.
  const pending = useRef<{ id: string; run: string } | null>(null);
  async function recheck() {
    setBusy(true);
    setError('');
    if (pending.current?.run !== runId)
      pending.current = { id: crypto.randomUUID(), run: runId };
    try {
      const r = await api(
        SourceRecheckResultSchema,
        `workspaces/${workspace.id}/problems/${problemId}/source-rechecks`,
        {
          body: { run_id: runId, recheck_id: pending.current.id },
          csrf: session.csrf_token,
          timeoutMs: recheckWaitMs(SOURCE_RECHECK_MAX),
        },
      );
      pending.current = null;
      setResult(r);
      onDone();
    } catch (e) {
      // Review L-5: the studio may still be fetching after the page stops waiting.
      setError(
        e instanceof DOMException &&
          (e.name === 'TimeoutError' || e.name === 'AbortError')
          ? 'The page stopped waiting, but the refetch may still be running. Press Refresh in a minute to see what it found, or press Refetch sources to pick it up where it is.'
          : message(e),
      );
    } finally {
      setBusy(false);
    }
  }
  const waiting = result?.sources.find(
    (s) => s.state === 'needs_human' && s.decision_id,
  );
  return (
    <div className="sf-recheck">
      <p className="small">
        <button
          type="button"
          className="secondary"
          disabled={busy || !runId || sources === 0}
          onClick={() => void recheck()}
        >
          {busy ? 'Refetching…' : 'Refetch sources'}
        </button>{' '}
        <span className="muted">
          {!runId
            ? 'Choose an active run below first: a refetch uses its permission to fetch pages.'
            : sources === 0
              ? 'These claims cite no sources.'
              : `${recheckIntro(sources, SOURCE_RECHECK_MAX)} under ${runName}, from approved sites only. No model requests; claims are flagged, never changed or re-assessed.`}
        </span>
      </p>
      {busy && (
        <p className="small muted" role="status">
          Fetching each page in turn; this can take a few minutes.
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="sf-result" role="status">
          <p className="small">{recheckSummary(result)}</p>
          {result.sources.some(
            (s) => s.outcome !== 'unchanged' && s.outcome !== 'not_tried',
          ) && (
            <ul className="small sf-list">
              {result.sources
                .filter(
                  (s) => s.outcome !== 'unchanged' && s.outcome !== 'not_tried',
                )
                .map((s) => (
                  <li key={s.source_id}>
                    <button
                      type="button"
                      className="text"
                      onClick={() => open('evidence', `source:${s.source_id}`)}
                    >
                      {s.title}
                    </button>
                    {': '}
                    {s.outcome === 'changed'
                      ? 'changed; a new version was recorded'
                      : s.outcome === 'page_gone'
                        ? 'removed or unreadable'
                        : s.outcome === 'moved'
                          ? `now redirects to ${s.moved_to ?? 'another page'}; the cited source has no new version`
                          : (s.explanation ?? 'not checked')}
                  </li>
                ))}
            </ul>
          )}
          {result.sources.some(
            (s) => s.outcome === 'changed' || s.outcome === 'moved',
          ) && (
            <p className="small muted">
              Claims marked “needs recheck” still need re-assessing against the
              new versions: refetching records what the pages say now, it does
              not re-assess any claim.
            </p>
          )}
          {waiting && (
            <InlineApproval
              key={waiting.decision_id}
              workspace={workspace.id}
              fixture={workspace.record_mode === 'fixture'}
              decisionId={waiting.decision_id!}
              csrf={session.csrf_token}
              owner={workspace.role === 'owner'}
              actorId={session.actor_id}
              approveLabel="Approve this fetch once and refetch again"
              onApproved={() => recheck()}
              againLabel="I approved it: refetch again"
              retryLabel="Refetch again"
              openApprovals={() => open('decisions', waiting.decision_id!)}
            />
          )}
        </div>
      )}
    </div>
  );
}
