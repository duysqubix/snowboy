import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.history.list, () => notImplemented('history.list', 'T3.6'));
  ipcMain.handle(CHANNELS.history.get, () => notImplemented('history.get', 'T3.6'));
}
