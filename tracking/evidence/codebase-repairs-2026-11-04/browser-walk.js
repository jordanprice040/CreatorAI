// Playwright MCP callback. Start the disposable fixture stack on review ports first.
// No model call, form submission, installed-app interaction or personal browser session.
async (page) => {
  const base = 'http://127.0.0.1:5183';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${base}/#login=repair-walk-code-0123456789abcdefghij`);
  await page.locator('#chat-input').waitFor();
  const ws = new URLSearchParams(page.url().split('?')[1]).get('ws');
  const assets = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .filter((n) => n.endsWith('.js')),
    );
  const before = await assets();
  if (before.some((n) => /\/models-.*\.js$/.test(n)))
    throw Error('Models loaded before navigation');
  const draft = 'Audit draft: keep this while opening Models';
  await page.locator('#chat-input').fill(draft);
  await page
    .getByRole('link', { name: 'Models and connections', exact: true })
    .click();
  await page
    .getByText('historical pass (older prompt)', { exact: false })
    .waitFor();
  const note = await page
    .getByText('Does not count for the current prompt.', { exact: false })
    .textContent();
  const after = await assets();
  if (!after.some((n) => /\/models-.*\.js$/.test(n)))
    throw Error('Models chunk not observed');
  await page.getByRole('link', { name: 'Chat', exact: true }).click();
  if ((await page.locator('#chat-input').inputValue()) !== draft)
    throw Error('Draft lost on navigation');
  await page.route('**/assets/portfolio-*.js', (route) => route.abort());
  await page.evaluate((ws) => {
    location.hash = `#/projects/maintain?ws=${ws}`;
  }, ws);
  await page
    .getByRole('alert')
    .filter({ hasText: 'This page could not be opened' })
    .waitFor();
  await page.getByRole('link', { name: 'Chat', exact: true }).click();
  if ((await page.locator('#chat-input').inputValue()) !== draft)
    throw Error('Draft lost on chunk failure');
  await page.unroute('**/assets/portfolio-*.js');
  await page
    .getByRole('link', { name: 'Models and connections', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (
    !(await page
      .getByText('historical pass (older prompt)', { exact: false })
      .isVisible())
  )
    throw Error('Historical label not visible');
  if (
    !(await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ))
  )
    throw Error('Mobile horizontal overflow');
  return {
    before,
    after,
    qualificationNote: note,
    draftRetained: true,
    failedChunkContained: true,
    mobileWidth: 390,
    horizontalOverflow: false,
  };
};
