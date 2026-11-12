import { useEffect, useState } from 'react';
import {
  CapabilityCheckResultSchema,
  GATE_CLEAR_MODES,
  GateRuleSchema,
  TEAM_CAPABILITIES,
  TeamProfileSchema,
  type GateClearMode,
  type SessionInfo,
  type TeamCapabilityKey,
  type TeamProfile,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import { Status, useLoad } from './ui.js';

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
      <p>
        What your team can run, install and do with data. Every automatic
        assessment in <strong>{workspace.name}</strong> reads it, so a question
        like “can the team install Python tools?” is answered instead of
        blocking an option. Tick answers yourself
        {t?.checks_available !== false
          ? ', or run a built-in check that looks for the program on this computer'
          : ''}
        . Only you can change it; agents can read it but never write it.
      </p>
      <p className="small">
        The answers, their notes and the notes below are sent to the model
        provider with every automatic assessment (the assessment preview shows
        them). Leave out anything you would not send there. Host names are never
        sent.
      </p>
      <Status
        loading={data.loading && !t}
        error={data.error}
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
      <AutoClearRule session={session} workspace={workspace} />
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
    text: 'An access gate also clears once every current automatic assessment has read a team profile that answers at least one question above and found no access concern. The model decides from your profile; the app checks only that a profile was sent, not that it covers what the option needs (an app-verified choice comes with the ethics and access checklist). Ethics still needs you.',
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
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const path = `workspaces/${workspace.id}/gate-rule`;
  const data = useLoad(() => api(GateRuleSchema, path), [workspace.id]);
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
      data.reload();
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
                  onChange={() => setPick(m === r.mode ? null : m)}
                />{' '}
                <strong>{MODE_TEXT[m].label}.</strong>{' '}
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
