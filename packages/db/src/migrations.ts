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
  {
    version: 12,
    name: 'model_routing',
    sql: `
-- X01: versioned model registry, route policies, held-out benchmarks, promotions and the
-- decisions/outcomes that bind each routed call to its policy, registry and price versions.
create table route_registries (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 registry_version text not null, registry_hash char(64) not null, body jsonb not null,
 pricing_snapshot_ids jsonb not null, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, registry_version)
);
create trigger route_registries_immutable before update or delete on route_registries
 for each row execute function creator_reject_change();
create table route_policies (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 scope_key text not null, scope jsonb not null, version integer not null check (version >= 1),
 policy_hash char(64) not null, body jsonb not null, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 unique (workspace_id, scope_key, version)
);
create trigger route_policies_immutable before update or delete on route_policies
 for each row execute function creator_reject_change();
create table route_benchmarks (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 manifest_hash char(64) not null, manifest jsonb not null, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, manifest_hash)
);
create trigger route_benchmarks_immutable before update or delete on route_benchmarks
 for each row execute function creator_reject_change();
create table route_promotions (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 version integer not null default 1, registry_id uuid not null references route_registries(id),
 task_class text not null, candidate jsonb not null, candidate_key text not null, baseline jsonb not null,
 benchmark_id uuid not null references route_benchmarks(id), manifest_hash char(64) not null,
 criteria jsonb not null, criteria_hash char(64) not null,
 state text not null check (state in ('candidate','shadow','canary','promoted','rejected','rolled_back')),
 canary_decisions integer not null default 0 check (canary_decisions >= 0),
 evaluations jsonb not null default '[]', reason text not null default '', rationale text not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture)
);
create unique index route_promotions_active on route_promotions(workspace_id, task_class, candidate_key)
 where state in ('candidate','shadow','canary','promoted');
-- Terminal promotions never change again; criteria, candidate and benchmark never change.
create function creator_route_promotion_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.state in ('rejected','rolled_back')
     or (new.criteria_hash, new.candidate_key, new.benchmark_id, new.manifest_hash, new.registry_id)
        is distinct from (old.criteria_hash, old.candidate_key, old.benchmark_id, old.manifest_hash, old.registry_id) then
    raise exception 'route promotion change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger route_promotions_guard before update or delete on route_promotions
 for each row execute function creator_route_promotion_guard();
create table route_benchmark_results (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 promotion_id uuid not null references route_promotions(id), benchmark_id uuid not null references route_benchmarks(id),
 manifest_hash char(64) not null, provider text not null, model_id text not null, case_id text not null,
 split text not null check (split in ('development','held_out')), signal text not null, passed boolean not null,
 logical_operation_id uuid not null, cost jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique (promotion_id, provider, model_id, case_id)
);
create trigger route_benchmark_results_immutable before update or delete on route_benchmark_results
 for each row execute function creator_reject_change();
create table route_decisions (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 run_id uuid not null, logical_operation_id uuid not null, request_hash char(64) not null,
 status text not null check (status in ('routed','refused')), reason_code text not null, explanation text not null,
 request jsonb not null, policy_id uuid references route_policies(id), policy_version integer, policy_hash char(64),
 registry_id uuid not null references route_registries(id), registry_version text not null, registry_hash char(64) not null,
 provider text, model_id text, pricing_snapshot_id uuid references pricing_snapshots(id), pricing_hash char(64),
 role text, promotion_id uuid references route_promotions(id), criteria_hash char(64), shadow jsonb,
 escalated_from uuid references route_decisions(id), candidates jsonb not null,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, logical_operation_id),
 check ((status = 'routed') = (model_id is not null and pricing_snapshot_id is not null))
);
create unique index route_decisions_one_escalation on route_decisions(escalated_from) where escalated_from is not null;
create index route_decisions_run on route_decisions(workspace_id, run_id, created_at);
create trigger route_decisions_immutable before update or delete on route_decisions
 for each row execute function creator_reject_change();
create table route_outcomes (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 decision_id uuid not null references route_decisions(id),
 variant text not null check (variant in ('primary','shadow')),
 provider text not null, model_id text not null, promotion_id uuid references route_promotions(id),
 signal text not null, accepted boolean not null, related_operation_ids jsonb not null, cost jsonb not null,
 note text, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 unique (decision_id, variant),
 check (accepted = (signal = 'accepted'))
);
create index route_outcomes_promotion on route_outcomes(promotion_id, created_at);
create trigger route_outcomes_immutable before update or delete on route_outcomes
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 13,
    name: 'context_cache_batches',
    sql: `
-- X02: provider capabilities, an incremental context index, hash-bound context packs,
-- compactions and handoffs, a scoped result cache that never grants permission, batches
-- whose items are ordinary broker reservations, and quality/total-cost comparisons.
create table context_capabilities (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 capabilities_version text not null, registry_hash char(64) not null, body jsonb not null,
 batch_pricing_snapshot_ids jsonb not null, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, capabilities_version)
);
create trigger context_capabilities_immutable before update or delete on context_capabilities
 for each row execute function creator_reject_change();
-- Mutable by design: re-indexing updates an entry in place and bumps its version when the
-- content hash changes. Packs and cache entries keep the hashes they were built from.
create table context_index_entries (
 workspace_id uuid not null, fixture boolean not null, corpus text not null, key text not null,
 kind text not null check (kind in ('code','note','source','record')),
 data_class text not null check (data_class in ('synthetic','public','private_approved')),
 version integer not null check (version >= 1), content_hash char(64) not null,
 locator text, record jsonb, text text not null, tokens integer not null check (tokens >= 0),
 status text not null check (status in ('current','removed')),
 indexed_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 primary key (workspace_id, corpus, key)
);
create table context_packs (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null, run_id uuid not null,
 pack_hash char(64) not null, prefix_hash char(64) not null, body jsonb not null,
 compacted_from uuid references context_packs(id), created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 foreign key (workspace_id, fixture) references workspaces (id, fixture)
);
create index context_packs_run on context_packs(workspace_id, run_id, created_at);
create trigger context_packs_immutable before update or delete on context_packs
 for each row execute function creator_reject_change();
create table context_compactions (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 pack_id uuid not null references context_packs(id),
 method text not null check (method in ('extractive','model','provider')),
 status text not null check (status in ('accepted','rejected','refused')),
 reason_code text not null, explanation text not null,
 result_pack_id uuid references context_packs(id), operation_id uuid,
 missing_pins jsonb not null, missing_facts jsonb not null,
 tokens_before integer not null, tokens_after integer,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 check ((status = 'accepted') = (result_pack_id is not null))
);
create unique index context_compactions_operation on context_compactions(workspace_id, operation_id)
 where operation_id is not null;
create trigger context_compactions_immutable before update or delete on context_compactions
 for each row execute function creator_reject_change();
create table context_handoffs (
 id uuid primary key, workspace_id uuid not null references workspaces(id), run_id uuid not null,
 pack_id uuid not null references context_packs(id), handoff_hash char(64) not null, body jsonb not null,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp()
);
create trigger context_handoffs_immutable before update or delete on context_handoffs
 for each row execute function creator_reject_change();
-- A cache entry holds an answer, never authority. Only its invalidation and hit count change.
create table context_cache_entries (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 cache_key char(64) not null, scope jsonb not null, version jsonb not null, deps jsonb not null,
 output jsonb not null, source_operation_id uuid not null, source_run_id uuid not null,
 status text not null check (status in ('valid','invalidated')),
 invalidated_reason text, invalidated_at timestamptz, invalidated_by uuid references actors(id),
 hits integer not null default 0 check (hits >= 0),
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 check ((status = 'invalidated') = (invalidated_at is not null))
);
create unique index context_cache_one_valid on context_cache_entries(workspace_id, cache_key)
 where status = 'valid';
create function creator_context_cache_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'invalidated' and new.status <> 'invalidated'
     or (new.id, new.workspace_id, new.cache_key, new.scope, new.version, new.deps, new.output,
         new.source_operation_id, new.created_at)
        is distinct from (old.id, old.workspace_id, old.cache_key, old.scope, old.version, old.deps,
         old.output, old.source_operation_id, old.created_at) then
    raise exception 'context cache entry change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger context_cache_entries_guard before update or delete on context_cache_entries
 for each row execute function creator_context_cache_guard();
create table context_events (
 id uuid primary key, workspace_id uuid not null references workspaces(id), run_id uuid,
 kind text not null check (kind in ('cache_hit','cache_hit_refused','cache_miss','cache_store',
   'cache_invalidated','pack_call')),
 pack_id uuid references context_packs(id), cache_entry_id uuid references context_cache_entries(id),
 operation_id uuid, detail jsonb not null, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp()
);
create index context_events_run on context_events(workspace_id, run_id, created_at);
create trigger context_events_immutable before update or delete on context_events
 for each row execute function creator_reject_change();
create table context_batches (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null, run_id uuid not null,
 batch_operation_id uuid not null, request_hash char(64) not null,
 provider text not null, model_id text not null, pricing_snapshot_id uuid not null references pricing_snapshots(id),
 capability_registry_id uuid references context_capabilities(id),
 status text not null check (status in ('refused','submitting','submitted','completed','partial',
   'expired','failed','unknown')),
 reason_code text not null, explanation text not null, provider_batch_id text,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, batch_operation_id)
);
create table context_batch_items (
 batch_id uuid not null references context_batches(id), custom_id text not null,
 logical_operation_id uuid not null, reservation_id uuid references budget_reservations(id),
 request jsonb not null, primary key (batch_id, custom_id), unique (batch_id, logical_operation_id)
);
create table context_evaluations (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null, run_id uuid not null,
 manifest_hash char(64) not null, request jsonb not null,
 state text not null check (state in ('pending','evaluated')), result jsonb,
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 evaluated_at timestamptz,
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, manifest_hash),
 check ((state = 'evaluated') = (result is not null and evaluated_at is not null))
);
-- Results are written once: a pending evaluation may become evaluated, nothing else changes.
create function creator_context_evaluation_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.state = 'evaluated'
     or (new.request, new.manifest_hash, new.run_id) is distinct from (old.request, old.manifest_hash, old.run_id) then
    raise exception 'context evaluation change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger context_evaluations_guard before update or delete on context_evaluations
 for each row execute function creator_context_evaluation_guard();
`,
  },
  {
    version: 14,
    name: 'saved_queries_and_member_removal',
    sql: `
-- X03 saved queries: a named search or audit question. The stored body is a request, never
-- query text; it is validated again and run with the caller's current access every time.
create table saved_queries (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 name text not null check (length(name) between 1 and 120),
 kind text not null check (kind in ('search','question')),
 body jsonb not null, body_hash char(64) not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 archived_at timestamptz, archived_by uuid references actors(id),
 check ((archived_at is null) = (archived_by is null))
);
create unique index saved_queries_name on saved_queries(workspace_id, lower(name))
 where archived_at is null;
-- Only archiving, once, may change a saved query.
create function creator_saved_query_archive_only() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.archived_at is not null or new.archived_at is null
     or (new.id, new.workspace_id, new.name, new.kind, new.body, new.body_hash,
         new.created_by, new.created_at)
        is distinct from (old.id, old.workspace_id, old.name, old.kind, old.body,
         old.body_hash, old.created_by, old.created_at) then
    raise exception 'saved queries can only be archived, once' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger saved_queries_archive_only before update or delete on saved_queries
 for each row execute function creator_saved_query_archive_only();
-- Workspace access is revoked by removing the membership row (audited as member.removed);
-- every read checks membership first, so a removed member learns nothing more.
create index cost_search_reservations on budget_reservations (workspace_id, created_at);
`,
  },
  {
    version: 15,
    name: 'github_scoped_management',
    sql: `
-- X04: scoped GitHub management. A connection names one verified owner and one credential
-- reference (an environment variable name, never a secret). Operations are journalled as
-- intents before any call; an unknown outcome stays unknown until reconciled.
create table github_connections (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 version integer not null check (version >= 1),
 status text not null check (status in ('unverified','active','credential_rejected',
   'access_revoked','revoked')),
 body jsonb not null, body_hash char(64) not null, verification jsonb, status_reason text,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture)
);
-- Only status and verification change; a revoked connection never comes back.
create function creator_github_connection_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'revoked'
     or (new.id, new.workspace_id, new.fixture, new.body, new.body_hash, new.created_by, new.created_at)
        is distinct from (old.id, old.workspace_id, old.fixture, old.body, old.body_hash,
          old.created_by, old.created_at) then
    raise exception 'github connection change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger github_connections_guard before update or delete on github_connections
 for each row execute function creator_github_connection_guard();
create table github_repositories (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 connection_id uuid not null references github_connections(id),
 github_id bigint not null check (github_id > 0), owner_id bigint not null,
 full_name text not null, default_branch text not null,
 origin text not null check (origin in ('created','included')),
 status text not null check (status in ('active','access_lost','quarantined')),
 status_reason text, created_operation_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (connection_id, github_id)
);
-- The immutable GitHub id and owner are the identity; the name may change with a rename.
create function creator_github_repository_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or (new.id, new.workspace_id, new.connection_id, new.github_id, new.owner_id,
       new.origin, new.created_operation_id, new.created_at)
     is distinct from (old.id, old.workspace_id, old.connection_id, old.github_id, old.owner_id,
       old.origin, old.created_operation_id, old.created_at) then
    raise exception 'github repository change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger github_repositories_guard before update or delete on github_repositories
 for each row execute function creator_github_repository_guard();
create table github_operations (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 connection_id uuid not null references github_connections(id), run_id uuid not null,
 kind text not null check (kind in ('repo_create','branch_create','push','issue_create',
   'pr_open','pr_merge')),
 action_type text, repository_id uuid references github_repositories(id),
 params jsonb not null, intent_hash char(64) not null, idempotency_key text,
 admission_id uuid references action_admissions(id),
 state text not null check (state in ('refused','dispatched','succeeded','failed','unknown',
   'reconciled_succeeded','reconciled_absent')),
 reason_code text not null, explanation text not null, gate jsonb, result jsonb,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 check ((state = 'refused') or admission_id is not null)
);
create index github_operations_connection on github_operations(connection_id, created_at);
create index github_operations_intent on github_operations(connection_id, intent_hash);
create unique index github_operations_key on github_operations(workspace_id, idempotency_key)
 where idempotency_key is not null;
-- dispatched -> succeeded | failed | unknown; unknown -> reconciled_*; nothing else moves.
create function creator_github_operation_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE'
     or (new.id, new.workspace_id, new.connection_id, new.run_id, new.kind, new.action_type,
         new.repository_id, new.params, new.intent_hash, new.idempotency_key, new.admission_id,
         new.gate, new.created_by, new.created_at)
        is distinct from (old.id, old.workspace_id, old.connection_id, old.run_id, old.kind,
         old.action_type, old.repository_id, old.params, old.intent_hash, old.idempotency_key,
         old.admission_id, old.gate, old.created_by, old.created_at)
     or not ((old.state = 'dispatched' and new.state in ('succeeded','failed','unknown'))
       or (old.state = 'unknown' and new.state in ('reconciled_succeeded','reconciled_absent'))) then
    raise exception 'github operation change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger github_operations_guard before update or delete on github_operations
 for each row execute function creator_github_operation_guard();
create table github_pull_requests (
 repository_id uuid not null references github_repositories(id), number bigint not null,
 workspace_id uuid not null references workspaces(id), head_branch text not null,
 base_branch text not null, state text not null check (state in ('open','closed','merged')),
 opened_operation_id uuid not null references github_operations(id),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (repository_id, number)
);
create table github_reviews (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 repository_id uuid not null references github_repositories(id), pr_number bigint not null,
 head_sha char(40) not null, verdict text not null check (verdict in ('approve','request_changes')),
 note text not null, reviewer_id uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp()
);
create index github_reviews_head on github_reviews(repository_id, pr_number, head_sha, created_at);
create trigger github_reviews_immutable before update or delete on github_reviews
 for each row execute function creator_reject_change();
create table github_webhook_deliveries (
 id uuid primary key, connection_id uuid not null references github_connections(id),
 delivery_id text not null, event text not null, action text, payload_hash char(64) not null,
 status text not null check (status in ('accepted','rejected_signature')),
 effects jsonb not null, received_at timestamptz not null default clock_timestamp()
);
-- A redelivered event is recognised by GitHub's delivery id and applied once.
create unique index github_webhook_once on github_webhook_deliveries(connection_id, delivery_id)
 where status = 'accepted';
create trigger github_webhook_deliveries_immutable before update or delete on github_webhook_deliveries
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 16,
    name: 'desktop_pairing_and_signin',
    sql: `
create table desktop_challenges (
 id uuid primary key, kind text not null check (kind in ('desktop_login', 'worker')),
 proof_hash char(64) not null unique, label text not null,
 workspace_id uuid, capabilities jsonb not null,
 approval_session_hash char(64) references auth_sessions(token_hash),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp() + interval '5 minutes'),
 consumed_at timestamptz
);
create table desktop_devices (
 id uuid primary key, kind text not null check (kind in ('desktop_login', 'worker')),
 owner_id uuid not null references actors(id), workspace_id uuid references workspaces(id),
 label text not null, capabilities jsonb not null,
 token_hash char(64) unique, session_hash char(64) unique references auth_sessions(token_hash),
 state text not null default 'active' check (state in ('active', 'paused', 'shutdown', 'revoked')),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, last_seen_at timestamptz, lease_expires_at timestamptz,
 fence integer not null default 0 check (fence >= 0),
 check ((kind = 'worker' and token_hash is not null and workspace_id is not null and session_hash is null)
     or (kind = 'desktop_login' and token_hash is null and workspace_id is null and session_hash is not null))
);
create index desktop_challenges_recent on desktop_challenges(created_at);
create index desktop_devices_owner on desktop_devices(owner_id, created_at);
`,
  },
  {
    version: 17,
    name: 'bounded_paired_artifact_jobs',
    sql: `
create table desktop_jobs (
 id uuid primary key, device_id uuid not null references desktop_devices(id),
 workspace_id uuid not null references workspaces(id), owner_id uuid not null references actors(id),
 request_id uuid not null, request_hash char(64) not null,
 artifact_id uuid not null references artifact_manifests(id), product_id uuid not null,
 manifest_sha256 char(64) not null, archive_sha256 char(64) not null, input jsonb not null,
 state text not null default 'queued' check (state in ('queued','leased','running','completed','cancelled','expired','reconciling')),
 fence integer not null, lease_id uuid, execution_id uuid, reconciled_outcome_hash char(64), lease_expires_at timestamptz,
 cancel_requested boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp() + interval '2 minutes'),
 unique(device_id, request_id)
);
create index desktop_jobs_device on desktop_jobs(device_id, created_at);
create unique index desktop_jobs_execution_once on desktop_jobs(execution_id) where execution_id is not null;
create index desktop_jobs_workspace on desktop_jobs(workspace_id, state);
create table desktop_job_reports (
 job_id uuid primary key references desktop_jobs(id), report jsonb not null,
 report_hash char(64) not null, received_at timestamptz not null default clock_timestamp()
);
create trigger desktop_job_reports_immutable before update or delete on desktop_job_reports
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 18,
    name: 'deployment_identity_and_verifications',
    sql: `
-- X06: which environment this database belongs to. A process configured for another
-- environment refuses to start against it, so staging cannot write to live records.
create table deployment_identity (
 singleton boolean primary key default true check (singleton),
 environment text not null check (environment in ('local','test','staging','live')),
 claimed_at timestamptz not null default clock_timestamp(),
 version integer not null default 1 check (version >= 1)
);
create trigger deployment_identity_no_delete before delete on deployment_identity
 for each row execute function creator_reject_change();
-- Owner-recorded deployment verifications, bound to the exact commit, configuration hash
-- and schema they checked. A later change of any of them makes the record stale.
create table deployment_verifications (
 id uuid primary key,
 environment text not null check (environment in ('local','test','staging','live')),
 build_commit char(40) not null check (build_commit ~ '^[0-9a-f]{40}$'),
 config_hash char(64) not null, schema_version integer not null,
 result text not null check (result in ('passed','failed')),
 checks jsonb not null, smoke_report_sha256 char(64) not null,
 confirmation text, recorded_by uuid not null references actors(id),
 audit_event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 check (environment <> 'live' or result <> 'passed' or confirmation is not null)
);
create index deployment_verifications_latest on deployment_verifications(environment, created_at desc);
create trigger deployment_verifications_immutable before update or delete on deployment_verifications
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 19,
    name: 'payments_entitlements_reinvestment',
    sql: `
-- X07 (migration 18 is left to X06). Processor connections, offers bound to verified releases,
-- an immutable double-entry ledger keyed by economic transaction, entitlements derived from
-- authoritative payment state, and reinvestment of settled earnings into new budget envelopes.
create table payment_connections (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 version integer not null check (version >= 1),
 status text not null check (status in ('unverified','active','rejected','revoked')),
 body jsonb not null, body_hash char(64) not null, verification jsonb, status_reason text,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, id)
);
create function creator_payment_connection_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'revoked'
     or (new.id, new.workspace_id, new.fixture, new.body, new.body_hash, new.created_by,
         new.created_at)
        is distinct from (old.id, old.workspace_id, old.fixture, old.body, old.body_hash,
         old.created_by, old.created_at) then
    raise exception 'payment connection change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payment_connections_guard before update or delete on payment_connections
 for each row execute function creator_payment_connection_guard();

create table payment_offers (
 id uuid primary key, workspace_id uuid not null, connection_id uuid not null,
 product_id uuid not null, artifact_id uuid not null references artifact_manifests(id),
 manifest_sha256 char(64) not null, label text not null,
 price_nano numeric(30,0) not null check (price_nano > 0 and mod(price_nano, 10000000) = 0),
 status text not null check (status in ('active','archived')),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, connection_id) references payment_connections (workspace_id, id),
 unique (workspace_id, id)
);
create function creator_payment_offer_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status <> 'active' or new.status <> 'archived'
     or (new.id, new.workspace_id, new.connection_id, new.product_id, new.artifact_id,
         new.manifest_sha256, new.label, new.price_nano, new.created_by, new.created_at)
        is distinct from (old.id, old.workspace_id, old.connection_id, old.product_id,
         old.artifact_id, old.manifest_sha256, old.label, old.price_nano, old.created_by,
         old.created_at) then
    raise exception 'payment offer change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger payment_offers_guard before update or delete on payment_offers
 for each row execute function creator_payment_offer_guard();

-- A checkout is only a request to the processor; it never grants access.
create table payment_checkouts (
 id uuid primary key, workspace_id uuid not null, offer_id uuid not null,
 customer_ref text not null, state text not null check (state in ('open','failed')),
 processor_session_id text, url text, reason text,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, offer_id) references payment_offers (workspace_id, id)
);
create trigger payment_checkouts_immutable before update or delete on payment_checkouts
 for each row execute function creator_reject_change();

-- Every delivery, verified or not. An event id is applied once; 'deferred' means the processor
-- could not be read, so the delivery is refused and its retry is processed.
create table payment_events (
 id uuid primary key, connection_id uuid not null references payment_connections(id),
 processor_event_id text, event_type text,
 status text not null check (status in ('applied','rejected','duplicate','deferred','ignored')),
 reason text not null, payload_hash char(64) not null,
 received_at timestamptz not null default clock_timestamp()
);
create unique index payment_events_once on payment_events (connection_id, processor_event_id)
 where status = 'applied';
create trigger payment_events_immutable before update or delete on payment_events
 for each row execute function creator_reject_change();

-- What the backend read from the processor; the only input to the ledger and entitlements.
create table payment_snapshots (
 id uuid primary key, workspace_id uuid not null, connection_id uuid not null,
 object_kind text not null check (object_kind in ('payment','payout','balance')),
 object_id text, snapshot jsonb not null, snapshot_hash char(64) not null,
 retrieved_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, connection_id) references payment_connections (workspace_id, id)
);
create index payment_snapshots_object on payment_snapshots (connection_id, object_id, retrieved_at);
create trigger payment_snapshots_immutable before update or delete on payment_snapshots
 for each row execute function creator_reject_change();

-- The financial ledger, separate from the budget journal. Entries never change: a different
-- processor answer for the same economic transaction posts a balanced correction.
create table finance_entries (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 economic_key text not null, revision integer not null check (revision >= 1),
 kind text not null check (kind in ('original','correction')),
 memo text not null, snapshot_id uuid references payment_snapshots(id),
 actor_id uuid not null references actors(id), event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 unique (workspace_id, economic_key, revision),
 check ((kind = 'original') = (revision = 1))
);
create table finance_postings (
 entry_id uuid not null references finance_entries(id),
 account text not null check (account in ('processor_pending','processor_available','bank',
   'revenue','processing_fees','refunds','dispute_losses','dispute_fees','owner_funding')),
 amount_nano numeric(30,0) not null check (amount_nano <> 0),
 primary key (entry_id, account)
);
create trigger finance_entries_immutable before update or delete on finance_entries
 for each row execute function creator_reject_change();
create trigger finance_postings_immutable before update or delete on finance_postings
 for each row execute function creator_reject_change();
-- Checked at commit: every entry has postings and they sum to zero.
create function creator_finance_entry_balanced() returns trigger language plpgsql as $$
declare total numeric; n integer;
begin
  select coalesce(sum(amount_nano), 0), count(*) into total, n
    from finance_postings where entry_id = new.id;
  if n < 2 or total <> 0 then
    raise exception 'finance entry % is unbalanced', new.id using errcode = '23514';
  end if;
  return null;
end $$;
create function creator_finance_posting_balanced() returns trigger language plpgsql as $$
declare total numeric;
begin
  select coalesce(sum(amount_nano), 0) into total from finance_postings
    where entry_id = new.entry_id;
  if total <> 0 then
    raise exception 'finance entry % is unbalanced', new.entry_id using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger finance_entries_balanced after insert on finance_entries
 deferrable initially deferred for each row execute function creator_finance_entry_balanced();
create constraint trigger finance_postings_balanced after insert on finance_postings
 deferrable initially deferred for each row execute function creator_finance_posting_balanced();

create table entitlements (
 id uuid primary key, workspace_id uuid not null, offer_id uuid not null,
 connection_id uuid not null references payment_connections(id), payment_id text not null,
 customer_ref text not null, product_id uuid not null, artifact_id uuid not null,
 manifest_sha256 char(64) not null,
 status text not null check (status in ('active','suspended','revoked')),
 reason text not null, version integer not null check (version >= 1),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, offer_id) references payment_offers (workspace_id, id),
 unique (connection_id, payment_id)
);
create function creator_entitlement_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'revoked'
     or (new.id, new.workspace_id, new.offer_id, new.connection_id, new.payment_id,
         new.customer_ref, new.product_id, new.artifact_id, new.manifest_sha256, new.created_at)
        is distinct from (old.id, old.workspace_id, old.offer_id, old.connection_id,
         old.payment_id, old.customer_ref, old.product_id, old.artifact_id,
         old.manifest_sha256, old.created_at) then
    raise exception 'entitlement change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger entitlements_guard before update or delete on entitlements
 for each row execute function creator_entitlement_guard();

create table reinvestment_policies (
 workspace_id uuid not null references workspaces(id), version integer not null check (version >= 1),
 body jsonb not null, anchor_at timestamptz not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, version)
);
create trigger reinvestment_policies_immutable before update or delete on reinvestment_policies
 for each row execute function creator_reject_change();

-- One tranche per settled payment. Its reinvestable cap only falls (later losses), and what
-- was consumed beyond a fallen cap moved to a clawback, so consumed <= cap + clawed.
create table earnings_tranches (
 id uuid primary key, workspace_id uuid not null, connection_id uuid not null,
 payment_id text not null, bps integer not null check (bps between 0 and 10000),
 policy_version integer,
 earned_nano numeric(30,0) not null check (earned_nano >= 0),
 loss_nano numeric(30,0) not null default 0 check (loss_nano >= 0),
 cap_nano numeric(30,0) not null check (cap_nano >= 0),
 consumed_nano numeric(30,0) not null default 0 check (consumed_nano >= 0),
 clawed_nano numeric(30,0) not null default 0 check (clawed_nano >= 0),
 disputed boolean not null default false,
 settled_at timestamptz not null, eligible_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, connection_id) references payment_connections (workspace_id, id),
 unique (connection_id, payment_id),
 check (consumed_nano <= cap_nano + clawed_nano)
);
create function creator_tranche_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.cap_nano > old.cap_nano or new.loss_nano < old.loss_nano
     or new.consumed_nano < old.consumed_nano or new.clawed_nano < old.clawed_nano
     or (new.id, new.workspace_id, new.connection_id, new.payment_id, new.bps,
         new.policy_version, new.earned_nano, new.settled_at, new.eligible_at, new.created_at)
        is distinct from (old.id, old.workspace_id, old.connection_id, old.payment_id, old.bps,
         old.policy_version, old.earned_nano, old.settled_at, old.eligible_at, old.created_at) then
    raise exception 'earnings tranche change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger earnings_tranches_guard before update or delete on earnings_tranches
 for each row execute function creator_tranche_guard();

create table funding_rails (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 kind text not null check (kind in ('processor_balance','owner_attested')),
 connection_id uuid references payment_connections(id), label text not null,
 status text not null check (status in ('available','unavailable')), status_reason text,
 version integer not null check (version >= 1),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 check ((kind = 'processor_balance') = (connection_id is not null))
);
create table rail_observations (
 id uuid primary key, rail_id uuid not null references funding_rails(id),
 available_nano numeric(30,0) not null, pending_nano numeric(30,0) not null,
 source text not null check (source in ('processor_api','owner_attestation')),
 evidence text not null, observed_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, actor_id uuid not null references actors(id)
);
create index rail_observations_latest on rail_observations (rail_id, observed_at desc);
create trigger rail_observations_immutable before update or delete on rail_observations
 for each row execute function creator_reject_change();

create table finance_commitments (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 kind text not null check (kind in ('reserve','liability','tax')), label text not null,
 amount_nano numeric(30,0) not null check (amount_nano > 0),
 status text not null check (status in ('open','closed')),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(), closed_at timestamptz,
 check ((status = 'closed') = (closed_at is not null))
);

create table reinvestment_allocations (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 policy_version integer not null, period_start timestamptz not null,
 requested_nano numeric(30,0) not null check (requested_nano > 0),
 amount_nano numeric(30,0) not null check (amount_nano > 0 and amount_nano <= requested_nano),
 envelope_id uuid not null references budget_envelopes(id), capacity jsonb not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, policy_version) references reinvestment_policies (workspace_id, version)
);
create trigger reinvestment_allocations_immutable before update or delete on reinvestment_allocations
 for each row execute function creator_reject_change();
-- Envelopes funded from an allocation, including successors left after a reclaim.
create table reinvestment_envelopes (
 envelope_id uuid primary key references budget_envelopes(id),
 allocation_id uuid not null references reinvestment_allocations(id),
 replaces uuid references budget_envelopes(id),
 created_at timestamptz not null default clock_timestamp()
);
create trigger reinvestment_envelopes_immutable before update or delete on reinvestment_envelopes
 for each row execute function creator_reject_change();
-- Losses that hit earnings already reinvested. Outstanding = amount - reclaimed - repaid;
-- while any is outstanding, new allocations are refused.
create table reinvestment_losses (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 tranche_id uuid not null references earnings_tranches(id),
 amount_nano numeric(30,0) not null check (amount_nano > 0),
 reclaimed_nano numeric(30,0) not null default 0 check (reclaimed_nano >= 0),
 repaid_nano numeric(30,0) not null default 0 check (repaid_nano >= 0),
 created_at timestamptz not null default clock_timestamp(),
 check (reclaimed_nano + repaid_nano <= amount_nano)
);
create function creator_loss_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or new.reclaimed_nano < old.reclaimed_nano
     or new.repaid_nano < old.repaid_nano
     or (new.id, new.workspace_id, new.tranche_id, new.amount_nano, new.created_at)
        is distinct from (old.id, old.workspace_id, old.tranche_id, old.amount_nano,
         old.created_at) then
    raise exception 'reinvestment loss change refused' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger reinvestment_losses_guard before update or delete on reinvestment_losses
 for each row execute function creator_loss_guard();
-- Each use of a tranche, by an allocation or to repay a loss; a tranche is consumed once.
create table tranche_uses (
 id uuid primary key, tranche_id uuid not null references earnings_tranches(id),
 allocation_id uuid references reinvestment_allocations(id),
 loss_id uuid references reinvestment_losses(id),
 amount_nano numeric(30,0) not null check (amount_nano > 0),
 created_at timestamptz not null default clock_timestamp(),
 check ((allocation_id is null) <> (loss_id is null))
);
create trigger tranche_uses_immutable before update or delete on tranche_uses
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 20,
    name: 'unique_payment_funding_identity',
    sql: `
-- Economic identity survives revocation: a new connection must not book the same
-- Stripe account's charges again. Duplicate existing identities require explicit
-- reconciliation; fail migration rather than rewriting immutable financial history.
create unique index payment_stripe_account_once on payment_connections ((body->>'account_id'))
 where body->>'processor' = 'stripe';
create unique index funding_processor_once on funding_rails (connection_id)
 where kind = 'processor_balance';
`,
  },
  {
    version: 21,
    name: 'bounded_fixture_marketing',
    sql: `
create table marketing_campaigns (
 id uuid primary key, workspace_id uuid not null references workspaces(id),
 artifact_id uuid not null references artifact_manifests(id),
 request jsonb not null, content jsonb not null, content_hash char(64) not null,
 cancelled boolean not null default false,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(), unique(workspace_id,id)
);
create table marketing_grants (
 id uuid primary key, workspace_id uuid not null, campaign_id uuid not null,
 content_hash char(64) not null, expires_at timestamptz not null,
 max_deliveries integer not null check(max_deliveries between 1 and 100),
 used integer not null default 0 check(used >= 0 and used <= max_deliveries),
 revoked boolean not null default false, rationale text not null,
 budget_nano numeric(30,0) not null check(budget_nano = 0),
 created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,campaign_id) references marketing_campaigns(workspace_id,id), unique(workspace_id,id)
);
create table marketing_suppressions (
 workspace_id uuid not null references workspaces(id), recipient text not null,
 reason text not null, created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(), primary key(workspace_id,recipient)
);
create table marketing_deliveries (
 id uuid primary key, workspace_id uuid not null, campaign_id uuid not null,
 grant_id uuid not null, recipient text not null, content_hash char(64) not null,
 state text not null check(state in ('dispatching','unknown','delivered','failed','suppressed')),
 simulation text not null, native_id text, reason text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,campaign_id) references marketing_campaigns(workspace_id,id),
 foreign key(workspace_id,grant_id) references marketing_grants(workspace_id,id),
 unique(campaign_id,recipient), unique(workspace_id,id)
);
-- Native inbox of the local fixture adapter, not evidence of external delivery.
create table marketing_fixture_receipts (
 delivery_id uuid primary key references marketing_deliveries(id), native_id text not null unique,
 outcome text not null check(outcome in ('delivered','failed','suppressed')),
 content_hash char(64) not null, reason text not null, created_at timestamptz not null default clock_timestamp()
);
create table marketing_observations (
 id uuid primary key, workspace_id uuid not null, campaign_id uuid not null,
 delivery_id uuid not null, event_key text not null, metric text not null,
 note text not null, created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,campaign_id) references marketing_campaigns(workspace_id,id),
 foreign key(workspace_id,delivery_id) references marketing_deliveries(workspace_id,id),
 unique(campaign_id,event_key), unique(delivery_id,metric)
);
create trigger marketing_receipts_immutable before update or delete on marketing_fixture_receipts
 for each row execute function creator_reject_change();
create trigger marketing_observations_immutable before update or delete on marketing_observations
 for each row execute function creator_reject_change();
create trigger marketing_suppressions_immutable before update or delete on marketing_suppressions
 for each row execute function creator_reject_change();
create function creator_marketing_content_guard() returns trigger language plpgsql as $$
begin
 if tg_op = 'DELETE' or (new.id,new.workspace_id,new.artifact_id,new.request,new.content,new.content_hash,new.created_by,new.created_at)
 is distinct from (old.id,old.workspace_id,old.artifact_id,old.request,old.content,old.content_hash,old.created_by,old.created_at)
 or (old.cancelled and not new.cancelled) then
 raise exception 'immutable marketing content' using errcode = '23514';
 end if;
 return new;
end $$;
create trigger marketing_content_immutable before update or delete on marketing_campaigns
 for each row execute function creator_marketing_content_guard();
`,
  },
  {
    version: 22,
    name: 'portfolio_scheduling_and_reviewed_knowledge',
    sql: `
create table portfolio_policies (
 workspace_id uuid primary key references workspaces(id), version integer not null check(version>0),
 body jsonb not null, next_tick_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references actors(id), updated_at timestamptz not null default clock_timestamp()
);
create table portfolio_run_lanes (
 workspace_id uuid not null, run_id uuid not null, lane text not null check(lane in ('maintenance','improvement','exploration')),
 rationale text not null, created_by uuid not null references actors(id), created_at timestamptz not null default clock_timestamp(),
 primary key(workspace_id,run_id),foreign key(workspace_id,run_id) references run_controls(workspace_id,run_id)
);
create trigger portfolio_lanes_immutable before update or delete on portfolio_run_lanes for each row execute function creator_reject_change();
create table portfolio_schedules (
 id uuid primary key,workspace_id uuid not null,run_id uuid not null,
 lane text not null check(lane in ('maintenance','improvement','exploration')),
 body jsonb not null,body_hash char(64) not null,next_due_at timestamptz not null,
 cancelled boolean not null default false,created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),unique(workspace_id,id),unique(workspace_id,run_id),
 foreign key(workspace_id,run_id) references portfolio_run_lanes(workspace_id,run_id)
);
create table portfolio_jobs (
 id uuid primary key,workspace_id uuid not null,schedule_id uuid not null,run_id uuid not null,
 lane text not null,slot_at timestamptz not null,body_hash char(64) not null,
 state text not null check(state in ('dispatching','unknown','succeeded','failed','cancelled')),
 result jsonb,created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 foreign key(workspace_id,schedule_id) references portfolio_schedules(workspace_id,id),
 unique(schedule_id,slot_at),unique(workspace_id,id)
);
create unique index portfolio_one_open_job on portfolio_jobs(schedule_id) where state in ('dispatching','unknown');
create index portfolio_jobs_state on portfolio_jobs(workspace_id,state);
create table portfolio_health (
 workspace_id uuid not null references workspaces(id),artifact_id uuid not null references artifact_manifests(id),
 job_id uuid not null references portfolio_jobs(id),state text not null,report jsonb not null,
 observed_at timestamptz not null default clock_timestamp(),primary key(workspace_id,artifact_id)
);
create table reusable_knowledge (
 id uuid primary key,workspace_id uuid not null references workspaces(id),key text not null,version integer not null,
 body jsonb not null,body_hash char(64) not null,status text not null check(status in ('proposed','reviewed','revoked')),
 created_by uuid not null references actors(id),created_at timestamptz not null default clock_timestamp(),
 unique(workspace_id,key,version),unique(workspace_id,id)
);
create table knowledge_regressions (
 id uuid primary key,workspace_id uuid not null,candidate_id uuid not null,body_hash char(64) not null,
 verifier_version text not null,checks jsonb not null,passed boolean not null,
 created_by uuid not null references actors(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,candidate_id) references reusable_knowledge(workspace_id,id)
);
create trigger knowledge_regressions_immutable before update or delete on knowledge_regressions for each row execute function creator_reject_change();
create table knowledge_heads (
 workspace_id uuid not null references workspaces(id),key text not null,candidate_id uuid not null,
 primary key(workspace_id,key),foreign key(workspace_id,candidate_id) references reusable_knowledge(workspace_id,id)
);
create table workflow_knowledge (
 workspace_id uuid not null,workflow_id uuid not null references workflows(id),candidate_id uuid not null,
 body_hash char(64) not null,primary key(workflow_id,candidate_id),
 foreign key(workspace_id,candidate_id) references reusable_knowledge(workspace_id,id)
);
create trigger workflow_knowledge_immutable before update or delete on workflow_knowledge for each row execute function creator_reject_change();
create function creator_portfolio_schedule_guard() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' or (new.id,new.workspace_id,new.run_id,new.lane,new.body,new.body_hash,new.created_by,new.created_at)
 is distinct from (old.id,old.workspace_id,old.run_id,old.lane,old.body,old.body_hash,old.created_by,old.created_at)
 or (old.cancelled and not new.cancelled) then raise exception 'immutable schedule' using errcode='23514';end if;
 return new;
end $$;
create trigger portfolio_schedule_guard before update or delete on portfolio_schedules for each row execute function creator_portfolio_schedule_guard();
create function creator_knowledge_guard() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' or (new.id,new.workspace_id,new.key,new.version,new.body,new.body_hash,new.created_by,new.created_at)
 is distinct from (old.id,old.workspace_id,old.key,old.version,old.body,old.body_hash,old.created_by,old.created_at)
 or not ((old.status='proposed' and new.status in ('reviewed','revoked')) or (old.status='reviewed' and new.status='revoked'))
 then raise exception 'immutable knowledge candidate' using errcode='23514';end if;return new;
end $$;
create trigger knowledge_guard before update or delete on reusable_knowledge for each row execute function creator_knowledge_guard();
`,
  },
  {
    version: 23,
    name: 'pairing_visitors_scheduler_state_portfolio_reinvestment',
    sql: `
-- Owner decisions 2026-10-20. Pairing requests remember a one-way hash of the visitor's
-- address so one visitor cannot use up the server's pairing allowance.
alter table desktop_challenges add column visitor_hash char(64);
create index desktop_challenges_visitor on desktop_challenges(visitor_hash, created_at);
create index desktop_challenges_created on desktop_challenges(created_at);
-- Portfolio scheduler: the current state per scope ('sweep' or a workspace id) and an
-- append-only failure history. Retries are bounded; a stopped scope waits for the owner.
create table portfolio_scheduler_state (
 scope text primary key, workspace_id uuid references workspaces(id),
 last_attempt_at timestamptz, last_success_at timestamptz,
 last_error_code text, last_error text,
 consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
 next_retry_at timestamptz, stopped_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
create table portfolio_scheduler_failures (
 sequence bigint generated always as identity primary key,
 scope text not null, workspace_id uuid references workspaces(id),
 error_code text not null, error text not null, consecutive_failures integer not null,
 stopped boolean not null, created_at timestamptz not null default clock_timestamp()
);
create trigger portfolio_scheduler_failures_immutable before update or delete on portfolio_scheduler_failures
 for each row execute function creator_reject_change();
-- Reinvested earnings reach a portfolio only through an owner's explicit allocation to it.
-- One row per allocation, so the same money cannot be assigned twice.
create table reinvestment_portfolio_allocations (
 allocation_id uuid primary key references reinvestment_allocations(id),
 workspace_id uuid not null references workspaces(id),
 portfolio_policy_version integer not null,
 created_at timestamptz not null default clock_timestamp()
);
create trigger reinvestment_portfolio_allocations_immutable before update or delete on reinvestment_portfolio_allocations
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 24,
    name: 'payment_observation_fences_and_batch_file_cleanup',
    sql: `
alter table payment_connections add column observation_epoch bigint not null default 0;
create table context_batch_files (
 batch_id uuid not null references context_batches(id), file_id text not null,
 created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz,
 primary key(batch_id,file_id), check(length(file_id) between 1 and 200)
);
`,
  },
  {
    version: 25,
    name: 'public_search_provider',
    sql: `
alter table pricing_snapshots drop constraint pricing_snapshots_provider_check;
alter table pricing_snapshots add constraint pricing_snapshots_provider_check check (provider in ('fixture','openai','brave'));
alter table budget_reservations drop constraint budget_reservations_provider_check;
alter table budget_reservations add constraint budget_reservations_provider_check check (provider in ('fixture','openai','brave'));
`,
  },
  {
    // §2.2/§2.4 ChatGPT-plan connections. No token is stored here: credential_ref names a
    // vault entry held by the studio process. Sign-in, model access and qualification are
    // separate tables so one can never stand in for another.
    version: 26,
    name: 'chatgpt_plan_connections',
    sql: `
create table plan_connections (
 id uuid primary key, workspace_id uuid not null, fixture boolean not null,
 version integer not null check (version >= 1),
 label text not null check (length(label) between 1 and 80),
 settings jsonb not null, settings_hash char(64) not null,
 caps_accepted_at timestamptz, caps_accepted_by uuid references actors(id),
 ext_agent_host_id text not null check (ext_agent_host_id ~ '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
 sign_in jsonb not null, credits jsonb not null, eligibility jsonb not null, quota jsonb not null,
 credential_ref text check (credential_ref is null or credential_ref ~ '^chatgpt-plan/[0-9a-f-]{36}$'),
 status_reason text,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, label)
);
create table plan_model_access (
 connection_id uuid not null references plan_connections(id),
 model_id text not null check (length(model_id) between 1 and 200),
 path text not null check (path in ('responses','codex')),
 access text not null check (access in ('verified','refused')),
 reason_code text, request_id uuid not null,
 verified_at timestamptz not null default clock_timestamp(),
 primary key (connection_id, model_id, path)
);
create table plan_verification_grants (
 id uuid primary key, connection_id uuid not null references plan_connections(id),
 model_id text not null, path text not null check (path in ('responses','codex')),
 max_requests integer not null check (max_requests = 1),
 used integer not null default 0 check (used between 0 and 1),
 expires_at timestamptz not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp()
);
create table plan_qualifications (
 id uuid primary key, connection_id uuid not null references plan_connections(id),
 model_id text not null, task_class text not null,
 manifest jsonb not null, manifest_hash char(64) not null,
 min_held_out_cases integer not null check (min_held_out_cases >= 3),
 floor jsonb not null,
 state text not null check (state in ('running','qualified','failed','abandoned')),
 development jsonb not null, held_out jsonb not null, reason text,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 decided_at timestamptz
);
create unique index plan_qualifications_one_running on plan_qualifications (connection_id, model_id, task_class) where state = 'running';
create table plan_requests (
 id uuid primary key, connection_id uuid not null references plan_connections(id),
 logical_operation_id uuid not null unique,
 path text not null check (path in ('responses','codex')),
 purpose text not null check (purpose in ('verification','qualification','task','codex_build')),
 model_id text not null, task_class text, data_class text not null,
 run_id uuid, build_id uuid, grant_id uuid references plan_verification_grants(id),
 qualification_id uuid references plan_qualifications(id), case_id text, case_split text check (case_split is null or case_split in ('development','held_out')), signal text,
 state text not null check (state in ('in_flight','completed','failed','rejected','unknown','reconciled')),
 reason_code text, upstream_request_id text,
 output_tokens bigint check (output_tokens is null or output_tokens >= 0),
 output_chars bigint check (output_chars is null or output_chars >= 0),
 output_hash char(64),
 created_by uuid not null references actors(id),
 started_at timestamptz not null default clock_timestamp(), finished_at timestamptz
);
create index plan_requests_window on plan_requests (connection_id, started_at);
create unique index plan_requests_one_case on plan_requests (qualification_id, case_id) where qualification_id is not null;
create table plan_connection_events (
 id uuid primary key, connection_id uuid not null references plan_connections(id),
 kind text not null check (length(kind) between 1 and 80), body jsonb not null,
 actor_id uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp()
);
create trigger plan_connection_events_immutable before update or delete on plan_connection_events
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 27,
    name: 'workflow_subscription_resources',
    sql: `
alter table workflows alter column envelope_id drop not null;
alter table workflows alter column pricing_snapshot_id drop not null;
alter table workflows add column resource_setup jsonb;
alter table workflows add constraint workflows_resource_shape check (
 coalesce((resource_setup is null and envelope_id is not null and pricing_snapshot_id is not null)
 or (resource_setup->>'kind' = 'api' and envelope_id is not null and pricing_snapshot_id is not null)
 or (resource_setup->>'kind' = 'subscription' and envelope_id is null and pricing_snapshot_id is null), false)
);
create function creator_workflow_resources_fixed() returns trigger language plpgsql as $$
begin
 if new.resource_setup is distinct from old.resource_setup then
  raise exception 'workflow resource setup is immutable' using errcode = 'P0001';
 end if;
 return new;
end $$;
create trigger workflows_resources_fixed before update on workflows
 for each row execute function creator_workflow_resources_fixed();
alter table plan_requests add column workflow_task_id uuid references workflow_tasks(id);
alter table plan_requests add column input_hash char(64);
alter table plan_requests add column output_text text;
create unique index plan_requests_workflow_task on plan_requests(workflow_task_id) where workflow_task_id is not null;
`,
  },
  {
    version: 28,
    name: 'plan_availability_recheck_grants',
    sql: `
alter table plan_verification_grants add column intent text not null default 'model_access'
 check (intent in ('model_access','availability_recheck'));
alter table plan_requests drop constraint plan_requests_purpose_check;
alter table plan_requests add constraint plan_requests_purpose_check
 check (purpose in ('verification','availability_recheck','qualification','task','codex_build'));
`,
  },
  {
    version: 29,
    name: 'theme_intent_drafts',
    sql: `
alter table entities drop constraint entities_kind_check;
alter table entities add constraint entities_kind_check check (kind in ('source',
  'claim', 'problem', 'idea', 'alternative', 'assessment', 'product',
  'specification', 'run', 'task', 'decision', 'grant', 'artifact', 'assumption',
  'humility_review', 'search_brief', 'scorecard', 'theme_intent'));
`,
  },
  {
    version: 30,
    name: 'runtime_ceiling_changes',
    sql: `
create table runtime_ceiling_changes (
 version integer primary key check (version > 0),
 ceiling_nano numeric(30,0) not null check (ceiling_nano >= 0),
 previous_nano numeric(30,0) not null check (previous_nano >= 0),
 reason text not null check (length(reason) between 1 and 1200),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp()
);
create trigger runtime_ceiling_changes_immutable before update or delete on runtime_ceiling_changes
 for each row execute function creator_reject_change();
`,
  },
  {
    version: 31,
    name: 'runtime_limit_changes',
    sql: `
create table runtime_limit_changes (
 version integer primary key check (version > 0),
 limits jsonb not null check (jsonb_typeof(limits) = 'object'),
 previous jsonb not null check (jsonb_typeof(previous) = 'object'),
 reason text not null check (length(reason) between 1 and 1200),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp()
);
create trigger runtime_limit_changes_immutable before update or delete on runtime_limit_changes
 for each row execute function creator_reject_change();
create index budget_reservations_model_spend on budget_reservations (provider, model_id, created_at)
 where not fixture;
`,
  },
  {
    // ADR-0050: a plan connection is either a ChatGPT plan (studio-held OAuth token in the
    // vault) or the owner's own signed-in Claude Code CLI, which never gives the studio a
    // credential. The kind is fixed for the life of the connection.
    version: 32,
    name: 'plan_connection_kinds',
    sql: `
alter table plan_connections add column kind text not null default 'chatgpt_plan'
 check (kind in ('chatgpt_plan','claude_code'));
alter table plan_connections add constraint plan_connections_claude_code_no_credential
 check (kind = 'chatgpt_plan' or credential_ref is null);
create function creator_plan_connection_kind_fixed() returns trigger language plpgsql as $$
begin
 if new.kind is distinct from old.kind then
  raise exception 'plan connection kind is immutable' using errcode = 'P0001';
 end if;
 return new;
end $$;
create trigger plan_connections_kind_fixed before update on plan_connections
 for each row execute function creator_plan_connection_kind_fixed();
`,
  },
  {
    // ADR-0054: one owner approval per build of a frozen spec. The row is written in the same
    // transaction as the build's single product.commit_build admission and never changes; the
    // requests it covers are counted from plan_requests.build_id.
    version: 33,
    name: 'build_approvals',
    sql: `
create table build_approvals (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 run_id uuid not null,
 product_id uuid not null,
 task_id uuid not null,
 spec_id uuid not null,
 spec_version integer not null check (spec_version >= 1),
 spec_hash char(64) not null,
 plan_hash char(64) not null,
 route text not null check (route in ('broker','codex_plan','plan_roles')),
 connection_id uuid,
 model_id text,
 data_class text not null check (data_class in ('synthetic','public','private_approved')),
 request_limit integer not null check (request_limit between 2 and 6),
 max_repairs integer not null check (max_repairs between 0 and 2),
 humility_review_id uuid not null,
 humility_review_version integer not null check (humility_review_version >= 1),
 admission_id uuid not null unique references action_admissions(id),
 grant_id uuid not null references grants(id),
 grant_version integer not null check (grant_version >= 1),
 decision_id uuid,
 expires_at timestamptz not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 check ((route = 'plan_roles') = (connection_id is not null and model_id is not null))
);
create trigger build_approvals_immutable before update or delete on build_approvals
 for each row execute function creator_reject_change();
-- The scope a build asked the person to approve, keyed by the decision it raised. A one-time
-- grant from that decision admits only a build within this scope (review M-1).
create table build_approval_asks (
 decision_id uuid primary key references decision_requests(id),
 workspace_id uuid not null references workspaces(id),
 route text not null check (route in ('broker','codex_plan','plan_roles')),
 connection_id uuid,
 model_id text,
 request_limit integer not null check (request_limit between 2 and 6),
 max_repairs integer not null check (max_repairs between 0 and 2),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 check ((route = 'plan_roles') = (connection_id is not null and model_id is not null))
);
create trigger build_approval_asks_immutable before update or delete on build_approval_asks
 for each row execute function creator_reject_change();
create index plan_requests_build on plan_requests (build_id) where build_id is not null;
`,
  },
  {
    // ADR-0055: the studio chat's first version. Conversations are per workspace; messages are
    // the person's own words, never changed after they are written, with the intent the
    // server's fixed rules gave them. No model output and no authority is stored here.
    version: 34,
    name: 'studio_chat',
    sql: `
create table chat_conversations (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 title text not null check (length(title) between 1 and 120),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique (workspace_id, id)
);
create index chat_conversations_recent on chat_conversations (workspace_id, updated_at desc);
create table chat_messages (
 id uuid primary key,
 workspace_id uuid not null,
 conversation_id uuid not null,
 seq integer not null check (seq >= 1),
 client_id uuid not null,
 author_id uuid not null references actors(id),
 text text not null check (length(text) between 1 and 4000),
 intent text not null check (intent in
  ('next','why_blocked','add_source','save_idea','start_discovery','approvals','note')),
 target jsonb not null check (jsonb_typeof(target) = 'object'),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, conversation_id) references chat_conversations (workspace_id, id),
 unique (conversation_id, seq),
 unique (conversation_id, client_id)
);
create trigger chat_messages_immutable before update or delete on chat_messages
 for each row execute function creator_reject_change();
`,
  },
  {
    // ADR-0056: the owner's evidence websites, per workspace. Each change is an immutable row
    // naming the version it replaced, with its reason and audit event. The latest row is the
    // list in force; with none, the list the studio started with applies.
    version: 35,
    name: 'evidence_site_changes',
    sql: `
create table evidence_site_changes (
 workspace_id uuid not null references workspaces(id),
 version integer not null check (version > 0),
 mode text not null check (mode in ('listed','any_public')),
 hosts jsonb not null check (jsonb_typeof(hosts) = 'array' and jsonb_array_length(hosts) <= 100),
 previous_mode text not null check (previous_mode in ('listed','any_public')),
 previous_hosts jsonb not null check (jsonb_typeof(previous_hosts) = 'array'),
 reason text not null check (length(reason) between 1 and 1200),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, version)
);
create trigger evidence_site_changes_immutable before update or delete on evidence_site_changes
 for each row execute function creator_reject_change();
`,
  },
  {
    // ADR-0057: chat answers from a connected plan. One owner setting per workspace; each
    // answer keeps exactly what was sent and what came back. An answer row can only move once,
    // from pending to its outcome, and is never deleted. Plan requests gain the purpose `chat`.
    version: 36,
    name: 'chat_plan_answers',
    sql: `
alter table plan_requests drop constraint plan_requests_purpose_check;
alter table plan_requests add constraint plan_requests_purpose_check
 check (purpose in ('verification','availability_recheck','qualification','task','codex_build','chat'));
create index plan_requests_chat on plan_requests (connection_id, started_at) where purpose = 'chat';
create table chat_settings (
 workspace_id uuid primary key references workspaces(id),
 enabled boolean not null,
 connection_id uuid references plan_connections(id),
 model_id text check (model_id is null or length(model_id) between 1 and 120),
 include_snapshot boolean not null,
 daily_limit integer not null check (daily_limit between 1 and 100),
 version integer not null check (version >= 1),
 updated_by uuid not null references actors(id),
 updated_at timestamptz not null default clock_timestamp(),
 check (not enabled or (connection_id is not null and model_id is not null))
);
create table chat_answers (
 id uuid primary key,
 workspace_id uuid not null,
 conversation_id uuid not null,
 message_id uuid not null references chat_messages(id),
 client_id uuid not null,
 state text not null check (state in ('pending','completed','failed','refused')),
 connection_id uuid not null references plan_connections(id),
 connection_kind text not null check (connection_kind in ('chatgpt_plan','claude_code')),
 fixture boolean not null,
 model_id text not null,
 logical_operation_id uuid not null unique,
 plan_request_id uuid references plan_requests(id),
 instructions_version text not null,
 instructions_hash char(64) not null,
 history_items integer not null check (history_items >= 0),
 snapshot boolean not null,
 input text not null,
 input_hash char(64) not null,
 text text,
 output_hash char(64),
 reason text check (reason is null or length(reason) <= 2000),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 foreign key (workspace_id, conversation_id) references chat_conversations (workspace_id, id),
 unique (message_id, client_id),
 check ((state = 'completed') = (text is not null and output_hash is not null)),
 check ((state = 'pending') = (finished_at is null))
);
create unique index chat_answers_one_live on chat_answers (message_id)
 where state in ('pending','completed');
create index chat_answers_conversation on chat_answers (conversation_id, created_at);
create function chat_answers_settle_once() returns trigger language plpgsql as $$
begin
 if tg_op = 'DELETE' or old.state <> 'pending' or new.state = 'pending'
   or (to_jsonb(new) - array['state','plan_request_id','text','output_hash','reason','finished_at'])
      is distinct from (to_jsonb(old) - array['state','plan_request_id','text','output_hash','reason','finished_at'])
 then
   raise exception 'chat answers change only once, from pending to their outcome'
     using errcode = 'P0001';
 end if;
 return new;
end $$;
create trigger chat_answers_settle_once before update or delete on chat_answers
 for each row execute function chat_answers_settle_once();
`,
  },
  {
    // ADR-0060: the right-hand sidebar's notepad. One note per person per workspace; only its
    // author reads or writes it. Each save bumps the version so a stale window cannot overwrite
    // newer text unnoticed. Notes are private scratch: no audit event, never sent to a model.
    // They go with their workspace or person (cascade) and when the person leaves the workspace.
    version: 37,
    name: 'workspace_notes',
    sql: `
create table workspace_notes (
 workspace_id uuid not null references workspaces(id) on delete cascade,
 actor_id uuid not null references actors(id) on delete cascade,
 text text not null check (length(text) <= 100000),
 version integer not null check (version >= 1),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, actor_id)
);
`,
  },
  {
    // ADR-0062: owner-set caps and limits have no upper limit. The chat answers-a-day limit
    // was capped at 100; it now only has to be at least 1 (the integer column still bounds it).
    version: 38,
    name: 'chat_daily_limit_uncapped',
    sql: `
alter table chat_settings drop constraint chat_settings_daily_limit_check;
alter table chat_settings add constraint chat_settings_daily_limit_check check (daily_limit >= 1);
`,
  },
  {
    // ADR-0063: a chat conversation can be deleted. Messages and answers still never change,
    // and one cannot be deleted on its own: a row may go only once its conversation is gone,
    // which happens through the cascade from deleting the conversation. Plan requests keep no
    // words and stay, so usage counts and daily limits do not change.
    version: 39,
    name: 'chat_conversation_delete',
    sql: `
alter table chat_messages drop constraint chat_messages_workspace_id_conversation_id_fkey;
alter table chat_messages add constraint chat_messages_workspace_id_conversation_id_fkey
 foreign key (workspace_id, conversation_id) references chat_conversations (workspace_id, id)
 on delete cascade;
alter table chat_answers drop constraint chat_answers_workspace_id_conversation_id_fkey;
alter table chat_answers add constraint chat_answers_workspace_id_conversation_id_fkey
 foreign key (workspace_id, conversation_id) references chat_conversations (workspace_id, id)
 on delete cascade;
alter table chat_answers drop constraint chat_answers_message_id_fkey;
alter table chat_answers add constraint chat_answers_message_id_fkey
 foreign key (message_id) references chat_messages (id) on delete cascade;
drop trigger chat_messages_immutable on chat_messages;
create function chat_messages_guard() returns trigger language plpgsql as $$
begin
 if tg_op = 'DELETE' and not exists
   (select 1 from chat_conversations where id = old.conversation_id) then
   return old;
 end if;
 raise exception 'chat messages never change and go only with their conversation'
   using errcode = 'P0001';
end $$;
create trigger chat_messages_guard before update or delete on chat_messages
 for each row execute function chat_messages_guard();
create or replace function chat_answers_settle_once() returns trigger language plpgsql as $$
begin
 if tg_op = 'DELETE' and not exists
   (select 1 from chat_conversations where id = old.conversation_id) then
   return old;
 end if;
 if tg_op = 'DELETE' or old.state <> 'pending' or new.state = 'pending'
   or (to_jsonb(new) - array['state','plan_request_id','text','output_hash','reason','finished_at'])
      is distinct from (to_jsonb(old) - array['state','plan_request_id','text','output_hash','reason','finished_at'])
 then
   raise exception 'chat answers change only once, from pending to their outcome'
     using errcode = 'P0001';
 end if;
 return new;
end $$;
`,
  },
  {
    // ADR-0065 (C53): "Explore for me". Explorations reuse the T05 workflow tables with a third
    // role and one task kind; their subject is the run record they belong to.
    version: 40,
    name: 'exploration_workflows',
    sql: `
alter table workflows drop constraint workflows_role_check;
alter table workflows add constraint workflows_role_check
  check (role in ('r05_skeptic', 'r02_discovery', 'r01_exploration'));
alter table workflow_tasks drop constraint workflow_tasks_kind_check;
alter table workflow_tasks add constraint workflow_tasks_kind_check
  check (kind in ('critique', 'synthesis', 'locate', 'propose', 'skeptic', 'revise', 'explore'));
`,
  },
  {
    // Auth follow-up: session identity survives settings edits and token rotation.
    // Old requests have no binding; their outcomes remain counted but cannot invalidate a login.
    version: 41,
    name: 'plan_auth_generation',
    sql: `
alter table plan_connections add column auth_generation bigint not null default 0 check (auth_generation >= 0);
alter table plan_requests add column auth_generation bigint check (auth_generation >= 0);
alter table plan_requests add column credential_ref text;
`,
  },
  {
    // ADR-0070: chat context. Each message keeps the context the person chose (older messages
    // are 'auto') and the records they picked; each answer keeps the context actually used, why,
    // and which picked records were sent. Set once at insert, like the rest of both rows.
    version: 43,
    name: 'chat_context_scope',
    sql: `
alter table chat_messages add column scope text not null default 'auto'
  check (scope in ('auto','general','project','selected'));
alter table chat_messages add column selected uuid[] not null default '{}'
  check (cardinality(selected) <= 5);
alter table chat_messages add constraint chat_messages_selected_scope
  check ((scope = 'selected') = (cardinality(selected) > 0));
alter table chat_answers add column context text
  check (context in ('general','project','selected'));
alter table chat_answers add column context_reason text
  check (length(context_reason) <= 600);
alter table chat_answers add column context_records jsonb not null default '[]'
  check (jsonb_typeof(context_records) = 'array' and jsonb_array_length(context_records) <= 5);
`,
  },
  {
    // ADR-0069 (P07, migration 44): a preview is Timed (fixed expiry) or Until stopped (no expiry; it lives
    // while a preview page keeps a viewer heartbeat within its grace). Link tickets expire and
    // can be renewed; cleanup of runs cut off by Stop is recorded. Old rows stay Timed.
    version: 44,
    name: 'preview_lifetime',
    sql: `
alter table artifact_previews add column lifetime text not null default 'timed'
  check (lifetime in ('timed', 'until_stopped'));
alter table artifact_previews alter column expires_at drop not null;
alter table artifact_previews add column last_seen_at timestamptz;
alter table artifact_previews add column idle_grace_seconds integer
  check (idle_grace_seconds between 30 and 3600);
alter table artifact_previews add column ticket_expires_at timestamptz;
alter table artifact_previews add column cleanup text
  check (cleanup in ('none', 'cancelled', 'unknown'));
alter table artifact_previews add constraint artifact_previews_lifetime_shape check (
  (lifetime = 'timed' and expires_at is not null and idle_grace_seconds is null)
  or (lifetime = 'until_stopped' and expires_at is null and idle_grace_seconds is not null
      and last_seen_at is not null));
`,
  },
  {
    // ADR-0072 (P05): workspace files. Each version keeps its exact original bytes and their
    // SHA-256; versions never change (a trigger refuses updates other than purging). An upload
    // key makes a retried upload store once. Links tie a file to records of the same workspace.
    // Deleting hides a file; purging removes every version's bytes and the file row.
    version: 45,
    name: 'workspace_files',
    sql: `
create table workspace_files (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id) on delete cascade,
 name text not null check (length(name) between 1 and 200),
 status text not null default 'active' check (status in ('active', 'deleted')),
 current_version integer not null check (current_version >= 1),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 deleted_at timestamptz,
 check ((status = 'deleted') = (deleted_at is not null)),
 unique (workspace_id, id)
);
create index workspace_files_newest on workspace_files (workspace_id, status, created_at desc, id desc);
create table workspace_file_versions (
 workspace_id uuid not null,
 file_id uuid not null,
 version integer not null check (version >= 1),
 sha256 char(64) not null check (sha256 ~ '^[0-9a-f]{64}$'),
 size_bytes bigint not null check (size_bytes >= 0),
 kind text not null check (kind in ('text','markdown','json','csv','code','image','pdf','other')),
 media_type text not null check (length(media_type) <= 100),
 declared_type text check (length(declared_type) <= 200),
 original_name text not null check (length(original_name) <= 500),
 type_mismatch boolean not null,
 content bytea not null,
 text_content text,
 text_truncated boolean not null default false,
 upload_key uuid not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (file_id, version),
 foreign key (workspace_id, file_id) references workspace_files (workspace_id, id) on delete cascade,
 unique (workspace_id, upload_key),
 check (octet_length(content) = size_bytes)
);
create index workspace_file_versions_hash on workspace_file_versions (workspace_id, sha256);
create function workspace_file_versions_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'workspace file versions never change';
end $$;
create trigger workspace_file_versions_immutable before update on workspace_file_versions
 for each row execute function workspace_file_versions_immutable();
create table workspace_file_links (
 workspace_id uuid not null,
 file_id uuid not null,
 entity_id uuid not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (file_id, entity_id),
 foreign key (workspace_id, file_id) references workspace_files (workspace_id, id) on delete cascade,
 foreign key (entity_id) references entities (id) on delete cascade
);
create index workspace_file_links_entity on workspace_file_links (entity_id);
`,
    // That a linked record belongs to the file's workspace is checked by FileStore
    // (checkLinkTarget), not by a constraint: entities has no (workspace_id, id) key to refer
    // to (PR #141 review N8).
  },
  {
    // ADR-0073 (P06): named private notes. Each person keeps several notes per workspace; only
    // the author reads or writes them, and `version` counts text saves so a stale window cannot
    // overwrite newer text. Every existing notepad becomes a note named "Notes" with the same
    // text, version and time; workspace_notes is kept unchanged as the original.
    version: 46,
    name: 'personal_notes',
    sql: `
create table personal_notes (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id) on delete cascade,
 actor_id uuid not null references actors(id) on delete cascade,
 title text not null check (length(title) between 1 and 120),
 text text not null check (length(text) <= 100000),
 version integer not null check (version >= 1),
 status text not null default 'active' check (status in ('active', 'archived')),
 from_notepad boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index personal_notes_owner on personal_notes (workspace_id, actor_id, updated_at desc);
create unique index personal_notes_one_notepad on personal_notes (workspace_id, actor_id) where from_notepad;
insert into personal_notes (id, workspace_id, actor_id, title, text, version, from_notepad, created_at, updated_at)
 select gen_random_uuid(), workspace_id, actor_id, 'Notes', text, version, true, updated_at, updated_at
 from workspace_notes;
`,
  },
  {
    // ADR-0074 (P08): automatic assessments reuse the T05 workflow tables with a fourth role
    // and one task kind; their subject is the problem, pinned to the version assessed.
    version: 47,
    name: 'assessment_workflows',
    sql: `
alter table workflows drop constraint workflows_role_check;
alter table workflows add constraint workflows_role_check
  check (role in ('r05_skeptic', 'r02_discovery', 'r01_exploration', 'r08_assessment'));
alter table workflow_tasks drop constraint workflow_tasks_kind_check;
alter table workflow_tasks add constraint workflow_tasks_kind_check
  check (kind in ('critique', 'synthesis', 'locate', 'propose', 'skeptic', 'revise', 'explore', 'assess'));
`,
  },
  {
    // ADR-0075 (P11 G1/G2): tester accounts for a private committee review. Each allow-listed
    // (issuer, subject) pair signs in as its own person actor, never the owner's; an account
    // stops working at its expiry or when disabled. Each tester's sample workspaces are listed
    // so reset can retire one and seed another without deleting any audited record.
    version: 48,
    name: 'tester_accounts',
    sql: `
create table tester_accounts (
 actor_id uuid primary key references actors(id),
 issuer text not null check (length(issuer) between 1 and 500),
 subject text not null check (length(subject) between 1 and 255),
 workspace_role text not null check (workspace_role in ('editor', 'viewer')),
 expires_at timestamptz not null,
 disabled_at timestamptz,
 disabled_reason text check (disabled_reason is null or length(disabled_reason) between 1 and 200),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 unique (issuer, subject)
);
create table tester_workspaces (
 workspace_id uuid primary key references workspaces(id),
 actor_id uuid not null references tester_accounts(actor_id),
 created_at timestamptz not null default clock_timestamp(),
 retired_at timestamptz
);
create unique index tester_workspaces_current on tester_workspaces (actor_id) where retired_at is null;
`,
  },
  {
    // ADR-0077 (P09): versioned non-code proposals are entity records of a new kind, written
    // only through the proposal API. Each review is feedback bound to one exact version and
    // content hash; a later version leaves earlier reviews standing for the version they read.
    version: 49,
    name: 'proposals',
    sql: `
alter table entities drop constraint entities_kind_check;
alter table entities add constraint entities_kind_check check (kind in ('source',
  'claim', 'problem', 'idea', 'alternative', 'assessment', 'product',
  'specification', 'run', 'task', 'decision', 'grant', 'artifact', 'assumption',
  'humility_review', 'search_brief', 'scorecard', 'theme_intent', 'proposal'));
create table proposal_reviews (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 proposal_id uuid not null,
 proposal_version integer not null check (proposal_version > 0),
 content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
 verdict text not null check (verdict in ('ready', 'revise')),
 marks jsonb not null,
 comments text not null check (length(comments) <= 4000),
 reviewer uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, proposal_id) references entities (workspace_id, id),
 foreign key (proposal_id, proposal_version) references entity_versions (entity_id, version)
);
create index proposal_reviews_by_proposal on proposal_reviews (workspace_id, proposal_id, created_at);
create trigger proposal_reviews_append_only before update or delete on proposal_reviews
  for each row execute function creator_reject_change();
`,
  },
  {
    // ADR-0079 (P10): routine approvals. One active policy per run, set by its owner.
    // The policy owns one run-scoped standing grant that only the policy path of admission
    // uses; its limits and stop conditions live here. Every version is kept unchanged.
    version: 50,
    name: 'routine_policies',
    sql: `
create table routine_policies (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 run_id uuid not null,
 version integer not null check (version >= 1),
 status text not null check (status in ('active', 'revoked')),
 grant_id uuid not null unique references grants(id),
 grant_version integer not null check (grant_version >= 1),
 stages text[] not null check (cardinality(stages) >= 1 and stages <@ array['research',
   'model_work', 'selection', 'spec_freeze', 'build']),
 data_classes text[] not null check (cardinality(data_classes) >= 1),
 max_actions bigint not null check (max_actions >= 1),
 max_total_nano_usd numeric(30, 0) check (max_total_nano_usd >= 0),
 stop_on text[] not null check (stop_on <@ array['person_rejects', 'unknown_outcome']),
 expires_at timestamptz not null,
 rationale text not null,
 summary text[] not null,
 policy_version text not null,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 confirmed_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 revoke_reason text,
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 check ((status = 'revoked') = (revoked_at is not null))
);
-- A run has at most one active policy; revoked ones stay as history.
create unique index routine_policies_one_active on routine_policies (workspace_id, run_id)
  where status = 'active';
create table routine_policy_versions (
 policy_id uuid not null references routine_policies(id),
 version integer not null,
 snapshot jsonb not null,
 change text not null check (change in ('created', 'widened', 'narrowed', 'reconfirmed', 'revoked')),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (policy_id, version)
);
create trigger routine_policy_versions_append_only before update or delete
  on routine_policy_versions for each row execute function creator_reject_change();
create index action_admissions_by_grant on action_admissions (grant_id)
  where grant_id is not null;
`,
  },
  {
    // ADR-0081 (P21): the person's current plan connection and model per workspace, set from
    // the picker beside the usage indicator. Forms start from it; runs keep their own route.
    version: 51,
    name: 'model_choices',
    sql: `
create table model_choices (
 workspace_id uuid not null references workspaces(id),
 actor_id uuid not null references actors(id),
 connection_id uuid not null references plan_connections(id),
 model_id text not null check (length(model_id) between 1 and 200),
 version integer not null check (version >= 1),
 updated_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, actor_id)
);
`,
  },
  {
    // ADR-0082 (P19): each person's Standard/Advanced choice, app-wide, so it follows them
    // across browsers and devices. Presentation only: no permission, cap or gate reads it.
    version: 52,
    name: 'person_preferences',
    sql: `
create table person_preferences (
 actor_id uuid primary key references actors(id),
 view_mode text not null check (view_mode in ('standard', 'advanced')),
 version integer not null check (version >= 1),
 updated_at timestamptz not null default clock_timestamp()
);
`,
  },
  {
    // ADR-0083 (P20): action cards in Chat. A card holds the answers for one form, the record
    // versions it was made from and how its send ended. It is sent by the person's browser
    // through the form's own routes; the store only checks it is not stale, records who sent it
    // and counts the audit events that name the send as their cause. Cards go with their
    // conversation; the audit events stay.
    version: 53,
    name: 'chat_actions',
    sql: `
create table chat_actions (
 id uuid primary key,
 workspace_id uuid not null,
 conversation_id uuid not null,
 client_id uuid not null,
 message_id uuid references chat_messages(id) on delete cascade,
 answer_id uuid references chat_answers(id) on delete cascade,
 -- A card sent again with the same answers names the card it repeats (and keeps its origin).
 again_of uuid references chat_actions(id) on delete cascade,
 origin text not null check (origin in ('studio','model')),
 kind text not null check (kind in ('fund_budget','fetch_source','cite_claim','start_discovery',
   'answer_decision','score_option','record_choice','save_proposal')),
 input jsonb not null check (jsonb_typeof(input) = 'object'),
 subjects jsonb not null check (jsonb_typeof(subjects) = 'array'),
 state text not null check (state in ('draft','sending','done','refused','partial','unconfirmed',
   'stale','dismissed')),
 version integer not null check (version >= 1),
 reason text check (reason is null or length(reason) <= 2000),
 outcome jsonb,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 sent_by uuid references actors(id),
 sent_at timestamptz,
 sent_event_id uuid references audit_events(id),
 finished_at timestamptz,
 foreign key (workspace_id, conversation_id) references chat_conversations (workspace_id, id)
   on delete cascade,
 unique (conversation_id, client_id),
 check ((origin = 'model') = (answer_id is not null)),
 check ((state in ('sending','done','refused','partial','unconfirmed'))
   = (sent_event_id is not null and sent_by is not null and sent_at is not null)),
 check ((state in ('draft','sending')) = (finished_at is null))
);
create index chat_actions_conversation on chat_actions (conversation_id, created_at);
create unique index chat_actions_one_per_answer on chat_actions (answer_id)
 where answer_id is not null and again_of is null;
-- The events a card's send caused are counted by their causation id.
create index audit_events_by_causation on audit_events (workspace_id, causation_id)
 where causation_id is not null;
`,
  },
  {
    // ADR-0086 (P12): online discovery through the plan connection's own web search. One row
    // per discovery holds its scope, the search calls the provider reported, the leads and the
    // fetch outcome of each; proposed claims are rows so each is added or dismissed once. The
    // routine policy gains its evidence stage, and passages record page furniture.
    version: 54,
    name: 'web_discoveries',
    sql: `
create table web_discoveries (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 fixture boolean not null,
 run_id uuid not null,
 connection_id uuid not null references plan_connections(id),
 model_id text not null check (length(model_id) between 1 and 200),
 scope jsonb not null check (jsonb_typeof(scope) = 'object'),
 input_hash char(64) not null,
 policy_version text not null,
 state text not null check (state in ('searching','fetching','reading','done','failed',
   'cancelled','interrupted')),
 outcome text check (outcome in ('claims_found','no_verified_claims','no_search','no_leads',
   'nothing_fetchable')),
 explanation text not null default '' check (length(explanation) <= 1200),
 search_request_id uuid unique references plan_requests(id),
 read_request_id uuid unique references plan_requests(id),
 search_calls jsonb not null default '[]' check (jsonb_typeof(search_calls) = 'array'),
 draft_summary text check (length(draft_summary) <= 1200),
 leads jsonb not null default '[]' check (jsonb_typeof(leads) = 'array'),
 packet_hash char(64),
 not_covered jsonb not null default '[]' check (jsonb_typeof(not_covered) = 'array'),
 version integer not null check (version >= 1),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 unique (workspace_id, id),
 check ((state in ('done','failed','cancelled','interrupted')) = (finished_at is not null)),
 check ((state = 'done') = (outcome is not null))
);
create index web_discoveries_by_workspace on web_discoveries (workspace_id, created_at desc);
-- At most one discovery is working at a time in a workspace (PR #173 review N-2): each
-- start makes its own run, so a per-run limit would never apply.
create unique index web_discoveries_one_live on web_discoveries (workspace_id)
 where state in ('searching','fetching','reading');
create table web_discovery_claims (
 id uuid primary key,
 workspace_id uuid not null,
 discovery_id uuid not null,
 ordinal integer not null check (ordinal >= 0),
 proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
 proposal_hash char(64) not null,
 check_state text not null check (check_state in ('verified','unverified','excluded','duplicate')),
 decision text not null default 'pending' check (decision in ('pending','admitted','dismissed')),
 claim_id uuid,
 admitted_via text check (admitted_via in ('owner','routine_policy')),
 admission_id uuid references action_admissions(id),
 decided_by uuid references actors(id),
 decided_at timestamptz,
 decision_reason text check (length(decision_reason) <= 500),
 created_at timestamptz not null default clock_timestamp(),
 foreign key (workspace_id, discovery_id) references web_discoveries (workspace_id, id),
 foreign key (workspace_id, claim_id) references entities (workspace_id, id),
 unique (discovery_id, ordinal),
 check ((decision = 'admitted') = (claim_id is not null and admitted_via is not null)),
 check (decision <> 'admitted' or check_state = 'verified'),
 check ((decision = 'pending') = (decided_at is null)),
 check (admitted_via <> 'routine_policy' or admission_id is not null)
);
create index web_discovery_claims_by_discovery on web_discovery_claims (discovery_id, ordinal);
alter table routine_policies drop constraint routine_policies_stages_check;
alter table routine_policies add constraint routine_policies_stages_check
 check (cardinality(stages) >= 1 and stages <@ array['research', 'model_work', 'selection',
   'spec_freeze', 'build', 'evidence']);
alter table source_passages add column boilerplate boolean not null default false;
create or replace function creator_passage_change() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.source_id, new.source_version, new.ordinal,
      new.paragraph, new.char_start, new.char_end, new.text_hash, new.excerpt_truncated,
      new.passage_hash, new.instruction_like, new.retrieval_id, new.created_at, new.boilerplate)
     is distinct from
      (old.id, old.workspace_id, old.source_id, old.source_version, old.ordinal,
      old.paragraph, old.char_start, old.char_end, old.text_hash, old.excerpt_truncated,
      old.passage_hash, old.instruction_like, old.retrieval_id, old.created_at, old.boilerplate)
     or new.excerpt is not null and new.excerpt is distinct from old.excerpt then
    raise exception 'passages only lose their excerpt (redaction)' using errcode = 'P0001';
  end if;
  return new;
end $$;
-- PR #173 review L-5: what a discovery was started with and what it found stay as recorded.
-- Only the forward state fields change: search calls while searching, leads while searching or
-- fetching, each request id once, and nothing after a finished state except the explanation.
create function creator_web_discovery_change() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.fixture, new.run_id, new.connection_id, new.model_id,
      new.scope, new.input_hash, new.policy_version, new.created_by, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.fixture, old.run_id, old.connection_id, old.model_id,
      old.scope, old.input_hash, old.policy_version, old.created_by, old.created_at) then
    raise exception 'a web discovery keeps what it was started with' using errcode = 'P0001';
  end if;
  if old.state in ('done','failed','cancelled','interrupted') and
     (new.state, new.outcome, new.search_calls, new.draft_summary, new.leads, new.packet_hash,
      new.not_covered, new.finished_at, new.search_request_id, new.read_request_id)
     is distinct from
     (old.state, old.outcome, old.search_calls, old.draft_summary, old.leads, old.packet_hash,
      old.not_covered, old.finished_at, old.search_request_id, old.read_request_id) then
    raise exception 'a finished web discovery is not changed' using errcode = 'P0001';
  end if;
  if old.state <> 'searching' and (new.search_calls, new.draft_summary)
     is distinct from (old.search_calls, old.draft_summary) then
    raise exception 'search calls are recorded once' using errcode = 'P0001';
  end if;
  if old.state not in ('searching','fetching') and new.leads is distinct from old.leads then
    raise exception 'leads are recorded once' using errcode = 'P0001';
  end if;
  if (old.search_request_id is not null and new.search_request_id is distinct from old.search_request_id)
     or (old.read_request_id is not null and new.read_request_id is distinct from old.read_request_id)
     or (old.packet_hash is not null and new.packet_hash is distinct from old.packet_hash) then
    raise exception 'request ids are recorded once' using errcode = 'P0001';
  end if;
  if new.version <= old.version then
    raise exception 'web discovery versions only increase' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger web_discoveries_guard before update on web_discoveries
  for each row execute function creator_web_discovery_change();
create trigger web_discoveries_no_delete before delete on web_discoveries
  for each row execute function creator_reject_change();
-- A proposal is decided once; only its decision columns change, and only from pending.
create function creator_web_claim_change() returns trigger language plpgsql as $$
begin
  if (new.id, new.workspace_id, new.discovery_id, new.ordinal, new.proposal,
      new.proposal_hash, new.check_state, new.created_at)
     is distinct from
     (old.id, old.workspace_id, old.discovery_id, old.ordinal, old.proposal,
      old.proposal_hash, old.check_state, old.created_at)
     or old.decision <> 'pending' then
    raise exception 'a proposed claim is decided once and otherwise kept as proposed'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger web_discovery_claims_guard before update on web_discovery_claims
  for each row execute function creator_web_claim_change();
create trigger web_discovery_claims_no_delete before delete on web_discovery_claims
  for each row execute function creator_reject_change();
`,
  },
  {
    // ADR-0088 (P24): several qualifications of one model, run one after another by the studio
    // so the person can leave the page. One running queue per connection. An item's
    // qualification is started when its turn comes, in the same transaction that links it here,
    // so a restart between two runs starts the next one once. The lease says which studio
    // process is working on the queue; an expired lease is taken over after a restart.
    version: 55,
    name: 'plan_qualification_queues',
    sql: `
create table plan_qualification_queues (
 id uuid primary key,
 connection_id uuid not null references plan_connections(id),
 model_id text not null check (length(model_id) between 1 and 200),
 state text not null check (state in ('running','done','stopped','cancelled')),
 reason text check (reason is null or length(reason) between 1 and 1200),
 lease_holder uuid,
 lease_until timestamptz,
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 check ((state = 'running') = (finished_at is null))
);
create unique index plan_qualification_queues_one_running on plan_qualification_queues (connection_id)
 where state = 'running';
create table plan_qualification_queue_items (
 queue_id uuid not null references plan_qualification_queues(id),
 position integer not null check (position >= 0),
 task_class text not null,
 manifest jsonb not null,
 manifest_hash char(64) not null,
 min_held_out_cases integer not null check (min_held_out_cases >= 3),
 floor jsonb not null,
 qualification_id uuid references plan_qualifications(id),
 state text not null check (state in ('waiting','running','qualified','failed','stopped','cancelled')),
 reason text check (reason is null or length(reason) between 1 and 1200),
 primary key (queue_id, position),
 unique (queue_id, manifest_hash),
 check (state not in ('running','qualified','failed') or qualification_id is not null)
);
-- A qualification is worked on by one queue item at a time; a later queue may take over one
-- whose earlier queue stopped or was cancelled (review of PR #176, M-1).
create unique index plan_qualification_queue_items_one_running on plan_qualification_queue_items
 (qualification_id) where state = 'running';
`,
  },
  {
    // ADR-0090: the team profile (what the owner says the team can run, install and do with
    // data, ticked by hand or found by a built-in check), one append-only version per save; the
    // owner's gate confirmations (a person's one-click answer to an ethics or access gate on one
    // option version, naming the concerns it answered); and the owner's gate rule (who clears
    // gates: owner, team_profile or model), one version per change. All are kept unchanged.
    version: 56,
    name: 'team_profiles_and_gate_confirmations',
    sql: `
create table team_profile_versions (
 workspace_id uuid not null references workspaces(id),
 version integer not null check (version > 0),
 profile jsonb not null check (jsonb_typeof(profile) = 'object'),
 profile_hash char(64) not null,
 change text not null check (change in ('saved','checked')),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, version)
);
create trigger team_profile_versions_immutable before update or delete on team_profile_versions
 for each row execute function creator_reject_change();
create table gate_confirmations (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 alternative_id uuid not null,
 alternative_version integer not null check (alternative_version > 0),
 gate text not null check (gate in ('ethics','access')),
 reason text not null check (length(reason) between 3 and 300),
 concerns jsonb not null check (jsonb_typeof(concerns) = 'array' and jsonb_array_length(concerns) <= 40),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp()
);
create index gate_confirmations_alternative on gate_confirmations (workspace_id, alternative_id, created_at);
create trigger gate_confirmations_immutable before update or delete on gate_confirmations
 for each row execute function creator_reject_change();
create table gate_rule_versions (
 workspace_id uuid not null references workspaces(id),
 version integer not null check (version > 0),
 mode text not null check (mode in ('owner','team_profile','model')),
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, version)
);
create trigger gate_rule_versions_immutable before update or delete on gate_rule_versions
 for each row execute function creator_reject_change();
`,
  },
  {
    // ADR-0092 (P13): an unattended autopilot over one run's main path. Its steps are kept as one
    // JSON array that only the studio's guarded updates change (each update names the version it
    // read). At most one autopilot runs per run. Migration 56 is held by #179, so this is 57.
    version: 57,
    name: 'autopilots',
    sql: `
create table autopilots (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 run_id uuid not null,
 fixture boolean not null,
 config jsonb not null check (jsonb_typeof(config) = 'object'),
 config_hash char(64) not null,
 summary text[] not null check (cardinality(summary) >= 1),
 policy_version text not null,
 state text not null check (state in ('running','finished')),
 stage text not null check (stage in ('research','explore','brief','discover','assess','select',
   'proposal','spec')),
 outcome text check (outcome in ('proposal','insufficient_evidence','no_eligible_option',
   'needs_person','needs_authority','limit_reached','failed','cancelled')),
 explanation text not null default '' check (length(explanation) <= 1200),
 steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
 calls_reserved integer not null default 0 check (calls_reserved >= 0),
 version integer not null check (version >= 1),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 unique (workspace_id, id),
 check ((state = 'finished') = (finished_at is not null)),
 check ((state = 'finished') = (outcome is not null))
);
create index autopilots_by_workspace on autopilots (workspace_id, created_at desc);
create unique index autopilots_one_running on autopilots (workspace_id, run_id)
 where state = 'running';
alter table autopilots add constraint autopilots_steps_max check (jsonb_array_length(steps) <= 60);
-- The agent every autopilot step is recorded under; the owner who started it is kept beside it.
insert into actors (id, kind, display_name)
 values ('00000000-0000-4000-8000-0000000000a1', 'agent', 'Autopilot') on conflict (id) do nothing;
-- A selection the autopilot recorded names it, so a person's choice and the rule's stay apart.
alter table selections add column autopilot_id uuid;
alter table selections add constraint selections_autopilot_fk
 foreign key (workspace_id, autopilot_id) references autopilots (workspace_id, id);
alter table selections add constraint selections_autopilot_actor
 check ((autopilot_id is null) = (actor_id <> '00000000-0000-4000-8000-0000000000a1'));
`,
  },
  {
    // ADR-0093 (P28): a workspace's own OpenAI API key, added in Models and connections. The key
    // itself is never here: credential_ref names the studio's protected vault entry (DPAPI on
    // Windows). Only the last four characters are kept, to tell keys apart. One key per real
    // workspace; saving again replaces it (version + 1) and removing deletes the row. Each change
    // is in the audit log.
    version: 58,
    name: 'workspace_api_keys',
    sql: `
create table workspace_api_keys (
 workspace_id uuid not null,
 fixture boolean not null check (not fixture),
 provider text not null check (provider = 'openai'),
 model_id text not null check (length(model_id) between 1 and 200),
 credential_ref text not null unique check (credential_ref ~ '^openai-api-key/[0-9a-f-]{36}$'),
 last_four text not null check (last_four ~ '^[A-Za-z0-9_-]{4}$'),
 version integer not null check (version >= 1),
 saved_by uuid not null references actors(id),
 saved_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, provider),
 foreign key (workspace_id, fixture) references workspaces (id, fixture)
);
`,
  },
  {
    // ADR-0094 (P29, walk item 6): temporary extra requests on a connection's daily cap, granted
    // by the owner when the cap is used up (20 at a time, Jordan, November 11, 2026). Each grant
    // lasts as long as the rolling window and then stops counting; the configured cap is never
    // changed and recorded usage is never rewritten. Grants are kept as they were made.
    // Version 59 (coordinator's table, November 12, 2026): #179 holds 56, P13 57, P28 58,
    // P30 60 and P31 61. Keep this array in ascending version order when merging.
    version: 59,
    name: 'plan_extra_requests',
    sql: `
create table plan_extra_requests (
 id uuid primary key,
 connection_id uuid not null references plan_connections(id),
 requests integer not null check (requests between 1 and 1000),
 configured_cap integer not null check (configured_cap >= 0),
 used_at_grant integer not null check (used_at_grant >= 0),
 settings_hash char(64) not null,
 connection_version integer not null check (connection_version >= 1),
 granted_by uuid not null references actors(id),
 granted_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 check (expires_at > granted_at)
);
create index plan_extra_requests_live on plan_extra_requests (connection_id, expires_at);
create trigger plan_extra_requests_no_update before update on plan_extra_requests
  for each row execute function creator_reject_change();
create trigger plan_extra_requests_no_delete before delete on plan_extra_requests
  for each row execute function creator_reject_change();
`,
  },
  {
    // ADR-0097: the owner's gate checklist (up to 12 items, each for the ethics or the access
    // gate), one append-only version per save; and the checklist gate rule, under which code
    // clears a gate only when every current automatic assessment passed every item for it.
    version: 60,
    name: 'gate_checklists',
    sql: `
create table gate_checklist_versions (
 workspace_id uuid not null references workspaces(id),
 version integer not null check (version > 0),
 items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 12),
 items_hash char(64) not null,
 actor_id uuid not null references actors(id),
 event_id uuid not null references audit_events(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key (workspace_id, version)
);
create trigger gate_checklist_versions_immutable before update or delete on gate_checklist_versions
 for each row execute function creator_reject_change();
alter table gate_rule_versions drop constraint gate_rule_versions_mode_check;
alter table gate_rule_versions add constraint gate_rule_versions_mode_check
 check (mode in ('owner','team_profile','model','checklist'));
`,
  },
  {
    // ADR-0096 (P31): "Fill in with <model>" on a Chat card. One row per press holds exactly
    // what was sent to the chat model, its reply and the proposals the studio could read. The
    // proposals answer nothing: the person uses them (saving the card's answers as usual) and
    // still presses Send. Rows change once, from pending to their outcome, and go only with
    // their card (and so with their conversation).
    version: 61,
    name: 'chat_action_fills',
    sql: `
create table chat_action_fills (
 id uuid primary key,
 workspace_id uuid not null,
 conversation_id uuid not null,
 action_id uuid not null references chat_actions(id) on delete cascade,
 client_id uuid not null,
 state text not null check (state in ('pending','completed','failed','refused')),
 connection_id uuid not null references plan_connections(id),
 connection_kind text not null check (connection_kind in ('chatgpt_plan','claude_code')),
 fixture boolean not null,
 model_id text not null,
 logical_operation_id uuid not null unique,
 plan_request_id uuid references plan_requests(id),
 instructions_version text not null,
 instructions_hash char(64) not null,
 questions jsonb not null check (jsonb_typeof(questions) = 'array'),
 records boolean not null,
 history_items integer not null check (history_items >= 0),
 input text not null,
 input_hash char(64) not null,
 text text,
 output_hash char(64),
 fill_values jsonb not null default '{}' check (jsonb_typeof(fill_values) = 'object'),
 dropped integer not null default 0 check (dropped >= 0),
 reason text check (reason is null or length(reason) <= 2000),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 foreign key (workspace_id, conversation_id) references chat_conversations (workspace_id, id)
   on delete cascade,
 unique (action_id, client_id),
 check ((state = 'completed') = (text is not null and output_hash is not null)),
 check ((state = 'pending') = (finished_at is null))
);
create unique index chat_action_fills_one_pending on chat_action_fills (action_id)
 where state = 'pending';
create index chat_action_fills_conversation on chat_action_fills (conversation_id, created_at);
create function chat_action_fills_settle_once() returns trigger language plpgsql as $$
begin
 -- A fill goes with its card or its conversation, whichever cascade reaches it first (the
 -- order of the two cascades depends on trigger names, which a restore can change).
 if tg_op = 'DELETE' and (
      not exists (select 1 from chat_actions where id = old.action_id)
   or not exists (select 1 from chat_conversations where id = old.conversation_id)) then
   return old;
 end if;
 if tg_op = 'DELETE' or old.state <> 'pending' or new.state = 'pending'
   or (to_jsonb(new) - array['state','plan_request_id','text','output_hash','fill_values',
         'dropped','reason','finished_at'])
      is distinct from (to_jsonb(old) - array['state','plan_request_id','text','output_hash',
         'fill_values','dropped','reason','finished_at'])
 then
   raise exception 'chat card fills change only once, from pending to their outcome'
     using errcode = 'P0001';
 end if;
 return new;
end $$;
create trigger chat_action_fills_settle_once before update or delete on chat_action_fills
 for each row execute function chat_action_fills_settle_once();
`,
  },
  {
    // ADR-0099 (P33): automation levels. "Automate selection" is a standing record on a run; while
    // it is active the studio starts a selection-only autopilot for each assessment that finishes
    // on the run (at most one per assessment, held by the unique index). The other levels need no
    // table: "Automate the rest" and "Whole process" are autopilots (migration 57). Version 62:
    // #185 holds 60, P31 61.
    version: 62,
    name: 'run_automations',
    sql: `
create table run_automations (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 run_id uuid not null,
 fixture boolean not null,
 level text not null check (level = 'selection'),
 config jsonb not null check (jsonb_typeof(config) = 'object'),
 config_hash char(64) not null,
 summary text[] not null check (cardinality(summary) >= 1),
 policy_version text not null,
 state text not null check (state in ('active','stopped')),
 stop_reason text check (stop_reason is null or length(stop_reason) <= 600),
 version integer not null check (version >= 1),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 stopped_at timestamptz,
 foreign key (workspace_id, run_id) references run_controls (workspace_id, run_id),
 foreign key (workspace_id, fixture) references workspaces (id, fixture),
 unique (workspace_id, id),
 check ((state = 'stopped') = (stopped_at is not null)),
 check ((state = 'stopped') = (stop_reason is not null))
);
create unique index run_automations_one_active on run_automations (workspace_id, run_id)
 where state = 'active';
create index run_automations_by_workspace on run_automations (workspace_id, created_at desc);
-- The assessment workflow an automation's autopilot was started for; one autopilot per pair.
alter table autopilots add column automation_id uuid;
alter table autopilots add column trigger_workflow_id uuid references workflows(id);
alter table autopilots add constraint autopilots_automation_fk
 foreign key (workspace_id, automation_id) references run_automations (workspace_id, id);
alter table autopilots add constraint autopilots_automation_trigger
 check ((automation_id is null) = (trigger_workflow_id is null));
create unique index autopilots_one_per_trigger on autopilots (automation_id, trigger_workflow_id)
 where automation_id is not null;
`,
  },
  {
    // ADR-0100: the owner's autopilot settings (one versioned row per workspace; every change is
    // audited) and the "gather more evidence" step an autopilot takes when they allow it.
    version: 63,
    name: 'autopilot_settings',
    sql: `
create table autopilot_settings (
 workspace_id uuid primary key references workspaces(id),
 settings jsonb not null check (jsonb_typeof(settings) = 'object'),
 version integer not null check (version >= 1),
 updated_by uuid not null references actors(id),
 updated_at timestamptz not null default clock_timestamp()
);
alter table autopilots drop constraint autopilots_stage_check;
alter table autopilots add constraint autopilots_stage_check check (stage in ('research','explore',
 'brief','discover','assess','select','proposal','spec','gather'));
-- P-11: the routine approvals made for this autopilot when it started, which end with it.
alter table routine_policies add constraint routine_policies_workspace_id_key
 unique (workspace_id, id);
alter table autopilots add column routine_policy_id uuid;
alter table autopilots add constraint autopilots_routine_policy_fk
 foreign key (workspace_id, routine_policy_id) references routine_policies (workspace_id, id);
alter table autopilots add column approvals_ended_at timestamptz;
alter table autopilots add constraint autopilots_approvals_ended_check
 check (approvals_ended_at is null or routine_policy_id is not null);
-- P-12: a quote-checked web claim the autopilot accepted under the owner's setting.
alter table web_discovery_claims drop constraint web_discovery_claims_admitted_via_check;
alter table web_discovery_claims add constraint web_discovery_claims_admitted_via_check
 check (admitted_via in ('owner','routine_policy','autopilot'));
alter table web_discovery_claims add constraint web_discovery_claims_autopilot_admission_check
 check (admitted_via <> 'autopilot' or admission_id is not null);
create index web_discovery_claims_by_autopilot_claim on web_discovery_claims (claim_id)
 where admitted_via = 'autopilot';
-- P-12 (review 1 L-6): the autopilot that started a web search, so the hold holds on a resume.
alter table web_discoveries add column autopilot_id uuid;
alter table web_discoveries add constraint web_discoveries_autopilot_fk
 foreign key (workspace_id, autopilot_id) references autopilots (workspace_id, id);
alter table workflows add column autopilot_id uuid;
alter table workflows add constraint workflows_autopilot_fk
 foreign key (workspace_id, autopilot_id) references autopilots (workspace_id, id);
`,
  },
  {
    // ADR-0101 (UX pass P-5): "Draft the missing sections" on a saved proposal. Each press is
    // one row: the version drafted, the sections asked, exactly what was sent under which fixed
    // instructions, the reply and the drafts the studio could read. It changes once, from
    // pending to its outcome, except that redacting the proposal clears its words. Version 64:
    // #193 holds 63; the other UX pass area threads hold 65 to 67.
    version: 64,
    name: 'proposal_section_drafts',
    sql: `
create table proposal_section_drafts (
 id uuid primary key,
 workspace_id uuid not null,
 proposal_id uuid not null,
 proposal_version integer not null check (proposal_version > 0),
 client_id uuid not null,
 state text not null check (state in ('pending','completed','failed','refused')),
 connection_id uuid not null references plan_connections(id),
 connection_kind text not null check (connection_kind in ('chatgpt_plan','claude_code')),
 fixture boolean not null,
 model_id text not null,
 logical_operation_id uuid not null unique,
 plan_request_id uuid references plan_requests(id),
 instructions_version text not null,
 instructions_hash char(64) not null,
 sections jsonb not null check (jsonb_typeof(sections) = 'array'),
 sections_sent integer not null check (sections_sent >= 0),
 input text not null,
 input_hash char(64) not null,
 text text,
 output_hash char(64),
 draft_values jsonb not null default '{}' check (jsonb_typeof(draft_values) = 'object'),
 dropped integer not null default 0 check (dropped >= 0),
 reason text check (reason is null or length(reason) <= 2000),
 requested_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 redacted_at timestamptz,
 foreign key (workspace_id, proposal_id) references entities (workspace_id, id),
 foreign key (proposal_id, proposal_version) references entity_versions (entity_id, version),
 unique (proposal_id, client_id),
 unique (workspace_id, id),
 check ((state = 'completed') = (output_hash is not null)),
 check (state <> 'completed' or text is not null),
 check ((state = 'pending') = (finished_at is null))
);
create unique index proposal_section_drafts_one_pending on proposal_section_drafts (proposal_id)
 where state = 'pending';
create index proposal_section_drafts_by_proposal
 on proposal_section_drafts (workspace_id, proposal_id, created_at desc);
create function proposal_section_drafts_settle_once() returns trigger language plpgsql as $$
begin
 -- Redacting the proposal clears the words once; hashes, ids and the outcome stay.
 if tg_op = 'UPDATE' and old.redacted_at is null and new.redacted_at is not null
   and old.state <> 'pending' and new.state = old.state
   and (to_jsonb(new) - array['input','text','draft_values','redacted_at'])
     is not distinct from (to_jsonb(old) - array['input','text','draft_values','redacted_at'])
 then
   return new;
 end if;
 -- A draft finishing after its proposal was redacted is recorded without its words.
 if tg_op = 'DELETE' or old.state <> 'pending' or new.state = 'pending'
   or (to_jsonb(new) - array['state','plan_request_id','text','output_hash','draft_values',
         'dropped','reason','finished_at','input','redacted_at'])
      is distinct from (to_jsonb(old) - array['state','plan_request_id','text','output_hash',
         'draft_values','dropped','reason','finished_at','input','redacted_at'])
 then
   raise exception 'proposal section drafts change only once, from pending to their outcome'
     using errcode = 'P0001';
 end if;
 return new;
end $$;
create trigger proposal_section_drafts_settle_once before update or delete
 on proposal_section_drafts for each row execute function proposal_section_drafts_settle_once();
`,
  },
  {
    // ADR-0105 (B1): build (recipe) qualifications as records earned in Qualify, per connection,
    // model and pair of role prompts, replacing the list in source code. Each attempt is one
    // build in the studio's qualification harness; its plan requests name the attempt, whose
    // start is the owner's one approval for them. The November 6 web pass is imported as history
    // where its connection exists.
    version: 65,
    name: 'recipe_qualifications',
    sql: `
create table recipe_qualifications (
 id uuid primary key,
 workspace_id uuid not null references workspaces(id),
 connection_id uuid not null references plan_connections(id),
 recipe text not null check (recipe in ('python-build/1','static-web/1')),
 benchmark_id text not null check (length(benchmark_id) between 1 and 80),
 model_id text not null check (length(model_id) between 1 and 200),
 builder_prompt_sha256 char(64) not null,
 reviewer_prompt_sha256 char(64) not null,
 freeze_sha256 char(64) not null,
 source text not null check (source in ('in_app','imported')),
 fixture boolean not null,
 state text not null check (state in ('running','qualified','not_qualified','stopped')),
 attempts_needed integer not null check (attempts_needed between 1 and 10),
 passed integer not null default 0 check (passed between 0 and attempts_needed),
 -- The connection's per-request input cap at Start (null on an imported record).
 max_input_chars integer check (max_input_chars >= 1),
 -- The fewest input characters Start accepted for this benchmark (null on an imported record).
 min_input_chars integer check (min_input_chars >= 1),
 reason text,
 evidence text,
 lease_holder text,
 lease_until timestamptz,
 version integer not null default 1 check (version >= 1),
 created_by uuid not null references actors(id),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 check ((state = 'running') = (finished_at is null)),
 check (state <> 'qualified' or passed = attempts_needed),
 check ((source = 'imported') = (evidence is not null)),
 check ((source = 'in_app') = (max_input_chars is not null)),
 check ((source = 'in_app') = (min_input_chars is not null))
);
create unique index recipe_qualifications_one_running on recipe_qualifications (connection_id)
 where state = 'running';
create index recipe_qualifications_by_connection on recipe_qualifications (connection_id, created_at);
create table recipe_qualification_attempts (
 id uuid primary key,
 qualification_id uuid not null references recipe_qualifications(id),
 slot integer not null check (slot between 1 and 10),
 replaces uuid references recipe_qualification_attempts(id),
 state text not null check (state in ('running','passed','failed','invalid')),
 reason text,
 product_id uuid,
 build_id uuid,
 request_limit integer not null check (request_limit >= 2),
 repairs integer check (repairs is null or repairs >= 0),
 result jsonb,
 started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 check ((state = 'running') = (finished_at is null))
);
create unique index recipe_attempts_one_running on recipe_qualification_attempts (qualification_id)
 where state = 'running';
create unique index recipe_attempts_one_original on recipe_qualification_attempts (qualification_id, slot)
 where replaces is null;
create unique index recipe_attempts_one_replacement on recipe_qualification_attempts (replaces)
 where replaces is not null;
alter table plan_requests add column recipe_attempt_id uuid references recipe_qualification_attempts(id);
create index plan_requests_by_recipe_attempt on plan_requests (recipe_attempt_id)
 where recipe_attempt_id is not null;
alter table plan_requests add constraint plan_requests_recipe_attempt_check
 check (recipe_attempt_id is null or (purpose = 'task' and run_id is null and build_id is not null
   and task_class in ('patch_build','independent_review')));
-- The November 6 live pass (3 of 3 on the dev studio's ChatGPT connection), formerly the
-- RECIPE_QUALIFICATIONS list in packages/executor/src/artifacts.ts.
insert into recipe_qualifications (id, workspace_id, connection_id, recipe, benchmark_id, model_id,
  builder_prompt_sha256, reviewer_prompt_sha256, freeze_sha256, source, fixture, state,
  attempts_needed, passed, reason, evidence, created_by, created_at, finished_at)
select '7d0c6f0e-5a1b-4c41-9b0e-b1a1e9c0f406', pc.workspace_id, pc.id, 'static-web/1',
  'p15-small-signup-v4', 'gpt-6-astra',
  '73cb799e9212ecdd2cd37fd5d642a292681b0169a4ddd12b831e6d1915da22ad',
  '9e1cc6b4184526512d4cafa6f0f7f450579935c0bacaa3f17c558b1d2908f99c',
  '463ced35393be0a34b3e941f70cec104a1cfe979cd6931dd568a2db3b1a9ce2c', 'imported', pc.fixture,
  'qualified', 3, 3,
  '3 of 3 live on November 6, 2026, run by a script on the dev studio before the app could run build qualifications.',
  'tracking/evidence/p15-benchmarks/RESULTS_P15_V4_2026-11-06.json', m.actor_id,
  '2026-11-06T21:44:00Z', '2026-11-06T21:44:00Z'
from plan_connections pc
join lateral (select actor_id from workspace_members where workspace_id = pc.workspace_id
  and role = 'owner' order by actor_id limit 1) m on true
where pc.id = '4e4a7bec-c1ca-4f31-8f87-b11ed5fc81d4';
`,
  },
];

export function migrationChecksum(m: Migration): string {
  return createHash('sha256').update(m.sql).digest('hex');
}
