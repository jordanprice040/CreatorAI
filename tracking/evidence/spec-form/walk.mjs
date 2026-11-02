// Browser walk for the Build page "Write a spec" form (audit item 4, piece 2), against a
// throwaway database on the review ports. Two `pnpm cli seed-selection` workspaces: in the
// first (create) the seeded spec was archived, so the selected option has no spec; the
// second (revise) keeps its spec. Usage:
//   node walk.mjs <login-code> <create-ws> <revise-ws> <out-dir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const [code, createWs, reviseWs, out = '.'] = process.argv.slice(2);
const WEB = 'http://127.0.0.1:5183';
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(';')[0];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const [name, value] = cookie.split('=');
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
const form = page.locator('form.spec-form');
const fill = (id, v) => page.locator(`[id="sf-${id}"]`).fill(v);

// Create: the selected option has no spec yet.
await page.goto(`${WEB}/#/projects/build?ws=${createWs}`);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Write a spec' }).click();
await page.waitForTimeout(400);
console.log('prefilled title:', await page.locator('[id="sf-title"]').inputValue());
console.log('prefilled audience:', await page.locator('[id="sf-audience"]').inputValue());
await page.getByRole('button', { name: 'Save spec' }).click();
await page.waitForTimeout(400);
console.log('empty save:', await form.locator('p[role=alert]').first().innerText());
await form.screenshot({ path: `${out}/01-spec-empty-save.png` });
await fill('scope', 'Offline Python command-line checklist');
await fill('non_goals', 'Web UI\nPublic release');
await fill('flows.0.name', 'Print checklist');
await fill('flows.0.steps', 'Run with no arguments\nRead the steps');
await fill('checks.0.statement', 'Prints the four steps');
await fill('checks.0.measure', 'Exact stdout and exit code 0');
await page.locator('[id="sf-checks.0.method"]').selectOption('automated_test');
await page.locator('[id="sf-checks.0.flow"]').selectOption('F1');
await fill('checks.0.cases.0.stdout', 'inspect\nbuild\nreview\nverify');
await page.getByRole('button', { name: 'Add a case' }).click();
await fill('checks.0.cases.1.args', 'unexpected');
await fill('checks.0.cases.1.stdout', 'invalid input');
await fill('checks.0.cases.1.exit_code', '2');
await page.getByText('Held out (only QA sees this case)').nth(1).click();
await fill('tasks.0.title', 'Implement the checklist');
await page.locator('[id="sf-tasks.0.role"]').selectOption('builder');
await fill('tasks.0.file_scope', 'src');
await page.getByRole('group', { name: 'Checks T1 delivers' }).getByLabel('A1').check();
await fill('tasks.0.deliverable', 'Python checklist with tests passing');
await fill('maintenance.owner', 'Owner');
await fill('maintenance.obligations', 'Keep the logs');
await fill('maintenance.review_interval', 'On change');
console.log('build notes:', await form.locator('.notice[role=status]').count());
await page.getByRole('button', { name: 'Save spec' }).click();
await page.waitForTimeout(2500);
console.log('note:', await page.locator('.notice, .ok, [role=status]').allInnerTexts().then((t) => t.filter((x) => /saved/.test(x))));
await page.locator('h3:has-text("Specs") + *').first().screenshot({ path: `${out}/02-spec-saved.png` }).catch(() => {});
await page.screenshot({ path: `${out}/02-build-after-save.png`, fullPage: true });
console.log('specs list:', await page.locator('h3:has-text("Specs") ~ ul.rows li').allInnerTexts());

// Revise: open the seeded spec, drop the held-out flag, see the build note, save with a reason.
await page.goto(`${WEB}/#/projects/build?ws=${reviseWs}`);
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Revise' }).first().click();
await page.waitForTimeout(400);
console.log('revise heading:', await form.locator('h3').innerText());
await fill('title', (await page.locator('[id="sf-title"]').inputValue()) + ' (edited)');
await page.getByRole('button', { name: 'Save new version' }).click();
await page.waitForTimeout(400);
console.log('no reason:', await page.locator('[id="sf-reason-error"]').innerText());
await fill('reason', 'Walk: renamed the spec');
await page.getByRole('button', { name: 'Save new version' }).click();
await page.waitForTimeout(2500);
console.log('after revise:', await page.locator('h3:has-text("Specs") ~ ul.rows li').first().innerText());
await page.screenshot({ path: `${out}/03-build-after-revise.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Revise' }).first().click();
await page.waitForTimeout(400);
await form.screenshot({ path: `${out}/04-spec-phone.png` });
await browser.close();
