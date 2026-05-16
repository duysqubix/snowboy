/**
 * T3.6 — history.* IPC handlers.
 *
 * Thin translation layer over Wave 1's `storage/history.ts`. Storage rows
 * are snake_case with `null` for absent fields; the IPC surface is
 * camelCase with `string | undefined` (and `number | undefined`) so the
 * renderer can pattern-match cleanly.
 *
 * Filtering: storage's `listHistory` only natively supports `profileId`,
 * `search`, and `limit`. The handler post-filters for the remaining
 * `HistoryFilter` fields (`worksheetId`, `status`, `since`, `until`,
 * `offset`) — at v0.1 scale (1000-row default cap) this is cheap and
 * keeps the storage layer narrow. T3.6's row filter strips
 * `status='running'` rows because the IPC `HistoryStatus` union does
 * not include them; in-flight queries belong to the renderer's
 * `queries.svelte.ts` store, not the history pane.
 */

import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import {
  getHistory as storageGetHistory,
  listHistory as storageListHistory,
  type QueryHistoryRow
} from '../storage/history';
import type { HistoryEntry, HistoryFilter, HistoryStatus } from '../types';

function rowToEntry(row: QueryHistoryRow): HistoryEntry | null {
  if (row.status === 'running') return null;
  const entry: HistoryEntry = {
    id: row.id,
    profileId: row.profile_id,
    sql: row.sql,
    startedAt: row.started_at,
    status: row.status as HistoryStatus
  };
  if (row.worksheet_id !== null) entry.worksheetId = row.worksheet_id;
  if (row.role !== null) entry.role = row.role;
  if (row.warehouse !== null) entry.warehouse = row.warehouse;
  if (row.database_name !== null) entry.databaseName = row.database_name;
  if (row.schema_name !== null) entry.schemaName = row.schema_name;
  if (row.ended_at !== null) entry.endedAt = row.ended_at;
  if (row.row_count !== null) entry.rowCount = row.row_count;
  if (row.bytes_scanned !== null) entry.bytesScanned = row.bytes_scanned;
  if (row.query_id !== null) entry.queryId = row.query_id;
  if (row.error_message !== null) entry.errorMessage = row.error_message;
  return entry;
}

export function list(filter?: HistoryFilter): HistoryEntry[] {
  const limit = filter?.limit ?? 1000;
  const listOpts: { limit?: number; profileId?: string } = { limit };
  if (filter?.profileId !== undefined) {
    listOpts.profileId = filter.profileId;
  }

  const rows = storageListHistory(listOpts);

  const out: HistoryEntry[] = [];
  for (const row of rows) {
    const entry = rowToEntry(row);
    if (entry === null) continue;
    if (filter?.worksheetId !== undefined && entry.worksheetId !== filter.worksheetId) {
      continue;
    }
    if (filter?.status !== undefined && entry.status !== filter.status) {
      continue;
    }
    if (filter?.since !== undefined && entry.startedAt < filter.since) {
      continue;
    }
    if (filter?.until !== undefined && entry.startedAt > filter.until) {
      continue;
    }
    out.push(entry);
  }

  const offset = filter?.offset ?? 0;
  if (offset > 0) {
    return out.slice(offset);
  }
  return out;
}

export function get(id: string): HistoryEntry {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('history.get: id is required');
  }
  const row = storageGetHistory(id);
  if (row === null) {
    throw new Error(`history.get: no entry with id=${id}`);
  }
  const entry = rowToEntry(row);
  if (entry === null) {
    throw new Error(`history.get: entry id=${id} is still running`);
  }
  return entry;
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.history.list, (_event, filter?: HistoryFilter) => list(filter));
  ipcMain.handle(CHANNELS.history.get, (_event, id: string) => get(id));
}
