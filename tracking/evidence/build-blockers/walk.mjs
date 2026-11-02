// Build-blocker walk (PR #117). Fixture only, $0. Reproduces a-spec-row.png and b-start-build.png.
// 1. Throwaway database, migrated: CREATOR_DATABASE_URL=… node packages/db/dist/migrate-main.js
// 2. Dev studio on the reviewer ports:
//    CREATOR_API_PORT=4330 CREATOR_WEB_PORT=5183 CREATOR_PREVIEW_PORT=4340 \
//    CREATOR_DEV_LOGIN_CODE=<32+ chars> node scripts/dev.mjs
// 3. CLI (CREATOR_API_URL=http://127.0.0.1:4330): login <code>; seed-selection; then freeze the
//    seeded spec with spec-freeze (approve the decision it asks for with `answer`).
// 4. node tracking/evidence/build-blockers/walk.mjs <login code> <workspace id> [out dir]
// The seeded spec's check A1 has no test cases, so both screenshots show the blocker.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [code, ws, out = 'tracking/evidence/build-blockers'] =
  process.argv.slice(2);
if (!code || !ws)
  throw new Error('usage: walk.mjs <login code> <workspace id> [out dir]');
const web = 'http://127.0.0.1:5183';
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('dialog', (d) => d.accept());
await pg.goto(`${web}/#login=${code}`);
await pg.waitForTimeout(2500);
await pg.goto(`${web}/#/projects/build?ws=${ws}`);
await pg.waitForTimeout(3000);
for (const name of ['Create product', 'Prepare task']) {
  const button = pg.getByRole('button', { name });
  if (await button.count()) {
    await button.first().click();
    await pg.waitForTimeout(3000);
  }
}
const row = pg.getByText("Can't be built yet").first();
await row.scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${out}/a-spec-row.png` });
await pg.getByText("This task can't be built").scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${out}/b-start-build.png` });
const start = pg.getByRole('button', { name: 'Start build' });
console.log(
  JSON.stringify({
    row: await row.innerText(),
    start_build_disabled: await start.isDisabled(),
  }),
);
await b.close();
