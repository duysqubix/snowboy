import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../main/ipc/channels';
import type {
  Column,
  ConnectionProfile,
  HistoryEntry,
  HistoryFilter,
  LayoutTree,
  ObjectRef,
  QueryId,
  RunOptions,
  SchemaObject,
  SessionContext,
  SessionId,
  SnowboyApi,
  TestResult,
  Worksheet
} from '../main/types';

const api = {
  connections: {
    listProfiles: (): Promise<ConnectionProfile[]> =>
      ipcRenderer.invoke(CHANNELS.connections.listProfiles),
    saveProfile: (p: ConnectionProfile): Promise<{ id: string }> =>
      ipcRenderer.invoke(CHANNELS.connections.saveProfile, p),
    deleteProfile: (id: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.connections.deleteProfile, id),
    test: (profileId: string): Promise<TestResult> =>
      ipcRenderer.invoke(CHANNELS.connections.test, profileId)
  },
  sessions: {
    open: (profileId: string, context: SessionContext): Promise<SessionId> =>
      ipcRenderer.invoke(CHANNELS.sessions.open, profileId, context),
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
      ipcRenderer.invoke(CHANNELS.schema.getDDL, sessionId, obj)
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
      ipcRenderer.invoke(CHANNELS.workspace.listWorksheets)
  }
} satisfies SnowboyApi;

contextBridge.exposeInMainWorld('snowboy', api);
