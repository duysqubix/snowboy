/**
 * Single source of truth for IPC channel strings. Both the preload
 * (`ipcRenderer.invoke`) and main (`ipcMain.handle`) sides import from here so
 * channel names cannot drift between the two halves of the surface.
 */
export const CHANNELS = {
  connections: {
    listProfiles: 'connections.list-profiles',
    saveProfile: 'connections.save-profile',
    deleteProfile: 'connections.delete-profile',
    test: 'connections.test',
    setPassword: 'connections.set-password',
    clearPassword: 'connections.clear-password',
    hasPassword: 'connections.has-password'
  },
  sessions: {
    open: 'sessions.open',
    close: 'sessions.close',
    setContext: 'sessions.set-context'
  },
  query: {
    run: 'query.run',
    cancel: 'query.cancel'
  },
  queryEvents: {
    rowBatch: 'query.row-batch',
    complete: 'query.complete',
    error: 'query.error'
  },
  schema: {
    listDatabases: 'schema.list-databases',
    listSchemas: 'schema.list-schemas',
    listObjects: 'schema.list-objects',
    getColumns: 'schema.get-columns',
    getDDL: 'schema.get-ddl',
    invalidate: 'schema.invalidate'
  },
  history: {
    list: 'history.list',
    get: 'history.get'
  },
  workspace: {
    saveLayout: 'workspace.save-layout',
    loadLayout: 'workspace.load-layout',
    saveWorksheet: 'workspace.save-worksheet',
    listWorksheets: 'workspace.list-worksheets',
    saveWorkspace: 'workspace.save-workspace',
    getWorksheet: 'workspace.get-worksheet',
    flushAck: 'workspace.flush-ack'
  },
  workspaceEvents: {
    requestFlush: 'workspace.request-flush'
  },
  settings: {
    get: 'settings.get',
    set: 'settings.set',
    boot: 'settings.boot'
  },
  settingsEvents: {
    changed: 'settings.changed'
  },
  theme: {
    get: 'theme.get'
  },
  themeEvents: {
    changed: 'theme.changed'
  },
  sessionsExt: {
    getEffectiveContext: 'sessions.get-effective-context'
  }
} as const;

export type ChannelMap = typeof CHANNELS;
