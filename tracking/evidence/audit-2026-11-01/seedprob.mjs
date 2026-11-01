const s = JSON.parse(
  (await import('node:fs')).readFileSync(
    process.env.CREATOR_SESSION_FILE,
    'utf8',
  ),
);
const WS = 'c2b797a1-be2d-4973-8aec-fa18805b72e9',
  B = 'http://127.0.0.1:4330/api/workspaces/' + WS;
const h = {
  cookie: 'creator_session=' + s.token,
  'x-csrf-token': s.csrf,
  'content-type': 'application/json',
};
const list = await (
  await fetch(B + '/entities?kind=problem', { headers: h })
).json();
const body = list[0].body;
for (let i = 1; i <= 3; i++) {
  const r = await fetch(B + '/entities', {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      kind: 'problem',
      title: `Practicing frame-precise keyboard and mouse input timing for speedrunners and competitive gamers: rerun ${i} candidate observation (audit)`,
      body,
    }),
  });
  console.log(r.status, (await r.text()).slice(0, 100));
  await new Promise((r) => setTimeout(r, 1100));
}
