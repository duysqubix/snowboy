/**
 * query_history repo. Typed CRUD + filterable list.
 *
 * Rows are written when a query starts and finalised when it completes
 * (status flips from a placeholder to 'success' | 'error' | 'cancelled'
 * with `ended_at`, `row_count`, `bytes_scanned`, and either `query_id`
 * or `error_message` set). `listHistory` powers the history pane and
 * supports basic filtering by profile / fulltext-ish search on the SQL.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getDatabase, type Database } from './db';

export type QueryStatus = 'success' | 'error' | 'cancelled' | 'running';

export interface QueryHistoryRow {
  id: string;
  worksheet_id: string | null;
  profile_id: string;
  role: string | null;
  warehouse: string | null;
  database_name: string | null;
  schema_name: string | null;
  sql: string;
  started_at: number;
  ended_at: number | null;
  status: QueryStatus;
  row_count: number | null;
  bytes_scanned: number | null;
  query_id: string | null;
  error_message: string | null;
}

export type NewQueryHistory = Omit<QueryHistoryRow, 'ended_at' | 'row_count' | 'bytes_scanned' | 'query_id' | 'error_message'> & {
  ended_at?: number | null;
  row_count?: number | null;
  bytes_scanned?: number | null;
  query_id?: string | null;
  error_message?: string | null;
};

export type QueryHistoryPatch = Partial<Omit<QueryHistoryRow, 'id' | 'started_at'>>;

export interface ListHistoryOptions {
  /** Max rows to return. Defaults to 100. */
  limit?: number;
  /** Restrict to a single connection profile. */
  profileId?: string;
  /** Case-sensitive substring match on the `sql` column. */
  search?: string;
}

interface HistoryStmts {
  getById: BetterSqlite3.Statement;
  insert: BetterSqlite3.Statement;
  update: BetterSqlite3.Statement;
  remove: BetterSqlite3.Statement;
}

const stmtCache = new WeakMap<Database, HistoryStmts>();

function stmts(db: Database): HistoryStmts {
  const cached = stmtCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  const fresh: HistoryStmts = {
    getById: db.prepare('SELECT * FROM query_history WHERE id = ?'),
    insert: db.prepare(
      'INSERT INTO query_history (' +
        'id, worksheet_id, profile_id, role, warehouse, database_name, schema_name, ' +
        'sql, started_at, ended_at, status, row_count, bytes_scanned, query_id, error_message' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    update: db.prepare(
      'UPDATE query_history SET ' +
        'worksheet_id = ?, profile_id = ?, role = ?, warehouse = ?, ' +
        'database_name = ?, schema_name = ?, sql = ?, ended_at = ?, ' +
        'status = ?, row_count = ?, bytes_scanned = ?, query_id = ?, error_message = ? ' +
        'WHERE id = ?'
    ),
    remove: db.prepare('DELETE FROM query_history WHERE id = ?')
  };
  stmtCache.set(db, fresh);
  return fresh;
}

export function getHistory(id: string): QueryHistoryRow | null {
  const row = stmts(getDatabase()).getById.get(id) as QueryHistoryRow | undefined | null;
  return row ?? null;
}

export function insertHistory(entry: NewQueryHistory): QueryHistoryRow {
  const row: QueryHistoryRow = {
    id: entry.id,
    worksheet_id: entry.worksheet_id,
    profile_id: entry.profile_id,
    role: entry.role,
    warehouse: entry.warehouse,
    database_name: entry.database_name,
    schema_name: entry.schema_name,
    sql: entry.sql,
    started_at: entry.started_at,
    ended_at: entry.ended_at ?? null,
    status: entry.status,
    row_count: entry.row_count ?? null,
    bytes_scanned: entry.bytes_scanned ?? null,
    query_id: entry.query_id ?? null,
    error_message: entry.error_message ?? null
  };
  stmts(getDatabase()).insert.run(
    row.id,
    row.worksheet_id,
    row.profile_id,
    row.role,
    row.warehouse,
    row.database_name,
    row.schema_name,
    row.sql,
    row.started_at,
    row.ended_at,
    row.status,
    row.row_count,
    row.bytes_scanned,
    row.query_id,
    row.error_message
  );
  return row;
}

export function updateHistory(id: string, patch: QueryHistoryPatch): QueryHistoryRow {
  const current = getHistory(id);
  if (current === null) {
    throw new Error(`query_history: no row with id=${id}`);
  }
  const next: QueryHistoryRow = {
    ...current,
    worksheet_id:
      patch.worksheet_id !== undefined ? patch.worksheet_id : current.worksheet_id,
    profile_id: patch.profile_id !== undefined ? patch.profile_id : current.profile_id,
    role: patch.role !== undefined ? patch.role : current.role,
    warehouse: patch.warehouse !== undefined ? patch.warehouse : current.warehouse,
    database_name:
      patch.database_name !== undefined ? patch.database_name : current.database_name,
    schema_name: patch.schema_name !== undefined ? patch.schema_name : current.schema_name,
    sql: patch.sql !== undefined ? patch.sql : current.sql,
    ended_at: patch.ended_at !== undefined ? patch.ended_at : current.ended_at,
    status: patch.status !== undefined ? patch.status : current.status,
    row_count: patch.row_count !== undefined ? patch.row_count : current.row_count,
    bytes_scanned:
      patch.bytes_scanned !== undefined ? patch.bytes_scanned : current.bytes_scanned,
    query_id: patch.query_id !== undefined ? patch.query_id : current.query_id,
    error_message:
      patch.error_message !== undefined ? patch.error_message : current.error_message
  };
  stmts(getDatabase()).update.run(
    next.worksheet_id,
    next.profile_id,
    next.role,
    next.warehouse,
    next.database_name,
    next.schema_name,
    next.sql,
    next.ended_at,
    next.status,
    next.row_count,
    next.bytes_scanned,
    next.query_id,
    next.error_message,
    next.id
  );
  return next;
}

export function deleteHistory(id: string): boolean {
  const result = stmts(getDatabase()).remove.run(id);
  return result.changes > 0;
}

export function listHistory(opts: ListHistoryOptions = {}): QueryHistoryRow[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (opts.profileId !== undefined) {
    conditions.push('profile_id = ?');
    params.push(opts.profileId);
  }
  if (opts.search !== undefined && opts.search.length > 0) {
    conditions.push('sql LIKE ?');
    params.push(`%${opts.search}%`);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, opts.limit ?? 100);
  params.push(limit);

  // The WHERE clause is composed from a fixed, finite set of conditions
  // — no caller input is interpolated. Values are always bound. The
  // `idx_history_started` index on (started_at DESC) backs the ORDER BY.
  const sql = `SELECT * FROM query_history${where} ORDER BY started_at DESC LIMIT ?`;
  return getDatabase().prepare(sql).all(...params) as QueryHistoryRow[];
}
