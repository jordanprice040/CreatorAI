async (page) => {
  const origin = 'http://127.0.0.1:5188';
  const ws = '98e83b94-56f8-49e9-9a6c-5a8af161d158',
    other = '827ca3a0-f045-44bc-bfa6-16cd6e076b4b';
  const initialSession = await (
    await page.request.get(origin + '/api/auth/session')
  ).json();
  const priorDrafts = await (
    await page.request.get(
      origin + `/api/workspaces/${ws}/entities?kind=theme_intent&status=active`,
    )
  ).json();
  for (const d of priorDrafts.filter(
    (d) => d.title === 'CSV quality draft browser acceptance',
  )) {
    const archived = await page.request.post(
      origin + `/api/workspaces/${ws}/entities/${d.id}/archive`,
      {
        headers: { 'X-CSRF-Token': initialSession.csrf_token },
        data: {
          expected_version: d.version,
          reason:
            'Preserve earlier isolated browser attempt as archived test data',
        },
      },
    );
    if (!archived.ok()) throw new Error('Could not archive earlier test draft');
  }
  await page.goto(origin + `/#/submit?ws=${ws}`);
  await page.reload();
  await page.getByLabel('Draft theme', { exact: true }).waitFor();
  const theme = page.getByLabel('Draft theme', { exact: true });
  const context = page.getByLabel('Context (optional)', { exact: true });
  const save = () =>
    page
      .getByRole('button', { name: 'Save draft and prepare plan', exact: true })
      .click();
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  await theme.fill('CSV quality draft browser acceptance');
  await save();
  await page
    .getByRole('status')
    .filter({ hasText: 'Draft saved as version 1.' })
    .waitFor();
  await page.getByLabel('Prepared research plan', { exact: true }).waitFor();
  check(
    (await page
      .getByText('Preparation uses zero provider requests', { exact: false })
      .count()) === 1,
    'preparation limits absent',
  );
  await page.reload();
  await page
    .getByRole('button', {
      name: 'Resume CSV quality draft browser acceptance',
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('#intent-theme')?.value ===
      'CSV quality draft browser acceptance',
  );
  check(
    (await theme.inputValue()) === 'CSV quality draft browser acceptance',
    'saved draft not restored after reload',
  );
  await context.fill('Browser edit preserved after failed save');
  await page.route('**/api/workspaces/*/entities/*/revisions', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'STORAGE_UNAVAILABLE',
          message: 'Injected local test save failure',
        },
      }),
    }),
  );
  await save();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Injected local test save failure' })
    .waitFor();
  check(
    (await context.inputValue()) === 'Browser edit preserved after failed save',
    'failed save lost input',
  );
  await page.unroute('**/api/workspaces/*/entities/*/revisions');
  await save();
  await page
    .getByRole('status')
    .filter({ hasText: 'Draft saved as version 2.' })
    .waitFor();
  const list = await (
    await page.request.get(
      origin + `/api/workspaces/${ws}/entities?kind=theme_intent&status=active`,
    )
  ).json();
  check(list.length === 1, 'duplicate draft created');
  const draft = list[0];
  const session = await (
    await page.request.get(origin + '/api/auth/session')
  ).json();
  const concurrent = await page.request.post(
    origin + `/api/workspaces/${ws}/entities/${draft.id}/revisions`,
    {
      headers: { 'X-CSRF-Token': session.csrf_token },
      data: {
        expected_version: 2,
        title: draft.title,
        body: { ...draft.body, context: 'Concurrent saved version' },
        reason: 'Browser conflict test',
        corrects_version: null,
      },
    },
  );
  check(concurrent.ok(), 'concurrent save failed');
  await context.fill('Unsaved conflicting editor text');
  await save();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Your edits are retained.' })
    .waitFor();
  check(
    (await context.inputValue()) === 'Unsaved conflicting editor text',
    'conflict lost edits',
  );
  await page
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  check(
    (await context.inputValue()) === 'Unsaved conflicting editor text',
    'keep editing lost text',
  );
  await page
    .getByRole('button', { name: 'Reload saved version', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Discard edits and open', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('#intent-context')?.value ===
      'Concurrent saved version',
  );
  await save();
  await page.getByLabel('Prepared research plan', { exact: true }).waitFor();
  await page
    .getByRole('button', {
      name: 'Edit these questions in the draft',
      exact: true,
    })
    .click();
  check(
    (
      await page
        .getByLabel('Research questions (optional, one per line; up to 10)', {
          exact: true,
        })
        .inputValue()
    ).includes('Who is affected'),
    'plan questions not editable',
  );
  await save();
  await page
    .getByRole('status')
    .filter({ hasText: 'Draft saved as version 4.' })
    .waitFor();
  await page.goto(origin + `/#/submit?ws=${other}`);
  await page.getByLabel('Draft theme', { exact: true }).waitFor();
  check(
    (await page
      .getByRole('button', {
        name: 'Resume CSV quality draft browser acceptance',
        exact: true,
      })
      .count()) === 0,
    'draft crossed workspaces',
  );
  check(
    (await page.getByLabel('Draft theme', { exact: true }).inputValue()) === '',
    'workspace leaked form',
  );
  await page.goto(origin + `/#/submit?ws=${ws}`);
  await page
    .getByRole('button', {
      name: 'Resume CSV quality draft browser acceptance',
      exact: true,
    })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('#intent-theme')?.value ===
      'CSV quality draft browser acceptance',
  );
  await save();
  await page.getByLabel('Prepared research plan', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'mobile horizontal overflow',
  );
  await page.screenshot({
    path: 'C:/dev/creator_agent/.verification/theme-intent-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: 'C:/dev/creator_agent/.verification/theme-intent-desktop.png',
    fullPage: true,
  });
  return {
    checks_passed: 10,
    mode: 'real browser/API/disposable PostgreSQL, one injected503 negative',
    provider_calls: 0,
    saved_version: 4,
    checks: [
      'theme-only save without connection/budget/claims',
      'zero-exposure prepared plan',
      'reload/resume',
      'failed save retains edits',
      'recovery creates no duplicate',
      'stale version conflict retains edits',
      'explicit discard/keep safeguards',
      'editable proposed questions',
      'workspace isolation',
      '390px responsive layout',
    ],
  };
};
