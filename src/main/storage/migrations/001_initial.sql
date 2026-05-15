-- Snowboy v0.1 — initial schema.
--
-- This is the canonical persistence layer described in
-- `.sisyphus/plans/snowboy-mvp-v0.1.md` §5.5 and is reproduced here
-- verbatim. Treat §5.5 as the source of truth: changes must be
-- proposed and reviewed against the plan, not the SQL.

CREATE TABLE connection_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_url TEXT NOT NULL,
  auth_method TEXT NOT NULL,         -- 'externalbrowser' | 'password_mfa' | 'password'
  username TEXT NOT NULL,
  default_role TEXT,
  default_warehouse TEXT,
  default_database TEXT,
  default_schema TEXT,
  -- secret material lives in safeStorage keyed by `profile:${id}`
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE worksheets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  cursor_line INTEGER,
  cursor_col INTEGER,
  last_session_context_json TEXT,    -- last role/warehouse/db/schema
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE query_history (
  id TEXT PRIMARY KEY,
  worksheet_id TEXT,
  profile_id TEXT NOT NULL,
  role TEXT,
  warehouse TEXT,
  database_name TEXT,
  schema_name TEXT,
  sql TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL,              -- 'success' | 'error' | 'cancelled'
  row_count INTEGER,
  bytes_scanned INTEGER,
  query_id TEXT,                     -- Snowflake-side query ID for later credit lookup
  error_message TEXT
);
CREATE INDEX idx_history_started ON query_history(started_at DESC);
CREATE INDEX idx_history_worksheet ON query_history(worksheet_id);

CREATE TABLE pane_layout (
  workspace_id TEXT PRIMARY KEY,     -- 'default' for v0.1 (single workspace)
  tree_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE schema_cache (
  profile_id TEXT NOT NULL,
  database_name TEXT NOT NULL,
  schema_name TEXT,
  object_type TEXT NOT NULL,         -- 'table' | 'view' | 'database' | 'schema' | 'column'
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, database_name, schema_name, object_type)
);
