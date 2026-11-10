import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const WS = process.argv[3];
const H = {
  'Content-Type': 'application/json',
  Cookie: `creator_session=${s.token}`,
  'X-CSRF-Token': s.csrf,
};
const api = async (path, body) => {
  const r = await fetch(
    `${s.origin}/api/${path}`,
    body
      ? { method: 'POST', headers: H, body: JSON.stringify(body) }
      : { headers: H },
  );
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
};
const problems = await api(`workspaces/${WS}/entities?kind=problem`);
const p = problems[0];
const alt = await api(`workspaces/${WS}/entities`, {
  kind: 'alternative',
  title: 'Shared shift roster',
  body: {
    kind: process.argv[4],
    rationale: 'Fixture option for the walk.',
    tradeoffs: ['Needs upkeep'],
    uncertainty: 'Synthetic fixture.',
  },
});
await api(`workspaces/${WS}/links`, {
  relation: 'derived_from',
  from: { id: alt.id, version: alt.version },
  to: { id: p.id, version: p.version },
  rationale: 'Walk fixture',
});
console.log('ok', alt.id);
