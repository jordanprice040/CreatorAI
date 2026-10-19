import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { marketingRelease } from './marketing-harness.js';

test('X08 real HTTP/session/CSRF and CLI: review, grant, fixture delivery, reconcile, suppress and measure', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  // Must close API before freshDatabase's pool teardown.
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  try {
    await api.ready();
    const auth = await login(origin + '/api');
    const post = async (
      path: string,
      body: unknown,
      headers: Record<string, string> = auth.write,
    ) => {
      const r = await fetch(`${origin}/api/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    const ws = (
      await post('workspaces', {
        name: 'X08 API fixture',
        record_mode: 'fixture',
      })
    ).body.id;
    const release = await marketingRelease(api.store!, db.pool, ws, {
      actorId: DEFAULT_OWNER_ACTOR_ID,
    });
    const base = `workspaces/${ws}/marketing-campaigns`;
    assert.equal((await post(base, release.request, {})).status, 401);
    assert.equal((await post(base, release.request, auth.read)).status, 403);
    const created = await post(base, release.request);
    assert.equal(created.status, 201);
    const campaign = created.body;
    const environment = {
      ...process.env,
      CREATOR_API_URL: origin,
      CREATOR_SESSION_FILE: join(
        await mkdtemp(join(tmpdir(), 'creator-x08-cli-')),
        'session.json',
      ),
    };
    const exec = promisify(execFile);
    const cli = async (...args: string[]) =>
      JSON.parse(
        (
          await exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
            env: environment,
            timeout: 30000,
          })
        ).stdout,
      );
    await cli('login', LOGIN_CODE);
    assert.equal((await cli('marketing-list', ws))[0].id, campaign.id);
    const grant = await cli(
      'marketing-action',
      ws,
      campaign.id,
      'grant',
      JSON.stringify({
        content_hash: campaign.content_hash,
        max_deliveries: 2,
        expires_at: new Date(Date.now() + 60000).toISOString(),
        budget_nano_usd: '0',
        rationale: 'Local test only.',
      }),
    );
    const d = await post(`${base}/${campaign.id}/deliver`, {
      grant_id: grant.id,
      recipient: 'test:one',
      simulation: 'unknown_after_accept',
    });
    assert.equal(d.status, 200);
    assert.equal(d.body.state, 'unknown');
    assert.equal(
      (
        await cli(
          'marketing-action',
          ws,
          campaign.id,
          'reconcile',
          JSON.stringify({ delivery_id: d.body.id }),
        )
      ).state,
      'delivered',
    );
    await cli(
      'marketing-action',
      ws,
      campaign.id,
      'observe',
      JSON.stringify({
        delivery_id: d.body.id,
        event_key: 'api-feedback',
        metric: 'feedback_received',
        note: 'Synthetic API feedback.',
      }),
    );
    await cli(
      'marketing-suppress',
      ws,
      JSON.stringify({ recipient: 'test:two', reason: 'Opt out.' }),
    );
    assert.equal(
      (
        await post(`${base}/${campaign.id}/deliver`, {
          grant_id: grant.id,
          recipient: 'test:two',
          simulation: 'delivered',
        })
      ).status,
      403,
    );
    const detail = await cli('marketing-get', ws, campaign.id);
    assert.equal(detail.measurement.observed, 1);
    assert.match(detail.campaign.content.label, /SYNTHETIC/);
    const changed = await post(base, {
      ...release.request,
      audience: { ...release.request.audience, recipients: ['test:changed'] },
    });
    assert.equal(changed.status, 201);
    assert.equal(
      (
        await post(`${base}/${changed.body.id}/deliver`, {
          grant_id: grant.id,
          recipient: 'test:changed',
          simulation: 'delivered',
        })
      ).status,
      403,
    );
  } finally {
    await api.close();
  }
});
