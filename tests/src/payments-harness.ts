import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { CommandContext, PaymentStore } from '@creator/db';

const h = (t: string) => createHash('sha256').update(t).digest('hex');

/** A minimal verified release row (labelled test seam: the T13 pipeline is tested elsewhere). */
export async function verifiedRelease(
  store: PaymentStore,
  pool: pg.Pool,
  ws: string,
  owner: CommandContext,
  makeManifest?: (ids: {
    id: string;
    spec_id: string;
    freeze_id: string;
    product_id: string;
  }) => unknown,
) {
  const run = await store.createEntity(owner, ws, {
    kind: 'run',
    title: 'Release run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const control = await store.registerRun(owner, ws, {
    run: { id: run.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  const problem = await store.createEntity(owner, ws, {
    kind: 'problem',
    title: 'Problem',
    body: {
      statement: 'A problem.',
      affected_group: 'Testers',
      uncertainty: 'Synthetic.',
    },
  });
  const spec = await store.createEntity(owner, ws, {
    kind: 'specification',
    title: 'Spec',
    body: {
      spec_hash: h('spec'),
      summary: 'Synthetic spec.',
      acceptance_criteria: ['Works'],
    },
  });
  const artifact = await store.createEntity(owner, ws, {
    kind: 'artifact',
    title: 'Release 1',
    body: {
      storage_uri: 'fixture://release-1',
      sha256: h('archive'),
      bytes: 10,
      media_type: 'application/x-tar',
    },
  });
  const admission = randomUUID();
  await pool.query(
    `insert into action_admissions (id, workspace_id, run_id, binding, binding_hash, verdict,
       outcome, reason_code, reasons, explanation, policy_version, provisional_assumptions,
       actor_id) values ($1,$2,$3,'{}',$4,'deny','denied','test_seam','{}','Test seam row.',
       'test','{}',$5)`,
    [admission, ws, control.run_id, h('binding'), owner.actorId],
  );
  const selection = randomUUID();
  await pool.query(
    `insert into selections (id, workspace_id, run_id, problem_id, problem_version, report_hash,
       report, dispositions, overrides, rationale, admission_id, actor_id)
     values ($1,$2,$3,$4,1,$5,'{}','[]','[]','Test seam.',$6,$7)`,
    [
      selection,
      ws,
      control.run_id,
      problem.id,
      h('report'),
      admission,
      owner.actorId,
    ],
  );
  const freeze = randomUUID();
  await pool.query(
    `insert into spec_freezes (id, workspace_id, run_id, spec_id, spec_version, content_hash,
       selection_id, task_hashes, admission_id, actor_id) values ($1,$2,$3,$4,1,$5,$6,'{}',$7,$8)`,
    [
      freeze,
      ws,
      control.run_id,
      spec.id,
      h('spec'),
      selection,
      admission,
      owner.actorId,
    ],
  );
  const manifestId = randomUUID();
  const product = randomUUID();
  const manifest =
    makeManifest?.({
      id: manifestId,
      spec_id: spec.id,
      freeze_id: freeze,
      product_id: product,
    }) ?? {};
  const manifestSha = makeManifest
    ? h(JSON.stringify(manifest))
    : h(`manifest-${manifestId}`);
  await pool.query(
    `insert into artifact_manifests (id, workspace_id, entity_id, product_id, spec_id,
       spec_version, freeze_id, commit, state, manifest, manifest_sha256, archive_sha256,
       created_by) values ($1,$2,$3,$4,$5,1,$6,$7,'verified',$11,$8,$9,$10)`,
    [
      manifestId,
      ws,
      artifact.id,
      product,
      spec.id,
      freeze,
      'a'.repeat(40),
      manifestSha,
      h('archive'),
      owner.actorId,
      JSON.stringify(manifest),
    ],
  );
  return {
    artifact_id: manifestId,
    manifest_sha256: manifestSha,
    product_id: product,
  };
}
