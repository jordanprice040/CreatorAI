const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const ws = process.env.WALK_WS; // the walk workspace on the throwaway database
  const shot = (name) => require('node:path').join(__dirname, 'screens', name);
  await p.goto('http://127.0.0.1:5183/#login=walk-login-code-0123456789abcdefghijkl');
  await p.waitForTimeout(2000);
  await p.goto(`http://127.0.0.1:5183/#/monitor/approvals?ws=${ws}`);
  await p.waitForTimeout(2500);
  const card = p.locator('.routine-card').first();
  console.log('CARD', (await card.textContent()).slice(0, 400));
  console.log('WAITING', await p.evaluate(() => document.querySelectorAll('article.decision').length));
  console.log('STANDING', await p.evaluate(() => [...document.querySelectorAll('h3')].find(h => h.textContent === 'Standing policies')?.nextElementSibling?.textContent?.slice(0, 200)));
  await card.locator('details').nth(1).evaluate((d) => (d.open = true));
  await card.screenshot({ path: shot('approvals-card.png') });
  // Change: lower the step limit, confirm, save.
  await card.locator('button:has-text("Change")').click();
  await p.waitForTimeout(300);
  console.log('SAVE disabled before confirm', await card.locator('button:has-text("Save the changed policy")').isDisabled());
  await card.locator('input[inputmode=numeric]').fill('60');
  await card.locator('input[id$="-confirm"]').check();
  await card.locator('.routine-edit').screenshot({ path: shot('approvals-change.png') });
  await card.locator('button:has-text("Save the changed policy")').click();
  await p.waitForTimeout(1500);
  const after = p.locator('.routine-card').first();
  console.log('AFTER CHANGE', (await after.textContent()).slice(0, 200));
  // Review L-5: Revoke asks first. "Keep them" leaves the policy as it is.
  await after.locator('button:has-text("Revoke…")').click();
  await p.waitForTimeout(300);
  await after.locator('button:has-text("Keep them")').click();
  await p.waitForTimeout(800);
  console.log('AFTER KEEP', (await p.locator('.routine-card').first().textContent()).slice(0, 60));
  await after.locator('button:has-text("Revoke…")').click();
  await p.waitForTimeout(300);
  await after.locator('[aria-label="Confirm revoke"]').screenshot({ path: shot('approvals-revoke-confirm.png') });
  await after.locator('button:has-text("Revoke routine approvals")').click();
  await p.waitForTimeout(1500);
  console.log('AFTER REVOKE', (await p.locator('.routine-card').first().textContent()).slice(0, 260));
  console.log('ERR', await p.evaluate(() => [...document.querySelectorAll('.error')].map(l=>l.textContent).join(' || ')));
  await p.locator('.routine-card').first().screenshot({ path: shot('approvals-revoked.png') });
  await b.close();
})();
