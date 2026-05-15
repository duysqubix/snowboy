import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('[main] snowboy starting');

const moduleDir = typeof __dirname === 'string'
  ? __dirname
  : fileURLToPath(new URL('.', import.meta.url));

/**
 * T0.2 smoke gate: prove that `snowflake-sdk` (pure JS) and `better-sqlite3`
 * (native, must be ABI-compatible with Electron's bundled Node) both load
 * inside Electron's main process. Failing here means a packaging / rebuild
 * problem and the rest of the app cannot function — exit immediately so
 * developers see the issue instead of cascading failures downstream.
 */
async function smokeLoadNatives(): Promise<void> {
  try {
    type SnowflakeNamespace = typeof import('snowflake-sdk');
    const snowflakeMod = (await import('snowflake-sdk')) as unknown as
      SnowflakeNamespace & { default?: SnowflakeNamespace };
    const snowflake: SnowflakeNamespace = snowflakeMod.default ?? snowflakeMod;
    if (typeof snowflake.createConnection !== 'function') {
      throw new Error('snowflake-sdk loaded but createConnection is not a function');
    }

    const sqliteMod = await import('better-sqlite3');
    const Database = sqliteMod.default;
    if (typeof Database !== 'function') {
      throw new Error('better-sqlite3 loaded but its default export is not a constructor');
    }
    const db = new Database(':memory:');
    try {
      const row = db.prepare('SELECT 1 AS x').get() as { x?: number } | undefined;
      if (!row || row.x !== 1) {
        throw new Error(`better-sqlite3 SELECT 1 returned unexpected value: ${JSON.stringify(row)}`);
      }
    } finally {
      db.close();
    }

    console.log('[main] natives ok');
  } catch (err) {
    console.error('[main] natives FAILED');
    console.error(err);
    app.exit(1);
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Snowboy',
    backgroundColor: '#020617',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(moduleDir, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });

  win.once('ready-to-show', () => {
    win.show();
    if (!app.isPackaged) {
      win.webContents.openDevTools({ mode: 'right' });
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(moduleDir, '../renderer/index.html'));
  }

  console.log('[main] window created');
}

void app.whenReady().then(async () => {
  await smokeLoadNatives();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
