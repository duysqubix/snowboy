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
    invalidate: (profileId: string, database?: string, schema?: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.schema.invalidate, profileId, database, schema)
  },
  sessionsExt: {
    getEffectiveContext: (sessionId: SessionId): Promise<EffectiveContext | null> =>
      ipcRenderer.invoke(CHANNELS.sessionsExt.getEffectiveContext, sessionId)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(CHANNELS.settings.get),
    set: (partial: Partial<Settings>): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.settings.set, partial)
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
      ipcRenderer.invoke(CHANNELS.workspace.getWorksheet, id)
  }
} satisfies SnowboyApi;

contextBridge.exposeInMainWorld('snowboy', api);
