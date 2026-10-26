import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { ThemeIntentBodySchema } from '@creator/contracts';

async function harness() {
  const source = await readFile(
    new URL('../../apps/web/src/theme-intent.tsx', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  async function open(');
  const end = source.indexOf('  async function save(', start);
  assert.ok(start > 0 && end > start);
  const handler = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const state = {
    dirty: true,
    pending: null as null | string | { id: string },
    form: { theme: 'UNSAVED', context: 'keep this text' },
    record: { id: 'original' },
    busy: false,
    error: '',
    reads: [] as string[],
    fail: false,
  };
  const make = new Function(
    'state',
    'ThemeIntentBodySchema',
    `const base='test/entities', EntityDetailSchema={};const blank=()=>({theme:'',context:''}),fromBody=b=>b;const createKey={current:null};const message=e=>e.message;const setPending=v=>state.pending=v,setBusy=v=>state.busy=v,setError=v=>state.error=v,setRecord=v=>state.record=v,setForm=v=>state.form=v,setDirty=v=>state.dirty=v,setPlan=()=>{},setNotice=()=>{};const api=async(_schema,path)=>{state.reads.push(path);if(state.fail)throw Error('load failed');return{entity:{id:path.split('/').pop(),status:'active',body:{format:'theme-intent/1',theme:'SAVED',context:'saved text'}}}};return ()=>{const {dirty,pending}=state;${handler};return open;}`,
  );
  const render = make(state, ThemeIntentBodySchema) as () => (
    next: 'new' | { id: string },
    confirmed?: boolean,
  ) => Promise<void>;
  return {
    state,
    open: async (next: 'new' | { id: string }, confirmed = false) =>
      render()(next, confirmed),
  };
}

test('every ordinary New, Resume and Reload preserves dirty input while a prompt is already open', async () => {
  const h = await harness();
  for (const target of [
    'new',
    'new',
    { id: 'A' },
    { id: 'B' },
    { id: 'original' },
  ] as const) {
    await h.open(target);
    assert.equal(h.state.form.theme, 'UNSAVED');
    assert.equal(h.state.dirty, true);
    assert.deepEqual(h.state.pending, target);
    assert.equal(h.state.reads.length, 0);
  }
});
test('explicit discard alone can open a new draft or a selected saved draft', async () => {
  const h = await harness();
  await h.open({ id: 'A' });
  await h.open({ id: 'A' }, true);
  assert.equal(h.state.form.theme, 'SAVED');
  assert.equal(h.state.dirty, false);
  assert.equal(h.state.pending, null);
  assert.equal(h.state.reads.length, 1);
  h.state.dirty = true;
  await h.open('new');
  assert.equal(h.state.form.theme, 'SAVED');
  await h.open('new', true);
  assert.equal(h.state.form.theme, '');
});
test('failed confirmed loads preserve edits and re-guard subsequent ordinary navigation', async () => {
  const h = await harness();
  await h.open({ id: 'A' });
  h.state.fail = true;
  await h.open({ id: 'A' }, true);
  assert.equal(h.state.form.context, 'keep this text');
  assert.equal(h.state.dirty, true);
  assert.equal(h.state.error, 'load failed');
  await h.open('new');
  assert.equal(h.state.form.theme, 'UNSAVED');
  assert.equal(h.state.reads.length, 1);
  assert.equal(h.state.busy, false);
});
