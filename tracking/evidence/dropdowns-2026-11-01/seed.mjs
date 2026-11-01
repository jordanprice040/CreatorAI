// Adds the pilot's three look-alike problems and a named discovery run to a throwaway workspace.
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.env.CREATOR_SESSION_FILE, 'utf8'));
const [, , WS] = process.argv;
const B = `http://127.0.0.1:4330/api/workspaces/${WS}`;
const h = {
  cookie: 'creator_session=' + s.token,
  'x-csrf-token': s.csrf,
  'content-type': 'application/json',
};
const get = async (p) => (await fetch(B + p, { headers: h })).json();
const post = async (p, body) => {
  const r = await fetch(B + p, {
    method: 'POST',
    headers: h,
    body: JSON.stringify(body),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(t));
  return t;
};
const THEME =
  'Practicing frame-precise keyboard and mouse input timing for speedrunners and competitive gamers';
const body = (await get('/entities?kind=problem'))[0].body;
for (const own of [
  'Candidate observation: repeated inputs fall outside a specified target window, while available practice feedback fails to reveal signed timing error',
  'For one defined technique, record repeated misses relative to a verified target window and whether existing feedback reveals signed error',
  'For a defined technique, repeated inputs fall outside a verified target window and available feedback fails to expose signed timing error',
]) {
  const p = await post('/entities', {
    kind: 'problem',
    title: `${THEME}: ${own}`,
    body,
  });
  console.log('problem', p.id);
  await new Promise((r) => setTimeout(r, 1100));
}
const run = await post('/entities', {
  kind: 'run',
  title: `Discovery: ${THEME}`,
  body: {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  },
});
const ctl = await post('/runs', {
  run: { id: run.id, version: 1 },
  autonomy_mode: 'human_in_loop',
  stage_gates: null,
  initial_grants: [],
});
console.log('run', ctl.run_id);
