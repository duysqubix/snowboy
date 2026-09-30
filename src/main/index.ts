import { app, BrowserWindow, dialog, session, shell, type WebContents } from 'electron';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHANNELS } from './ipc/channels';
import { registerIpc } from './ipc/index';
import { closeAllSessions } from './ipc/sessions';
import { waitForRendererFlush } from './ipc/workspace';
import { isAppUrl, isPermissionAllowed, safeExternalUrl } from './security';
import { closeDatabase, openDatabase } from './storage/db';
import { EMBEDDED_MIGRATIONS } from './storage/embedded-migrations';

console.log('[main] snowboy starting');

const moduleDir =
  typeof __dirname === 'string' ? __dirname : fileURLToPath(new URL('.', import.meta.url));

const rendererIndex = join(moduleDir, '../renderer/index.html');
// electron-vite's dev server. An installed app ignores it, so the environment
// can't point it at other content.
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
// The only page a window may show. Navigation, permission and IPC checks all
// compare against it (see security.ts).
const appUrl = devServerUrl ?? pathToFileURL(rendererIndex).href;

let mainWindow: BrowserWindow | null = null;
/** Set once the before-quit shutdown starts; see `second-instance`. */
let quitting = false;

/** Scheme and host only: the rest of a blocked URL may hold a token or a local path. */
function urlForLog(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return 'an invalid URL';
  }
}

/**
 * Applied to every webContents as it's created: it may only show the app,
 * can't open windows or attach a <webview>, and hands https links (the
 * connection wizard's docs links) to the system browser.
 */
function hardenWebContents(contents: WebContents): void {
  const stayInApp = (event: { url: string; preventDefault: () => void }): void => {
    if (isAppUrl(event.url, appUrl)) return;
    event.preventDefault();
    console.warn(`[main] blocked navigation to ${urlForLog(event.url)}`);
  };
  contents.on('will-navigate', stayInApp);
  contents.on('will-redirect', stayInApp);
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.warn('[main] blocked a <webview>');
  });
  contents.setWindowOpenHandler(({ url }) => {
    const external = safeExternalUrl(url);
    if (external === null) {
      console.warn(`[main] blocked a new window for ${urlForLog(url)}`);
    } else {
      setImmediate(() => {
        shell.openExternal(external).catch((err: unknown) => {
          console.warn(`[main] could not open ${urlForLog(external)}: ${String(err)}`);
        });
      });
    }
    return { action: 'deny' };
  });
}

/** Electron grants every web permission by default; allow only what security.ts lists. */
function installPermissionHandlers(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const allowed = isPermissionAllowed(permission, details.requestingUrl, appUrl);
    if (!allowed) console.warn(`[main] denied permission request: ${permission}`);
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, _origin, details) =>
    isPermissionAllowed(permission, details.requestingUrl, appUrl)
  );
}

/** Resolves once the renderer has loaded, and rejects if it can't. */
async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Snowboy',
    icon: join(moduleDir, '../../resources/icon.png'),
    backgroundColor: '#020617',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // CommonJS: a sandboxed preload runs as a plain script, not an ES module.
      preload: join(moduleDir, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // SNOWBOY_DEVTOOLS=1 turns DevTools back on in an installed app, for debugging.
      devTools: !app.isPackaged || process.env['SNOWBOY_DEVTOOLS'] === '1'
    }
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once('ready-to-show', () => {
    win.show();
    if (!app.isPackaged && !process.env['SNOWBOY_DISABLE_DEVTOOLS']) {
      win.webContents.openDevTools({ mode: 'right' });
    }
  });

  let closing = false;
  win.once('close', () => {
    closing = true;
  });

  console.log('[main] window created');
  try {
    await (devServerUrl ? win.loadURL(devServerUrl) : win.loadFile(rendererIndex));
  } catch (err) {
    // Closed or quit during the load, which rejects before the window is
    // destroyed; not a failed start.
    if (closing || win.isDestroyed()) return;
    // Electron rejects with ERR_ABORTED once another navigation starts, even
    // one the guard then blocks, or Vite's dependency reload in dev. The window
    // still ends up on the app, so that isn't a failed start either.
    if (!(err instanceof Error && 'code' in err && err.code === 'ERR_ABORTED')) throw err;
  }
  // The IPC guard answers only appUrl, so a page it didn't recognise would get
  // nothing from main. Fail here instead, where the reason can be shown.
  const shown = win.webContents.getURL();
  if (!isAppUrl(shown, appUrl)) {
    throw new Error(`The window shows ${shown}, which doesn't match the app's ${appUrl}`);
  }
}

async function startup(): Promise<void> {
  // better-sqlite3 loads here, so a broken native module fails startup too.
  // snowflake-sdk loads later, when the first session opens.
  openDatabase({ migrations: EMBEDDED_MIGRATIONS });
  console.log('[main] storage ready');
  installPermissionHandlers();
  registerIpc(appUrl);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((err: unknown) => {
        console.error('[main] could not reopen the window', err);
      });
    }
  });
  await createWindow();
}

/** Explains a failed startup and exits, instead of leaving a process with no window. */
function failStartup(err: unknown): void {
  console.error('[main] startup failed', err);
  try {
    const reason = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      'Snowboy failed to start',
      `${reason}\n\nSnowboy keeps its data in:\n${app.getPath('userData')}`
    );
  } finally {
    app.exit(1);
  }
}

if (!app.requestSingleInstanceLock()) {
  // Another Snowboy has this profile (userData) open. It shows its window when
  // `second-instance` fires, and two processes must not share the stores.
  console.log('[main] Snowboy is already running; exiting');
  app.exit(0);
} else {
  app.on('second-instance', () => {
    // This process is shutting down and can't show a window, but it still holds
    // the lock, so the new launch has exited. Start a fresh one once this exits.
    if (quitting) {
      app.relaunch();
      return;
    }
    if (mainWindow === null) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents);
  });
  void app.whenReady().then(startup).catch(failStartup);
}

/** Waits up to `ms` for `work`; false if it was still running. A rejection is rethrown. */
async function doneWithin(ms: number, work: Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([work.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

let shutdownComplete = false;

app.on('before-quit', (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  // Kept short: until this process exits it holds the single-instance lock, so
  // a relaunch meanwhile only reaches `second-instance`.
  void (async () => {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        try {
          win.webContents.send(CHANNELS.workspaceEvents.requestFlush);
        } catch (err) {
          console.warn('[main] before-quit: requestFlush send failed', err);
        }
      }
      // Closing the last window quits with none left, and then nothing can ack.
      if (windows.length > 0) await waitForRendererFlush(2000);
      if (!(await doneWithin(3000, closeAllSessions()))) {
        console.warn('[main] before-quit: sessions still closing after 3 s; quitting anyway');
      }
    } catch (err) {
      console.warn('[main] before-quit: orchestrated shutdown error', err);
    } finally {
      closeDatabase();
      shutdownComplete = true;
      app.quit();
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
