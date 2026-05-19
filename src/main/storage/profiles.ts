/**
 * connection_profiles repo. Typed CRUD over the §5.5 schema.
 *
 * Secret material (passwords, refresh tokens, etc.) does NOT live here —
 * it goes into safeStorage keyed by `profile:${id}` per the plan.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getDatabase, type Database } from './db';

export type AuthMethod = 'externalbrowser' | 'password_mfa' | 'password' | 'pat';

export interface ConnectionProfileRow {
  id: string;
  name: string;
  account_url: string;
  auth_method: AuthMethod;
  username: string;
  default_role: string | null;
  default_warehouse: string | null;
  default_database: string | null;
  default_schema: string | null;
  created_at: number;
  updated_at: number;
}

export type NewConnectionProfile = Omit<ConnectionProfileRow, 'created_at' | 'updated_at'>;

export type ConnectionProfilePatch = Partial<Omit<ConnectionProfileRow, 'id' | 'created_at' | 'updated_at'>>;

interface ProfileStmts {
  listAll: BetterSqlite3.Statement;
  getById: BetterSqlite3.Statement;
  insert: BetterSqlite3.Statement;
  update: BetterSqlite3.Statement;
  remove: BetterSqlite3.Statement;
}

const stmtCache = new WeakMap<Database, ProfileStmts>();

function stmts(db: Database): ProfileStmts {
  const cached = stmtCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  const fresh: ProfileStmts = {
    listAll: db.prepare('SELECT * FROM connection_profiles ORDER BY name'),
    getById: db.prepare('SELECT * FROM connection_profiles WHERE id = ?'),
    insert: db.prepare(
      'INSERT INTO connection_profiles (' +
        'id, name, account_url, auth_method, username, ' +
        'default_role, default_warehouse, default_database, default_schema, ' +
        'created_at, updated_at' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    update: db.prepare(
      'UPDATE connection_profiles SET ' +
        'name = ?, account_url = ?, auth_method = ?, username = ?, ' +
        'default_role = ?, default_warehouse = ?, default_database = ?, default_schema = ?, ' +
        'updated_at = ? ' +
        'WHERE id = ?'
    ),
    remove: db.prepare('DELETE FROM connection_profiles WHERE id = ?')
  };
  stmtCache.set(db, fresh);
  return fresh;
}

export function listProfiles(): ConnectionProfileRow[] {
  return stmts(getDatabase()).listAll.all() as ConnectionProfileRow[];
}

export function getProfile(id: string): ConnectionProfileRow | null {
  const row = stmts(getDatabase()).getById.get(id) as ConnectionProfileRow | undefined | null;
  return row ?? null;
}

export function insertProfile(profile: NewConnectionProfile): ConnectionProfileRow {
  const now = Date.now();
  const row: ConnectionProfileRow = {
    id: profile.id,
    name: profile.name,
    account_url: profile.account_url,
    auth_method: profile.auth_method,
    username: profile.username,
    default_role: profile.default_role ?? null,
    default_warehouse: profile.default_warehouse ?? null,
    default_database: profile.default_database ?? null,
    default_schema: profile.default_schema ?? null,
    created_at: now,
    updated_at: now
  };
  stmts(getDatabase()).insert.run(
    row.id,
    row.name,
    row.account_url,
    row.auth_method,
    row.username,
    row.default_role,
    row.default_warehouse,
    row.default_database,
    row.default_schema,
    row.created_at,
    row.updated_at
  );
  return row;
}

export function updateProfile(
  id: string,
  patch: ConnectionProfilePatch
): ConnectionProfileRow {
  const current = getProfile(id);
  if (current === null) {
    throw new Error(`connection_profiles: no row with id=${id}`);
  }
  const next: ConnectionProfileRow = {
    ...current,
    name: patch.name !== undefined ? patch.name : current.name,
    account_url: patch.account_url !== undefined ? patch.account_url : current.account_url,
    auth_method: patch.auth_method !== undefined ? patch.auth_method : current.auth_method,
    username: patch.username !== undefined ? patch.username : current.username,
    default_role: patch.default_role !== undefined ? patch.default_role : current.default_role,
    default_warehouse:
      patch.default_warehouse !== undefined ? patch.default_warehouse : current.default_warehouse,
    default_database:
      patch.default_database !== undefined ? patch.default_database : current.default_database,
    default_schema:
      patch.default_schema !== undefined ? patch.default_schema : current.default_schema,
    updated_at: Date.now()
  };
  stmts(getDatabase()).update.run(
    next.name,
    next.account_url,
    next.auth_method,
    next.username,
    next.default_role,
    next.default_warehouse,
    next.default_database,
    next.default_schema,
    next.updated_at,
    next.id
  );
  return next;
}

export function deleteProfile(id: string): boolean {
  const result = stmts(getDatabase()).remove.run(id);
  return result.changes > 0;
}
