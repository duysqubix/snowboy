import { ipcMain } from 'electron';
import { register as registerConnections } from './connections';
import { register as registerSessions } from './sessions';
import { register as registerQuery } from './query';
import { register as registerSchema } from './schema';
import { register as registerHistory } from './history';
import { register as registerWorkspace } from './workspace';
import { register as registerSettings } from './settings';
import { register as registerTheme } from './theme';

let registered = false;

export function registerIpc(): void {
  if (registered) {
    console.warn('[ipc] registerIpc() called more than once; ignoring');
    return;
  }
  registered = true;

  registerConnections(ipcMain);
  registerSessions(ipcMain);
  registerQuery(ipcMain);
  registerSchema(ipcMain);
  registerHistory(ipcMain);
  registerWorkspace(ipcMain);
  registerSettings(ipcMain);
  registerTheme(ipcMain);

  console.log('[ipc] handlers registered');
}
