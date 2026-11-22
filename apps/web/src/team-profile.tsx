import { useEffect, useMemo, useState } from 'react';
import {
  CapabilityCheckResultSchema,
  GATE_CLEAR_MODES,
  GateChecklistSchema,
  GateRuleSchema,
  MAX_CHECKLIST_ITEMS,
  STARTER_GATE_CHECKLIST,
  TEAM_CAPABILITIES,
  TeamProfileSchema,
  type GateChecklistItem,
  type GateClearMode,
  type GateKind,
  type SessionInfo,
  type TeamCapabilityKey,
  type TeamProfile,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import { Status, useLoad } from './ui.js';
import { Explain } from './explain.js';

type Status3 = 'yes' | 'no' | 'unknown';
const STATUS_LABEL: Record<Status3, string> = {
  yes: 'Yes',
  no: 'No',
  unknown: 'Don’t know',
};

/** What the page edits: each capability's answer and note, and the notes. */
function draftOf(t: TeamProfile) {
  const caps = Object.fromEntries(
    TEAM_CAPABILITIES.map((c) => {
      const x = t.profile.capabilities.find((y) => y.key === c.key);
      return [
        c.key,
        { status: (x?.status ?? 'unknown') as Status3, note: x?.note ?? '' },
      ];
    }),
  ) as Record<TeamCapabilityKey, { status: Status3; note: string }>;
  return { caps, notes: t.profile.notes };
}

/** How one capability is known now, in words. */
export function basisText(t: TeamProfile, key: TeamCapabilityKey): string {
  const x = t.profile.capabilities.find((y) => y.key === key);
  if (!x) return 'not answered';
  if (x.basis === 'check' && x.check)
    return `checked: ${x.check.detail}${x.check.machine ? ` on ${x.check.machine}` : ''}, ${when(x.check.checked_at)}`;
  return 'declared by you';
}

/**
 * Settings › Team profile (ADR-0090). What the team can run, install and do with data, ticked by
 * hand or found by a built-in check on this computer. Every automatic assessment reads it, so an
 * access question it answers is no longer flagged as "not established". Only the workspace
 * owner can change it; agents can read it but never write it. Also the owner's auto-clear rule.
 */
export function TeamProfilePanel({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const path = `workspaces/${workspace.id}/team-profile`;
  const data = useLoad(() => api(TeamProfileSchema, path), [workspace.id]);
  const t = data.data;
  // Saving the checklist or the gate rule reloads both (PR #185 review N-3).
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<ReturnType<typeof draftOf> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    if (t && !draft) setDraft(draftOf(t));
  }, [t]);

  const dirty =
    !!t && !!draft && JSON.stringify(draftOf(t)) !== JSON.stringify(draft);

  async function save() {
    if (!t || !draft) return;
    setBusy('save');
    setError('');
    setNotice('');
    try {
      const next = await api(TeamProfileSchema, path, {
        csrf: session.csrf_token,
        body: {
          expected_version: t.version,
          capabilities: TEAM_CAPABILITIES.map((c) => ({
            key: c.key,
            status: draft.caps[c.key].status,
            note: draft.caps[c.key].note.trim() || null,
          })),
          notes: draft.notes,
        },
      });
      setDraft(draftOf(next));
      data.reload();
      setNotice(
        `Saved as version ${next.version}. Assess again so the ratings read it; earlier automatic assessments show as out of date if what they read changed.`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setDraft(null);
        data.reload();
      }
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function check(key: TeamCapabilityKey) {
    if (!t) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const r = await api(CapabilityCheckResultSchema, `${path}/checks`, {
        csrf: session.csrf_token,
        body: { expected_version: t.version, capability: key },
      });
      setNotice(
        r.saved
          ? `${r.detail} Earlier automatic assessments now show as out of date.`
          : r.detail,
      );
      if (r.saved) setDraft(draftOf(r.profile));
      data.reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        setDraft(null);
        data.reload();
      }
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h3 id="team-profile">Team profile</h3>
      <Explain
        short="What your team can run, install and do with data."
        className=""
      >
        What your team can run, install and do with data. Every automatic
        assessment in <strong>{workspace.name}</strong> reads it, so a question
        like “can the team install Python tools?” is answered instead of
        blocking an option. Tick answers yourself
        {t?.checks_available !== false
          ? ', or run a built-in check that looks for the program on this computer'
          : ''}
        . Only you can change it; agents can read it but never write it.
      </Explain>
      <Explain>
        The answers, their notes and the notes below are sent to the model
        provider with every automatic assessment (the assessment preview shows
        them). Leave out anything you would not send there. Host names are never
        sent.
      </Explain>
      <Status
        loading={data.loading && !t}
        error={data.error}
        stale={data.stale}
        retry={data.reload}
      >
        {t && draft && (
          <>
            <p className="small">
              {t.version
                ? `Version ${t.version}, saved ${when(t.updated_at ?? '')}.`
                : 'Not saved yet: assessments do not get a team profile.'}
              {t.machine && (
                <>
                  {' '}
                  Built-in checks run on <strong>{t.machine}</strong>, the
                  computer this studio runs on.
                </>
              )}
            </p>
            <table className="team-profile">
              <thead>
                <tr>
                  <th scope="col">Can the team…</th>
                  <th scope="col">Answer</th>
                  <th scope="col">How it’s known</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {TEAM_CAPABILITIES.map((c) => (
                  <tr key={c.key}>
                    <th scope="row">{c.label}</th>
                    <td>
                      <select
                        aria-label={`${c.label}: answer`}
                        disabled={!t.can_edit || !!busy}
                        value={draft.caps[c.key].status}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            caps: {
                              ...draft.caps,
                              [c.key]: {
                                ...draft.caps[c.key],
                                status: e.target.value as Status3,
                              },
                            },
                          })
                        }
                      >
                        {(['yes', 'no', 'unknown'] as const).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="small">
                      {basisText(t, c.key)}
                      {c.check && t.can_edit && t.checks_available && (
                        <>
                          {' '}
                          <button
                            className="text"
                            disabled={!!busy || dirty}
                            title={
                              dirty
                                ? 'Save or undo your changes first'
                                : undefined
                            }
                            onClick={() => void check(c.key)}
                          >
                            {busy === c.key ? 'Checking…' : 'Run check'}
                          </button>
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        aria-label={`${c.label}: note`}
                        disabled={!t.can_edit || !!busy}
                        maxLength={300}
                        value={draft.caps[c.key].note}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            caps: {
                              ...draft.caps,
                              [c.key]: {
                                ...draft.caps[c.key],
                                note: e.target.value,
                              },
                            },
                          })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label htmlFor="team-notes">
              Anything else an assessment should know about the team
            </label>
            <textarea
              id="team-notes"
              rows={3}
              maxLength={1000}
              disabled={!t.can_edit || !!busy}
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
            {t.can_edit && (
              <div className="actions">
                <button disabled={!dirty || !!busy} onClick={() => void save()}>
                  {busy === 'save' ? 'Saving…' : 'Save team profile'}
                </button>
                <button
                  className="secondary"
                  disabled={!dirty || !!busy}
                  onClick={() => setDraft(draftOf(t))}
                >
                  Undo changes
                </button>
              </div>
            )}
            {!t.can_edit && (
              <p className="small">Only the workspace owner can change this.</p>
            )}
            {notice && (
              <p className="notice" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </Status>
      <GateChecklistEditor
        session={session}
        workspace={workspace}
        tick={tick}
        onChanged={() => setTick((t) => t + 1)}
      />
      <AutoClearRule
        session={session}
        workspace={workspace}
        tick={tick}
        onChanged={() => setTick((t) => t + 1)}
      />
    </>
  );
}

const MODE_TEXT: Record<GateClearMode, { label: string; text: string }> = {
  owner: {
    label: 'You confirm every gate',
    text: 'A gate clears only from a person: your own scorecard, or Clear: I confirm on the option.',
  },
  team_profile: {
    label: 'Access clears on the model’s reading of your team profile',
    text: 'An access gate also clears once every current automatic assessment has read a team profile that answers at least one question above and found no access concern. The model decides from your profile; the app checks only that a profile was sent, not that it covers what the option needs (for that, choose your gate checklist below). Ethics still needs you.',
  },
  checklist: {
    label: 'Gates clear when they pass your gate checklist',
    text: 'A gate also clears once every current automatic assessment answered pass to every checklist item for it, each pass citing the evidence or your team profile. Access also needs every capability the assessment names as needed (or cites) to be Yes in your team profile, found by a check on this computer (or ticked by you when no check can test it): the app compares them itself. Any fail or unknown keeps the gate open and is listed on the option. Each item’s answer is still the model’s judgment, so a run that selects an option whose ethics gate cleared this way stops and asks you first.',
  },
  model: {
    label: 'Both gates clear on the model’s word',
    text: 'An ethics or access gate also clears once every current automatic assessment found no concern on it. No person looks at a gate cleared this way: the model can be wrong or misled by a source. Each such gate is marked “cleared on the model’s word”. A run (a routine approval policy included) that selects an option whose ethics gate cleared this way stops and asks you first.',
  },
};

/** Who clears ethics and access gates: the owner picks; each change is recorded. */
function AutoClearRule({
  session,
  workspace,
  tick,
  onChanged,
}: {
  session: SessionInfo;
  workspace: Workspace;
  tick: number;
  onChanged: () => void;
}) {
  const path = `workspaces/${workspace.id}/gate-rule`;
  const data = useLoad(() => api(GateRuleSchema, path), [workspace.id, tick]);
  // The checklist rule needs a saved checklist (PR #185 review N-3).
  const list = useLoad(
    () => api(GateChecklistSchema, `workspaces/${workspace.id}/gate-checklist`),
    [workspace.id, tick],
  );
  const noChecklist = (list.data?.items.length ?? 0) === 0;
  const r = data.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pick, setPick] = useState<GateClearMode | null>(null);
  async function save(mode: GateClearMode) {
    if (!r) return;
    setBusy(true);
    setError('');
    try {
      await api(GateRuleSchema, path, {
        csrf: session.csrf_token,
        body: { expected_version: r.version, mode },
      });
      setPick(null);
      onChanged();
    } catch (err) {
      setError(message(err));
      data.reload();
    } finally {
      setBusy(false);
    }
  }
  const chosen = pick ?? r?.mode ?? 'owner';
  return (
    <>
      <h4>Who clears ethics and access gates</h4>
      <p className="small">
        In every choice, a concern raised by an assessment or a person still
        blocks and comes to you, and changing the choice ends every clear the
        earlier one made. Only you can change this; agents can’t.
      </p>
      <Status
        loading={data.loading && !r}
        error={data.error}
        stale={data.stale || list.stale}
        retry={data.reload}
      >
        {r && (
          <fieldset className="gate-rule" disabled={!r.can_edit || busy}>
            <legend className="small">
              Now: <strong>{MODE_TEXT[r.mode].label}</strong>
              {r.updated_at ? ` · since ${when(r.updated_at)}` : ''}
            </legend>
            {GATE_CLEAR_MODES.map((m) => (
              <label key={m} className="choice">
                <input
                  type="radio"
                  name={`gate-mode-${workspace.id}`}
                  value={m}
                  checked={chosen === m}
                  disabled={m === 'checklist' && m !== r.mode && noChecklist}
                  onChange={() => setPick(m === r.mode ? null : m)}
                />{' '}
                <strong>{MODE_TEXT[m].label}.</strong>{' '}
                {m === 'checklist' && noChecklist && (
                  <em className="small">(save a gate checklist first) </em>
                )}
                <span className="small">{MODE_TEXT[m].text}</span>
              </label>
            ))}
            {pick && (
              <div className="actions" role="group" aria-label="Confirm">
                <p className="small">
                  {pick === 'owner'
                    ? 'Gates will clear only when you or another person clear them.'
                    : pick === 'team_profile'
                      ? 'Access gates will clear without you whenever the model, reading your team profile, finds no access concern.'
                      : pick === 'checklist'
                        ? 'Gates will clear without you whenever every checklist item passes and, for access, the app finds every needed capability in your team profile.'
                        : 'Ethics and access gates will clear without you whenever the automatic assessment finds no concern. No person will look at them.'}{' '}
                  Change it?
                </p>
                <button onClick={() => void save(pick)}>
                  {busy ? 'Saving…' : 'Yes, change it'}
                </button>
                <button className="secondary" onClick={() => setPick(null)}>
                  Cancel
                </button>
              </div>
            )}
            {!r.can_edit && (
              <p className="small">Only the workspace owner can change this.</p>
            )}
          </fieldset>
        )}
      </Status>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const GATE_LABEL: Record<GateKind, string> = {
  ethics: 'Ethics',
  access: 'Access',
};

/**
 * ADR-0097: the owner's gate checklist. Up to 12 short items, each for the ethics or the access
 * gate; the automatic assessment answers every item. Saved as a new version; only the owner
 * edits it. Changing it makes earlier assessments stale (they answered the old list).
 */
type DraftItem = GateChecklistItem & { id: number };
let nextItemId = 0;
const withId = (x: GateChecklistItem): DraftItem => ({
  gate: x.gate,
  text: x.text,
  id: ++nextItemId,
});

function GateChecklistEditor({
  session,
  workspace,
  tick,
  onChanged,
}: {
  session: SessionInfo;
  workspace: Workspace;
  tick: number;
  onChanged: () => void;
}) {
  const path = `workspaces/${workspace.id}/gate-checklist`;
  const data = useLoad(
    () => api(GateChecklistSchema, path),
    [workspace.id, tick],
  );
  const rule = useLoad(
    () => api(GateRuleSchema, `workspaces/${workspace.id}/gate-rule`),
    [workspace.id, tick],
  );
  const l = data.data;
  const saved = useMemo(() => l?.items.map(withId) ?? [], [l]);
  const [draft, setDraft] = useState<DraftItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const items: DraftItem[] = draft ?? saved;
  const edit = (next: DraftItem[]) => {
    setDraft(next);
    setNotice('');
  };
  const blank = items.some((x) => x.text.trim().length < 3);
  async function save() {
    if (!l) return;
    setBusy(true);
    setError('');
    try {
      await api(GateChecklistSchema, path, {
        csrf: session.csrf_token,
        body: {
          expected_version: l.version,
          items: items.map((x) => ({ gate: x.gate, text: x.text.trim() })),
        },
      });
      setDraft(null);
      setNotice(
        'Saved. Assess the options again so the assessment answers this checklist.',
      );
      onChanged();
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT')
        data.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h4>Gate checklist</h4>
      <Explain short="What must hold before a gate clears without you.">
        What must hold before an ethics or access gate may clear without you.
        Every automatic assessment answers each item pass, fail or unknown and
        says why; the items go to the model provider with the assessment. Saving
        a change makes earlier assessments out of date.
      </Explain>
      <Status
        loading={data.loading && !l}
        error={data.error}
        stale={data.stale || rule.stale}
        retry={data.reload}
      >
        {l && (
          <fieldset className="gate-checklist" disabled={!l.can_edit || busy}>
            <legend className="small">
              {l.version
                ? `Version ${l.version}${l.updated_at ? ` · saved ${when(l.updated_at)}` : ''}`
                : 'No checklist saved yet.'}
            </legend>
            {items.length ? (
              <ol>
                {items.map((x, i) => (
                  <li key={x.id}>
                    <select
                      aria-label={`Gate for item ${i + 1}`}
                      value={x.gate}
                      onChange={(e) =>
                        edit(
                          items.map((y, j) =>
                            j === i
                              ? { ...y, gate: e.target.value as GateKind }
                              : y,
                          ),
                        )
                      }
                    >
                      <option value="ethics">{GATE_LABEL.ethics}</option>
                      <option value="access">{GATE_LABEL.access}</option>
                    </select>{' '}
                    <input
                      aria-label={`Item ${i + 1}`}
                      maxLength={300}
                      value={x.text}
                      onChange={(e) =>
                        edit(
                          items.map((y, j) =>
                            j === i ? { ...y, text: e.target.value } : y,
                          ),
                        )
                      }
                    />{' '}
                    <button
                      className="secondary"
                      aria-label={`Remove item ${i + 1}`}
                      onClick={() => edit(items.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="small">
                No items. Start from the suggested list, or add your own.
              </p>
            )}
            {l.can_edit && (
              <div className="actions">
                <button
                  className="secondary"
                  disabled={items.length >= MAX_CHECKLIST_ITEMS}
                  onClick={() =>
                    edit([...items, withId({ gate: 'ethics', text: '' })])
                  }
                >
                  Add an item
                </button>
                {!items.length && (
                  <button
                    className="secondary"
                    onClick={() => edit(STARTER_GATE_CHECKLIST.map(withId))}
                  >
                    Use the suggested list
                  </button>
                )}
                {draft && (
                  <>
                    <button disabled={blank} onClick={() => void save()}>
                      {busy ? 'Saving…' : 'Save checklist'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setDraft(null);
                        setError('');
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}
            {rule.data?.mode === 'checklist' &&
              (['ethics', 'access'] as const)
                .filter((g) => !items.some((x) => x.gate === g))
                .map((g) => (
                  <p key={g} className="small notice">
                    No item for the {g} gate: under your checklist rule, {g}{' '}
                    never clears without you.
                  </p>
                ))}
            {blank && draft && (
              <p className="small">Each item needs at least 3 characters.</p>
            )}
            {!l.can_edit && (
              <p className="small">Only the workspace owner can change this.</p>
            )}
          </fieldset>
        )}
      </Status>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
