import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CHANNELS } from '../main/ipc/channels';
import type {
  Column,
  ConnectionProfile,
  EffectiveContext,
  EffectiveTheme,
  HistoryEntry,
  HistoryFilter,
  LayoutTree,
  LayoutTreeSerialized,
  ObjectRef,
  QueryCompleteEvent,
  QueryErrorEvent,
  QueryId,
  QueryRowBatchEvent,
  RunOptions,
  SchemaObject,
  SessionContext,
  SessionId,
  Settings,
  SnowboyApi,
  TestResult,
  ThemeChangedEvent,
  Worksheet
} from '../main/types';

/**
 * Synchronous settings boot. The renderer's theme decision (T4.4a)
 * must run before first paint to avoid FOUC, so we cannot wait for
 * an `invoke()` round-trip during renderer hydration. `sendSync`
 * blocks the preload thread until the main process responds; the
 * main `settings.boot` handler is registered before any
 * `BrowserWindow.loadURL` fires, so the round-trip is bounded by a
 * single sync handler call (a few ms) and only happens once per
 * preload script execution.
 */
function readSettingsBoot(): Settings {
  try {
    const raw: unknown = ipcRenderer.sendSync(CHANNELS.settings.boot);
    if (raw && typeof raw === 'object') {
      return raw as Settings;
    }
    console.warn(
      '[preload] settings.boot returned non-object payload; using fallback'
    );
  } catch (err) {
    console.warn(
      `[preload] settings.boot sendSync failed: ${(err as Error).message}; using fallback`
    );
  }
  return {
    theme: 'system',
    fontSize: 14,
    tabWidth: 2,
    wordWrap: true,
    telemetryEnabled: false,
    dataDir: ''
  };
}

const settingsBoot = readSettingsBoot();

/**
 * Apply the boot theme to `<html>` BEFORE the renderer paints (T4.4a FOUC
 * fix). Skipping this lets the page render in default light then flip to
 * dark after Svelte hydration — a visible white flash on dark systems.
 *
 * Effective theme = settings.theme when explicit (`light`/`dark`), else a
 * sync `theme.boot` IPC that reads `nativeTheme.shouldUseDarkColors`. The
 * preload shares the DOM with the renderer even under `contextIsolation:
 * true`, so writing `classList` here is safe and observed by Tailwind's
 * `dark:` variant from the very first paint.
 */
const bootEffectiveTheme: EffectiveTheme = (() => {
  try {
    const mode = settingsBoot.theme;
    if (mode === 'light' || mode === 'dark') return mode;
    const raw: unknown = ipcRenderer.sendSync('theme.boot');
    return raw === 'dark' ? 'dark' : 'light';
  } catch (err) {
    console.warn(
      `[preload] boot theme resolve failed: ${(err as Error).message}; defaulting to light`
    );
    return 'light';
  }
})();

function applyBootTheme(): void {
  const root = document.documentElement;
  if (root === null) {
    console.warn('[preload] applyBootTheme: documentElement is null at apply time');
    return;
  }
  root.classList.toggle('dark', bootEffectiveTheme === 'dark');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyBootTheme, { once: true });
} else {
  applyBootTheme();
}

function makeEventBridge<T>(channel: string) {
  return (handler: (event: T) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: T): void => {
      handler(payload);
    };
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.off(channel, listener);
    };
  };
}

const api = {
  connections: {
    listProfiles: (): Promise<ConnectionProfile[]> =>
      ipcRenderer.invoke(CHANNELS.connections.listProfiles),
    saveProfile: (p: ConnectionProfile): Promise<{ id: string }> =>
      ipcRenderer.invoke(CHANNELS.connections.saveProfile, p),
    deleteProfile: (id: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.connections.deleteProfile, id),
    test: (profileId: string, passcode?: string): Promise<TestResult> =>
      ipcRenderer.invoke(CHANNELS.connections.test, profileId, passcode),
    setPassword: (profileId: string, password: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.connections.setPassword, profileId, password),
    clearPassword: (profileId: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.connections.clearPassword, profileId),
    hasPassword: (profileId: string): Promise<boolean> =>
      ipcRenderer.invoke(CHANNELS.connections.hasPassword, profileId)
  },
  sessions: {
    open: (
      profileId: string,
      context: SessionContext,
      passcode?: string
    ): Promise<SessionId> =>
      ipcRenderer.invoke(CHANNELS.sessions.open, profileId, context, passcode),
    close: (sessionId: SessionId): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessions.close, sessionId),
    setContext: (
      sessionId: SessionId,
      context: Partial<SessionContext>
    ): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessions.setContext, sessionId, context)
  },
  query: {
    run: (
      sessionId: SessionId,
      sql: string,
      options?: RunOptions
    ): Promise<QueryId> =>
      ipcRenderer.invoke(CHANNELS.query.run, sessionId, sql, options),
    cancel: (queryId: QueryId): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.query.cancel, queryId)
  },
  queryEvents: {
    onRowBatch: makeEventBridge<QueryRowBatchEvent>(CHANNELS.queryEvents.rowBatch),
    onComplete: makeEventBridge<QueryCompleteEvent>(CHANNELS.queryEvents.complete),
    onError: makeEventBridge<QueryErrorEvent>(CHANNELS.queryEvents.error)
  },
  schema: {
    listDatabases: (sessionId: SessionId): Promise<string[]> =>
      ipcRenderer.invoke(CHANNELS.schema.listDatabases, sessionId),
    listSchemas: (sessionId: SessionId, db: string): Promise<string[]> =>
      ipcRenderer.invoke(CHANNELS.schema.listSchemas, sessionId, db),
    listObjects: (
      sessionId: SessionId,
      db: string,
      schema: string
    ): Promise<SchemaObject[]> =>
      ipcRenderer.invoke(CHANNELS.schema.listObjects, sessionId, db, schema),
    getColumns: (sessionId: SessionId, obj: ObjectRef): Promise<Column[]> =>
      ipcRenderer.invoke(CHANNELS.schema.getColumns, sessionId, obj),
    getDDL: (sessionId: SessionId, obj: ObjectRef): Promise<string> =>
      ipcRenderer.invoke(CHANNELS.schema.getDDL, sessionId, obj),
    listRoles: (sessionId: SessionId): Promise<string[]> =>
      ipcRenderer.invoke(CHANNELS.schema.listRoles, sessionId),
    listWarehouses: (sessionId: SessionId): Promise<string[]> =>
      ipcRenderer.invoke(CHANNELS.schema.listWarehouses, sessionId),
    invalidate: (profileId: string, database?: string, schema?: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.schema.invalidate, profileId, database, schema)
  },
  sessionsExt: {
    getEffectiveContext: (sessionId: SessionId): Promise<EffectiveContext | null> =>
      ipcRenderer.invoke(CHANNELS.sessionsExt.getEffectiveContext, sessionId),
    onEffectiveContextChanged: makeEventBridge<{ sessionId: SessionId }>(
      CHANNELS.sessionsExt.events.effectiveContextChanged
    )
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(CHANNELS.settings.get),
    set: (partial: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(CHANNELS.settings.set, partial),
    onChanged: makeEventBridge<Settings>(CHANNELS.settingsEvents.changed)
  },
  theme: {
    get: (): Promise<EffectiveTheme> => ipcRenderer.invoke(CHANNELS.theme.get),
    onChanged: makeEventBridge<ThemeChangedEvent>(CHANNELS.themeEvents.changed)
  },
  history: {
    list: (filter?: HistoryFilter): Promise<HistoryEntry[]> =>
      ipcRenderer.invoke(CHANNELS.history.list, filter),
    get: (id: string): Promise<HistoryEntry> =>
      ipcRenderer.invoke(CHANNELS.history.get, id)
  },
  workspace: {
    saveLayout: (layout: LayoutTree): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.workspace.saveLayout, layout),
    loadLayout: (): Promise<LayoutTree> =>
      ipcRenderer.invoke(CHANNELS.workspace.loadLayout),
    saveWorksheet: (w: Worksheet): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.workspace.saveWorksheet, w),
    listWorksheets: (): Promise<Worksheet[]> =>
      ipcRenderer.invoke(CHANNELS.workspace.listWorksheets),
    saveWorkspace: (payload: {
      layout: LayoutTreeSerialized;
      worksheets: Worksheet[];
    }): Promise<void> => ipcRenderer.invoke(CHANNELS.workspace.saveWorkspace, payload),
    getWorksheet: (id: string): Promise<Worksheet | null> =>
      ipcRenderer.invoke(CHANNELS.workspace.getWorksheet, id),
    flushAck: (): Promise<void> => ipcRenderer.invoke(CHANNELS.workspace.flushAck)
  },
  workspaceEvents: {
    onRequestFlush: (handler: () => void): (() => void) => {
      const listener = (): void => {
        handler();
      };
      ipcRenderer.on(CHANNELS.workspaceEvents.requestFlush, listener);
      return () => {
        ipcRenderer.off(CHANNELS.workspaceEvents.requestFlush, listener);
      };
    }
  }
} satisfies SnowboyApi;

contextBridge.exposeInMainWorld('snowboy', api);
contextBridge.exposeInMainWorld('snowboySettingsBoot', settingsBoot);
