import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.connections.listProfiles, () =>
    notImplemented('connections.listProfiles', 'T3.1')
  );
  ipcMain.handle(CHANNELS.connections.saveProfile, () =>
    notImplemented('connections.saveProfile', 'T3.1')
  );
  ipcMain.handle(CHANNELS.connections.deleteProfile, () =>
    notImplemented('connections.deleteProfile', 'T3.1')
  );
  ipcMain.handle(CHANNELS.connections.test, () =>
    notImplemented('connections.test', 'T3.1')
  );
}
