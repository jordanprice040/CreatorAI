import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// allow-tasks.tsx with caps-fields.ts transpiled beside it; React loads from the web app.
async function load() {
  const compile = async (file: string, req: (n: string) => unknown) => {
    const source = await readFile(`apps/web/src/${file}`, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const exports = {} as Record<string, unknown>;
    new Function('require', 'exports', code)(req, exports);
    return exports;
  };
  const web = createRequire(
    new URL('../../apps/web/src/allow-tasks.tsx', import.meta.url),
  );
  const caps = await compile('caps-fields.ts', web);
  return (await compile('allow-tasks.tsx', (n) =>
    n === './caps-fields.js' ? caps : web(n),
  )) as {
    allowTaskSequence: (
      c: unknown,
      after: readonly string[],
      act: Act,
      report: (e: string) => void,
    ) => Promise<boolean>;
    allowSequence: (
      c: unknown,
      after: { data?: readonly string[]; tasks?: readonly string[] },
      act: Act,
      report: (e: string) => void,
    ) => Promise<boolean>;
  };
}
type Act = (
  path: string,
  body: unknown,
  timeoutMs?: number,
  local?: (error: string) => void,
) => Promise<unknown>;

const connection = (accepted: boolean) => ({
  id: 'c1',
  kind: 'chatgpt_plan',
  version: 4,
  caps_accepted_at: accepted ? '2026-11-11T09:00:00.000Z' : null,
  settings: {
    allowed_data_classes: ['synthetic', 'public'],
    allowed_task_classes: ['summarization'],
  },
});

/** A fake `act` that records each call and answers from a script. */
function fakeAct(answers: ((local?: (e: string) => void) => unknown)[]) {
  const calls: { path: string; body: unknown }[] = [];
  const act: Act = async (path, body, _t, local) => {
    calls.push({ path, body });
    return answers[calls.length - 1]!(local);
  };
  return { act, calls };
}

test('ADR-0084: allowing on accepted caps saves the tasks, then accepts the version that save returned', async () => {
  const { allowTaskSequence } = await load();
  const errors: string[] = [];
  const { act, calls } = fakeAct([
    () => ({ version: 5, settings_hash: 'h5' }),
    () => ({ version: 6 }),
  ]);
  const ok = await allowTaskSequence(
    connection(true),
    ['specification', 'summarization'],
    act,
    (e) => errors.push(e),
  );
  assert.equal(ok, true);
  assert.deepEqual(
    calls.map((c) => c.path),
    ['plan-connections/c1/settings', 'plan-connections/c1/accept-caps'],
  );
  assert.deepEqual(
    (calls[0]!.body as { settings: { allowed_task_classes: string[] } })
      .settings.allowed_task_classes,
    ['specification', 'summarization'],
  );
  assert.equal(
    (calls[0]!.body as { expected_version: number }).expected_version,
    4,
  );
  assert.deepEqual(calls[1]!.body, {
    expected_version: 5,
    settings_hash: 'h5',
  });
  assert.deepEqual(errors, []);
});

test('ADR-0084: caps that were not accepted stay unaccepted', async () => {
  const { allowTaskSequence } = await load();
  const { act, calls } = fakeAct([() => ({ version: 5, settings_hash: 'h5' })]);
  assert.equal(
    await allowTaskSequence(connection(false), ['scoring'], act, () => {}),
    true,
  );
  assert.deepEqual(
    calls.map((c) => c.path),
    ['plan-connections/c1/settings'],
  );
});

test('PR #172 review L-1: a refused re-acceptance is reported through the outliving handler, with its fix', async () => {
  const { allowTaskSequence } = await load();
  const errors: string[] = [];
  const { act } = fakeAct([
    () => ({ version: 5, settings_hash: 'h5' }),
    (local) => {
      local?.('The connection changed; reload it and try again.');
      return null;
    },
  ]);
  const ok = await allowTaskSequence(connection(true), ['scoring'], act, (e) =>
    errors.push(e),
  );
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /allowed, but the caps were not accepted again/);
  assert.match(errors[0]!, /The connection changed/);
  assert.match(errors[0]!, /Accept these caps and allowed work/);
  // A refused save stops before accept-caps.
  const first = fakeAct([
    (local) => {
      local?.('Only the workspace owner can change this.');
      return null;
    },
  ]);
  const seen: string[] = [];
  assert.equal(
    await allowTaskSequence(connection(true), ['scoring'], first.act, (e) =>
      seen.push(e),
    ),
    false,
  );
  assert.equal(first.calls.length, 1);
  assert.deepEqual(seen, ['Only the workspace owner can change this.']);
});

test('ADR-0087: allowing a data class changes only the data classes, and re-accepts accepted caps', async () => {
  const { allowSequence } = await load();
  const errors: string[] = [];
  const { act, calls } = fakeAct([
    () => ({ version: 5, settings_hash: 'h5' }),
    (local) => {
      local?.('Stale.');
      return null;
    },
  ]);
  const ok = await allowSequence(
    connection(true),
    { data: ['synthetic', 'public', 'private_approved'] },
    act,
    (e) => errors.push(e),
  );
  assert.equal(ok, false);
  const sent = (
    calls[0]!.body as {
      settings: {
        allowed_data_classes: string[];
        allowed_task_classes: string[];
      };
    }
  ).settings;
  assert.deepEqual(sent.allowed_data_classes, [
    'synthetic',
    'public',
    'private_approved',
  ]);
  assert.deepEqual(sent.allowed_task_classes, ['summarization']);
  assert.equal(calls[1]!.path, 'plan-connections/c1/accept-caps');
  assert.match(errors[0]!, /^The change was saved, but the caps/);
});
