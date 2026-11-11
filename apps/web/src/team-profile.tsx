import { useEffect, useState } from 'react';
import {
  CapabilityCheckResultSchema,
  GateRuleSchema,
  TEAM_CAPABILITIES,
  TeamProfileSchema,
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
    return `checked: ${x.check.detail} on ${x.check.machine}, ${when(x.check.checked_at)}`;
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
        `Saved as version ${next.version}. Assess again so the ratings read it; earlier automatic assessments now show as out of date.`,
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
      setNotice(r.passed ? `${r.detail} Saved to the profile.` : r.detail);
      if (r.passed) setDraft(draftOf(r.profile));
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
        blocking an option. Tick answers yourself, or run a built-in check that
        looks for the program on this computer. Only you can change it; agents
        can read it but never write it.
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
                : 'Not saved yet: assessments do not get a team profile.'}{' '}
              Built-in checks run on <strong>{t.machine}</strong>, the computer
              this studio runs on.
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
                      {c.check && t.can_edit && (
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

/** The owner's auto-clear rule: off until turned on; each change is recorded. */
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
  async function toggle() {
    if (!r) return;
    setBusy(true);
    setError('');
    try {
      await api(GateRuleSchema, path, {
        csrf: session.csrf_token,
        body: { expected_version: r.version, auto_clear: !r.auto_clear },
      });
      data.reload();
    } catch (err) {
      setError(message(err));
      data.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h4>Clear ethics and access gates automatically</h4>
      <p className="small">
        When this is on, an option’s ethics or access gate counts as cleared
        without you once every current automatic assessment of it has read your
        team profile and raised no concern. Any concern, from an assessment or a
        person, still blocks and comes to you. Turning it off ends every clear
        it made. Only you can change this; agents can’t.
      </p>
      <Status
        loading={data.loading && !r}
        error={data.error}
        retry={data.reload}
      >
        {r && (
          <div className="actions">
            <span>
              <strong>{r.auto_clear ? 'On' : 'Off'}</strong>
              {r.updated_at ? ` · since ${when(r.updated_at)}` : ''}
            </span>
            {r.can_edit && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void toggle()}
              >
                {r.auto_clear ? 'Turn off' : 'Turn on'}
              </button>
            )}
          </div>
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
