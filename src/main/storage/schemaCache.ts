/**
 * schema_cache repo. Stores object-metadata payloads keyed by
 * (profile_id, database_name, schema_name, object_type) per §5.5.
 *
 * Note on the composite primary key: `schema_name` is declared TEXT
 * (nullable) and is part of the PK. SQLite treats NULLs in a composite
 * PK as distinct, so a naive ON CONFLICT upsert would let duplicate
 * NULL-schema rows accumulate. `setCached` therefore performs a
 * DELETE-then-INSERT inside a transaction, using `IS` for the
 * NULL-aware comparison — this gives correct upsert semantics for both
 * schema=NULL (e.g. database-level metadata) and schema=<name> (e.g.
 * table lists under a specific schema).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getDatabase, type Database } from './db';

export type ObjectType = 'table' | 'view' | 'database' | 'schema' | 'column';

export interface SchemaCacheRow {
  profile_id: string;
  database_name: string;
  schema_name: string | null;
  object_type: string;
  payload_json: string;
  fetched_at: number;
}

interface SchemaCacheStmts {
  get: BetterSqlite3.Statement;
  removeKey: BetterSqlite3.Statement;
  insert: BetterSqlite3.Statement;
  invalidateByProfile: BetterSqlite3.Statement;
  invalidateByProfileDb: BetterSqlite3.Statement;
  invalidateByProfileDbSchema: BetterSqlite3.Statement;
}

const stmtCache = new WeakMap<Database, SchemaCacheStmts>();

function stmts(db: Database): SchemaCacheStmts {
  const cached = stmtCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  const fresh: SchemaCacheStmts = {
    get: db.prepare(
      'SELECT * FROM schema_cache ' +
        'WHERE profile_id = ? AND database_name = ? AND schema_name IS ? AND object_type = ?'
    ),
    removeKey: db.prepare(
      'DELETE FROM schema_cache ' +
        'WHERE profile_id = ? AND database_name = ? AND schema_name IS ? AND object_type = ?'
    ),
    insert: db.prepare(
      'INSERT INTO schema_cache (' +
        'profile_id, database_name, schema_name, object_type, payload_json, fetched_at' +
        ') VALUES (?, ?, ?, ?, ?, ?)'
    ),
    invalidateByProfile: db.prepare('DELETE FROM schema_cache WHERE profile_id = ?'),
    invalidateByProfileDb: db.prepare(
      'DELETE FROM schema_cache WHERE profile_id = ? AND database_name = ?'
    ),
    invalidateByProfileDbSchema: db.prepare(
      'DELETE FROM schema_cache ' +
        'WHERE profile_id = ? AND database_name = ? AND schema_name IS ?'
    )
  };
  stmtCache.set(db, fresh);
  return fresh;
}

/**
 * Returns the parsed cache payload, or `null` if no entry exists.
 * Shape is opaque here — callers know their own object_type contract.
 */
export function getCached(
  profileId: string,
  database: string,
  schema: string | null,
  type: string
): unknown | null {
  const row = stmts(getDatabase()).get.get(profileId, database, schema, type) as
    | SchemaCacheRow
    | undefined
    | null;
  if (row === undefined || row === null) {
    return null;
  }
  return JSON.parse(row.payload_json) as unknown;
}

/**
 * Upsert a cached payload, stamping `fetched_at` to now. DELETE-then-INSERT
 * inside a transaction so NULL-schema upserts replace cleanly (see the
 * note at the top of this file).
 */
export function setCached(
  profileId: string,
  database: string,
  schema: string | null,
  type: string,
  payload: unknown
): void {
  const db = getDatabase();
  const s = stmts(db);
  const now = Date.now();
  const serialized = JSON.stringify(payload);
  const tx = db.transaction(() => {
    s.removeKey.run(profileId, database, schema, type);
    s.insert.run(profileId, database, schema, type, serialized, now);
  });
  tx();
}

/**
 * Delete cache rows for a profile, optionally narrowed by database and
 * schema. Schema `null` is a real selector — passing `null` matches only
 * rows with NULL `schema_name`; omitting the argument leaves the schema
 * dimension unfiltered.
 */
export function invalidate(
  profileId: string,
  database?: string,
  schema?: string | null
): number {
  const s = stmts(getDatabase());
  if (database === undefined) {
    return s.invalidateByProfile.run(profileId).changes;
  }
  if (schema === undefined) {
    return s.invalidateByProfileDb.run(profileId, database).changes;
  }
  return s.invalidateByProfileDbSchema.run(profileId, database, schema).changes;
}

/**
 * Drop every cache row owned by a profile. Used by the session-close
 * hook (T4 B1) so re-opening a session after the user has added or
 * dropped objects in another tool shows fresh data rather than 5-min
 * stale entries.
 */
export function invalidateByProfile(profileId: string): number {
  return stmts(getDatabase()).invalidateByProfile.run(profileId).changes;
}

/**
 * Drop every cache row for a profile + database pair, regardless of
 * schema or object_type. Used by the user-facing Refresh action when a
 * database node is right-clicked.
 */
export function invalidateByProfileDb(profileId: string, database: string): number {
  return stmts(getDatabase()).invalidateByProfileDb.run(profileId, database).changes;
}

/**
 * Drop every cache row for a profile + database + schema triple. `null`
 * matches only NULL-schema rows; pass the schema name for the common
 * "refresh this schema's tables/views" path.
 */
export function invalidateByProfileDbSchema(
  profileId: string,
  database: string,
  schema: string | null
): number {
  return stmts(getDatabase()).invalidateByProfileDbSchema.run(profileId, database, schema).changes;
}
