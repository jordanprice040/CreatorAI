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
  const conn = {
    id: '10000000-0000-4000-8000-000000000003',
    workspace_id: '10000000-0000-4000-8000-000000000001',
    fixture: true,
    kind: 'chatgpt_plan',
    label: 'ChatGPT plan',
    version: 1,
    settings: {
      format: 'chatgpt-plan-settings/1',
      plan_type: 'plus',
      shared_allowance_note:
        "ChatGPT Plus: the five-hour usage allowance is shared with Jordan's personal ChatGPT and Codex use. Credits after the limit stay off for Creator Agent. Studio caps below are proposals pending Jordan's acceptance.",
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: ['summarization', 'specification'],
      caps: {
        responses: {
          max_requests_per_run: 10,
          request_timeout_ms: 120000,
          max_output_chars: 16000,
          max_input_chars: 24000,
        },
        codex: {
          max_builds_per_day: 2,
          max_turns_per_build: 1,
          max_model_requests_per_build: 25,
          build_timeout_ms: 600000,
        },
        shared: { max_model_requests_per_day: 40, max_in_flight: 1 },
      },
    },
    settings_hash:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    caps_accepted_at: '2026-10-20T00:00:00.000Z',
    ext_agent_host_id: 'urn:uuid:10000000-0000-4000-8000-000000000003',
    sign_in: {
      state: 'not_signed_in',
      issued_client_id: null,
      account_label: null,
      scopes: [],
      plan_usage_granted: false,
      verified_at: null,
      access_expires_at: null,
    },
    credits: {
      state: 'confirmed_off',
      checked_on: '2026-10-20',
      confirmed_at: '2026-10-20T00:00:00.000Z',
      confirmed_by: '10000000-0000-4000-8000-000000000003',
    },
    eligibility: {
      state: 'unknown',
      reason_code: null,
      upstream_request_id: null,
      observed_at: null,
    },
    quota: { state: 'unknown', reason_code: null, observed_at: null },
    status_reason: null,
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-20T00:00:00.000Z',
  };
  let attempt = null;
  let detailReads = 0;
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

    if (path.endsWith('/plan-connections')) body = [conn];
    if (
      path.endsWith('/plan-connections/10000000-0000-4000-8000-000000000003')
    ) {
      detailReads++;
      body = {
        connection: conn,
        model_access: [],
        qualifications: [],
        grants: [],
        usage: {
          last_24h_requests: 0,
          last_24h_codex_builds: 0,
          in_flight: 0,
          unresolved: 0,
        },
        blockers: [],
        sign_in_attempt: attempt,
      };
    }
    if (path.endsWith('/sign-in')) {
      attempt = { state: 'pending', started_at: '2026-10-20T00:00:00.000Z' };
      body = {};
    }
    await route.fulfill({ json: body });
  });

  await page.goto('http://127.0.0.1:5175/#/models?ws=' + ws);
  await page
    .getByRole('button', { name: 'Continue with ChatGPT', exact: true })
    .waitFor();
  if (
    await page
      .getByRole('button', { name: 'Add a ChatGPT plan connection' })
      .count()
  )
    throw new Error('Saved connection offered as missing');
  await page
    .getByRole('button', { name: 'Continue with ChatGPT', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Waiting for ChatGPT' })
    .waitFor();
  if (
    !(await page
      .getByRole('button', { name: 'Continue with ChatGPT', exact: true })
      .isDisabled())
  )
    throw new Error('Duplicate sign-in is enabled');
  attempt = {
    state: 'failed',
    code: 'vault_failure',
    message: 'Synthetic vault failure',
    finished_at: '2026-10-20T00:00:00.000Z',
  };
  await page
    .getByRole('alert')
    .filter({ hasText: 'Synthetic vault failure' })
    .waitFor();
  attempt = {
    state: 'completed',
    plan_usage_granted: true,
    finished_at: '2026-10-20T00:00:00.000Z',
  };
  conn.sign_in = {
    ...conn.sign_in,
    state: 'signed_in',
    plan_usage_granted: true,
    account_label: 'Fixture account',
  };
  await page
    .getByText('Signed in · Fixture account', { exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByText('Signed in · Fixture account', { exact: true })
    .waitFor();
  if (posts.length !== 1 || !posts[0].endsWith('/sign-in'))
    throw new Error('Unexpected mutation');
  return { passed: 5, detailReads, fixtureOnly: true };
};
