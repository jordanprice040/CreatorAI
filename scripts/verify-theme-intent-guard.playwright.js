async (page) => {
  await page.unrouteAll({ behavior: 'wait' });
  const ws = '10000000-0000-4000-8000-000000000001';
  const ids = [
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000003',
  ];
  const drafts = ids.map((id, i) => ({
    id,
    workspace_id: ws,
    kind: 'theme_intent',
    version: 1,
    status: 'active',
    fixture: false,
    title: `Draft ${i ? 'B' : 'A'}`,
    body: {
      format: 'theme-intent/1',
      theme: `Saved ${i ? 'B' : 'A'}`,
      context: 'Saved context',
      solution_constraints: '',
      questions: [],
      source_strategy: 'supplied_public_sources',
      source_urls: [],
    },
    content_hash: 'a'.repeat(64),
    created_at: '2026-10-23T00:00:00Z',
    updated_at: '2026-10-23T00:00:00Z',
  }));
  let detailReads = 0,
    failLoad = false,
    mutations = 0;
  const job = {
    last_success_at: null,
    last_failure_at: null,
    error_code: null,
  };
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (request.method() !== 'GET') {
      mutations++;
      return route.fulfill({
        status: 405,
        json: {
          error: {
            code: 'TEST_MUTATION_DENIED',
            message: 'Navigation regression permits no mutation',
          },
        },
      });
    }
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
          jobs: { outbox: job, broker_recovery: job, retrieval_recovery: job },
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
        display_name: 'Guard regression owner',
        method: 'dev_local',
        csrf_token: 'a'.repeat(43),
        expires_at: '2099-01-01T00:00:00Z',
      };
    if (path === '/api/workspaces')
      body = [
        {
          id: ws,
          name: 'Isolated navigation regression',
          role: 'owner',
          record_mode: 'real',
          created_at: '2026-10-23T00:00:00Z',
        },
      ];
    if (
      path.endsWith('/entities') &&
      url.searchParams.get('kind') === 'theme_intent'
    )
      body = drafts;
    const draft = drafts.find((d) => path.endsWith('/entities/' + d.id));
    if (draft) {
      detailReads++;
      if (failLoad)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'STORAGE_UNAVAILABLE',
              message: 'Injected saved-draft read failure',
            },
          },
        });
      body = { entity: draft, versions: [], incoming: [], outgoing: [] };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('http://127.0.0.1:5188/#/submit?ws=' + ws);
  await page.reload();
  const theme = page.getByLabel('Draft theme', { exact: true }),
    context = page.getByLabel('Context (optional)', { exact: true });
  const button = (name) => page.getByRole('button', { name, exact: true });
  const check = (ok, message) => {
    if (!ok) throw Error(message);
  };
  await button('Resume Draft A').waitFor();
  await theme.fill('UNSAVED');
  await context.fill('Preserve unsaved text');
  await button('New theme draft').click();
  await button('New theme draft').click();
  check(
    (await context.inputValue()) === 'Preserve unsaved text',
    'Repeated New discarded edits',
  );
  await button('Resume Draft A').click();
  await button('Resume Draft B').click();
  check(
    (await context.inputValue()) === 'Preserve unsaved text' &&
      detailReads === 0,
    'Ordinary Resume bypassed pending guard',
  );
  await button('Keep editing').click();
  check(
    (await context.inputValue()) === 'Preserve unsaved text',
    'Keep lost edits',
  );
  await button('Resume Draft A').click();
  await button('Discard edits and open').click();
  await page.waitForFunction(
    () => document.querySelector('#intent-theme')?.value === 'Saved A',
  );
  check(detailReads === 1, 'Explicit discard did not load once');
  await context.fill('Preserve after failed reload');
  await button('Reload saved version').click();
  await button('Reload saved version').click();
  check(
    detailReads === 1 &&
      (await context.inputValue()) === 'Preserve after failed reload',
    'Repeated Reload bypassed guard',
  );
  failLoad = true;
  await button('Discard edits and open').click();
  await page
    .getByRole('alert')
    .filter({ hasText: 'Injected saved-draft read failure' })
    .waitFor();
  check(
    (await context.inputValue()) === 'Preserve after failed reload' &&
      detailReads === 2,
    'Failed confirmed load lost input',
  );
  await button('New theme draft').click();
  check(
    (await context.inputValue()) === 'Preserve after failed reload',
    'Ordinary New after load failure lost input',
  );
  await button('Discard edits and open').click();
  await page.waitForFunction(
    () => document.querySelector('#intent-context')?.value === '',
  );
  check(
    (await theme.inputValue()) === '' && mutations === 0,
    'Explicit confirmed new failed or dispatched work',
  );
  return {
    checks_passed: 8,
    api_intercepted: true,
    database_access: false,
    provider_calls: 0,
    mutations,
    detail_reads: detailReads,
    checks: [
      'repeat New guarded',
      'alternate Resume guarded',
      'Keep preserves',
      'explicit saved-load allowed',
      'repeat Reload guarded',
      'failed confirmed load preserves',
      'post-failure New guarded',
      'explicit New allowed without mutation',
    ],
  };
};
