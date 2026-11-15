// Downloads an artifact's manifest and source archive from the throwaway studio, as Try's
// Download buttons do. Usage: node fetch-package.mjs <workspace> <artifact id> <out dir>
import { writeFileSync, mkdirSync } from 'node:fs';
const [ws, id, out] = process.argv.slice(2);
const api = process.env.CREATOR_API_URL + '/api';
const login = await fetch(`${api}/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: process.env.CREATOR_DEV_LOGIN_CODE }),
});
const Cookie = login.headers.getSetCookie()[0].split(';')[0];
const list = await (
  await fetch(`${api}/workspaces/${ws}/artifacts`, { headers: { Cookie } })
).json();
const a = list.find((x) => x.id === id);
mkdirSync(out, { recursive: true });
const manifest = await fetch(
  `${api}/workspaces/${ws}/artifacts/${id}/manifest?sha256=${a.manifest_sha256}`,
  { headers: { Cookie } },
);
writeFileSync(
  `${out}/manifest.json`,
  Buffer.from(await manifest.arrayBuffer()),
);
const tar = await fetch(
  `${api}/workspaces/${ws}/artifacts/${id}/download?sha256=${a.manifest_sha256}`,
  { headers: { Cookie } },
);
const name = /filename="([^"]+)"/.exec(
  tar.headers.get('content-disposition'),
)[1];
writeFileSync(`${out}/${name}`, Buffer.from(await tar.arrayBuffer()));
console.log(`${out}/${name}`);
