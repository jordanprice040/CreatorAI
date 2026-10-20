// Run with creator_playwright.browser_run_code_unsafe(filename=...). All API calls
// are intercepted fixtures; this check never uses an operational studio or provider.
async (page) => {
  await page.unrouteAll({ behavior: 'wait' });
  await page.goto('about:blank');
  const ws = '10000000-0000-4000-8000-000000000001';
  const ws2 = '10000000-0000-4000-8000-000000000002';
  const job = {
    last_success_at: null,
    last_failure_at: null,
    error_code: null,
  };
  const posts = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET') posts.push(path);
    let body = [];
    if (path === '/api/health')
      body = {
        schema_version: '1.0',
        status: 'ok',
        service: 'creator-agent-api',
        data_mode: 'fixture',
        provider: 'fixture',
        live_enabled: false,
        live: { model: 'not_configured', sources: 'off' },
        persistent: true,
        storage: 'postgresql',
        maintenance: {
          enabled: false,
          degraded: false,
          jobs: {
            outbox: job,
            broker_recovery: job,
            retrieval_recovery: job,
          },
        },
        portfolio_scheduler: {
          enabled: false,
          state: 'off',
          last_attempt_at: null,
          last_success_at: null,
          error_code: null,
          failing_scopes: 0,
          stopped_scopes: 0,
        },
      };
    if (path === '/api/auth/status')
      body = {
        mode: 'dev_local',
        available: true,
        login_path: '/api/auth/dev-login',
      };
    if (path === '/api/auth/session')
      body = {
        authenticated: true,
        actor_id: ws,
        display_name: 'Draft test owner',
        method: 'dev_local',
        csrf_token: 'a'.repeat(43),
        expires_at: '2099-01-01T00:00:00Z',
      };
    if (path === '/api/workspaces')
      body = [ws, ws2].map((id, index) => ({
        id,
        name: `Draft test ${index + 1}`,
        role: 'owner',
        record_mode: 'fixture',
        created_at: '2026-10-20T00:00:00Z',
      }));
    await route.fulfill({ json: body });
  });
  const check = async (condition, message) => {
    if (!(await condition)) throw new Error(message);
  };
  const nav = (name) =>
    page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('link', { name, exact: true })
      .click();
  await page.goto(`http://127.0.0.1:5175/#/submit?ws=${ws}`);
  const theme = page.getByLabel('Theme (specific setting or group)', {
    exact: true,
  });
  await theme.fill('Keep this unfinished theme');
  await page
    .getByLabel('Target users', { exact: true })
    .fill('Research students');
  await page
    .getByRole('button', { name: 'Save brief and start discovery' })
    .click();
  await check(
    theme.inputValue().then((v) => v === 'Keep this unfinished theme'),
    'Invalid submission discarded fields',
  );
  await nav('Evidence');
  await page
    .getByPlaceholder('https://approved.host/page')
    .fill('https://example.org/draft');
  await nav('Submit a theme');
  await check(
    theme.inputValue().then((v) => v === 'Keep this unfinished theme'),
    'Theme lost on navigation',
  );
  await check(
    page
      .getByLabel('Target users', { exact: true })
      .inputValue()
      .then((v) => v === 'Research students'),
    'Second field lost',
  );
  await page.goBack();
  await check(
    page
      .getByPlaceholder('https://approved.host/page')
      .inputValue()
      .then((v) => v === 'https://example.org/draft'),
    'Evidence lost on Back',
  );
  await page.goForward();
  await check(
    theme.inputValue().then((v) => v === 'Keep this unfinished theme'),
    'Theme lost on Forward',
  );
  await page
    .getByRole('button', { name: 'Reset page fields', exact: true })
    .click();
  await page.getByRole('button', { name: 'Keep fields', exact: true }).click();
  await check(
    theme.inputValue().then((v) => v === 'Keep this unfinished theme'),
    'Canceled reset discarded draft',
  );
  await page
    .getByRole('button', { name: 'Reset page fields', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Reset these fields', exact: true })
    .click();
  await check(
    theme.inputValue().then((v) => v === ''),
    'Confirmed reset did not clear theme',
  );
  await nav('Evidence');
  await check(
    page
      .getByPlaceholder('https://approved.host/page')
      .inputValue()
      .then((v) => v === 'https://example.org/draft'),
    'Reset changed another page',
  );
  await nav('Search');
  await page.getByRole('searchbox').fill('unsent search words');
  await nav('Submit a theme');
  await nav('Search');
  await check(
    page
      .getByRole('searchbox')
      .inputValue()
      .then((v) => v === 'unsent search words'),
    'Search draft lost',
  );
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('searchbox').fill('unsubmitted revision of search');
  await nav('Submit a theme');
  await nav('Search');
  await check(
    page
      .getByRole('searchbox')
      .inputValue()
      .then((v) => v === 'unsubmitted revision of search'),
    'Search revision lost after committed query',
  );
  await page.getByLabel('Workspace', { exact: true }).selectOption(ws2);
  await nav('Submit a theme');
  await check(
    theme.inputValue().then((v) => v === ''),
    'Draft crossed workspace boundary',
  );
  await theme.fill('Private unsent draft');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Login code', { exact: true }).waitFor();
  await check(
    page
      .locator('#b-theme')
      .count()
      .then((v) => v === 0),
    'Signed-out page retained draft DOM',
  );
  await check(
    Promise.resolve(posts.length === 1 && posts[0] === '/api/auth/logout'),
    'Unexpected mutation while navigating/resetting',
  );
  await page.unrouteAll({ behavior: 'wait' });
  return {
    passed: [
      'multiple fields survive page changes',
      'independent evidence draft',
      'Back and Forward preserve drafts',
      'cancel reset preserves draft',
      'reset affects only current page',
      'unsubmitted search preserved',
      'invalid submission keeps fields',
      'search revision after submitted query',
      'workspace isolation',
      'sign-out removes retained forms',
      'no mutation on navigation/reset',
    ],
    mode: 'intercepted fixture API; browser UI only',
  };
};
