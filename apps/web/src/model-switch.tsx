import { useEffect, useRef, useState } from 'react';
import {
  ASSESSMENT_TASK_CLASS,
  DISCOVERY_TASK_CLASSES,
  EXPLORATION_TASK_CLASS,
  ModelChoiceResultSchema,
  ModelChoiceSchema,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  isQualified,
  latestDecided,
  z,
  type ModelChoice,
  type PlanConnectionDetail,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import {
  BUILD_ROLE_CLASSES,
  MODEL_CHOICE_CHANGED,
  taskWords,
  type Choice,
  type Route,
  type RoutePlan,
} from './model-choice.js';

// ADR-0081 (P21): the picker beside the usage indicator sets the owner's current connection
// and model for this workspace. Forms start from it (model-choice.ts); a form can still pick
// another route, and a run keeps the route it recorded when it started. The server refuses a
// model that is not verified; whether it is qualified is checked where each task runs.

/** The tasks the picker reports on, with the task classes each needs on a plan route. */
export const CHOICE_TASKS: readonly {
  label: string;
  classes: readonly string[];
}[] = [
  { label: 'Chat', classes: [] },
  { label: 'Explore', classes: [EXPLORATION_TASK_CLASS] },
  {
    label: 'Discover',
    classes: [...new Set(Object.values(DISCOVERY_TASK_CLASSES))],
  },
  { label: 'Assess', classes: [ASSESSMENT_TASK_CLASS] },
  { label: 'Build', classes: BUILD_ROLE_CLASSES },
];

/**
 * ADR-0074: an assessment needs a scoring qualification bound to the assessor's prompt, so
 * the discovery skeptic's scoring result does not count for Assess.
 */
export const assessQualified = (
  d: Pick<PlanConnectionDetail, 'qualifications'>,
  model: string,
) =>
  latestDecided(
    d.qualifications.filter((q) => q.admits_assessment === true),
    model,
    ASSESSMENT_TASK_CLASS,
  )?.state === 'qualified';

/** Verified Responses models on a connection. */
export const responsesModels = (
  d: Pick<PlanConnectionDetail, 'model_access'>,
) =>
  d.model_access
    .filter((a) => a.path === 'responses' && a.access === 'verified')
    .map((a) => a.model_id);

/** What preferredRoute needs from the connection details a form already loaded. */
export function routePlans(
  details: readonly PlanConnectionDetail[],
  taskClasses: readonly string[],
  dataClass: string | null,
  assessment = false,
): RoutePlan[] {
  return details.map((d) => ({
    id: d.connection.id,
    ready:
      d.blockers.length === 0 &&
      (dataClass === null ||
        d.connection.settings.allowed_data_classes.includes(
          dataClass as never,
        )),
    models: responsesModels(d).map((m) => ({
      id: m,
      qualified: taskClasses.filter((tc) =>
        assessment && tc === ASSESSMENT_TASK_CLASS
          ? assessQualified(d, m)
          : isQualified(d.qualifications, m, tc),
      ),
    })),
  }));
}

const asChoice = (c: ModelChoice | null): Choice | null =>
  c?.connection_id && c.model_id
    ? { connection_id: c.connection_id, model_id: c.model_id }
    : null;

/**
 * The owner's current choice in this workspace, kept current when it is switched here. Null
 * for someone who is not the owner (plan connections are the owner's own) or before it loads.
 */
export function useModelChoice(workspace: Workspace): Choice | null {
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const owner = workspace.role === 'owner';
  useEffect(() => {
    setChoice(null);
    if (!owner) return;
    let live = true;
    api(ModelChoiceSchema, `workspaces/${workspace.id}/model-choice`).then(
      (c) => live && setChoice(c),
      () => undefined,
    );
    const changed = (e: Event) => {
      const next = (e as CustomEvent<ModelChoice>).detail;
      if (next?.workspace_id === workspace.id) setChoice(next);
    };
    window.addEventListener(MODEL_CHOICE_CHANGED, changed);
    return () => {
      live = false;
      window.removeEventListener(MODEL_CHOICE_CHANGED, changed);
    };
  }, [workspace.id, owner]);
  return asChoice(choice);
}

/**
 * The line under a form's connection and model fields: where the route came from, and, when
 * the current model is not qualified for this task, a button for the qualified alternative.
 */
export function ChoiceNote({
  route,
  choice,
  labelOf,
  onUse,
  task,
}: {
  route: Route;
  choice: Choice | null;
  labelOf: (connection: string) => string;
  onUse: (connection: string, model: string) => void;
  /** What this form does, e.g. "Explore". */
  task: string;
}) {
  if (route.choiceUnavailable && choice)
    return (
      <p className="small model-note">
        Your current model ({choice.model_id}) is not verified on a connection
        here, so this form uses {route.model || 'no model'}. Switch models from
        the top bar.
      </p>
    );
  if (!route.fromChoice) return null;
  if (route.unqualified.length === 0)
    return (
      <p className="small model-note">
        Your current model, from the top bar. Change it here for this form only.
      </p>
    );
  const alt = route.alternative;
  return (
    <p className="small model-note model-note-warn" role="note">
      {route.model} (your current model) is not qualified for{' '}
      {route.unqualified.map(taskWords).join(', ')}, so {task} can&apos;t run on
      it.{' '}
      {alt ? (
        <button
          type="button"
          className="text"
          onClick={() => onUse(alt.connection, alt.model)}
        >
          Use {alt.model} on {labelOf(alt.connection)} instead
        </button>
      ) : (
        'No verified model here is qualified for it yet; qualify one under Models and connections.'
      )}
    </p>
  );
}

const Detail = PlanConnectionDetailSchema.passthrough();

/** The top-bar picker. Owners only; it lists verified models and what each is ready for. */
export function ModelSwitch({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo;
}) {
  const base = `workspaces/${workspace.id}`;
  const ref = useRef<HTMLDetailsElement>(null);
  const [choice, setChoice] = useState<ModelChoice | null>(null);
  const [details, setDetails] = useState<PlanConnectionDetail[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  async function load() {
    const mine = ++seq.current;
    try {
      const [c, conns] = await Promise.all([
        api(ModelChoiceSchema, `${base}/model-choice`),
        api(z.array(PlanConnectionSchema), `${base}/plan-connections`),
      ]);
      const d = await Promise.all(
        conns.map((x) =>
          api(Detail, `${base}/plan-connections/${x.id}`).catch(() => null),
        ),
      );
      if (mine !== seq.current) return;
      setChoice(c);
      setDetails(d.filter((x) => x !== null));
      setError('');
    } catch (e) {
      if (mine === seq.current) setError(message(e));
    }
  }
  useEffect(() => {
    setChoice(null);
    setDetails(null);
    setSaved('');
    void load();
    return () => {
      seq.current++;
    };
  }, [workspace.id]);
  useEffect(() => {
    const close = (e: KeyboardEvent | MouseEvent) => {
      const d = ref.current;
      if (!d?.open) return;
      if (
        e instanceof KeyboardEvent
          ? e.key === 'Escape'
          : !d.contains(e.target as Node)
      )
        d.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('mousedown', close);
    };
  }, []);

  async function pick(connection_id: string, model_id: string) {
    if (!choice || busy) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const out = await api(ModelChoiceResultSchema, `${base}/model-choice`, {
        csrf: session.csrf_token,
        body: { expected_version: choice.version, connection_id, model_id },
      });
      setChoice(out.choice);
      window.dispatchEvent(
        new CustomEvent(MODEL_CHOICE_CHANGED, { detail: out.choice }),
      );
      setSaved(
        `Switched to ${model_id}.${out.chat_updated ? ' Chat answers use it too.' : ''} Runs already started keep their model.`,
      );
    } catch (e) {
      setError(message(e));
      void load();
    } finally {
      setBusy(false);
    }
  }

  const current = details?.find(
    (d) => d.connection.id === choice?.connection_id,
  );
  const verifiedHere =
    current && choice?.model_id
      ? responsesModels(current).includes(choice.model_id)
      : false;
  const label = !choice
    ? 'Model…'
    : choice.model_id && verifiedHere
      ? choice.model_id
      : choice.model_id && details
        ? `${choice.model_id} (not verified)`
        : choice.model_id
          ? choice.model_id
          : 'Choose a model';
  const options = (details ?? []).flatMap((d) =>
    responsesModels(d).map((m) => ({ d, m })),
  );
  return (
    <details
      className="usage model-switch"
      ref={ref}
      onToggle={(e) => e.currentTarget.open && void load()}
    >
      <summary
        className={`usage-summary${choice?.model_id && details && !verifiedHere ? ' usage-warn' : ''}`}
        title="Current model for this workspace"
      >
        <span className="model-switch-label">Model</span>
        <span>{label}</span>
      </summary>
      <div className="usage-panel" role="region" aria-label="Current model">
        <h2>Current model</h2>
        <p className="small">
          Chat, Explore, Discover, Assess, Build and Qualify start from this
          model. You can still choose another on a form. Runs already started
          keep the model they started with.
        </p>
        {error && <p className="error small">{error}</p>}
        {saved && (
          <p className="small notice" role="status">
            {saved}
          </p>
        )}
        {details && options.length === 0 && (
          <p className="small">
            No verified model yet. Verify one on{' '}
            <a href={`#/connections/models?ws=${workspace.id}`}>
              Models and connections
            </a>
            .
          </p>
        )}
        {options.length > 0 && (
          <fieldset className="model-switch-list" disabled={busy || !choice}>
            <legend className="sr-only">Models you can switch to</legend>
            {options.map(({ d, m }) => {
              const on =
                choice?.connection_id === d.connection.id &&
                choice.model_id === m;
              const ready = CHOICE_TASKS.filter((t) =>
                t.classes.every((tc) =>
                  tc === ASSESSMENT_TASK_CLASS
                    ? assessQualified(d, m)
                    : isQualified(d.qualifications, m, tc),
                ),
              ).map((t) => t.label);
              const not = CHOICE_TASKS.map((t) => t.label).filter(
                (t) => !ready.includes(t),
              );
              return (
                <label
                  key={`${d.connection.id}:${m}`}
                  className={`model-switch-option${on ? ' on' : ''}`}
                >
                  <input
                    type="radio"
                    name={`model-choice-${workspace.id}`}
                    checked={on}
                    onChange={() => void pick(d.connection.id, m)}
                  />
                  <span>
                    <strong>{m}</strong>{' '}
                    <span className="small">· {d.connection.label}</span>
                    {d.blockers.length > 0 && (
                      <span className="small model-note-warn">
                        {' '}
                        · can&apos;t run now: {d.blockers[0]}
                      </span>
                    )}
                    <span className="small model-switch-ready">
                      Ready for {ready.join(', ')}
                      {not.length > 0 &&
                        `. Not qualified for ${not.join(', ')}`}
                      .
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <p className="small usage-foot">
          <a href={`#/connections/models?ws=${workspace.id}`}>
            Verify or qualify models
          </a>
        </p>
      </div>
    </details>
  );
}
