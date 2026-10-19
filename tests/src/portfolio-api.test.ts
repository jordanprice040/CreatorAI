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
import { portfolioFixture } from './portfolio-harness.js';

test('X09 HTTP/CSRF/CLI: schedule, bounded pass, evidence, mode changes and knowledge review', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_PORTFOLIO_SCHEDULER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  try {
    await api.ready();
    const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    const auth = await login(origin + '/api');
    const f = await portfolioFixture(api.store!, db.pool, {
      actorId: DEFAULT_OWNER_ACTOR_ID,
    });
    const base = `workspaces/${f.ws}`;
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
    assert.equal((await post(`${base}/portfolio/tick`, {}, {})).status, 401);
    assert.equal(
      (await post(`${base}/portfolio/tick`, {}, auth.read)).status,
      403,
    );
    const environment = {
      ...process.env,
      CREATOR_API_URL: origin,
      CREATOR_SESSION_FILE: join(
        await mkdtemp(join(tmpdir(), 'creator-x09-cli-')),
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
    const run = await f.run('maintenance');
    const schedule = await cli(
      'portfolio-schedule',
      f.ws,
      JSON.stringify({
        label: 'API synthetic source refresh',
        run_id: run.id,
        lane: 'maintenance',
        interval_seconds: 60,
        first_due_at: f.due(),
        operation: {
          kind: 'source_refresh',
          source_id: f.source.id,
          source_version: 1,
          source_hash: f.source.content_hash,
        },
      }),
    );
    const tick = await cli('portfolio-command', f.ws, 'tick', '{}');
    assert.equal(tick.claimed, 1);
    assert.equal(tick.outcomes[0].state, 'succeeded');
    const policy = (await cli('portfolio', f.ws)).state.policy;
    const { version, workspace_id: _ws, next_tick_at: _tick, ...body } = policy;
    assert.equal(
      (
        await post(`${base}/portfolio/policy`, {
          ...body,
          expected_version: version,
          mode: 'paused',
          rationale: 'Pause acceptance.',
        })
      ).status,
      200,
    );
    assert.equal(
      (await cli('portfolio-command', f.ws, 'tick', '{}')).claimed,
      0,
    );
    assert.equal(
      (
        await post(`${base}/portfolio/policy`, {
          ...body,
          expected_version: version,
          mode: 'normal',
        })
      ).status,
      409,
    );
    const proposed = await cli(
      'knowledge-propose',
      f.ws,
      JSON.stringify({
        key: 'api-lesson',
        kind: 'lesson',
        title: 'Check evidence',
        guidance: ['Keep recorded evidence distinct from inference.'],
        permitted_lanes: ['maintenance'],
        data_class: 'synthetic',
        permitted_use: 'task_review_guidance',
        provenance: [
          {
            entity_id: f.problem.id,
            version: 1,
            content_hash: f.problem.content_hash,
            locator: 'body.statement',
          },
        ],
        limitations: 'No measured quality claim.',
      }),
    );
    const regression = await cli(
      'knowledge-command',
      f.ws,
      proposed.id,
      'verify',
      '{}',
    );
    assert.equal(regression.passed, true);
    await cli(
      'knowledge-command',
      f.ws,
      proposed.id,
      'review',
      JSON.stringify({
        body_hash: proposed.body_hash,
        regression_id: regression.id,
        reason: 'Review precise proposal.',
      }),
    );
    await cli(
      'knowledge-activate',
      f.ws,
      JSON.stringify({
        candidate_id: proposed.id,
        expected_active_id: null,
        reason: 'Reviewed activation.',
      }),
    );
    const read = await cli('portfolio', f.ws);
    assert.equal(read.knowledge[0].active, true);
    assert.equal(read.jobs.length, 1);
    await cli(
      'portfolio-cancel',
      f.ws,
      schedule.id,
      'Cancel dedicated schedule run.',
    );
    assert.equal((await cli('portfolio', f.ws)).schedules[0].cancelled, true);
  } finally {
    await api.close();
  }
});
