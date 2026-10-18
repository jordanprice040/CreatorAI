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
];

export function migrationChecksum(m: Migration): string {
  return createHash('sha256').update(m.sql).digest('hex');
}
