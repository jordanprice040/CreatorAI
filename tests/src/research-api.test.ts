import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import {
  ClaimEvidenceSchema,
  RetrievalSchema,
  SourceBrokerStatusSchema,
  SourceSummarySchema,
  parse,
  z,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);

test('the research demonstration runs over HTTP and the CLI against PostgreSQL', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const address = api.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;

  const status = parse(
    SourceBrokerStatusSchema,
    await (await fetch(`${base}/sources/status`)).json(),
  );
  assert.equal(status.live, 'not_configured');

  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${address.port}`,
    CREATOR_SESSION_FILE: join(
      await mkdtemp(join(tmpdir(), 'creator-cli-')),
      'session.json',
    ),
  };
  const cli = (...args: string[]) =>
    exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
      env: cliEnv,
      timeout: 30000,
    });
  await cli('login', LOGIN_CODE);
  const seeded = JSON.parse((await cli('seed-research')).stdout) as {
    workspace: { id: string };
    run: string;
    retrievals: Record<string, string>;
    refetch: Record<string, string>;
    claims: Record<string, { status: string; labels: string[] }>;
  };
  assert.deepEqual(seeded.retrievals, {
    report: 'fetched (new_version)',
    wire: 'fetched (new_version)',
    repost: 'fetched (new_version)',
    copy: 'fetched (new_version)',
    survey: 'fetched (new_version)',
    paywalled: 'inaccessible (http_403)',
    staffing: 'fetched (new_version)',
    metadataRedirect: 'blocked (private_address)',
    forum: 'fetched (new_version)',
  });
  assert.deepEqual(seeded.refetch, {
    report: 'new_version → source v2',
    staffing: 'removed → source v2',
  });
  // The corrected report invalidates its row; reposts still count once against the survey.
  assert.deepEqual(
    Object.values(seeded.claims).map((c) => c.status),
    ['contested', 'inaccessible', 'inaccessible'],
  );

  const ws = seeded.workspace.id;
  const auth = await login(base);
  const sources = z
    .array(SourceSummarySchema)
    .parse(
      await (
        await fetch(`${base}/workspaces/${ws}/sources`, { headers: auth.read })
      ).json(),
    );
  assert.equal(sources.length, 8);
  const wire = sources.find((s) => s.url.includes('wire.fixture.test'))!;
  assert.equal(wire.cluster_size, 3);
  assert.ok(sources.find((s) => s.url.includes('forum'))!.instruction_like);

  const claimId = Object.keys(seeded.claims)[0]!;
  const evidence = ClaimEvidenceSchema.parse(
    await (
      await fetch(`${base}/workspaces/${ws}/claims/${claimId}/evidence`, {
        headers: auth.read,
      })
    ).json(),
  );
  assert.equal(evidence.independent_origins, 1);
  assert.ok(evidence.rows.some((r) => r.freshness === 'changed'));

  // A fabricated quote is refused over HTTP too.
  const passage = (
    (await (
      await fetch(`${base}/workspaces/${ws}/sources/${wire.id}`, {
        headers: auth.read,
      })
    ).json()) as { passages: { id: string }[] }
  ).passages[0]!.id;
  const forged = await fetch(
    `${base}/workspaces/${ws}/claims/${claimId}/support`,
    {
      method: 'POST',
      headers: { ...auth.write, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        evidence: 'passage',
        claim_version: 1,
        passage_id: passage,
        stance: 'supports',
        support_type: 'quotation',
        quote: 'nobody wrote this sentence anywhere',
        rationale: 'Invented.',
      }),
    },
  );
  assert.equal(forged.status, 400);
  assert.equal(
    ((await forged.json()) as { error: { code: string } }).error.code,
    'EVIDENCE_MISMATCH',
  );

  // An inward URL submitted over HTTP is recorded as blocked, not fetched.
  const blocked = RetrievalSchema.parse(
    await (
      await fetch(
        `${base}/workspaces/${ws}/runs/${seeded.run}/source-fetches`,
        {
          method: 'POST',
          headers: { ...auth.write, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: 'https://169.254.169.254/latest/meta-data/',
            task_id: null,
            logical_operation_id: randomUUID(),
            justification: 'Should be refused.',
          }),
        },
      )
    ).json(),
  );
  assert.deepEqual(
    [blocked.state, blocked.reason_code],
    ['blocked', 'private_address'],
  );
  const listed = JSON.parse(
    (await cli('retrievals', ws, seeded.run)).stdout,
  ) as unknown[];
  assert.equal(listed.length, 12);
});
