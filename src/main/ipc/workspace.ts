import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.workspace.saveLayout, () =>
    notImplemented('workspace.saveLayout', 'T4.1')
  );
  ipcMain.handle(CHANNELS.workspace.loadLayout, () =>
    notImplemented('workspace.loadLayout', 'T4.1')
  );
  ipcMain.handle(CHANNELS.workspace.saveWorksheet, () =>
    notImplemented('workspace.saveWorksheet', 'T4.2')
  );
  ipcMain.handle(CHANNELS.workspace.listWorksheets, () =>
    notImplemented('workspace.listWorksheets', 'T4.2')
  );
  ipcMain.handle(CHANNELS.workspace.saveWorkspace, () =>
    notImplemented('workspace.saveWorkspace', 'T4.1')
  );
  ipcMain.handle(CHANNELS.workspace.getWorksheet, () =>
    notImplemented('workspace.getWorksheet', 'T4.2')
  );
}
