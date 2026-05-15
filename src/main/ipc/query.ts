import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.query.run, () => notImplemented('query.run', 'T3.3'));
  ipcMain.handle(CHANNELS.query.cancel, () => notImplemented('query.cancel', 'T3.3'));
}
