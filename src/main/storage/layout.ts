/**
 * pane_layout repo. v0.1 ships with a single workspace whose layout tree
 * is keyed under `workspace_id = 'default'`. The actual structure is the
 * pane-tree the renderer builds (see §5.4); it's opaque JSON to this
 * module — we store/round-trip the parsed payload at the boundary.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { getDatabase, type Database } from './db';

export const DEFAULT_WORKSPACE_ID = 'default';

export interface PaneLayoutRow {
  workspace_id: string;
  tree_json: string;
  updated_at: number;
}

interface LayoutStmts {
  get: BetterSqlite3.Statement;
  upsert: BetterSqlite3.Statement;
}

const stmtCache = new WeakMap<Database, LayoutStmts>();

function stmts(db: Database): LayoutStmts {
  const cached = stmtCache.get(db);
  if (cached !== undefined) {
    return cached;
  }
  const fresh: LayoutStmts = {
    get: db.prepare('SELECT * FROM pane_layout WHERE workspace_id = ?'),
    upsert: db.prepare(
      'INSERT INTO pane_layout (workspace_id, tree_json, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(workspace_id) DO UPDATE SET ' +
        'tree_json = excluded.tree_json, updated_at = excluded.updated_at'
    )
  };
  stmtCache.set(db, fresh);
  return fresh;
}

/**
 * Return the parsed layout tree for the default workspace, or `null` if
 * no layout has been saved yet. The shape is opaque to this module — the
 * caller knows what to do with it.
 */
export function getLayout(): unknown | null {
  const row = stmts(getDatabase()).get.get(DEFAULT_WORKSPACE_ID) as
    | PaneLayoutRow
    | undefined
    | null;
  if (row === undefined || row === null) {
    return null;
  }
  // JSON parsing is the boundary; trust shape per v0.1 internal-data policy.
  return JSON.parse(row.tree_json) as unknown;
}

/**
 * Upsert the layout tree for the default workspace. Serialises with
 * `JSON.stringify` — pass an already-stringified payload only if you
 * know better.
 */
export function setLayout(tree: unknown): void {
  stmts(getDatabase()).upsert.run(DEFAULT_WORKSPACE_ID, JSON.stringify(tree), Date.now());
}
