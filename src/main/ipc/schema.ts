import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.schema.listDatabases, () =>
    notImplemented('schema.listDatabases', 'T3.5')
  );
  ipcMain.handle(CHANNELS.schema.listSchemas, () =>
    notImplemented('schema.listSchemas', 'T3.5')
  );
  ipcMain.handle(CHANNELS.schema.listObjects, () =>
    notImplemented('schema.listObjects', 'T3.5')
  );
  ipcMain.handle(CHANNELS.schema.getColumns, () =>
    notImplemented('schema.getColumns', 'T3.5')
  );
  ipcMain.handle(CHANNELS.schema.getDDL, () => notImplemented('schema.getDDL', 'T3.5'));
}
