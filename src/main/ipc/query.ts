/**
 * T3.3 + T3.4 + T3.6 — query.* IPC handlers.
 *
 * Wires the renderer's `window.snowboy.query.run / cancel` surface to a
 * live `Session` (resolved from `sessionRegistry`) and streams row
 * batches back via `webContents.send`. T3.6 history capture rides on
 * the same lifecycle: a placeholder row is inserted on `run` and
 * UPDATEd to a terminal status (`success` / `error` / `cancelled`)
 * inside each streaming callback.
 *
 * Architecture notes:
 *
 *   - Two `QueryId` spaces. The handler generates a fresh `nanoid` for
 *     the queryId returned to the renderer; this is also the key into
 *     `activeQueries`, the `query_history.id`, and the demux key for
 *     row-batch events. The Snowflake-side query UUID is recorded in
 *     `query_history.query_id` once `runStreaming`'s `queryIdPromise`
 *     resolves — separate fields, never overloaded.
 *
 *   - Window resolution. Streaming events go to a `BrowserWindow` via
 *     `webContents.send`. v0.1 is single-window; the default getter
 *     returns `BrowserWindow.getAllWindows()[0]`. Tests inject a fake
 *     window with `__setMainWindowGetterForTesting` so a mock
 *     `webContents.send` can be asserted on directly. If the window is
 *     gone (closed mid-query), `send` becomes a no-op — the renderer
 *     would never receive the event anyway.
 *
 *   - Status placeholder. `query_history.status` is `TEXT NOT NULL`
 *     with no CHECK, so the SQL accepts `'running'` even though the IPC
 *     `HistoryStatus` union does not. `history.list` filters running
 *     rows out so the IPC contract stays honest.
 *
 *   - Cancel ergonomics. `Session.runStreaming` already wires
 *     `handle.cancel()` to issue `SYSTEM$CANCEL_QUERY` once the
 *     Snowflake query id resolves, and emits `onCancel` once the
 *     in-flight row loop exits. The handler delegates to that — no
 *     direct `cancelQuery` call — so cancellation has a single source
 *     of truth and double-cancel is internally idempotent.
 */

import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { BrowserWindow, IpcMain } from 'electron';
import { CHANNELS } from './channels';

const localRequire = createRequire(import.meta.url);
import { getSession } from './sessions';
import { insertHistory, updateHistory } from '../storage/history';
import type { ResultColumn, RunOptions, SessionId as IpcSessionId } from '../types';
import type { Session } from '../snowflake/session';
import type {
  ColumnMeta,
  QueryCompleteEvent as DriverCompleteEvent,
  RowBatch,
  RunOptions as DriverRunOptions,
  SessionId as DriverSessionId,
  StreamingHandle
} from '../snowflake/types';

type QueryIdBrand = string & { readonly __brand: 'QueryId' };

interface ActiveQueryEntry {
  handle: StreamingHandle;
  sessionId: DriverSessionId;
  profileId: string;
  sql: string;
  startedAt: number;
}

const activeQueries = new Map<QueryIdBrand, ActiveQueryEntry>();

type MainWindowGetter = () => BrowserWindow | null;

function defaultWindowGetter(): BrowserWindow | null {
  try {
    type ElectronModule = { BrowserWindow?: typeof BrowserWindow };
    const mod = localRequire('electron') as ElectronModule;
    if (mod?.BrowserWindow === undefined) return null;
    const all = mod.BrowserWindow.getAllWindows();
    return all[0] ?? null;
  } catch {
    return null;
  }
}

let mainWindowGetter: MainWindowGetter = defaultWindowGetter;

/**
 * Test-only: install a fake main-window getter. Pass `null` to revert
 * to the production default that picks the first BrowserWindow.
 */
export function __setMainWindowGetterForTesting(
  getter: MainWindowGetter | null
): void {
  mainWindowGetter = getter ?? defaultWindowGetter;
}

function asQueryId(value: string): QueryIdBrand {
  return value as QueryIdBrand;
}

function sendEvent(channel: string, payload: unknown): void {
  const win = mainWindowGetter();
  if (win === null) return;
  if (win.isDestroyed?.()) return;
  win.webContents.send(channel, payload);
}

function toResultColumns(cols: readonly ColumnMeta[]): ResultColumn[] {
  const out: ResultColumn[] = new Array(cols.length);
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c === undefined) continue;
    out[i] = { name: c.name, dataType: c.type, nullable: c.nullable };
  }
  return out;
}

const USE_CONTEXT_PATTERN = /^\s*USE\s+(DATABASE|SCHEMA|WAREHOUSE|ROLE)\b/i;

function isContextChangingSql(sql: string): boolean {
  return USE_CONTEXT_PATTERN.test(sql);
}

function rowsToObjects(
  rows: readonly unknown[][],
  columns: readonly ColumnMeta[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = new Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const src = rows[r];
    if (src === undefined) {
      out[r] = {};
      continue;
    }
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < columns.length; c++) {
      const meta = columns[c];
      if (meta === undefined) continue;
      obj[meta.name] = src[c];
    }
    out[r] = obj;
  }
  return out;
}

function translateRunOptions(opts: RunOptions | undefined): DriverRunOptions {
  const out: { -readonly [K in keyof DriverRunOptions]?: DriverRunOptions[K] } = {};
  if (opts?.fetchSize !== undefined && opts.fetchSize > 0) {
    out.batchSize = opts.fetchSize;
  }
  if (opts?.timeoutMs !== undefined && opts.timeoutMs > 0) {
    out.timeoutMs = opts.timeoutMs;
  }
  return out as DriverRunOptions;
}

export async function run(
  sessionId: IpcSessionId,
  sql: string,
  options?: RunOptions
): Promise<QueryIdBrand> {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('query.run: sessionId is required');
  }
  if (typeof sql !== 'string' || sql.length === 0) {
    throw new Error('query.run: sql is required');
  }

  const session = getSession(sessionId);
  if (session === undefined) {
    throw new Error(`query.run: unknown sessionId: ${sessionId}`);
  }

  const queryId = asQueryId(randomUUID());
  const startedAt = Date.now();
  const ctx = session.getContext();
  const profileId = session.getProfileId();

  insertHistory({
    id: queryId,
    worksheet_id: null,
    profile_id: profileId,
    role: ctx.role ?? null,
    warehouse: ctx.warehouse ?? null,
    database_name: ctx.database ?? null,
    schema_name: ctx.schema ?? null,
    sql,
    started_at: startedAt,
    status: 'running'
  });

  const driverOpts = translateRunOptions(options);

  const handle = session.runStreaming(sql, driverOpts, {
    onBatch: (batch: RowBatch) => {
      const columns = toResultColumns(batch.columns);
      const rows = rowsToObjects(batch.rows, batch.columns);
      sendEvent(CHANNELS.queryEvents.rowBatch, {
        queryId,
        rows,
        columns
      });
    },
    onComplete: (event: DriverCompleteEvent) => {
      const endedAt = Date.now();
      activeQueries.delete(queryId);
      try {
        updateHistory(queryId, {
          ended_at: endedAt,
          status: 'success',
          row_count: event.rowCount,
          bytes_scanned: event.bytesScanned,
          query_id: event.queryId
        });
      } catch (historyErr) {
        console.warn('[query] failed to update history on complete', historyErr);
      }
      if (isContextChangingSql(sql)) {
        session.invalidateEffectiveContext();
        sendEvent(CHANNELS.sessionsExt.events.effectiveContextChanged, { sessionId });
      }
      sendEvent(CHANNELS.queryEvents.complete, {
        queryId,
        totalRows: event.rowCount,
        durationMs: endedAt - startedAt,
        warehouse: event.warehouseUsed === '' ? undefined : event.warehouseUsed
      });
    },
    onError: (err: Error) => {
      const endedAt = Date.now();
      activeQueries.delete(queryId);
      const message = err instanceof Error ? err.message : String(err);
      try {
        updateHistory(queryId, {
          ended_at: endedAt,
          status: 'error',
          error_message: message
        });
      } catch (historyErr) {
        console.warn('[query] failed to update history on error', historyErr);
      }
      sendEvent(CHANNELS.queryEvents.error, {
        queryId,
        message
      });
    },
    onCancel: () => {
      const endedAt = Date.now();
      activeQueries.delete(queryId);
      try {
        updateHistory(queryId, {
          ended_at: endedAt,
          status: 'cancelled'
        });
      } catch (historyErr) {
        console.warn('[query] failed to update history on cancel', historyErr);
      }
      sendEvent(CHANNELS.queryEvents.error, {
        queryId,
        message: 'Query cancelled'
      });
    }
  });

  activeQueries.set(queryId, {
    handle,
    sessionId: session.getId(),
    profileId,
    sql,
    startedAt
  });

  return queryId;
}

export async function cancel(queryId: string): Promise<void> {
  if (typeof queryId !== 'string' || queryId.length === 0) {
    return;
  }
  const entry = activeQueries.get(asQueryId(queryId));
  if (entry === undefined) {
    return;
  }
  entry.handle.cancel();
}

/**
 * Test-only: wipe the in-memory active-queries map. Prevents bleed
 * between test cases since the registry is module-scoped.
 */
export function __clearActiveForTesting(): void {
  activeQueries.clear();
}

/**
 * Test-only: read the active-queries count for assertions.
 */
export function __activeCountForTesting(): number {
  return activeQueries.size;
}

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(
    CHANNELS.query.run,
    (_event, sessionId: string, sql: string, options?: RunOptions) =>
      run(sessionId as IpcSessionId, sql, options)
  );
  ipcMain.handle(CHANNELS.query.cancel, (_event, queryId: string) => cancel(queryId));
}

export type { Session };
