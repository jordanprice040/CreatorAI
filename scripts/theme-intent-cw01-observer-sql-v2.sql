-- cw01-observer-sql/2 — successor fixed SQL asset for the CW-01 observer.
-- NOT EXECUTED. Repository-only asset; executing it needs a separately reviewed
-- adapter, protected credential mechanism and an exact operational grant.
-- Predecessor: the frozen design SQL in
-- docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md (7aaa898c...7252),
-- preserved unchanged there. Corrections incorporated from the supported v1.1 note
-- (0462b516...bb81) and v1.1 review (d7628032...de58):
--   M1 host(inet_server_addr()) without netmask; NULL is failure.
--   M2/R3 instance query with pg_postmaster_start_time, pg_is_in_recovery and
--         pg_backend_pid in A and B; backend parent must be the owned postmaster.
--   L3 NULL backend_type count in A and B.
--   L4 detect-only startup-boundary settings in A (session/local preloads are
--      per-session evidence, I4).
--   I-a session transaction_timeout backstop; no cancel-request connection.
-- Both transactions run on the same single connection. Parameters: A02/B01 use
-- ($1 = expected actor); A03 uses ($1 = expected database, $2 = manifest port).
-- Statement boundaries are the "-- @" marker lines; adapters must use the exact
-- statement text between markers and this file's exact SHA-256.

-- @S01 session
SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;
-- @S02 session
SET statement_timeout = '2s';
-- @S03 session
SET lock_timeout = '2s';
-- @S04 session
SET idle_in_transaction_session_timeout = '2s';
-- @S05 session
SET transaction_timeout = '30s';
-- @S06 session
SET search_path = pg_catalog;

-- @A01 transaction_A begin
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- @A02 transaction_A observer params=actor
SELECT current_user::text = $1::text AND r.rolsuper AS observer_ok
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
-- @A03 transaction_A identity params=database,port
SELECT pg_catalog.current_database()::text = $1::text AS database_ok,
       pg_catalog.host(pg_catalog.inet_server_addr()) = '127.0.0.1' AS address_ok,
       pg_catalog.inet_server_port() = $2::integer AS port_ok,
       pg_catalog.current_setting('transaction_read_only') = 'on' AS readonly_ok,
       pg_catalog.current_setting('transaction_isolation') = 'repeatable read' AS isolation_ok;
-- @A04 transaction_A instance
SELECT pg_catalog.pg_postmaster_start_time() AS server_started_at,
       pg_catalog.pg_is_in_recovery() AS in_recovery,
       pg_catalog.pg_backend_pid() AS backend_pid;
-- @A05 transaction_A startup_boundary
SELECT pg_catalog.current_setting('shared_preload_libraries') AS shared_preloads,
       pg_catalog.current_setting('session_preload_libraries') AS session_preloads,
       pg_catalog.current_setting('local_preload_libraries') AS local_preloads,
       pg_catalog.current_setting('archive_mode') AS archive_mode,
       pg_catalog.current_setting('max_wal_senders') AS max_wal_senders;
-- @A06 transaction_A relations
SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
 ('schema_migrations','workflows','workflow_tasks','outbox','plan_requests',
  'plan_qualifications','budget_reservations','source_retrievals','context_batches',
  'github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews')
ORDER BY c.relname;
-- @A07 transaction_A attributes
SELECT c.relname, a.attnum, a.attname, a.atttypid, a.atttypmod, a.attnotnull, a.attisdropped
FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
 ('schema_migrations','workflows','workflow_tasks','outbox','plan_requests',
  'plan_qualifications','budget_reservations','source_retrievals','context_batches',
  'github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews')
 AND a.attnum > 0 ORDER BY c.relname, a.attnum;
-- @A08 transaction_A constraints
SELECT c.relname, k.conname, k.contype, pg_catalog.pg_get_constraintdef(k.oid, true) AS definition
FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN
 ('schema_migrations','workflows','workflow_tasks','outbox','plan_requests',
  'plan_qualifications','budget_reservations','source_retrievals','context_batches',
  'github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews')
ORDER BY c.relname, k.conname;
-- @A09 transaction_A ledger
SELECT version, name, checksum FROM public.schema_migrations ORDER BY version;
-- @A10 transaction_A listener_settings
SELECT pg_catalog.current_setting('listen_addresses') AS listen_addresses,
       pg_catalog.current_setting('port') AS port,
       pg_catalog.current_setting('unix_socket_directories') AS sockets,
       pg_catalog.current_setting('data_directory') AS data_directory;
-- @A11 transaction_A activity_client
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_catalog.pg_backend_pid();
-- @A12 transaction_A activity_walsender
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity WHERE backend_type = 'walsender';
-- @A13 transaction_A activity_background
SELECT backend_type, count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type NOT IN ('client backend','walsender') GROUP BY backend_type ORDER BY backend_type;
-- @A14 transaction_A activity_null_type
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type IS NULL;
-- @A15 transaction_A work_workflows
SELECT count(*)::text AS n FROM public.workflows
 WHERE finished_at IS NULL OR state NOT IN ('succeeded','failed','cancelled');
-- @A16 transaction_A work_workflow_tasks
SELECT count(*)::text AS n FROM public.workflow_tasks WHERE finished_at IS NULL;
-- @A17 transaction_A work_outbox
SELECT count(*)::text AS n FROM public.outbox WHERE delivered_at IS NULL;
-- @A18 transaction_A work_plan_requests
SELECT count(*)::text AS n FROM public.plan_requests WHERE state NOT IN ('completed','failed','rejected','reconciled');
-- @A19 transaction_A work_plan_qualifications
SELECT count(*)::text AS n FROM public.plan_qualifications WHERE state = 'running';
-- @A20 transaction_A work_budget_reservations
SELECT count(*)::text AS n FROM public.budget_reservations WHERE status IN ('in_flight','unknown');
-- @A21 transaction_A work_source_retrievals
SELECT count(*)::text AS n FROM public.source_retrievals WHERE state = 'in_flight';
-- @A22 transaction_A work_context_batches
SELECT count(*)::text AS n FROM public.context_batches WHERE status IN ('submitting','submitted','unknown');
-- @A23 transaction_A work_github_operations
SELECT count(*)::text AS n FROM public.github_operations WHERE state IN ('dispatched','unknown');
-- @A24 transaction_A work_marketing_deliveries
SELECT count(*)::text AS n FROM public.marketing_deliveries WHERE state IN ('dispatching','unknown');
-- @A25 transaction_A work_portfolio_jobs
SELECT count(*)::text AS n FROM public.portfolio_jobs WHERE state IN ('dispatching','unknown');
-- @A26 transaction_A work_desktop_jobs
SELECT count(*)::text AS n FROM public.desktop_jobs WHERE state NOT IN ('completed','cancelled','expired');
-- @A27 transaction_A work_artifact_previews
SELECT count(*)::text AS n FROM public.artifact_previews WHERE state IN ('starting','ready');
-- @A28 transaction_A end
ROLLBACK;

-- @B01 transaction_B begin
BEGIN READ ONLY;
-- @B02 transaction_B observer params=actor
SELECT current_user::text = $1::text AND r.rolsuper AS observer_ok
FROM pg_catalog.pg_roles r WHERE r.rolname = current_user;
-- @B03 transaction_B instance
SELECT pg_catalog.pg_postmaster_start_time() AS server_started_at,
       pg_catalog.pg_is_in_recovery() AS in_recovery,
       pg_catalog.pg_backend_pid() AS backend_pid;
-- @B04 transaction_B activity_client
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type = 'client backend' AND pid <> pg_catalog.pg_backend_pid();
-- @B05 transaction_B activity_walsender
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity WHERE backend_type = 'walsender';
-- @B06 transaction_B activity_background
SELECT backend_type, count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type NOT IN ('client backend','walsender') GROUP BY backend_type ORDER BY backend_type;
-- @B07 transaction_B activity_null_type
SELECT count(*)::text AS n FROM pg_catalog.pg_stat_activity
 WHERE backend_type IS NULL;
-- @B08 transaction_B end
ROLLBACK;
