import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { guardIpcMain, isTrustedIpcSender } from '../security';
import { register as registerConnections } from './connections';
import { register as registerSessions } from './sessions';
import { register as registerQuery } from './query';
import { register as registerSchema } from './schema';
import { register as registerHistory } from './history';
import { register as registerWorkspace } from './workspace';
import { register as registerSettings } from './settings';
import { register as registerTheme } from './theme';

let registered = false;

/**
 * Registers every domain's handlers through one guarded `ipcMain`, so no
 * handler runs for a message unless it comes from the main frame of an app
 * window showing `appUrl` (see `isTrustedIpcSender`).
 */
export function registerIpc(appUrl: string): void {
  if (registered) {
    console.warn('[ipc] registerIpc() called more than once; ignoring');
    return;
  }
  registered = true;

  const guarded = guardIpcMain(ipcMain, (event: IpcMainEvent | IpcMainInvokeEvent) =>
    isTrustedIpcSender(event, appUrl, BrowserWindow.fromWebContents(event.sender) !== null)
  );

  registerConnections(guarded);
  registerSessions(guarded);
  registerQuery(guarded);
  registerSchema(guarded);
  registerHistory(guarded);
  registerWorkspace(guarded);
  registerSettings(guarded);
  registerTheme(guarded);

  console.log('[ipc] handlers registered');
}
