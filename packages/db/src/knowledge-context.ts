import type { PoolClient } from 'pg';
import {
  KnowledgeProposalSchema,
  type KnowledgeProposal,
} from '@creator/contracts';
import { renderKnowledge } from '@creator/domain';
import { fail } from './store.js';

export async function knowledgeSources(
  c: PoolClient,
  ws: string,
  body: KnowledgeProposal,
) {
  if (
    (
      await c.query(
        'select 1 from study_attempts where workspace_id=$1 limit 1',
        [ws],
      )
    ).rowCount
  )
    throw fail(
      'SCOPE_EXCEEDED',
      'Study workspaces cannot supply reusable knowledge.',
    );
  for (const ref of body.provenance) {
    const row = (
      await c.query(
        'select kind,version,status,content_hash,body from entities where workspace_id=$1 and id=$2 for share',
        [ws, ref.entity_id],
      )
    ).rows[0];
    if (
      !row ||
      !['source', 'artifact', 'problem', 'specification'].includes(row.kind) ||
      row.status !== 'active' ||
      Number(row.version) !== ref.version ||
      row.content_hash !== ref.content_hash
    )
      throw fail(
        'EVIDENCE_MISMATCH',
        'Knowledge provenance is stale, redacted, unsupported or out of scope.',
      );
    if (
      (
        await c.query('select 1 from study_attempt_pins where spec_id=$1', [
          ref.entity_id,
        ])
      ).rowCount
    )
      throw fail(
        'SCOPE_EXCEEDED',
        'Study pins cannot supply reusable knowledge.',
      );
  }
}
export async function activeKnowledgeConstraints(
  c: PoolClient,
  ws: string,
  runId: string,
  keys: readonly string[],
  dataClass: string,
) {
  if (!keys.length) return [];
  if (
    (
      await c.query(
        'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
        [ws, runId],
      )
    ).rowCount
  )
    throw fail(
      'SCOPE_EXCEEDED',
      'Frozen study tasks cannot consume portfolio knowledge.',
    );
  const lane =
    (
      await c.query(
        'select lane from portfolio_run_lanes where workspace_id=$1 and run_id=$2',
        [ws, runId],
      )
    ).rows[0]?.lane ?? 'exploration';
  const result: string[] = [];
  for (const key of [...new Set(keys)].sort()) {
    const row = (
      await c.query(
        `select k.* from knowledge_heads h join reusable_knowledge k on k.id=h.candidate_id
      where h.workspace_id=$1 and h.key=$2 and k.status='reviewed' for share of h,k`,
        [ws, key],
      )
    ).rows[0];
    if (!row)
      throw fail(
        'MISSING_EVIDENCE',
        'Knowledge has no active reviewed version: ' + key,
      );
    const body = KnowledgeProposalSchema.parse(row.body);
    if (
      !body.permitted_lanes.includes(lane) ||
      (body.data_class === 'public' && dataClass === 'synthetic') ||
      (body.data_class === 'synthetic' && dataClass !== 'synthetic')
    )
      throw fail(
        'SCOPE_EXCEEDED',
        'Knowledge permitted use/data class does not cover this task.',
      );
    await knowledgeSources(c, ws, body);
    result.push(
      ...renderKnowledge(body.guidance, {
        key,
        version: Number(row.version),
        hash: row.body_hash,
      }),
    );
  }
  return result;
}
export async function bindWorkflowKnowledge(
  c: PoolClient,
  ws: string,
  workflowId: string,
  keys: readonly string[],
) {
  if (!keys.length) return;
  await c.query(
    `insert into workflow_knowledge(workspace_id,workflow_id,candidate_id,body_hash)
    select h.workspace_id,$2,k.id,k.body_hash from knowledge_heads h join reusable_knowledge k on k.id=h.candidate_id
    where h.workspace_id=$1 and h.key=any($3::text[])`,
    [ws, workflowId, [...new Set(keys)]],
  );
}
export async function workflowKnowledgeValid(
  c: PoolClient,
  ws: string,
  runId: string,
) {
  const { rows } = await c.query(
    `select k.*,b.body_hash as bound_hash from workflow_knowledge b join workflows w on w.id=b.workflow_id
    join reusable_knowledge k on k.id=b.candidate_id where b.workspace_id=$1 and w.run_id=$2 and w.finished_at is null for share of k`,
    [ws, runId],
  );
  for (const row of rows) {
    if (row.status !== 'reviewed' || row.body_hash !== row.bound_hash)
      return false;
    try {
      await knowledgeSources(c, ws, KnowledgeProposalSchema.parse(row.body));
    } catch {
      return false;
    }
  }
  return true;
}
