import type { IpcMain } from 'electron';
import { CHANNELS } from './channels';
import { notImplemented } from './errors';

export function register(ipcMain: IpcMain): void {
  ipcMain.handle(CHANNELS.sessions.open, () => notImplemented('sessions.open', 'T3.2'));
  ipcMain.handle(CHANNELS.sessions.close, () => notImplemented('sessions.close', 'T3.2'));
  ipcMain.handle(CHANNELS.sessions.setContext, () =>
    notImplemented('sessions.setContext', 'T3.2')
  );
}
