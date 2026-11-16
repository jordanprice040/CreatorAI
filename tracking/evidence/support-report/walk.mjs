// ADR-0118 (F5) walk: Monitor > Workers, prepare the support report, check the preview hides a
// planted secret and path, copy it, and screenshot both themes. Fixture data, no live calls.
// Usage: node walk.mjs <web origin> <out dir>   (studio started with CREATOR_DEV_LOGIN_CODE)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [origin = 'http://127.0.0.1:5183', out = '.'] = process.argv.slice(2);
const code = process.env.CREATOR_DEV_LOGIN_CODE;
const browser = await chromium.launch();
const results = [];
const check = (name, ok) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
for (const theme of ['dark', 'light']) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.evaluate(async (c) => {
    const r = await fetch('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: c }),
    });
    const { csrf_token } = await r.json();
    const list = await (await fetch('/api/workspaces')).json();
    if (list.length === 0)
      await fetch('/api/workspaces', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf_token,
        },
        body: JSON.stringify({ name: 'F5 walk', record_mode: 'fixture' }),
      });
  }, code);
  await page.goto(`${origin}/#/monitor/workers`);
  // A hash change alone keeps the app's first load; reload so a new workspace shows.
  await page.reload();
  // The studio's own theme button (dark is the default theme).
  const toggle = page.getByRole('button', { name: `Use ${theme} theme` });
  if (await toggle.count()) await toggle.click();
  await page.getByRole('button', { name: 'Prepare support report' }).click();
  const box = page.locator('#support-report-text');
  await box.waitFor();
  const text = await box.inputValue();
  const status = page.locator('.support-report [role="status"]');
  check(
    `${theme}: status announces the ready report`,
    /^Report ready, \d+ items? hidden\.$/.test(
      (await status.innerText()).trim(),
    ),
  );
  check(
    `${theme}: preview shows the report`,
    text.startsWith('Creator Agent support report'),
  );
  check(`${theme}: planted token hidden`, !text.includes('abc123secret'));
  check(
    `${theme}: planted user folder hidden`,
    !text.includes('\\Users\\jordan'),
  );
  await page.getByRole('button', { name: 'Copy report' }).click();
  await page.getByText('Copied.').waitFor();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(`${theme}: clipboard equals preview`, copied === text);
  // Review 1 N-5: axe on the section, with the preview and status shown.
  await page.addScriptTag({ path: require.resolve('axe-core') });
  const violations = await page.evaluate(async () =>
    (
      await window.axe.run(document.querySelector('.support-report'), {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag22aa'],
      })
    ).violations.map((v) => `${v.id} ${v.nodes.length}`),
  );
  check(
    `${theme}: axe finds no violations${violations.length ? ` (${violations.join(', ')})` : ''}`,
    violations.length === 0,
  );
  await page
    .locator('.support-report')
    .screenshot({ path: `${out}/support-report-${theme}.png` });
  await context.close();
}
await browser.close();
console.log(results.join('\n'));
if (results.some((r) => r.startsWith('FAIL'))) process.exit(1);
