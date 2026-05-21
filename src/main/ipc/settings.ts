import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.settings.get, () => notImplemented('settings.get', 'T4.3a'));
  ipcMain.handle(CHANNELS.settings.set, () => notImplemented('settings.set', 'T4.3a'));
}
