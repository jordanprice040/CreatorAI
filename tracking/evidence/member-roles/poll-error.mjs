// PR #90 re-review N-4 (second point): one failed background poll on Monitor > Approvals used to
// leave its error on screen for good. Now the next poll that works clears it; an action's own
// error (a refused Revoke or Stop run, simulated) still stays through the next good poll.
// Start ../owner-actions/stack.mjs first, then:
//   node tracking/evidence/member-roles/poll-error.mjs <workspace-id>
// The failed poll is simulated in the browser (Playwright route), so nothing on the server changes.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const WEB = 'http://127.0.0.1:5183';
const [ws] = process.argv.slice(2);
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) process.exitCode = 1;
};
const login = await fetch(`${WEB}/api/auth/dev-login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: 'walk-login-code-0123456789abcdefghij' }),
});
const [name, value] = login.headers.getSetCookie()[0].split(';')[0].split('=');
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name, value, url: WEB }]);
const page = await ctx.newPage();
const alerts = () => page.locator('[role=alert]:visible').allInnerTexts();
await page.goto(`${WEB}/#/decisions?ws=${ws}`);
await page.waitForTimeout(3000);
check((await alerts()).length === 0, 'no error on first load');
const grants = '**/api/workspaces/*/grants';
await page.route(grants, (r) =>
  r.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'INTERNAL', message: 'Walk: one poll failed.' },
    }),
  }),
);
await page.waitForTimeout(16500); // one 15-second poll
check(
  (await alerts()).includes('Walk: one poll failed.'),
  'a failed poll shows its error',
);
await page.unroute(grants);
await page.waitForTimeout(16500);
check((await alerts()).length === 0, 'the next poll that works clears it');

// An action's own error stays through the next good poll. The refusal is simulated in the
// browser, so nothing is revoked or stopped.
const revoke = page.getByRole('button', { name: 'Revoke', exact: true });
const stop = page.getByRole('button', { name: 'Stop run', exact: true });
const useRevoke = (await revoke.count()) > 0;
check(
  useRevoke || (await stop.count()) > 0,
  'a Revoke or Stop run button to try',
);
const action = useRevoke
  ? '**/api/workspaces/*/grants/*/revoke'
  : '**/api/workspaces/*/runs/*/cancel';
await page.route(action, (r) =>
  r.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Walk: the action was refused.',
      },
    }),
  }),
);
await (useRevoke ? revoke : stop).first().click();
await page.waitForTimeout(1500);
check(
  (await alerts()).includes('Walk: the action was refused.'),
  `a refused ${useRevoke ? 'Revoke' : 'Stop run'} shows its error`,
);
await page.waitForTimeout(16500); // one good poll
check(
  (await alerts()).includes('Walk: the action was refused.'),
  'the next good poll keeps the action error',
);
await browser.close();
