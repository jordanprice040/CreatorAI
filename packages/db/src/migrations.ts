import { createHash } from 'node:crypto';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Applied migrations are immutable: the runner refuses a database whose recorded checksum
// differs from this text. Add a new migration instead of editing an applied one.
export const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'records_links_audit_outbox',
    sql: `
create table actors (
  id uuid primary key,
  kind text not null check (kind in ('human', 'agent', 'system')),
  display_name text not null check (length(display_name) between 1 and 200),
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key,
  name text not null check (length(name) between 1 and 500),
  record_mode text not null check (record_mode in ('fixture', 'real')),
  fixture boolean not null,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  check (fixture = (record_mode = 'fixture')),
  unique (id, fixture)
);

create table workspace_members (
  workspace_id uuid not null references workspaces (id),
  actor_id uuid not null references actors (id),
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, actor_id)
);

create table entities (
  id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  kind text not null check (kind in ('source', 'claim', 'problem', 'idea',
    'alternative', 'assessment', 'product', 'specification', 'run', 'task',
    'decision', 'grant', 'artifact')),
  version integer not null check (version >= 1),
  status text not null check (status in ('active', 'archived', 'redacted')),
  title text not null check (length(title) between 1 and 500),
  body jsonb,
  content_hash char(64) not null,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Fixture records can only live in fixture workspaces, and real records in real ones.
  foreign key (workspace_id, fixture) references workspaces (id, fixture),
  unique (workspace_id, id),
  unique (workspace_id, id, kind),
  check ((status = 'redacted') = (body is null))
);
create index entities_scope on entities (workspace_id, kind, status);

create table audit_events (
  sequence bigint generated always as identity primary key,
  id uuid not null unique,
  workspace_id uuid references workspaces (id),
  occurred_at timestamptz not null,
  actor_id uuid not null references actors (id),
  action text not null,
  subject_kind text not null,
  subject_id uuid not null,
  subject_version integer,
  content_hash char(64),
  correlation_id uuid not null,
  causation_id uuid,
  payload jsonb not null,
  previous_hash char(64),
  event_hash char(64) not null unique
);

create table entity_versions (
  entity_id uuid not null,
  workspace_id uuid not null,
  version integer not null check (version >= 1),
  status text not null check (status in ('active', 'archived', 'redacted')),
  title text not null,
  body jsonb,
  content_hash char(64) not null,
  reason text,
  corrects_version integer,
  actor_id uuid not null references actors (id),
  event_id uuid not null references audit_events (id),
  created_at timestamptz not null default now(),
  primary key (entity_id, version),
  foreign key (workspace_id, entity_id) references entities (workspace_id, id),
  check (corrects_version is null or corrects_version < version)
);

create table entity_links (
  id uuid primary key,
  workspace_id uuid not null,
  relation text not null check (relation in ('supports', 'contradicts',
    'derived_from', 'uses', 'implements', 'verifies', 'supersedes', 'forks',
    'reuses', 'released_as', 'assesses', 'part_of', 'authorizes')),
  from_id uuid not null,
  from_kind text not null,
  from_version integer not null,
  to_id uuid not null,
  to_kind text not null,
  to_version integer not null,
  rationale text not null check (length(rationale) between 1 and 500),
  asserted_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  retracted_at timestamptz,
  retracted_by uuid references actors (id),
  retraction_reason text,
  -- Both endpoints must exist in the link's own workspace with the recorded kind and version.
  foreign key (workspace_id, from_id, from_kind)
    references entities (workspace_id, id, kind),
  foreign key (workspace_id, to_id, to_kind)
    references entities (workspace_id, id, kind),
  foreign key (from_id, from_version) references entity_versions (entity_id, version),
  foreign key (to_id, to_version) references entity_versions (entity_id, version),
  check ((retracted_at is null) = (retraction_reason is null)),
  check ((retracted_at is null) = (retracted_by is null))
);
create unique index entity_links_active on entity_links
  (workspace_id, relation, from_id, from_version, to_id, to_version)
  where retracted_at is null;
create index entity_links_from on entity_links (workspace_id, from_id);
create index entity_links_to on entity_links (workspace_id, to_id);

create table outbox (
  event_id uuid primary key references audit_events (id),
  sequence bigint not null unique,
  topic text not null,
  created_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0,
  delivered_at timestamptz
);
create index outbox_pending on outbox (sequence) where delivered_at is null;

create table consumer_inbox (
  consumer text not null,
  event_id uuid not null references audit_events (id),
  processed_at timestamptz not null default clock_timestamp(),
  primary key (consumer, event_id)
);

create table history_projection (
  event_id uuid primary key references audit_events (id),
  sequence bigint not null unique,
  workspace_id uuid references workspaces (id),
  occurred_at timestamptz not null,
  actor_id uuid not null,
  action text not null,
  subject_kind text not null,
  subject_id uuid not null,
  subject_version integer,
  content_hash char(64),
  correlation_id uuid not null,
  causation_id uuid,
  related_ids uuid[] not null,
  summary text not null
);
create index history_scope on history_projection (workspace_id, sequence);
create index history_related on history_projection using gin (related_ids);

create table command_receipts (
  workspace_id uuid not null references workspaces (id),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_hash char(64) not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

create function creator_reject_change() returns trigger language plpgsql as $$
begin
  raise exception 'append-only table %: % rejected', tg_table_name, tg_op
    using errcode = 'P0001';
end $$;
create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function creator_reject_change();
create trigger entity_versions_no_delete before delete on entity_versions
  for each row execute function creator_reject_change();
create trigger entity_links_no_delete before delete on entity_links
  for each row execute function creator_reject_change();

-- Version rows are immutable except for redaction, which removes the protected payload
-- and leaves a non-sensitive tombstone (identity, version, hash, actor, time).
create function creator_version_redaction_only() returns trigger language plpgsql as $$
begin
  if new.body is null and new.title = '[redacted]' and new.reason is null
     and new.entity_id = old.entity_id and new.workspace_id = old.workspace_id
     and new.version = old.version and new.status = old.status
     and new.content_hash = old.content_hash
     and new.corrects_version is not distinct from old.corrects_version
     and new.actor_id = old.actor_id and new.event_id = old.event_id
     and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'entity_versions is immutable except for redaction'
    using errcode = 'P0001';
end $$;
create trigger entity_versions_immutable before update on entity_versions
  for each row execute function creator_version_redaction_only();

-- A link is a historical assertion: only its retraction fields may be set, once.
create function creator_link_retraction_only() returns trigger language plpgsql as $$
begin
  if old.retracted_at is null and new.retracted_at is not null
     and (new.id, new.workspace_id, new.relation, new.from_id, new.from_kind,
          new.from_version, new.to_id, new.to_kind, new.to_version,
          new.rationale, new.asserted_by, new.created_at)
       = (old.id, old.workspace_id, old.relation, old.from_id, old.from_kind,
          old.from_version, old.to_id, old.to_kind, old.to_version,
          old.rationale, old.asserted_by, old.created_at) then
    return new;
  end if;
  raise exception 'entity_links can only be retracted once' using errcode = 'P0001';
end $$;
create trigger entity_links_retraction_only before update on entity_links
  for each row execute function creator_link_retraction_only();
`,
  },
  {
    version: 2,
    name: 'oversight_sessions_decisions_grants',
    sql: `
alter table entities drop constraint entities_kind_check;
alter table entities add constraint entities_kind_check check (kind in ('source',
  'claim', 'problem', 'idea', 'alternative', 'assessment', 'product',
  'specification', 'run', 'task', 'decision', 'grant', 'artifact', 'assumption',
  'humility_review'));

-- Opaque session tokens: only their SHA-256 is stored, so a database read cannot replay one.
create table auth_sessions (
  token_hash char(64) primary key,
  actor_id uuid not null references actors (id),
  method text not null check (method in ('dev_local', 'oidc')),
  subject text check (length(subject) <= 600),
  csrf_token text not null check (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  check (expires_at > created_at)
);
create index auth_sessions_actor on auth_sessions (actor_id);

create table oidc_logins (
  state_hash char(64) primary key,
  code_verifier text not null,
  nonce text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table run_controls (
  workspace_id uuid not null,
  run_id uuid not null,
  run_kind text not null default 'run' check (run_kind = 'run'),
  run_version integer not null,
  autonomy_mode text not null check (autonomy_mode in ('supervised',
    'human_in_loop', 'autonomous_within_scope', 'human_only')),
  experiment_condition text not null check (experiment_condition in
    ('autonomous', 'human_in_loop', 'human_only')),
  policy_version text not null,
  stage_gates text[] not null,
  initial_grants jsonb not null,
  state text not null check (state in ('active', 'cancelled')),
  cancel_reason text,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references actors (id),
  primary key (workspace_id, run_id),
  foreign key (workspace_id, run_id, run_kind)
    references entities (workspace_id, id, kind),
  foreign key (run_id, run_version) references entity_versions (entity_id, version),
  check ((autonomy_mode = 'human_only') = (experiment_condition = 'human_only')),
  check ((autonomy_mode = 'autonomous_within_scope') = (experiment_condition = 'autonomous')),
  check ((state = 'cancelled') = (cancelled_at is not null)),
  check ((state = 'cancelled') = (cancel_reason is not null))
);
-- Mode, condition, gates and initial grants are fixed; a run can only be cancelled, once.
create function creator_run_control_cancel_only() returns trigger language plpgsql as $$
begin
  if old.state = 'active' and new.state = 'cancelled'
     and (new.workspace_id, new.run_id, new.run_version, new.autonomy_mode,
          new.experiment_condition, new.policy_version, new.stage_gates,
          new.initial_grants, new.created_by, new.created_at)
       = (old.workspace_id, old.run_id, old.run_version, old.autonomy_mode,
          old.experiment_condition, old.policy_version, old.stage_gates,
          old.initial_grants, old.created_by, old.created_at) then
    return new;
  end if;
  raise exception 'run_controls can only be cancelled' using errcode = 'P0001';
end $$;
create trigger run_controls_cancel_only before update on run_controls
  for each row execute function creator_run_control_cancel_only();
create trigger run_controls_no_delete before delete on run_controls
  for each row execute function creator_reject_change();

create table grants (
  id uuid primary key,
  workspace_id uuid not null references workspaces (id),
  version integer not null check (version >= 1),
  scope text not null check (scope in ('once', 'standing')),
  status text not null check (status in ('active', 'revoked', 'consumed')),
  run_id uuid,
  action_types text[] not null check (cardinality(action_types) >= 1),
  target_kind text,
  target jsonb,
  spec_hash char(64),
  max_amount_nano_usd numeric(30, 0) check (max_amount_nano_usd >= 0),
  allow_irreversible boolean not null,
  allow_external_effects boolean not null,
  data_classes text[] not null check (cardinality(data_classes) >= 1),
  expires_at timestamptz not null,
  decision_id uuid,
  policy_version text not null,
  rationale text not null,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references actors (id),
  revoke_reason text,
  consumed_at timestamptz,
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  check (scope = 'standing' or (run_id is not null and decision_id is not null)),
  check (status <> 'consumed' or scope = 'once'),
  check ((status = 'revoked') = (revoked_at is not null)),
  check ((status = 'consumed') = (consumed_at is not null))
);
create index grants_scope on grants (workspace_id, status);

create table grant_versions (
  grant_id uuid not null references grants (id),
  version integer not null,
  snapshot jsonb not null,
  actor_id uuid not null references actors (id),
  event_id uuid not null references audit_events (id),
  created_at timestamptz not null default now(),
  primary key (grant_id, version)
);
create trigger grant_versions_append_only before update or delete on grant_versions
  for each row execute function creator_reject_change();

create table decision_requests (
  id uuid primary key,
  workspace_id uuid not null,
  run_id uuid not null,
  task_id uuid,
  version integer not null check (version >= 1),
  kind text not null check (kind in ('clarification', 'judgment',
    'authorization', 'feedback')),
  reason text not null,
  status text not null check (status in ('pending', 'answered', 'expired',
    'cancelled', 'superseded')),
  dedupe_key char(64) not null,
  request jsonb not null,
  binding jsonb,
  binding_hash char(64),
  expires_at timestamptz not null,
  requested_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  response jsonb,
  answered_by uuid references actors (id),
  answered_at timestamptz,
  grant_id uuid references grants (id),
  closed_reason text,
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  check ((status = 'answered') = (response is not null)),
  check ((status = 'answered') = (answered_at is not null)),
  check ((binding is null) = (binding_hash is null)),
  check (kind <> 'authorization' or binding is not null),
  check (expires_at > created_at)
);
-- The same open question is asked once; a repeat returns the pending request.
create unique index decision_requests_open on decision_requests
  (workspace_id, run_id, dedupe_key) where status = 'pending';
create index decision_requests_binding on decision_requests
  (workspace_id, run_id, binding_hash);
create trigger decision_requests_no_delete before delete on decision_requests
  for each row execute function creator_reject_change();
alter table grants add foreign key (decision_id) references decision_requests (id);

create table action_admissions (
  id uuid primary key,
  workspace_id uuid not null,
  run_id uuid not null,
  binding jsonb not null,
  binding_hash char(64) not null,
  verdict text not null check (verdict in ('allow', 'request_human', 'deny', 'defer')),
  outcome text not null check (outcome in ('admitted', 'needs_human', 'denied',
    'waiting_human')),
  reason_code text not null,
  reasons text[] not null,
  explanation text not null,
  policy_version text not null,
  grant_id uuid references grants (id),
  grant_version integer,
  provisional_assumptions uuid[] not null,
  decision_id uuid references decision_requests (id),
  actor_id uuid not null references actors (id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  check ((verdict = 'allow') = (grant_id is not null)),
  check ((grant_id is null) = (grant_version is null))
);
create index action_admissions_run on action_admissions (workspace_id, run_id, created_at);
create trigger action_admissions_append_only before update or delete on action_admissions
  for each row execute function creator_reject_change();
`,
  },
  {
    version: 3,
    name: 'budgets_pricing_reservations_usage',
    sql: `
-- Dated pricing, immutable once recorded. Fixture pricing lives only in fixture workspaces.
create table pricing_snapshots (
  id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  provider text not null check (provider in ('fixture', 'openai')),
  model_id text not null,
  basis text not null check (basis in ('fixture', 'documented')),
  body jsonb not null,
  snapshot_hash char(64) not null,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, fixture) references workspaces (id, fixture),
  unique (workspace_id, id),
  check ((basis = 'fixture') = fixture),
  check ((provider = 'fixture') = fixture)
);
create trigger pricing_snapshots_append_only before update or delete on pricing_snapshots
  for each row execute function creator_reject_change();

-- Permission-to-spend envelopes. Child authority is carved out of the parent (allocated),
-- so a child's spending is never counted twice. The check is the last line of defence
-- behind the row lock taken for every reservation.
create table budget_envelopes (
  id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  version integer not null default 1 check (version >= 1),
  parent_id uuid,
  kind text not null check (kind in ('global', 'period', 'run', 'task')),
  run_id uuid,
  name text not null check (length(name) between 1 and 200),
  status text not null check (status in ('active', 'closed', 'overrun')),
  cap_nano numeric(30, 0) not null check (cap_nano >= 0),
  allocated_nano numeric(30, 0) not null default 0 check (allocated_nano >= 0),
  reserved_nano numeric(30, 0) not null default 0 check (reserved_nano >= 0),
  unknown_nano numeric(30, 0) not null default 0 check (unknown_nano >= 0),
  incurred_nano numeric(30, 0) not null default 0 check (incurred_nano >= 0),
  max_in_flight integer not null check (max_in_flight between 1 and 32),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (workspace_id, fixture) references workspaces (id, fixture),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  unique (workspace_id, id),
  foreign key (workspace_id, parent_id) references budget_envelopes (workspace_id, id),
  check ((kind = 'global') = (parent_id is null)),
  check ((kind in ('run', 'task')) = (run_id is not null)),
  check (kind <> 'period' or (starts_at is not null and ends_at > starts_at)),
  check ((starts_at is null) = (ends_at is null)),
  check ((status = 'closed') = (closed_at is not null)),
  check (status <> 'closed' or (reserved_nano = 0 and unknown_nano = 0 and allocated_nano = 0)),
  check (status = 'overrun'
    or allocated_nano + reserved_nano + unknown_nano + incurred_nano <= cap_nano)
);
-- Identity, cap and parentage are fixed; only balances, status and version move.
create function creator_envelope_fixed() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.fixture, new.parent_id, new.kind, new.run_id,
      new.cap_nano, new.max_in_flight, new.starts_at, new.ends_at, new.created_by,
      new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.fixture, old.parent_id, old.kind, old.run_id,
      old.cap_nano, old.max_in_flight, old.starts_at, old.ends_at, old.created_by,
      old.created_at) or old.status = 'closed' then
    raise exception 'budget envelope identity and cap are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger budget_envelopes_fixed before update on budget_envelopes
  for each row execute function creator_envelope_fixed();
create trigger budget_envelopes_no_delete before delete on budget_envelopes
  for each row execute function creator_reject_change();

-- One row per broker attempt (and per denied evaluation). reserved_nano is the estimate held;
-- incurred_nano is set only from authoritative usage.
create table budget_reservations (
  id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  envelope_id uuid not null,
  run_id uuid not null,
  task_id uuid,
  logical_operation_id uuid not null,
  attempt integer not null check (attempt between 1 and 3),
  request_hash char(64) not null,
  action_type text not null check (action_type in ('model.generate', 'model.summarize',
    'model.embed', 'tool.search_public')),
  provider text not null check (provider in ('fixture', 'openai')),
  model_id text not null,
  pricing_snapshot_id uuid references pricing_snapshots (id),
  admission_id uuid references action_admissions (id),
  decision_id uuid references decision_requests (id),
  status text not null check (status in ('denied', 'in_flight', 'settled', 'released', 'unknown')),
  reason_code text not null,
  explanation text not null,
  reserved_nano numeric(30, 0) not null check (reserved_nano >= 0),
  exposure jsonb,
  incurred_nano numeric(30, 0) check (incurred_nano >= 0),
  provider_response_id text,
  result jsonb,
  deadline_at timestamptz,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (workspace_id, envelope_id) references budget_envelopes (workspace_id, id),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  check ((status = 'settled') = (incurred_nano is not null)),
  check (status <> 'denied' or reserved_nano = 0),
  check ((status = 'in_flight') = (finished_at is null))
);
-- A dispatched attempt exists once per logical operation; denials may be re-evaluated.
create unique index budget_reservations_attempt on budget_reservations
  (workspace_id, logical_operation_id, attempt) where status <> 'denied';
create index budget_reservations_envelope on budget_reservations (envelope_id, status);
create index budget_reservations_run on budget_reservations (workspace_id, run_id, created_at);
create function creator_reservation_transition() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.envelope_id, new.run_id, new.logical_operation_id,
      new.attempt, new.request_hash, new.action_type, new.reserved_nano, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.envelope_id, old.run_id, old.logical_operation_id,
      old.attempt, old.request_hash, old.action_type, old.reserved_nano, old.created_at)
     or not ((old.status = 'in_flight' and new.status in ('settled', 'released', 'unknown'))
          or (old.status = 'unknown' and new.status in ('settled', 'released'))) then
    raise exception 'invalid reservation transition % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger budget_reservations_transition before update on budget_reservations
  for each row execute function creator_reservation_transition();
create trigger budget_reservations_no_delete before delete on budget_reservations
  for each row execute function creator_reject_change();

-- Financial reality: at most one authoritative charge per attempt, so a late or repeated
-- result cannot charge twice.
create table usage_records (
  id uuid primary key,
  workspace_id uuid not null,
  reservation_id uuid not null unique references budget_reservations (id),
  source text not null check (source in ('provider_response', 'late_provider_response',
    'owner_reconciliation', 'fixture')),
  provider_response_id text,
  usage jsonb not null,
  amount_nano numeric(30, 0) not null check (amount_nano >= 0),
  pricing_snapshot_id uuid references pricing_snapshots (id),
  evidence text,
  actor_id uuid not null references actors (id),
  created_at timestamptz not null default now()
);
create trigger usage_records_append_only before update or delete on usage_records
  for each row execute function creator_reject_change();

-- Every balance movement, so envelope balances can be re-derived and audited.
create table budget_journal (
  sequence bigint generated always as identity primary key,
  workspace_id uuid not null,
  envelope_id uuid not null references budget_envelopes (id),
  reservation_id uuid references budget_reservations (id),
  counterpart_envelope_id uuid references budget_envelopes (id),
  entry text not null check (entry in ('fund', 'allocate', 'return', 'reserve', 'settle',
    'release', 'hold_unknown', 'resolve_unknown', 'close')),
  d_allocated numeric(30, 0) not null default 0,
  d_reserved numeric(30, 0) not null default 0,
  d_unknown numeric(30, 0) not null default 0,
  d_incurred numeric(30, 0) not null default 0,
  actor_id uuid not null references actors (id),
  event_id uuid not null references audit_events (id),
  created_at timestamptz not null default now()
);
create trigger budget_journal_append_only before update or delete on budget_journal
  for each row execute function creator_reject_change();
`,
  },
  {
    version: 4,
    name: 'durable_workflows_tasks_leases',
    sql: `
-- T05 workflows: a finite coordinator per registered run. Identity, bound context and limits
-- are fixed at start; only state, control, step count and result move, and terminal is final.
create table workflows (
  id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  run_id uuid not null,
  version integer not null default 1 check (version >= 1),
  role text not null check (role = 'r05_skeptic'),
  role_version text not null,
  prompt_hash char(64) not null,
  policy_version text not null,
  subject_id uuid not null,
  subject_version integer not null,
  context jsonb not null,
  context_hash char(64) not null,
  limits jsonb not null,
  envelope_id uuid not null,
  pricing_snapshot_id uuid not null,
  data_class text not null check (data_class in ('synthetic', 'public', 'private_approved')),
  state text not null check (state in ('queued', 'running', 'waiting_dependency',
    'waiting_human', 'paused_operator', 'reconciling', 'succeeded', 'failed', 'cancelled')),
  reason text not null,
  control text not null default 'run' check (control in ('run', 'pause', 'cancel')),
  steps integer not null default 0 check (steps >= 0),
  deadline_at timestamptz not null,
  result jsonb,
  created_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, fixture) references workspaces (id, fixture),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  foreign key (workspace_id, envelope_id) references budget_envelopes (workspace_id, id),
  foreign key (workspace_id, pricing_snapshot_id) references pricing_snapshots (workspace_id, id),
  foreign key (subject_id, subject_version) references entity_versions (entity_id, version),
  check ((state in ('succeeded', 'failed', 'cancelled')) = (finished_at is not null)),
  check ((finished_at is null) = (result is null))
);
-- One live coordinator per run, so a run's broker calls belong to one workflow.
create unique index workflows_one_live_per_run on workflows (workspace_id, run_id)
  where finished_at is null;
create index workflows_live on workflows (state) where finished_at is null;
create function creator_workflow_fixed() returns trigger language plpgsql as $$
begin
  if old.finished_at is not null
     or (new.id, new.workspace_id, new.fixture, new.run_id, new.role, new.role_version,
         new.prompt_hash, new.policy_version, new.subject_id, new.subject_version,
         new.context, new.context_hash, new.limits, new.envelope_id,
         new.pricing_snapshot_id, new.data_class, new.deadline_at, new.created_by,
         new.created_at)
       is distinct from
        (old.id, old.workspace_id, old.fixture, old.run_id, old.role, old.role_version,
         old.prompt_hash, old.policy_version, old.subject_id, old.subject_version,
         old.context, old.context_hash, old.limits, old.envelope_id,
         old.pricing_snapshot_id, old.data_class, old.deadline_at, old.created_by,
         old.created_at)
     or new.version <> old.version + 1
     or (old.control = 'cancel' and new.control <> 'cancel') then
    raise exception 'workflow identity, context and limits are immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger workflows_fixed before update on workflows
  for each row execute function creator_workflow_fixed();
create trigger workflows_no_delete before delete on workflows
  for each row execute function creator_reject_change();

-- Fencing tokens: every lease takes a new, larger value; only the current holder may commit.
create sequence workflow_lease_tokens;
create table workflow_tasks (
  id uuid primary key,
  workspace_id uuid not null,
  workflow_id uuid not null,
  kind text not null check (kind in ('critique', 'synthesis')),
  ordinal integer not null check (ordinal between 0 and 7),
  repair integer not null check (repair between 0 and 2),
  repair_of uuid references workflow_tasks (id),
  depth integer not null check (depth = 1),
  logical_operation_id uuid not null unique,
  state text not null check (state in ('waiting_dependency', 'queued', 'leased',
    'waiting_human', 'reconciling', 'succeeded', 'failed', 'needs_human', 'cancelled')),
  reason text not null,
  version integer not null default 1 check (version >= 1),
  deliveries integer not null default 0 check (deliveries >= 0),
  lease_owner text,
  lease_token bigint,
  lease_expires_at timestamptz,
  decision_id uuid references decision_requests (id),
  context jsonb not null,
  context_hash char(64) not null,
  output jsonb,
  output_hash char(64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (workspace_id, workflow_id) references workflows (workspace_id, id),
  unique (workflow_id, kind, ordinal, repair),
  check ((repair = 0) = (repair_of is null)),
  check ((state = 'leased') = (lease_owner is not null and lease_expires_at is not null)),
  check ((state = 'leased') <= (lease_token is not null)),
  check ((state = 'waiting_human') <= (decision_id is not null)),
  check ((state in ('succeeded', 'failed', 'needs_human', 'cancelled')) = (finished_at is not null)),
  check ((state = 'succeeded') = (output is not null)),
  check ((output is null) = (output_hash is null))
);
create index workflow_tasks_ready on workflow_tasks (workflow_id, state);
create index workflow_tasks_decision on workflow_tasks (decision_id) where decision_id is not null;
-- Context is fixed once a task can run; terminal tasks never change; tokens only grow.
create function creator_workflow_task_transition() returns trigger language plpgsql as $$
begin
  if old.finished_at is not null
     or (new.id, new.workspace_id, new.workflow_id, new.kind, new.ordinal, new.repair,
         new.repair_of, new.depth, new.logical_operation_id, new.created_at)
       is distinct from
        (old.id, old.workspace_id, old.workflow_id, old.kind, old.ordinal, old.repair,
         old.repair_of, old.depth, old.logical_operation_id, old.created_at)
     or (old.state <> 'waiting_dependency'
         and (new.context, new.context_hash) is distinct from (old.context, old.context_hash))
     or new.version <> old.version + 1
     or coalesce(new.lease_token, 0) < coalesce(old.lease_token, 0) then
    raise exception 'invalid workflow task change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger workflow_tasks_transition before update on workflow_tasks
  for each row execute function creator_workflow_task_transition();
create trigger workflow_tasks_no_delete before delete on workflow_tasks
  for each row execute function creator_reject_change();
`,
  },
  {
    version: 5,
    name: 'sources_passages_claim_support',
    sql: `
-- T06 research. A source's identity in a workspace is its final URL; its versions are entity
-- versions written by the source broker. Origin clusters are fixed when the source is first
-- recorded, so reposts of one original count once as corroboration.
create table research_sources (
  source_id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  kind text not null default 'source' check (kind = 'source'),
  url_key text not null check (length(url_key) between 1 and 2000),
  canonical_key text check (length(canonical_key) <= 2000),
  fingerprint char(64),
  origin_cluster uuid not null,
  cluster_reason text not null check (length(cluster_reason) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (workspace_id, url_key),
  unique (workspace_id, source_id),
  foreign key (workspace_id, fixture) references workspaces (id, fixture),
  foreign key (workspace_id, source_id, kind) references entities (workspace_id, id, kind)
);
create index research_sources_fingerprint on research_sources (workspace_id, fingerprint);
create index research_sources_canonical on research_sources (workspace_id, canonical_key);
create trigger research_sources_fixed before update or delete on research_sources
  for each row execute function creator_reject_change();

-- One row per fetch attempt, including refusals; raw bytes are never stored.
create table source_retrievals (
  id uuid primary key,
  workspace_id uuid not null,
  fixture boolean not null,
  run_id uuid not null,
  task_id uuid,
  logical_operation_id uuid not null,
  request_hash char(64) not null,
  adapter text not null check (adapter in ('fixture', 'http', 'none')),
  policy_hash char(64) not null,
  requested_url text not null check (length(requested_url) between 1 and 2000),
  url_key text not null check (length(url_key) between 1 and 2000),
  final_url text check (length(final_url) <= 2000),
  redirects jsonb not null default '[]',
  state text not null check (state in ('in_flight', 'fetched', 'blocked', 'inaccessible',
    'removed', 'failed', 'too_large', 'unsupported_type', 'denied', 'needs_human')),
  reason_code text not null check (length(reason_code) between 1 and 200),
  explanation text not null check (length(explanation) <= 1200),
  http_status integer,
  content_type text check (length(content_type) <= 200),
  bytes bigint check (bytes >= 0),
  content_hash char(64),
  text_hash char(64),
  source_id uuid,
  source_version integer,
  changed boolean,
  instruction_like boolean not null default false,
  admission_id uuid references action_admissions (id),
  decision_id uuid references decision_requests (id),
  actor_id uuid not null references actors (id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (workspace_id, logical_operation_id),
  foreign key (workspace_id, fixture) references workspaces (id, fixture),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  foreign key (source_id, source_version) references entity_versions (entity_id, version),
  check ((state = 'in_flight') = (finished_at is null)),
  check (state <> 'fetched' or (content_hash is not null and source_id is not null)),
  check ((source_id is null) = (source_version is null))
);
create index source_retrievals_run on source_retrievals (workspace_id, run_id, started_at);
create index source_retrievals_source on source_retrievals (source_id, finished_at);
create index source_retrievals_url on source_retrievals (workspace_id, url_key);
create index source_retrievals_open on source_retrievals (started_at) where state = 'in_flight';
-- An attempt finishes once; identity and request never change.
create function creator_retrieval_finish() returns trigger language plpgsql as $$
begin
  if old.state <> 'in_flight'
     or (new.id, new.workspace_id, new.fixture, new.run_id, new.task_id,
         new.logical_operation_id, new.request_hash, new.adapter, new.policy_hash,
         new.requested_url, new.url_key, new.admission_id, new.actor_id, new.started_at)
       is distinct from
        (old.id, old.workspace_id, old.fixture, old.run_id, old.task_id,
         old.logical_operation_id, old.request_hash, old.adapter, old.policy_hash,
         old.requested_url, old.url_key, old.admission_id, old.actor_id, old.started_at) then
    raise exception 'a finished retrieval is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger source_retrievals_finish before update on source_retrievals
  for each row execute function creator_retrieval_finish();
create trigger source_retrievals_no_delete before delete on source_retrievals
  for each row execute function creator_reject_change();

-- Passages of one exact source version. Offsets index that version's extracted text (hash
-- kept); the excerpt is bounded by policy and may be absent (hash-only retention, redaction).
create table source_passages (
  id uuid primary key,
  workspace_id uuid not null,
  source_id uuid not null,
  source_version integer not null,
  ordinal integer not null check (ordinal >= 0),
  paragraph integer not null check (paragraph >= 0),
  char_start integer not null check (char_start >= 0),
  char_end integer not null check (char_end > char_start),
  text_hash char(64) not null,
  excerpt text check (length(excerpt) <= 2000),
  excerpt_truncated boolean not null,
  passage_hash char(64) not null,
  instruction_like boolean not null,
  retrieval_id uuid not null references source_retrievals (id),
  created_at timestamptz not null default now(),
  unique (source_id, source_version, ordinal),
  unique (workspace_id, id),
  foreign key (workspace_id, source_id) references research_sources (workspace_id, source_id),
  foreign key (source_id, source_version) references entity_versions (entity_id, version)
);
create function creator_passage_change() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.source_id, new.source_version, new.ordinal,
      new.paragraph, new.char_start, new.char_end, new.text_hash, new.excerpt_truncated,
      new.passage_hash, new.instruction_like, new.retrieval_id, new.created_at)
     is distinct from
      (old.id, old.workspace_id, old.source_id, old.source_version, old.ordinal,
      old.paragraph, old.char_start, old.char_end, old.text_hash, old.excerpt_truncated,
      old.passage_hash, old.instruction_like, old.retrieval_id, old.created_at)
     or new.excerpt is not null and new.excerpt is distinct from old.excerpt then
    raise exception 'passages only lose their excerpt (redaction)' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger source_passages_change before update on source_passages
  for each row execute function creator_passage_change();
create trigger source_passages_no_delete before delete on source_passages
  for each row execute function creator_reject_change();

-- Claim-to-passage support at exact claim and source versions. Rows are retracted, never
-- edited; a redacted source takes its quoted text with it.
create table claim_support (
  id uuid primary key,
  workspace_id uuid not null,
  claim_id uuid not null,
  claim_kind text not null default 'claim' check (claim_kind = 'claim'),
  claim_version integer not null,
  source_id uuid not null,
  source_version integer not null,
  passage_id uuid,
  stance text not null check (stance in ('supports', 'contradicts', 'does_not_support',
    'inaccessible')),
  support_type text check (support_type in ('source_assertion', 'quotation',
    'observation', 'inference')),
  quote text check (length(quote) <= 1000),
  rationale text not null check (length(rationale) between 1 and 1200),
  link_id uuid references entity_links (id),
  asserted_by uuid not null references actors (id),
  created_at timestamptz not null default now(),
  retracted_at timestamptz,
  retracted_by uuid references actors (id),
  retraction_reason text check (length(retraction_reason) <= 500),
  foreign key (workspace_id, claim_id, claim_kind) references entities (workspace_id, id, kind),
  foreign key (claim_id, claim_version) references entity_versions (entity_id, version),
  foreign key (workspace_id, source_id) references research_sources (workspace_id, source_id),
  foreign key (source_id, source_version) references entity_versions (entity_id, version),
  foreign key (workspace_id, passage_id) references source_passages (workspace_id, id),
  check ((stance = 'inaccessible') = (passage_id is null)),
  check ((stance = 'inaccessible') = (support_type is null)),
  check ((stance in ('supports', 'contradicts')) = (link_id is not null)),
  check ((retracted_at is null) = (retraction_reason is null)),
  check ((retracted_at is null) = (retracted_by is null))
);
create unique index claim_support_active on claim_support
  (claim_id, claim_version, coalesce(passage_id, source_id)) where retracted_at is null;
create index claim_support_claim on claim_support (workspace_id, claim_id);
create function creator_claim_support_change() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.claim_id, new.claim_version, new.source_id,
      new.source_version, new.passage_id, new.stance, new.support_type, new.rationale,
      new.link_id, new.asserted_by, new.created_at)
     is distinct from
      (old.id, old.workspace_id, old.claim_id, old.claim_version, old.source_id,
      old.source_version, old.passage_id, old.stance, old.support_type, old.rationale,
      old.link_id, old.asserted_by, old.created_at)
     or (new.quote is not null and new.quote is distinct from old.quote)
     or (old.retracted_at is not null
         and (new.retracted_at, new.retracted_by, new.retraction_reason)
           is distinct from (old.retracted_at, old.retracted_by, old.retraction_reason)) then
    raise exception 'claim support is retracted, never edited' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger claim_support_change before update on claim_support
  for each row execute function creator_claim_support_change();
create trigger claim_support_no_delete before delete on claim_support
  for each row execute function creator_reject_change();

create function creator_redact_source_text() returns trigger language plpgsql as $$
begin
  if new.kind = 'source' and new.status = 'redacted' and old.status <> 'redacted' then
    update source_passages set excerpt = null where source_id = new.id and excerpt is not null;
    update claim_support set quote = null where source_id = new.id and quote is not null;
  end if;
  return new;
end $$;
create trigger entities_redact_source_text after update on entities
  for each row execute function creator_redact_source_text();
`,
  },
  {
    version: 6,
    name: 'discovery_briefs_rounds',
    sql: `
-- T07 discovery: search briefs are versioned records; discovery runs reuse the T05 workflow
-- tables with a second role, four task kinds and a revision round per task.
alter table entities drop constraint entities_kind_check;
alter table entities add constraint entities_kind_check check (kind in ('source',
  'claim', 'problem', 'idea', 'alternative', 'assessment', 'product',
  'specification', 'run', 'task', 'decision', 'grant', 'artifact', 'assumption',
  'humility_review', 'search_brief'));
alter table workflows drop constraint workflows_role_check;
alter table workflows add constraint workflows_role_check
  check (role in ('r05_skeptic', 'r02_discovery'));
alter table workflow_tasks drop constraint workflow_tasks_kind_check;
alter table workflow_tasks add constraint workflow_tasks_kind_check
  check (kind in ('critique', 'synthesis', 'locate', 'propose', 'skeptic', 'revise'));
alter table workflow_tasks add column round integer not null default 0
  check (round between 0 and 2);
alter table workflow_tasks drop constraint workflow_tasks_workflow_id_kind_ordinal_repair_key;
alter table workflow_tasks add constraint workflow_tasks_logical_slot
  unique (workflow_id, kind, ordinal, round, repair);
create or replace function creator_workflow_task_transition() returns trigger language plpgsql as $$
begin
  if old.finished_at is not null
     or (new.id, new.workspace_id, new.workflow_id, new.kind, new.ordinal, new.round,
         new.repair, new.repair_of, new.depth, new.logical_operation_id, new.created_at)
       is distinct from
        (old.id, old.workspace_id, old.workflow_id, old.kind, old.ordinal, old.round,
         old.repair, old.repair_of, old.depth, old.logical_operation_id, old.created_at)
     or (old.state <> 'waiting_dependency'
         and (new.context, new.context_hash) is distinct from (old.context, old.context_hash))
     or new.version <> old.version + 1
     or coalesce(new.lease_token, 0) < coalesce(old.lease_token, 0) then
    raise exception 'invalid workflow task change' using errcode = 'P0001';
  end if;
  return new;
end $$;
`,
  },
  {
    version: 7,
    name: 'scoring_selection_specs',
    sql: `
-- T08 scoring, selection and frozen specifications. Scorecards and specs are versioned
-- records; a selection keeps the report it was made from (original scores and ranks), and a
-- freeze binds one exact spec version and its task hashes. Both are append-only.
alter table entities drop constraint entities_kind_check;
alter table entities add constraint entities_kind_check check (kind in ('source',
  'claim', 'problem', 'idea', 'alternative', 'assessment', 'product',
  'specification', 'run', 'task', 'decision', 'grant', 'artifact', 'assumption',
  'humility_review', 'search_brief', 'scorecard'));
create table selections (
  id uuid primary key,
  workspace_id uuid not null,
  run_id uuid not null,
  problem_kind text not null default 'problem' check (problem_kind = 'problem'),
  problem_id uuid not null,
  problem_version integer not null,
  report_hash char(64) not null,
  report jsonb not null,
  dispositions jsonb not null,
  overrides jsonb not null,
  override_reason text,
  rationale text not null,
  admission_id uuid not null references action_admissions (id),
  actor_id uuid not null references actors (id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  foreign key (workspace_id, problem_id, problem_kind)
    references entities (workspace_id, id, kind),
  foreign key (problem_id, problem_version) references entity_versions (entity_id, version),
  unique (workspace_id, id),
  check (jsonb_array_length(overrides) = 0 or override_reason is not null)
);
create index selections_problem on selections (workspace_id, problem_id, created_at);
create trigger selections_append_only before update or delete on selections
  for each row execute function creator_reject_change();
create table spec_freezes (
  id uuid primary key,
  workspace_id uuid not null,
  run_id uuid not null,
  spec_kind text not null default 'specification' check (spec_kind = 'specification'),
  spec_id uuid not null,
  spec_version integer not null,
  content_hash char(64) not null,
  selection_id uuid not null,
  task_hashes jsonb not null,
  admission_id uuid not null references action_admissions (id),
  actor_id uuid not null references actors (id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
  foreign key (workspace_id, spec_id, spec_kind) references entities (workspace_id, id, kind),
  foreign key (spec_id, spec_version) references entity_versions (entity_id, version),
  foreign key (workspace_id, selection_id) references selections (workspace_id, id),
  unique (spec_id, spec_version)
);
create index spec_freezes_spec on spec_freezes (workspace_id, spec_id, created_at);
create trigger spec_freezes_append_only before update or delete on spec_freezes
  for each row execute function creator_reject_change();
`,
  },
  {
    version: 8,
    name: 'catalog_search',
    sql: `
-- T09 lexical search. Expression indexes only: the searchable text is the stored title and
-- string values, so a redacted record (title '[redacted]', body null) and a passage whose
-- excerpt was removed have nothing left to match. Queries repeat these exact expressions.
create index entities_search on entities using gin ((
  to_tsvector('english'::regconfig, title)
  || jsonb_to_tsvector('english'::regconfig, coalesce(body, '{}'::jsonb), '["string"]')));
create index source_passages_search on source_passages using gin (
  (to_tsvector('english'::regconfig, coalesce(excerpt, ''))));
create index history_search on history_projection using gin (
  (to_tsvector('english'::regconfig, summary)));
create index decision_requests_search on decision_requests using gin ((
  jsonb_to_tsvector('english'::regconfig, request, '["string"]')));
`,
  },
  {
    version: 9,
    name: 'isolated_synthetic_studies',
    sql: `
create table studies (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 manifest jsonb not null, manifest_hash char(64) not null,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp()
);
create trigger studies_immutable before update or delete on studies for each row execute function creator_reject_change();
create table study_attempts (
 id uuid primary key, study_id uuid not null references studies(id),
 workspace_id uuid not null references workspaces(id), run_id uuid not null,
 assignment jsonb not null, context jsonb not null, context_hash char(64) not null,
 ordinal integer not null, created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id,run_id) references run_controls(workspace_id,run_id),
 unique(study_id,ordinal)
);
create trigger study_attempts_immutable before update or delete on study_attempts for each row execute function creator_reject_change();
create table study_events (
 sequence bigint generated always as identity primary key,
 id uuid not null unique, study_id uuid not null references studies(id),
 attempt_id uuid references study_attempts(id), actor_id uuid not null references actors(id),
 kind text not null, payload jsonb not null, content_hash char(64) not null,
 created_at timestamptz not null default clock_timestamp()
);
create index study_events_attempt on study_events(attempt_id,sequence);
create unique index study_one_finish on study_events(attempt_id) where kind = 'finished';
create trigger study_events_immutable before update or delete on study_events for each row execute function creator_reject_change();
create table study_execution_requests (
 attempt_id uuid primary key references study_attempts(id), kind text not null,
 request jsonb not null, request_hash char(64) not null, input_bindings jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger study_execution_requests_immutable before update or delete on study_execution_requests for each row execute function creator_reject_change();
-- Never indexed or exposed by catalog/history: private grader content has its own ACL.
create table study_graders (
 study_id uuid not null references studies(id), actor_id uuid not null references actors(id),
 primary key(study_id,actor_id)
);
create table study_grader_material (
 id uuid primary key, study_id uuid not null references studies(id),
 actor_id uuid not null references actors(id), payload jsonb not null, content_hash char(64) not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger study_grader_material_immutable before update or delete on study_grader_material for each row execute function creator_reject_change();
`,
  },
  {
    version: 10,
    name: 'artifacts_previews_feedback',
    sql: `
-- T13 verified artifacts. The package bytes and manifest live in the local product store; this
-- index binds the manifest hash to an exact frozen spec version and is append-only.
create table artifact_manifests (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 entity_kind text not null default 'artifact' check (entity_kind = 'artifact'),
 entity_id uuid not null, product_id uuid not null,
 spec_id uuid not null, spec_version integer not null,
 freeze_id uuid not null references spec_freezes(id),
 commit char(40) not null, state text not null check (state in ('verified','failed','blocked')),
 manifest jsonb not null, manifest_sha256 char(64) not null unique, archive_sha256 char(64) not null,
 previous_id uuid references artifact_manifests(id),
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, entity_id, entity_kind) references entities(workspace_id, id, kind),
 foreign key (spec_id, spec_version) references entity_versions(entity_id, version)
);
create index artifact_manifests_spec on artifact_manifests(workspace_id, spec_id, created_at);
create trigger artifact_manifests_immutable before update or delete on artifact_manifests
 for each row execute function creator_reject_change();
-- A preview is a short resource lease on one exact manifest. Tickets and sessions are stored
-- only as hashes; state changes are versioned and audited.
create table artifact_previews (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 artifact_id uuid not null references artifact_manifests(id), manifest_sha256 char(64) not null,
 actor_id uuid not null references actors(id),
 ticket_hash char(64) not null, ticket_used boolean not null default false, session_hash char(64),
 state text not null check (state in ('starting','ready','failed','blocked','stopped','revoked')),
 readiness jsonb, max_runs integer not null check (max_runs between 1 and 20),
 runs_used integer not null default 0 check (runs_used <= max_runs),
 expires_at timestamptz not null, created_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz, end_reason text, version integer not null default 1
);
create index artifact_previews_artifact on artifact_previews(artifact_id, created_at);
create table artifact_feedback (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 artifact_id uuid not null references artifact_manifests(id), manifest_sha256 char(64) not null,
 spec_id uuid not null, spec_version integer not null,
 category text not null check (category in ('defect','change_request','question','praise')),
 body text not null, content_hash char(64) not null,
 status text not null check (status in ('submitted','accepted','declined','revised')),
 rationale text, revision_spec_version integer, version integer not null default 1,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 foreign key (spec_id, spec_version) references entity_versions(entity_id, version)
);
create index artifact_feedback_artifact on artifact_feedback(artifact_id, created_at);
`,
  },
  {
    version: 11,
    name: 'study_builds_and_budget_holds',
    sql: `
-- T15: an implementation-stratum attempt pins a copy of the owner's frozen spec and humility
-- review in its own workspace, so the builder, admission and grants never reach another arm.
create table study_attempt_pins (
 attempt_id uuid primary key references study_attempts(id),
 spec_id uuid not null, spec_version integer not null, spec_hash char(64) not null,
 review_id uuid not null, review_version integer not null,
 source jsonb not null, created_at timestamptz not null default clock_timestamp(),
 foreign key (spec_id, spec_version) references entity_versions(entity_id, version),
 foreign key (review_id, review_version) references entity_versions(entity_id, version)
);
create trigger study_attempt_pins_immutable before update or delete on study_attempt_pins
 for each row execute function creator_reject_change();
-- Maximum exposure held against a ledger before any model work for an attempt. Exposure of a
-- finished attempt is recomputed from its reservations; unknown cost counts as reserved.
create table study_budget_holds (
 attempt_id uuid primary key references study_attempts(id), ledger text not null,
 cap_nano numeric(30,0) not null check (cap_nano >= 0),
 ledger_cap_nano numeric(30,0) not null check (ledger_cap_nano >= 0),
 created_at timestamptz not null default clock_timestamp()
);
create index study_budget_holds_ledger on study_budget_holds(ledger, created_at);
create trigger study_budget_holds_immutable before update or delete on study_budget_holds
 for each row execute function creator_reject_change();
create unique index study_one_build on study_events(attempt_id) where kind = 'build';
`,
  },
];

export function migrationChecksum(m: Migration): string {
  return createHash('sha256').update(m.sql).digest('hex');
}
