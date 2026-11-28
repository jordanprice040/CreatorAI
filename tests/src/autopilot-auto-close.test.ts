import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AUTOPILOT_SETTINGS_DEFAULT,
  ContractError,
  type PlanConnection,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { freshDatabase } from './pg-harness.js';

// ADR-0137 (Jordan, November 28): an autopilot closes plan requests without a recorded outcome
// by itself only under the owner's setting, only for the autopilot acting for the owner, only
// requests a person could close now, and always as "it ran" so they keep counting.

const SETTINGS = JSON.parse(
  readFileSync(
    new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
    'utf8',
  ),
) as PlanConnection['settings'];

test('ADR-0137: an autopilot closes unknown plan requests only under the owner setting, as ran', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner: CommandContext = { actorId: randomUUID() };
  const editor: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Auto close',
    record_mode: 'real',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const add = async (state: string) => {
    const id = randomUUID();
    await db.pool.query(
      `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose,
         model_id, data_class, state, created_by, started_at)
       values ($1, $2, $3, 'responses', 'task', 'm', 'synthetic', $4, $5, clock_timestamp())`,
      [id, conn.id, randomUUID(), state, owner.actorId],
    );
    return id;
  };
  const unknown = await add('unknown');
  // Just started: it may still be running, so nothing closes it.
  const flying = await add('in_flight');
  const stateOf = async (id: string) =>
    (
      await db.pool.query(
        'select state, reason_code from plan_requests where id = $1',
        [id],
      )
    ).rows[0] as { state: string; reason_code: string | null };
  const autopilotId = randomUUID();
  const asAutopilot: CommandContext = {
    actorId: owner.actorId,
    autopilot: { id: autopilotId },
  };
  const before = (await store.planConnectionDetail(owner, ws.id, conn.id))
    .usage;

  // Only an autopilot closes by itself, and only its own id.
  await assert.rejects(
    store.autoClosePlanRequests(owner, ws.id, conn.id, autopilotId),
    (e: unknown) => e instanceof ContractError && e.code === 'ACCESS_DENIED',
  );
  await assert.rejects(
    store.autoClosePlanRequests(asAutopilot, ws.id, conn.id, randomUUID()),
    (e: unknown) => e instanceof ContractError && e.code === 'ACCESS_DENIED',
  );
  // Setting off (the default): nothing changes.
  assert.deepEqual(
    await store.autoClosePlanRequests(asAutopilot, ws.id, conn.id, autopilotId),
    [],
  );
  assert.equal((await stateOf(unknown)).state, 'unknown');

  await store.saveAutopilotSettings(owner, ws.id, {
    expected_version: 0,
    values: {
      ...AUTOPILOT_SETTINGS_DEFAULT,
      close_unknown_plan_requests: true,
    },
  });
  // An autopilot acting for someone who does not own the workspace is refused.
  await assert.rejects(
    store.autoClosePlanRequests(
      { actorId: editor.actorId, autopilot: { id: autopilotId } },
      ws.id,
      conn.id,
      autopilotId,
    ),
    (e: unknown) => e instanceof ContractError,
  );

  const closed = await store.autoClosePlanRequests(
    asAutopilot,
    ws.id,
    conn.id,
    autopilotId,
  );
  assert.deepEqual(closed, [unknown]);
  assert.deepEqual(await stateOf(unknown), {
    state: 'reconciled',
    reason_code: 'autopilot_setting_ran',
  });
  assert.equal(
    (await stateOf(flying)).state,
    'in_flight',
    'a request that may still be running is left alone',
  );
  const after = await store.planConnectionDetail(owner, ws.id, conn.id);
  assert.equal(after.usage.unresolved, 0);
  assert.equal(
    after.usage.last_24h_requests,
    before.last_24h_requests,
    'it still counts toward the daily cap',
  );
  assert.equal(after.connection.version, conn.version + 1);
  const audit = await db.pool.query(
    `select payload from audit_events where action = 'connection.request_reconciled' and subject_id = $1`,
    [conn.id],
  );
  assert.equal(audit.rowCount, 1);
  assert.match(
    JSON.stringify(audit.rows[0].payload),
    /Close unknown plan requests/,
  );
  // Nothing left to close: an empty answer, no new version.
  assert.deepEqual(
    await store.autoClosePlanRequests(asAutopilot, ws.id, conn.id, autopilotId),
    [],
  );
});
