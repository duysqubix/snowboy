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
    test: 'connections.test'
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
  schema: {
    listDatabases: 'schema.list-databases',
    listSchemas: 'schema.list-schemas',
    listObjects: 'schema.list-objects',
    getColumns: 'schema.get-columns',
    getDDL: 'schema.get-ddl'
  },
  history: {
    list: 'history.list',
    get: 'history.get'
  },
  workspace: {
    saveLayout: 'workspace.save-layout',
    loadLayout: 'workspace.load-layout',
    saveWorksheet: 'workspace.save-worksheet',
    listWorksheets: 'workspace.list-worksheets'
  }
} as const;

export type ChannelMap = typeof CHANNELS;
