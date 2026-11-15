import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { hostname, userInfo } from 'node:os';
import { SupportReportSchema } from '@creator/contracts';
import {
  redactSupportText,
  renderSupportReport,
  SUPPORT_FAILURE_LIMIT,
  type SupportFacts,
} from '@creator/domain';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0118 (F5): planted secrets and personal details never reach the support report.
const SECRETS = [
  'sk-proj-Zx81kQ2mN4pL7vR9tY3wB6cD',
  'sk-ant-api03-AbCdEf0123456789GhIjKl',
  'ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
  'github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  'AKIAIOSFODNN7EXAMPLE',
  'xoxb-123456789012-abcdefghijkl',
  'whsec_9f8e7d6c5b4a3210fedcba',
  'hunter2-password-value',
  'cookie-value-c0ffee42',
  'refresh-tok-77aa',
  'Qm9vdHN0cmFwU2VjcmV0S2V5Rm9yVGVzdGluZzEyMzQ1Ng',
  'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
  'jordan.price@example.com',
  'C:\\Users\\jordan',
  'C:/Users/jordan',
  '/home/alice',
  '/Users/bob',
  'secretbox-host-42',
  'Bearer abcDEF123456ghiJKL',
];
const PLANTED = [
  'OpenAI said: invalid key sk-proj-Zx81kQ2mN4pL7vR9tY3wB6cD',
  'claude key sk-ant-api03-AbCdEf0123456789GhIjKl rejected',
  'push failed with ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 and github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
  'header Authorization: Bearer abcDEF123456ghiJKL',
  'id token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  'aws AKIAIOSFODNN7EXAMPLE slack xoxb-123456789012-abcdefghijkl webhook whsec_9f8e7d6c5b4a3210fedcba',
  'db postgresql://creator:hunter2-password-value@127.0.0.1:55433/creator_studio',
  'Cookie: __Host-creator_session=cookie-value-c0ffee42; theme=dark',
  'Set-Cookie: sid=cookie-value-c0ffee42; Path=/',
  '{"refresh_token": "refresh-tok-77aa", "password":"hunter2-password-value"}',
  'url https://api.example.test/cb?code=1&access_token=refresh-tok-77aa&x=2',
  'opaque Qm9vdHN0cmFwU2VjcmV0S2V5Rm9yVGVzdGluZzEyMzQ1Ng end',
  '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
  'mail jordan.price@example.com about it',
  'ENOENT C:\\Users\\jordan\\OneDrive\\Desktop\\creator_agent\\x.json',
  'cwd C:/Users/jordan/dev/creator',
  'cannot read /home/alice/.config/creator and /Users/bob/Library/x',
  'machine secretbox-host-42 user jordanp',
];
const IDENTITY = { userNames: ['jordanp'], hostNames: ['secretbox-host-42'] };
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

function assertClean(text: string, extra: string[] = []) {
  for (const s of [...SECRETS, ...extra])
    assert.ok(
      !text.toLowerCase().includes(s.toLowerCase()),
      `support report leaked ${s}:\n${text}`,
    );
}

test('redaction hides planted tokens, keys, cookies, passwords, emails, paths and names', () => {
  const { text, hidden } = redactSupportText(PLANTED.join('\n'), IDENTITY);
  assertClean(text, ['jordanp']);
  assert.ok(hidden >= PLANTED.length, `hidden ${hidden}`);
  // Personal folders keep their shape so a support reader can still follow the path.
  assert.match(text, /C:\\Users\\\[user\]\\OneDrive/);
  assert.match(text, /\/home\/\[user\]\/\.config/);
  // Commit, hashes, ids and ordinary words stay readable.
  const kept = redactSupportText(
    `Commit: ${COMMIT}\nhash ${'ab'.repeat(32)}\nworkflow step ${ID}: failed. Schema 68`,
    IDENTITY,
  );
  assert.equal(kept.hidden, 0);
  assert.match(kept.text, new RegExp(COMMIT));
  assert.match(kept.text, new RegExp(ID));
});

test('the rendered report lists the newest 20 failures with ids and redacts every field', () => {
  const facts: SupportFacts = {
    generated_at: '2026-11-15T12:00:00.000Z',
    app: {
      version: '0.1.0',
      build_commit: COMMIT,
      schema_version: 68,
      mode: 'local',
      environment: 'local',
      node: 'v22.23.4',
      os: { platform: 'win32', release: '10.0.26100', arch: 'x64' },
    },
    readiness: {
      ready: false,
      checks: [
        {
          name: 'products',
          ok: false,
          detail: 'Cannot write C:\\Users\\jordan\\AppData\\products',
        },
      ],
    },
    maintenance: [{ job: 'outbox', error_code: 'STORAGE_UNAVAILABLE' }],
    workers: {
      leases_active: 1,
      leases_expired: 0,
      local_jobs_open: 2,
      outbox_pending: 0,
      local: [
        {
          id: ID,
          label: 'secretbox-host-42',
          availability: 'online',
          last_seen_at: null,
        },
      ],
    },
    connections: [
      {
        kind: 'model connection chatgpt_plan',
        id: ID,
        workspace_id: ID,
        fixture: false,
        label: 'jordan.price@example.com plan',
        state: 'reauthorization_required',
        reason: 'refresh failed: refresh_token=refresh-tok-77aa',
        problems_24h: 3,
      },
    ],
    failures: Array.from({ length: 25 }, (_, i) => ({
      at: `2026-11-15T11:${String(59 - i).padStart(2, '0')}:00.000Z`,
      source: 'workflow step',
      id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
      workspace_id: ID,
      fixture: i % 2 === 0,
      state: 'failed',
      detail: PLANTED[i % PLANTED.length]!,
    })),
    unavailable: [],
  };
  const { text } = renderSupportReport(facts, IDENTITY);
  assertClean(text, ['jordanp']);
  for (const want of [
    'Version: 0.1.0',
    `Commit: ${COMMIT}`,
    'Schema: 68',
    'OS: win32 10.0.26100 x64',
    'products: failing',
    'maintenance outbox: last run failed (STORAGE_UNAVAILABLE)',
    'reauthorization_required',
    '3 failed or unknown requests in the last day',
  ])
    assert.ok(text.includes(want), `missing ${want}`);
  const listed = text.match(/^- 2026-11-15T\S+ workflow step /gm) ?? [];
  assert.equal(listed.length, SUPPORT_FAILURE_LIMIT);
  assert.ok(text.includes('00000000-0000-4000-8000-000000000000 (fixture)'));
  assert.ok(text.includes('00000001-0000-4000-8000-000000000000 (real)'));
  assert.ok(!text.includes('00000020-0000-4000-8000-000000000000'));
});

test('GET /api/support/report is owner-only, read from the database, and redacted', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;

  const anonymous = await fetch(`${base}/support/report`);
  assert.equal(anonymous.status, 401);
  assert.ok(!(await anonymous.text()).includes('Creator Agent support report'));

  const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const ws = await api.store!.createWorkspace(owner, {
    name: 'F5 support',
    record_mode: 'fixture',
  });
  // The machine's own account and host names are hidden too.
  const me = (() => {
    try {
      return userInfo().username;
    } catch {
      return '';
    }
  })();
  const local = [me, hostname()].filter((n) => n.trim().length >= 3);
  for (let i = 0; i < 24; i++)
    await db.pool.query(
      `insert into portfolio_scheduler_failures (scope, workspace_id, error_code, error,
         consecutive_failures, stopped, created_at)
       values ($1, $2, 'PLANTED', $3, 1, false, now() - make_interval(mins => $4))`,
      [
        `scope-${i}`,
        ws.id,
        `${PLANTED[i % (PLANTED.length - 1)]!} ${local.join(' ')}`,
        i,
      ],
    );
  await db.pool.query(
    `insert into desktop_devices (id, kind, owner_id, workspace_id, label, capabilities,
       token_hash, state, expires_at, last_seen_at)
     values ($1, 'worker', $2, $3, 'C:\\Users\\jordan laptop', '[]', $4, 'active',
       now() + interval '1 day', now())`,
    [randomUUID(), DEFAULT_OWNER_ACTOR_ID, ws.id, 'f'.repeat(64)],
  );

  await db.pool.query(
    `insert into github_connections (id, workspace_id, fixture, version, status, body,
       body_hash, status_reason, created_by)
     values ($1, $2, true, 1, 'credential_rejected', '{}', $3, $4, $5)`,
    [
      randomUUID(),
      ws.id,
      'e'.repeat(64),
      'GitHub said 401 for token=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8',
      DEFAULT_OWNER_ACTOR_ID,
    ],
  );
  const auth = await login(base);
  const res = await fetch(`${base}/support/report`, { headers: auth.read });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const report = SupportReportSchema.parse(await res.json());
  // The last planted line names this test's own fake machine, which this server does not know.
  assertClean(report.text.replace(/secretbox-host-42/g, ''), [
    ...local,
    auth.cookie.split('=')[1]!,
    auth.csrf,
  ]);
  assert.ok(report.hidden > 0);
  assert.match(report.text, /^Version: \S+$/m);
  assert.match(report.text, /^Schema: \d+$/m);
  assert.match(report.text, /^OS: \S+/m);
  assert.match(
    report.text,
    /worker [0-9a-f-]{36} "C:\\Users\\\[user\] laptop": unreachable/,
  );
  assert.match(
    report.text,
    /github connection [0-9a-f-]{36} \(fixture\) "GitHub": credential_rejected \(GitHub said 401 for token=\[hidden\]\), 0 failed or unknown/,
  );
  const listed =
    report.text.match(/^- \S+ portfolio scheduler \d+ workspace /gm) ?? [];
  assert.equal(listed.length, SUPPORT_FAILURE_LIMIT);

  // Writing to the report route is not a thing.
  const post = await fetch(`${base}/support/report`, {
    method: 'POST',
    headers: { ...auth.write, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(post.status, 404);
});
