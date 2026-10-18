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
];

export function migrationChecksum(m: Migration): string {
  return createHash('sha256').update(m.sql).digest('hex');
}
