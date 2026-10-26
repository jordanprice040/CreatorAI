import { files, copyVerified, child } from 'file:///C:/dev/creator_agent/scripts/theme-intent-upgrade-core.mjs';
const S = process.argv[2];
for (const [label, f] of [
  ['files(root containing junction)', () => files(S + '/root')],
  ['files(root itself is a junction)', () => files(S + '/rootjunction')],
  ['copyVerified(root with junction)', () => copyVerified(S + '/root', S + '/copy')],
]) {
  try { console.log(label, 'ACCEPTED', JSON.stringify(await f())); }
  catch (e) { console.log(label, 'REJECTED:', e.message); }
}
for (const p of ['a/./b', 'a//b', '.', 'x/..', 'a/..', 'CON', 'a/b\u0000'])
  try { console.log('child', JSON.stringify(p), '->', child('C:/r', p)); } catch (e) { console.log('child', JSON.stringify(p), 'REJECTED'); }
