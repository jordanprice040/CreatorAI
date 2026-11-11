import { useMemo, useState } from 'react';
import {
  EntityDetailSchema,
  StoredEntitySchema,
  StoredLinkSchema,
  z,
  type SessionInfo,
  type StoredEntity,
  type StoredLink,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message } from './oversight.js';
import { useLoad, type View } from './ui.js';
import {
  matchesFilter,
  suggestClaims,
  type SuggestableClaim,
} from './claim-suggest.js';
import { requestWebSearch } from './web-search-handoff.js';

// ADR-0091: linking recorded claims to a problem or one of its options from the web app (it
// was CLI-only). A link is a "supports" link, claim → problem or claim → option: the evidence
// an automatic assessment reads for it. Linking marks earlier automatic assessments stale.

export type LinkTarget = {
  id: string;
  version: number;
  kind: 'problem' | 'alternative';
  title: string;
};

const asClaim = (e: StoredEntity): SuggestableClaim => ({
  id: e.id,
  title: e.title,
  text: typeof e.body?.statement === 'string' ? e.body.statement : '',
});
const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const activeEvidence = (l: StoredLink) =>
  !l.retracted_at &&
  l.from.kind === 'claim' &&
  (l.relation === 'supports' || l.relation === 'contradicts');

/** Links each claim as support of the target, one request each; an existing link counts as done. */
async function linkAll(
  session: SessionInfo,
  base: string,
  claims: StoredEntity[],
  target: { id: string; version: number },
  rationale: string,
): Promise<{ linked: number; errors: string[] }> {
  let linked = 0;
  const errors: string[] = [];
  for (const c of claims) {
    try {
      await api(StoredLinkSchema, `${base}/links`, {
        csrf: session.csrf_token,
        body: {
          relation: 'supports',
          from: { id: c.id, version: c.version },
          to: { id: target.id, version: target.version },
          rationale,
        },
      });
      linked++;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE') linked++;
      else errors.push(`${clip(c.title, 60)}: ${message(e)}`);
    }
  }
  return { linked, errors };
}

/**
 * "Link claims": the recorded claims that look like evidence about this problem or option,
 * ticked, with a filter to find any other claim, and a hand-off to Search the web when the
 * workspace has nothing on it yet.
 */
export function LinkClaims({
  session,
  workspace,
  target,
  problemTitle,
  onLinked,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  target: LinkTarget;
  /** For an option, the problem it answers: used in the web search question. */
  problemTitle?: string;
  onLinked: () => void;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const data = useLoad(async () => {
    const [claims, detail] = await Promise.all([
      api(
        z.array(StoredEntitySchema),
        `${base}/entities?kind=claim&status=active`,
      ),
      api(EntityDetailSchema, `${base}/entities/${target.id}`),
    ]);
    // A problem drafted from claims records them as "problem derived_from claim"; those
    // count as linked too (PROBLEM_CLAIMS_SQL).
    const linked = new Set([
      ...detail.incoming
        .filter(activeEvidence)
        .map((l) => l.from.id.toLowerCase()),
      ...detail.outgoing
        .filter(
          (l) =>
            !l.retracted_at &&
            l.relation === 'derived_from' &&
            l.to.kind === 'claim',
        )
        .map((l) => l.to.id.toLowerCase()),
    ]);
    return { claims, linked, version: detail.entity.version };
  }, [workspace.id, target.id, target.version]);
  const d = data.data;
  const suggested = useMemo(
    () =>
      d
        ? suggestClaims(target, d.claims.map(asClaim), d.linked).map(
            (s) => s.id,
          )
        : [],
    [d, target.title],
  );
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const ticked = picked ?? new Set(suggested);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  if (data.error) return <p className="error small">{data.error}</p>;
  if (!d) return <p className="small muted">Loading claims…</p>;
  const byId = new Map(d.claims.map((c) => [c.id, c]));
  const shown = [
    ...suggested,
    ...(filter.trim()
      ? d.claims
          .filter(
            (c) =>
              !d.linked.has(c.id.toLowerCase()) &&
              !suggested.includes(c.id) &&
              matchesFilter(asClaim(c), filter),
          )
          .slice(0, 20)
          .map((c) => c.id)
      : []),
  ];
  const what = target.kind === 'problem' ? 'this problem' : 'this option';
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  async function link() {
    const chosen = [...ticked].flatMap((id) => byId.get(id) ?? []);
    if (!chosen.length) return;
    setBusy(true);
    setNote('');
    setErrors([]);
    const r = await linkAll(
      session,
      base,
      chosen,
      { id: target.id, version: d!.version },
      `Linked as evidence about ${what} from Compare and decide.`,
    );
    setBusy(false);
    setErrors(r.errors);
    if (r.linked) {
      setNote(
        `Linked ${r.linked} claim${r.linked === 1 ? '' : 's'}. Earlier automatic assessments of this problem are now stale; assess again to read ${r.linked === 1 ? 'it' : 'them'}.`,
      );
      setPicked(new Set());
      data.refresh();
      onLinked();
    }
  }
  const bare = (t: string) => t.trim().replace(/[.?!:;,]+$/, '');
  const question = clip(
    target.kind === 'problem'
      ? `What do public sources say about: ${bare(target.title)}?`
      : `What do public sources say about ${bare(target.title)}${problemTitle ? ` for: ${bare(problemTitle)}` : ''}?`,
    300,
  );
  return (
    <div className="link-claims">
      <p className="small">
        {d.linked.size
          ? `${d.linked.size} claim${d.linked.size === 1 ? ' is' : 's are'} already linked to ${what}. `
          : `No claim is linked to ${what} yet. `}
        {suggested.length
          ? 'These recorded claims mention it; untick any that are not about it.'
          : 'No recorded claim mentions it by name. Search below, or find evidence on the web.'}
      </p>
      {shown.length > 0 && (
        <ul className="link-claims-list">
          {shown.map((id) => {
            const c = byId.get(id)!;
            const text = asClaim(c).text;
            return (
              <li key={id}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={ticked.has(id)}
                    onChange={() => toggle(id)}
                  />{' '}
                  <span>
                    <strong>{clip(c.title, 120)}</strong>
                    {text && !text.startsWith(c.title.replace(/…$/, '')) ? (
                      <span className="muted"> · {clip(text, 160)}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <label htmlFor={`lc-filter-${target.id}`} className="small">
        Find another claim
      </label>
      <input
        id={`lc-filter-${target.id}`}
        type="search"
        value={filter}
        placeholder="Words in the claim"
        onChange={(e) => setFilter(e.target.value)}
      />
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy || ticked.size === 0}
          onClick={() => void link()}
        >
          {busy
            ? 'Linking…'
            : `Link ${ticked.size || ''} claim${ticked.size === 1 ? '' : 's'} to ${what}`.replace(
                '  ',
                ' ',
              )}
        </button>{' '}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            requestWebSearch({
              question,
              interests: target.title.slice(0, 120),
            });
            open('submit');
          }}
        >
          Find evidence on the web
        </button>
      </div>
      <p className="small muted">
        Search the web opens in Discover with this filled in. Claims it records
        show up here to link.
      </p>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="error small">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sources › Claims: what this claim is linked to as evidence, and a way to link it to a problem
 * or one of its options, or unlink it.
 */
export function ClaimLinks({
  session,
  workspace,
  claimId,
  editor,
  onChanged,
}: {
  session: SessionInfo;
  workspace: Workspace;
  claimId: string;
  editor: boolean;
  /** The page's own copy of the claim's links is read again. */
  onChanged?: () => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const data = useLoad(async () => {
    const [detail, problems, options] = await Promise.all([
      api(EntityDetailSchema, `${base}/entities/${claimId}`),
      api(
        z.array(StoredEntitySchema),
        `${base}/entities?kind=problem&status=active`,
      ),
      api(
        z.array(StoredEntitySchema),
        `${base}/entities?kind=alternative&status=active`,
      ),
    ]);
    return { detail, problems, options };
  }, [workspace.id, claimId]);
  const [problemId, setProblemId] = useState('');
  const opts = useLoad(async () => {
    if (!problemId) return [];
    const p = await api(EntityDetailSchema, `${base}/entities/${problemId}`);
    return p.incoming
      .filter(
        (l) =>
          !l.retracted_at &&
          l.relation === 'derived_from' &&
          l.from.kind === 'alternative',
      )
      .map((l) => l.from.id.toLowerCase());
  }, [workspace.id, problemId]);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const d = data.data;
  if (data.error) return <p className="error small">{data.error}</p>;
  if (!d) return null;
  const names = new Map(
    [...d.problems, ...d.options].map((e) => [e.id.toLowerCase(), e]),
  );
  // Claim → problem or option links, and "problem derived_from claim" (a drafted problem).
  const links = [
    ...d.detail.outgoing
      .filter(
        (l) =>
          !l.retracted_at &&
          (l.relation === 'supports' || l.relation === 'contradicts') &&
          (l.to.kind === 'problem' || l.to.kind === 'alternative'),
      )
      .map((l) => ({ link: l, kind: l.to.kind, id: l.to.id })),
    ...d.detail.incoming
      .filter(
        (l) =>
          !l.retracted_at &&
          l.relation === 'derived_from' &&
          l.from.kind === 'problem',
      )
      .map((l) => ({ link: l, kind: l.from.kind, id: l.from.id })),
  ];
  const optionChoices = (opts.data ?? []).flatMap((id) => names.get(id) ?? []);
  const target = names.get((targetId || problemId).toLowerCase());
  const already = links.some(
    (l) => l.id.toLowerCase() === target?.id.toLowerCase(),
  );
  async function link() {
    if (!target) return;
    setBusy(true);
    setError('');
    setNote('');
    const r = await linkAll(
      session,
      base,
      [d!.detail.entity],
      target,
      `Linked as evidence about this ${target.kind === 'problem' ? 'problem' : 'option'} from Sources.`,
    );
    setBusy(false);
    if (r.errors.length) setError(r.errors.join(' '));
    else {
      setNote(
        `Linked to “${clip(target.title, 80)}”. Assess that problem again to use it.`,
      );
      data.refresh();
      onChanged?.();
    }
  }
  async function unlink(l: StoredLink) {
    setError('');
    setNote('');
    try {
      await api(StoredLinkSchema, `${base}/links/${l.id}/retract`, {
        csrf: session.csrf_token,
        body: { reason: 'Unlinked from Sources.' },
      });
      data.refresh();
      onChanged?.();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="claim-links">
      <h4>Evidence for</h4>
      {links.length ? (
        <ul className="small">
          {links.map(({ link: l, kind, id }) => {
            const e = names.get(id.toLowerCase());
            return (
              <li key={l.id}>
                {kind === 'problem' ? 'Problem' : 'Option'}:{' '}
                {e ? clip(e.title, 100) : `${kind} ${id.slice(0, 8)}`}
                {l.relation === 'derived_from' ? ' (drafted from it)' : ''}
                {editor && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="text"
                      onClick={() => void unlink(l)}
                    >
                      Unlink
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="small">
          Not linked to any problem or option, so no assessment reads it.
        </p>
      )}
      {editor && d.problems.length > 0 && (
        <div className="two">
          <div>
            <label htmlFor="cl-problem">Link to problem</label>
            <select
              id="cl-problem"
              value={problemId}
              onChange={(e) => {
                setProblemId(e.target.value);
                setTargetId('');
              }}
            >
              <option value="">Choose a problem</option>
              {d.problems.map((p) => (
                <option key={p.id} value={p.id}>
                  {clip(p.title, 90)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cl-option">About</label>
            <select
              id="cl-option"
              value={targetId}
              disabled={!problemId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              <option value="">The problem itself</option>
              {optionChoices.map((o) => (
                <option key={o.id} value={o.id}>
                  Option: {clip(o.title, 80)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {editor && problemId && (
        <button
          type="button"
          className="secondary"
          disabled={busy || !target || already}
          onClick={() => void link()}
        >
          {busy ? 'Linking…' : already ? 'Already linked' : 'Link as evidence'}
        </button>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
