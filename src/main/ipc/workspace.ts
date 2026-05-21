/**
 * T4.1/T4.2 — workspace.* IPC handlers.
 *
 * Translates between the renderer-facing `Worksheet` (camelCase,
 * `string | undefined`, parsed `lastSessionContext`) and Wave 1's
 * `WorksheetRow` (snake_case, `null`, JSON blob for context).
 *
 * `saveWorksheet` uses `upsertWorksheet` (NOT `updateWorksheet`): the
 * renderer mints a `worksheetId` at pane creation but the row does not
 * exist until the first debounce flush — `updateWorksheet` would throw
 * on the initial insert race.
 *
 * Handler functions are exported for direct unit testing; `register()`
 * is the thin adapter that wires them onto Electron's invoke channels.
 * `saveLayout`/`loadLayout`/`saveWorkspace` are still T4.1 stubs.
 */

import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';
import {
  getWorksheet as storageGetWorksheet,
  listWorksheets as storageListWorksheets,
  upsertWorksheet as storageUpsertWorksheet,
  type WorksheetRow
} from '../storage/worksheets';
import type { SessionContext, Worksheet } from '../types';

function rowToWorksheet(row: WorksheetRow): Worksheet {
  const w: Worksheet = {
    id: row.id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
  if (row.cursor_line !== null) w.cursorLine = row.cursor_line;
  if (row.cursor_col !== null) w.cursorCol = row.cursor_col;
  if (row.scroll_top !== null) w.scrollTop = row.scroll_top;
  if (row.last_session_context_json !== null) {
    try {
      w.lastSessionContext = JSON.parse(row.last_session_context_json) as SessionContext;
    } catch {
      // Corrupt JSON in storage falls back to "no context" so a stale row
      // from an earlier version never blocks hydration of the body.
    }
  }
  return w;
}

export function saveWorksheet(w: Worksheet): Worksheet {
  if (typeof w?.id !== 'string' || w.id.length === 0) {
    throw new Error('saveWorksheet: worksheet.id is required');
  }
  if (typeof w.title !== 'string') {
    throw new Error('saveWorksheet: worksheet.title must be a string');
  }
  if (typeof w.body !== 'string') {
    throw new Error('saveWorksheet: worksheet.body must be a string');
  }

  const row = storageUpsertWorksheet({
    id: w.id,
    title: w.title,
    body: w.body,
    cursor_line: w.cursorLine ?? null,
    cursor_col: w.cursorCol ?? null,
    scroll_top: w.scrollTop ?? null,
    last_session_context: w.lastSessionContext ?? null
  });
  return rowToWorksheet(row);
}

export function getWorksheet(id: string): Worksheet | null {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('getWorksheet: id is required');
  }
  const row = storageGetWorksheet(id);
  return row === null ? null : rowToWorksheet(row);
}

export function listWorksheets(): Worksheet[] {
  return storageListWorksheets().map(rowToWorksheet);
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.workspace.saveLayout, () =>
    notImplemented('workspace.saveLayout', 'T4.1')
  );
  ipcMain.handle(CHANNELS.workspace.loadLayout, () =>
    notImplemented('workspace.loadLayout', 'T4.1')
  );
  ipcMain.handle(CHANNELS.workspace.saveWorkspace, () =>
    notImplemented('workspace.saveWorkspace', 'T4.1')
  );

  ipcMain.handle(CHANNELS.workspace.saveWorksheet, (_event, w: Worksheet) =>
    saveWorksheet(w)
  );
  ipcMain.handle(CHANNELS.workspace.getWorksheet, (_event, id: string) =>
    getWorksheet(id)
  );
  ipcMain.handle(CHANNELS.workspace.listWorksheets, () => listWorksheets());
}
