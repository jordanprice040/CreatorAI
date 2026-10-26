import { useRef, useState, type FormEvent } from 'react';
import {
  EntityDetailSchema,
  StoredEntitySchema,
  ThemeIntentBodySchema,
  ThemeResearchPlanSchema,
  z,
  type SessionInfo,
  type StoredEntity,
  type Workspace,
  type ThemeIntentBody,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { useLoad } from './ui.js';

const blank = () => ({
  theme: '',
  context: '',
  solution_constraints: '',
  questions: '',
  source_urls: '',
  source_strategy:
    'supplied_public_sources' as ThemeIntentBody['source_strategy'],
});
const fromBody = (body: ThemeIntentBody) => ({
  ...body,
  questions: body.questions.join('\n'),
  source_urls: body.source_urls.join('\n'),
});
const lines = (text: string) =>
  text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/** Saving and deterministic preparation never create a run, grant, claim or provider call. */
export function ThemeIntent({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const base = `workspaces/${workspace.id}/entities`;
  const saved = useLoad(
    () =>
      api(
        z.array(StoredEntitySchema),
        `${base}?kind=theme_intent&status=active`,
      ),
    [workspace.id],
  );
  const [form, setForm] = useState(blank);
  const [record, setRecord] = useState<StoredEntity | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<StoredEntity | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [plan, setPlan] = useState<z.infer<
    typeof ThemeResearchPlanSchema
  > | null>(null);
  const createKey = useRef<{ signature: string; key: string } | null>(null);
  const readonly = workspace.role === 'viewer';
  const change = (next: typeof form) => {
    setForm(next);
    setDirty(true);
    setPlan(null);
    setNotice('');
  };
  async function open(next: StoredEntity | 'new', discardConfirmed = false) {
    if (dirty && !discardConfirmed) {
      setPending(next);
      return;
    }
    setBusy(true);
    setError('');
    try {
      // Re-read after selection: list entries can be older than another editor's save.
      const current =
        next === 'new'
          ? null
          : (await api(EntityDetailSchema, `${base}/${next.id}`)).entity;
      const body = current ? ThemeIntentBodySchema.parse(current.body) : null;
      if (current && current.status !== 'active')
        throw new Error('This draft is no longer active.');
      setRecord(current);
      setForm(body ? fromBody(body) : blank());
      setDirty(false);
      setPlan(null);
      setNotice('');
      setPending(null);
      createKey.current = null;
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = ThemeIntentBodySchema.parse({
        ...form,
        format: 'theme-intent/1',
        questions: lines(form.questions),
        source_urls: lines(form.source_urls),
      });
      let current = record;
      if (!current || dirty) {
        const payload = current
          ? {
              expected_version: current.version,
              title: body.theme,
              body,
              reason: 'Updated theme draft and proposed research scope.',
              corrects_version: null,
            }
          : { kind: 'theme_intent', title: body.theme, body };
        const signature = JSON.stringify(payload);
        if (createKey.current?.signature !== signature)
          createKey.current = {
            signature,
            key: `theme:${crypto.randomUUID()}`,
          };
        current = await api(
          StoredEntitySchema,
          current ? `${base}/${current.id}/revisions` : base,
          {
            csrf: session.csrf_token,
            body: payload,
            idempotencyKey: createKey.current.key,
          },
        );
        setRecord(current);
        setForm(fromBody(body));
        setDirty(false);
        setPending(null);
        createKey.current = null;
        saved.reload();
      }
      setNotice(`Draft saved as version ${current.version}.`);
      const prepared = await api(
        ThemeResearchPlanSchema,
        `${base}/${current.id}/research-plan`,
      );
      if (prepared.intent.content_hash !== current.content_hash)
        throw new Error(
          'This draft changed while preparing. Reload the saved version before continuing.',
        );
      setPlan(prepared);
    } catch (e) {
      setError(
        `${message(e)} Your edits are retained. If the draft changed elsewhere, reload its saved version before saving again.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="theme-intent-title">
      <h3 id="theme-intent-title">Start with a theme</h3>
      <p>
        Save a draft with just a theme. No connection, budget or existing claims
        are needed. Preparing a plan does not fetch sources, send data or start
        a run.
      </p>
      {saved.error && (
        <p role="alert">
          Could not load saved drafts: {saved.error}{' '}
          <button type="button" onClick={saved.reload}>
            Reload saved drafts
          </button>
        </p>
      )}
      <ul className="rows" aria-label="Saved theme drafts">
        {saved.data?.map((d) => (
          <li key={d.id}>
            <button type="button" disabled={busy} onClick={() => void open(d)}>
              Resume {d.title}
            </button>{' '}
            · version {d.version}
          </li>
        ))}
      </ul>
      <button type="button" disabled={busy} onClick={() => void open('new')}>
        New theme draft
      </button>
      {pending && (
        <div role="group" aria-label="Unsaved theme edits">
          <p>Discard unsaved edits before opening another draft?</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void open(pending, true)}
          >
            Discard edits and open
          </button>{' '}
          <button
            type="button"
            disabled={busy}
            onClick={() => setPending(null)}
          >
            Keep editing
          </button>
        </div>
      )}
      <form onSubmit={(e) => void save(e)}>
        <fieldset disabled={busy || readonly}>
          <legend>
            {record
              ? `Theme draft · version ${record.version}`
              : 'New theme draft'}
          </legend>
          <label htmlFor="intent-theme">Draft theme</label>
          <input
            id="intent-theme"
            required
            maxLength={300}
            value={form.theme}
            onChange={(e) => change({ ...form, theme: e.target.value })}
          />
          <label htmlFor="intent-context">Context (optional)</label>
          <textarea
            id="intent-context"
            maxLength={2000}
            value={form.context}
            onChange={(e) => change({ ...form, context: e.target.value })}
          />
          <label htmlFor="intent-constraints">
            Solution constraints (optional, separate from execution limits)
          </label>
          <textarea
            id="intent-constraints"
            maxLength={2000}
            value={form.solution_constraints}
            onChange={(e) =>
              change({ ...form, solution_constraints: e.target.value })
            }
          />
          <label htmlFor="intent-questions">
            Research questions (optional, one per line; up to 10)
          </label>
          <textarea
            id="intent-questions"
            value={form.questions}
            onChange={(e) => change({ ...form, questions: e.target.value })}
          />
          <label htmlFor="intent-strategy">Proposed evidence path</label>
          <select
            id="intent-strategy"
            value={form.source_strategy}
            onChange={(e) =>
              change({
                ...form,
                source_strategy: e.target
                  .value as ThemeIntentBody['source_strategy'],
              })
            }
          >
            <option value="supplied_public_sources">
              Supplied public sources
            </option>
            <option value="approved_direct_fetch">
              Direct retrieval after host and permission checks
            </option>
          </select>
          <label htmlFor="intent-sources">
            Proposed public HTTPS source URLs (optional, one per line; up to 10)
          </label>
          <textarea
            id="intent-sources"
            value={form.source_urls}
            onChange={(e) => change({ ...form, source_urls: e.target.value })}
          />
          <button type="submit">
            {busy ? 'Saving…' : 'Save draft and prepare plan'}
          </button>
        </fieldset>
      </form>
      {readonly && <p>You can read saved drafts but cannot save changes.</p>}
      {record && (
        <button type="button" disabled={busy} onClick={() => void open(record)}>
          Reload saved version
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {plan && (
        <div aria-label="Prepared research plan">
          <h4>Proposed research plan · saved version {plan.intent.version}</h4>
          <p>
            {plan.sharing} Preparation uses zero provider requests, zero source
            fetches and $0 new metered spending. Execution has not been
            authorized or configured.
          </p>
          <p>
            Native search is not integrated in this adapter; account entitlement
            is unknown. Public URLs still need source-policy and permission
            checks.
          </p>
          <h4>Questions to resolve</h4>
          <button
            type="button"
            disabled={busy || readonly}
            onClick={() =>
              change({ ...form, questions: plan.questions.join('\n') })
            }
          >
            Edit these questions in the draft
          </button>
          <ul>
            {plan.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          <h4>Before collection or discovery</h4>
          <ul>
            {plan.prerequisites.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
