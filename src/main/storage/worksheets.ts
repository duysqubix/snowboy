/**
 * worksheets repo. Typed CRUD over the §5.5 schema.
 *
 * `last_session_context_json` is a TEXT column that stores the JSON-
 * encoded {role, warehouse, database, schema} a worksheet last ran
 * against. Rows here expose it as the raw string; callers JSON.parse on
 * demand (we treat it as `unknown` once parsed — v0.1 trusts shape).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getDatabase, type Database } from './db';

export interface WorksheetRow {
  id: string;
  title: string;
  body: string;
  cursor_line: number | null;
  cursor_col: number | null;
  scroll_top: number | null;
  last_session_context_json: string | null;
  created_at: number;
  updated_at: number;
}

export interface NewWorksheet {
  id: string;
  title: string;
  body: string;
  cursor_line?: number | null;
  cursor_col?: number | null;
  scroll_top?: number | null;
  last_session_context_json?: string | null;
  last_session_context?: unknown;
}

export interface WorksheetPatch {
  title?: string;
  body?: string;
  cursor_line?: number | null;
  cursor_col?: number | null;
  scroll_top?: number | null;
  last_session_context_json?: string | null;
  last_session_context?: unknown;
}

interface WorksheetStmts {
  listAll: BetterSqlite3.Statement;
  getById: BetterSqlite3.Statement;
  insert: BetterSqlite3.Statement;
  update: BetterSqlite3.Statement;
  upsert: BetterSqlite3.Statement;
  remove: BetterSqlite3.Statement;
}

const stmtCache = new WeakMap<Database, WorksheetStmts>();

function stmts(db: Database): WorksheetStmts {
  const cached = stmtCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  const fresh: WorksheetStmts = {
    listAll: db.prepare('SELECT * FROM worksheets ORDER BY updated_at DESC'),
    getById: db.prepare('SELECT * FROM worksheets WHERE id = ?'),
    insert: db.prepare(
      'INSERT INTO worksheets (' +
        'id, title, body, cursor_line, cursor_col, scroll_top, ' +
        'last_session_context_json, created_at, updated_at' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    update: db.prepare(
      'UPDATE worksheets SET ' +
        'title = ?, body = ?, cursor_line = ?, cursor_col = ?, scroll_top = ?, ' +
        'last_session_context_json = ?, updated_at = ? ' +
        'WHERE id = ?'
    ),
    upsert: db.prepare(
      'INSERT INTO worksheets (' +
        'id, title, body, cursor_line, cursor_col, scroll_top, ' +
        'last_session_context_json, created_at, updated_at' +
        ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET ' +
        'title = excluded.title, body = excluded.body, ' +
        'cursor_line = excluded.cursor_line, cursor_col = excluded.cursor_col, ' +
        'scroll_top = excluded.scroll_top, ' +
        'last_session_context_json = excluded.last_session_context_json, ' +
        'updated_at = excluded.updated_at'
    ),
    remove: db.prepare('DELETE FROM worksheets WHERE id = ?')
  };
  stmtCache.set(db, fresh);
  return fresh;
}

function resolveContextJson(
  json: string | null | undefined,
  parsed: unknown
): string | null {
  if (json !== undefined) {
    return json;
  }
  if (parsed === undefined) {
    return null;
  }
  if (parsed === null) {
    return null;
  }
  return JSON.stringify(parsed);
}

export function listWorksheets(): WorksheetRow[] {
  return stmts(getDatabase()).listAll.all() as WorksheetRow[];
}

export function getWorksheet(id: string): WorksheetRow | null {
  const row = stmts(getDatabase()).getById.get(id) as WorksheetRow | undefined | null;
  return row ?? null;
}

export function insertWorksheet(input: NewWorksheet): WorksheetRow {
  const now = Date.now();
  const row: WorksheetRow = {
    id: input.id,
    title: input.title,
    body: input.body,
    cursor_line: input.cursor_line ?? null,
    cursor_col: input.cursor_col ?? null,
    scroll_top: input.scroll_top ?? null,
    last_session_context_json: resolveContextJson(
      input.last_session_context_json,
      input.last_session_context
    ),
    created_at: now,
    updated_at: now
  };
  stmts(getDatabase()).insert.run(
    row.id,
    row.title,
    row.body,
    row.cursor_line,
    row.cursor_col,
    row.scroll_top,
    row.last_session_context_json,
    row.created_at,
    row.updated_at
  );
  return row;
}

export function updateWorksheet(id: string, patch: WorksheetPatch): WorksheetRow {
  const current = getWorksheet(id);
  if (current === null) {
    throw new Error(`worksheets: no row with id=${id}`);
  }
  const nextContext =
    patch.last_session_context_json !== undefined || patch.last_session_context !== undefined
      ? resolveContextJson(patch.last_session_context_json, patch.last_session_context)
      : current.last_session_context_json;
  const next: WorksheetRow = {
    ...current,
    title: patch.title !== undefined ? patch.title : current.title,
    body: patch.body !== undefined ? patch.body : current.body,
    cursor_line: patch.cursor_line !== undefined ? patch.cursor_line : current.cursor_line,
    cursor_col: patch.cursor_col !== undefined ? patch.cursor_col : current.cursor_col,
    scroll_top: patch.scroll_top !== undefined ? patch.scroll_top : current.scroll_top,
    last_session_context_json: nextContext,
    updated_at: Date.now()
  };
  stmts(getDatabase()).update.run(
    next.title,
    next.body,
    next.cursor_line,
    next.cursor_col,
    next.scroll_top,
    next.last_session_context_json,
    next.updated_at,
    next.id
  );
  return next;
}

export function upsertWorksheet(input: NewWorksheet): WorksheetRow {
  const now = Date.now();
  const existing = getWorksheet(input.id);
  const created_at = existing?.created_at ?? now;
  const row: WorksheetRow = {
    id: input.id,
    title: input.title,
    body: input.body,
    cursor_line: input.cursor_line ?? null,
    cursor_col: input.cursor_col ?? null,
    scroll_top: input.scroll_top ?? null,
    last_session_context_json: resolveContextJson(
      input.last_session_context_json,
      input.last_session_context
    ),
    created_at,
    updated_at: now
  };
  stmts(getDatabase()).upsert.run(
    row.id,
    row.title,
    row.body,
    row.cursor_line,
    row.cursor_col,
    row.scroll_top,
    row.last_session_context_json,
    row.created_at,
    row.updated_at
  );
  return row;
}

export function deleteWorksheet(id: string): boolean {
  const result = stmts(getDatabase()).remove.run(id);
  return result.changes > 0;
}
