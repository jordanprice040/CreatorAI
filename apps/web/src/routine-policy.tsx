import { useState } from 'react';
import { Money } from './money.js';
import { useViewMode } from './view-mode.js';
import {
  ROUTINE_STAGE_TEXT,
  ROUTINE_STOP_TEXT,
  RoutinePolicySchema,
  RoutineStageSchema,
  dataClassName,
  routinePolicySummary,
  type RoutinePolicyInput,
  type RoutinePolicyView,
  type RoutineStage,
  type SessionInfo,
} from '@creator/contracts';
import { money, usdToNano } from './amounts.js';
import { endAfter } from './end-time.js';
import { api, message, when, words } from './oversight.js';
import { Fold, FoldAll, useFolds, type Folds } from './fold.js';
import { firstNeeding } from './fold-state.js';
import { Term } from './term.js';

// ADR-0079 (P10): "Approve routine steps for me". The form only gathers the owner's choices
// and shows the summary the studio writes from them. The server writes the same summary
// again, refuses a request whose summary differs, and alone decides what is admitted.

type DataClass = RoutinePolicyInput['data_classes'][number];
const DATA_CLASSES: readonly DataClass[] = [
  'synthetic',
  'public',
  'private_approved',
];

export type RoutineDraft = {
  enabled: boolean;
  stages: RoutineStage[];
  dataClasses: DataClass[];
  maxActions: string;
  /** Dollars as typed; empty means no step that states an amount is covered. */
  maxTotalUsd: string;
  hours: string;
  /** Fixed when the hours are chosen, so the summary that is read is the one that is sent. */
  expiresAt: string;
  stopOnReject: boolean;
  stopOnUnknown: boolean;
  rationale: string;
  /** The owner ticked that they read the summary; any change clears it. */
  confirmed: boolean;
};

/** Exact dollars for a nano-USD amount, e.g. "12.5"; the reverse of usdToNano. */
function nanoToUsd(nano: string): string {
  const n = BigInt(nano);
  const frac = String(n % 1_000_000_000n)
    .padStart(9, '0')
    .replace(/0+$/, '');
  return `${n / 1_000_000_000n}${frac ? `.${frac}` : ''}`;
}

/** Off by default: routine approvals are never switched on for the owner. */
export function routineStart(dataClass: DataClass): RoutineDraft {
  return {
    enabled: false,
    stages: ['research', 'model_work'],
    dataClasses: [dataClass],
    maxActions: '40',
    maxTotalUsd: '',
    hours: '24',
    expiresAt: endAfter('24'),
    stopOnReject: true,
    stopOnUnknown: true,
    rationale: 'Routine steps for this run.',
    confirmed: false,
  };
}

/** A draft that edits an existing policy; the end time starts as the policy's own. */
export function routineDraftOf(v: RoutinePolicyView): RoutineDraft {
  const p = v.policy;
  const left = Math.max(
    1,
    Math.ceil((Date.parse(p.expires_at) - Date.now()) / 3_600_000),
  );
  return {
    enabled: true,
    stages: p.stages,
    dataClasses: p.data_classes,
    maxActions: String(p.max_actions),
    maxTotalUsd:
      p.max_total_nano_usd === null ? '' : nanoToUsd(p.max_total_nano_usd),
    hours: String(left),
    expiresAt:
      Date.parse(p.expires_at) > Date.now() ? p.expires_at : endAfter('24'),
    stopOnReject: p.stop_on.includes('person_rejects'),
    stopOnUnknown: p.stop_on.includes('unknown_outcome'),
    rationale: p.rationale,
    confirmed: false,
  };
}

/** The policy the draft describes, or what to fix first. */
export function routineInput(d: RoutineDraft): {
  input: RoutinePolicyInput | null;
  issues: string[];
} {
  const issues: string[] = [];
  if (d.stages.length === 0) issues.push('Choose at least one kind of step.');
  if (d.dataClasses.length === 0)
    issues.push('Choose at least one data class.');
  const max = Number(d.maxActions);
  if (
    !/^\d+$/.test(d.maxActions.trim()) ||
    !Number.isSafeInteger(max) ||
    max < 1
  )
    issues.push('The most steps must be a whole number of 1 or more.');
  const total = d.maxTotalUsd.trim() === '' ? null : usdToNano(d.maxTotalUsd);
  if (d.maxTotalUsd.trim() !== '' && total === null)
    issues.push('The money total must be a plain dollar amount, or empty.');
  const hours = Number(d.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 90 * 24)
    issues.push('The hours must be more than 0 and at most 2160 (90 days).');
  else if (Date.parse(d.expiresAt) <= Date.now())
    issues.push('The end time has passed; set the hours again.');
  if (!d.rationale.trim()) issues.push('Give a brief reason.');
  if (issues.length) return { input: null, issues };
  return {
    input: {
      stages: [...d.stages].sort(),
      data_classes: [...d.dataClasses].sort(),
      max_actions: max,
      max_total_nano_usd: total,
      stop_on: [
        ...(d.stopOnReject ? (['person_rejects'] as const) : []),
        ...(d.stopOnUnknown ? (['unknown_outcome'] as const) : []),
      ],
      expires_at: d.expiresAt,
      rationale: d.rationale.trim(),
    },
    issues,
  };
}

/** The request body for a confirmed draft; null while it is off, incomplete or unconfirmed. */
export function routineRequest(d: RoutineDraft) {
  if (!d.enabled || !d.confirmed) return null;
  const { input } = routineInput(d);
  return input ? { ...input, summary_seen: routinePolicySummary(input) } : null;
}

/** Why the form cannot be sent yet because of the routine approval fields (empty: fine). */
export function routineIssues(d: RoutineDraft): string[] {
  if (!d.enabled) return [];
  const { issues } = routineInput(d);
  if (issues.length) return issues.map((i) => `Routine approvals: ${i}`);
  return d.confirmed
    ? []
    : [
        'Routine approvals: read the summary and tick the box under it, or turn them off.',
      ];
}

export function RoutineFields({
  draft,
  onChange,
  idPrefix,
  runDataClass,
  editing = false,
}: {
  draft: RoutineDraft;
  onChange: (next: RoutineDraft) => void;
  idPrefix: string;
  /** The data class the form's run will use; turning the policy on starts from it. */
  runDataClass?: DataClass;
  /** Changing an existing policy: there is no on/off box. */
  editing?: boolean;
}) {
  // Every change needs the summary read again.
  const set = (patch: Partial<RoutineDraft>) =>
    onChange({ ...draft, ...patch, confirmed: patch.confirmed ?? false });
  const toggle = <T,>(list: readonly T[], item: T, on: boolean) =>
    on
      ? [...list.filter((x) => x !== item), item]
      : list.filter((x) => x !== item);
  const { input, issues } = routineInput(draft);
  return (
    <div className="routine-policy">
      {!editing && (
        <label className="chip">
          <input
            id={`${idPrefix}-on`}
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) =>
              set({
                enabled: e.target.checked,
                expiresAt: endAfter(draft.hours),
                ...(e.target.checked &&
                runDataClass &&
                !draft.dataClasses.includes(runDataClass)
                  ? { dataClasses: [...draft.dataClasses, runDataClass] }
                  : {}),
              })
            }
          />
          Approve routine steps for me in this run
        </label>
      )}
      {!editing && !draft.enabled && (
        <p className="small">
          Off: the run asks you as its oversight setting says. You can also turn
          this on later under Monitor › Approvals.
        </p>
      )}
      {draft.enabled && (
        <>
          <fieldset>
            <legend>Steps the studio may admit without asking</legend>
            {RoutineStageSchema.options.map((s) => (
              <label key={s} className="routine-choice">
                <input
                  type="checkbox"
                  checked={draft.stages.includes(s)}
                  onChange={(e) =>
                    set({ stages: toggle(draft.stages, s, e.target.checked) })
                  }
                />
                <span>
                  <strong>{ROUTINE_STAGE_TEXT[s].label}</strong>:{' '}
                  {ROUTINE_STAGE_TEXT[s].covers}
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Data these steps may use</legend>
            <div className="chips">
              {DATA_CLASSES.map((c) => (
                <label key={c} className="chip">
                  <input
                    type="checkbox"
                    checked={draft.dataClasses.includes(c)}
                    onChange={(e) =>
                      set({
                        dataClasses: toggle(
                          draft.dataClasses,
                          c,
                          e.target.checked,
                        ),
                      })
                    }
                  />
                  {dataClassName(c)}
                </label>
              ))}
            </div>
          </fieldset>
          <label htmlFor={`${idPrefix}-max`}>Most steps in total</label>
          <input
            id={`${idPrefix}-max`}
            inputMode="numeric"
            value={draft.maxActions}
            onChange={(e) => set({ maxActions: e.target.value })}
          />
          <label htmlFor={`${idPrefix}-usd`}>
            Money total for steps that state an amount, in dollars (leave empty
            to cover none)
          </label>
          <input
            id={`${idPrefix}-usd`}
            inputMode="decimal"
            value={draft.maxTotalUsd}
            onChange={(e) => set({ maxTotalUsd: e.target.value })}
          />
          <p className="small">
            A model call billed through the API or a budget states an amount, so
            it is covered only when you set a total here. Calls on a
            subscription plan state none.
          </p>
          <label htmlFor={`${idPrefix}-hours`}>
            Ends after (hours from now, up to 2160)
          </label>
          <input
            id={`${idPrefix}-hours`}
            inputMode="decimal"
            value={draft.hours}
            onChange={(e) =>
              set({
                hours: e.target.value,
                expiresAt: endAfter(e.target.value),
              })
            }
          />
          <label className="routine-choice">
            <input
              type="checkbox"
              checked={draft.stopOnReject}
              onChange={(e) => set({ stopOnReject: e.target.checked })}
            />
            <span>{ROUTINE_STOP_TEXT.person_rejects}</span>
          </label>
          <label className="routine-choice">
            <input
              type="checkbox"
              checked={draft.stopOnUnknown}
              onChange={(e) => set({ stopOnUnknown: e.target.checked })}
            />
            <span>{ROUTINE_STOP_TEXT.unknown_outcome}</span>
          </label>
          <label htmlFor={`${idPrefix}-why`}>Your reason (brief)</label>
          <input
            id={`${idPrefix}-why`}
            maxLength={1000}
            value={draft.rationale}
            onChange={(e) => set({ rationale: e.target.value })}
          />
          {input ? (
            <aside
              className="notice policy"
              aria-label="Routine approval summary"
            >
              <strong>What you are approving</strong>
              <ul className="routine-summary">
                {routinePolicySummary(input).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <span className="small">
                Ends {when(input.expires_at)} your time.
              </span>
              <label className="chip">
                <input
                  id={`${idPrefix}-confirm`}
                  type="checkbox"
                  checked={draft.confirmed}
                  onChange={(e) => set({ confirmed: e.target.checked })}
                />
                I have read this summary and want these steps admitted without
                asking me each time
              </label>
            </aside>
          ) : (
            <ul className="small issues">
              {issues.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const STATE_TEXT: Record<RoutinePolicyView['state'], string> = {
  active: 'Admitting covered steps',
  paused: 'Paused',
  expired: 'Ended',
  revoked: 'Revoked',
};

function PolicyCard({
  v,
  folds,
  runName,
  session,
  workspace,
  onDone,
}: {
  v: RoutinePolicyView;
  folds: Folds;
  runName: string;
  session: SessionInfo;
  workspace: string;
  onDone: () => void;
}) {
  const { standard } = useViewMode();
  const p = v.policy;
  const [revoking, setRevoking] = useState(false);
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function send(path: string, body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(
        RoutinePolicySchema,
        `workspaces/${workspace}/routine-policies/${p.id}/${path}`,
        { csrf: session.csrf_token, body },
      );
      setDraft(null);
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const request = draft ? routineRequest(draft) : null;
  return (
    <li className="routine-card">
      <Fold
        id={p.id}
        folds={folds}
        summary={
          <>
            {!standard && <span className="kind">v{p.version}</span>}{' '}
            <span className="fold-title">{runName}</span> ·{' '}
            <strong
              className={v.state === 'paused' ? 'fold-attention' : undefined}
            >
              {STATE_TEXT[v.state]}
            </strong>
            {v.state_reason ? `: ${v.state_reason}` : ''}
            {v.stop_reason && v.stop_reason !== v.state_reason
              ? ` ${v.stop_reason}`
              : ''}
            <span className="fold-line small">
              {v.used_actions} of {p.max_actions} steps used
              {p.max_total_nano_usd !== null && (
                <>
                  {' '}
                  · <Money
                    nano={v.used_nano_usd}
                    fixture={false}
                    inButton
                  /> of {money(p.max_total_nano_usd, false)} admitted
                </>
              )}{' '}
              · {v.state === 'expired' ? 'ended' : 'ends'} {when(p.expires_at)}
            </span>
          </>
        }
      >
        <p className="small">
          Covers: {p.stages.map((s) => ROUTINE_STAGE_TEXT[s].label).join(', ')}
          {p.max_total_nano_usd !== null && (
            <>
              {' '}
              · <Money nano={v.used_nano_usd} fixture={false} /> of{' '}
              {money(p.max_total_nano_usd, false)} in stated amounts admitted
            </>
          )}
        </p>
        <details>
          <summary>Summary you confirmed on {when(p.confirmed_at)}</summary>
          <ul className="routine-summary">
            {p.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="small">Your reason: {p.rationale}</p>
        </details>
        <details>
          <summary>
            Steps this policy admitted ({v.used_actions}
            {v.used_actions > v.recent.length
              ? `, latest ${v.recent.length} shown`
              : ''}
            )
          </summary>
          {v.recent.length === 0 ? (
            <p className="small">None yet.</p>
          ) : (
            <ul>
              {v.recent.map((a) => (
                <li key={a.admission_id}>
                  {words(a.action_type)} · {when(a.created_at)} · admitted by
                  policy rules, not approved by a person
                </li>
              ))}
            </ul>
          )}
        </details>
        {p.status === 'active' && !draft && (
          <span className="actions">
            <button
              className="text"
              disabled={busy}
              onClick={() => setDraft(routineDraftOf(v))}
            >
              Change…
            </button>{' '}
            <button
              className="text"
              disabled={busy}
              onClick={() => setRevoking(true)}
            >
              Revoke…
            </button>
          </span>
        )}
        {p.status === 'active' && !draft && revoking && (
          <div
            className="routine-edit"
            role="group"
            aria-label="Confirm revoke"
          >
            <p className="small">
              Revoke routine approvals for this run? The run asks you again from
              its next step, and a build admitted under this policy stops at its
              next request. If you turn routine approvals on again later, that
              is a new policy whose step and money counts start at zero.
            </p>
            <div className="actions">
              <button
                className="secondary strong"
                disabled={busy}
                onClick={() => {
                  setRevoking(false);
                  void send('revoke', {
                    expected_version: p.version,
                    reason: 'Revoked from the Approvals page',
                  });
                }}
              >
                Revoke routine approvals
              </button>{' '}
              <button
                className="text"
                disabled={busy}
                onClick={() => setRevoking(false)}
              >
                Keep them
              </button>
            </div>
          </div>
        )}
        {p.status === 'revoked' && (
          <p className="small">
            Revoked. You can turn routine approvals on again for this run below,
            with a new summary.
          </p>
        )}
        {draft && (
          <div className="routine-edit">
            <p className="small">
              Changing the policy needs the new summary confirmed. A build
              already approved under the current version stops at its next
              request and asks again.
            </p>
            <RoutineFields
              draft={draft}
              onChange={setDraft}
              idPrefix={`rp-${p.id.slice(0, 8)}`}
              editing
            />
            <div className="actions">
              <button
                className="secondary strong"
                disabled={busy || !request}
                onClick={() =>
                  void send('revisions', {
                    ...request,
                    expected_version: p.version,
                  })
                }
              >
                Save the changed policy
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Fold>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** The workspace's routine approval policies, on the Approvals page. */
export function RoutinePolicies({
  policies,
  runName,
  session,
  workspace,
  eligibleRuns,
  runDataClasses,
  onDone,
}: {
  policies: RoutinePolicyView[];
  runName: (runId: string) => string;
  session: SessionInfo;
  workspace: string;
  /** Active supervised or human-in-the-loop runs with no active policy. */
  eligibleRuns: string[];
  /** Kinds of data seen in a run's waiting decisions and its own grants (may be empty). */
  runDataClasses: (runId: string) => DataClass[];
  onDone: () => void;
}) {
  const [runId, setRunId] = useState('');
  const [draft, setDraft] = useState<RoutineDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = eligibleRuns.includes(runId) ? runId : '';
  // P18: each policy folds to one line; a paused one (it stopped admitting) opens.
  const policyFolds = useFolds(
    firstNeeding(
      policies.map((v) => v.policy.id),
      (id) => policies.find((v) => v.policy.id === id)?.state === 'paused',
    ),
  );
  const request = draft && chosen ? routineRequest(draft) : null;
  const seenData = chosen ? runDataClasses(chosen) : [];
  const missing = draft
    ? seenData.filter((d) => !draft.dataClasses.includes(d))
    : [];
  async function turnOn() {
    if (!request) return;
    setBusy(true);
    setError('');
    try {
      await api(
        RoutinePolicySchema,
        `workspaces/${workspace}/runs/${chosen}/routine-policy`,
        { csrf: session.csrf_token, body: request },
      );
      setDraft(null);
      setRunId('');
      onDone();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="fold-head">
        <h3>
          <Term term="routine_approval">Routine approvals</Term>
        </h3>
        <FoldAll
          ids={policies.map((v) => v.policy.id)}
          folds={policyFolds}
          label="routine approval policies"
        />
      </div>
      {eligibleRuns.length > 0 && (
        <div className="routine-edit">
          <label htmlFor="rp-run">
            Turn on routine approvals for a run that is already going
          </label>
          <select
            id="rp-run"
            value={chosen}
            onChange={(e) => {
              setRunId(e.target.value);
              // Review L-4: start from the kinds of data this run is known to use.
              const seen = e.target.value ? runDataClasses(e.target.value) : [];
              setDraft(
                e.target.value
                  ? {
                      ...routineStart(seen[0] ?? 'synthetic'),
                      dataClasses: seen.length ? seen : ['synthetic'],
                      enabled: true,
                    }
                  : null,
              );
            }}
          >
            <option value="">Choose a run…</option>
            {eligibleRuns.map((id) => (
              <option key={id} value={id}>
                {runName(id)}
              </option>
            ))}
          </select>
          {draft && chosen && (
            <>
              <p className="small">
                The run keeps its oversight setting. From now on it stops asking
                you about the steps you choose here, within these limits.
              </p>
              <p className="small" id="rp-data-note">
                {seenData.length
                  ? `This run's waiting decisions and grants use ${seenData.map((d) => dataClassName(d)).join(' and ')}. `
                  : 'The studio cannot tell from this page which kind of data this run uses. '}
                A step is covered only when its kind of data is ticked below; a
                step on any other kind still asks you.
                {missing.length > 0 &&
                  ` Not ticked now: ${missing.map((d) => dataClassName(d)).join(' and ')}.`}
              </p>
              <RoutineFields
                draft={draft}
                onChange={setDraft}
                idPrefix="rp-new"
                editing
              />
              <div className="actions">
                <button
                  className="secondary strong"
                  disabled={busy || !request}
                  onClick={() => void turnOn()}
                >
                  Turn on routine approvals for this run
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {policies.length === 0 ? (
        <p className="small">
          No run has routine approvals yet. You can choose them when you set up
          a new run on the Discover page, or turn them on above for a run that
          is already going.
        </p>
      ) : (
        <ul>
          {policies.map((v) => (
            <PolicyCard
              key={`${v.policy.id}-${v.policy.version}`}
              v={v}
              folds={policyFolds}
              runName={runName(v.policy.run_id)}
              session={session}
              workspace={workspace}
              onDone={onDone}
            />
          ))}
        </ul>
      )}
    </>
  );
}
