/**
 * M1.2 renderer hardening, checked in the running app: the preload is
 * sandboxed, only the app page reaches main over IPC, the window can't leave
 * the app or open others, web permissions are denied apart from clipboard
 * writes, and the built page enforces the production CSP. The decisions
 * themselves are unit-tested in tests/unit/security.test.ts.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launchApp } from '../helpers/launch';

const PRELOAD = fileURLToPath(new URL('../../../out/preload/index.cjs', import.meta.url));

interface Navigation {
  url: string;
  blocked: boolean;
}

/** What the tests record in the main process between `app.evaluate` calls. */
interface MainGlobals {
  navigations?: Navigation[];
  opened?: string[];
}

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Snowboy' })).toBeVisible({ timeout: 10_000 });
  return page;
}

test.describe('renderer hardening', () => {
  test('the preload runs sandboxed and the app page reaches main', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const page = await ready(app);
      // World 999 is where Electron runs the preload under contextIsolation.
      // Unsandboxed, it has Node's `process` and `Buffer`.
      const preloadGlobals = await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScriptInIsolatedWorld(999, [
          { code: '`${typeof process} ${typeof Buffer}`' }
        ])
      );
      expect(preloadGlobals).toBe('undefined undefined');

      const settings = await page.evaluate(() => {
        const bridge = window as unknown as { snowboy: { settings: { get(): Promise<object> } } };
        return bridge.snowboy.settings.get();
      });
      expect(settings).toHaveProperty('theme');
      // The preload's synchronous boot call went through too: its fallback has no dataDir.
      const bootDataDir = await page.evaluate(
        () =>
          (window as unknown as { snowboySettingsBoot: { dataDir: string } }).snowboySettingsBoot
            .dataDir
      );
      expect(bootDataDir).toBe(
        await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
      );
    } finally {
      await cleanup();
    }
  });

  test('a window showing any other page gets nothing from main', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      await ready(app);
      // One read-only call per IPC domain module, from an app window with the
      // app's preload that shows another page.
      const answers = await app.evaluate(async ({ BrowserWindow }, preload) => {
        const win = new BrowserWindow({
          show: false,
          webPreferences: { preload, sandbox: true, contextIsolation: true }
        });
        try {
          await win.loadURL('data:text/html,<p>not the app</p>');
          return await win.webContents.executeJavaScript(`(async () => {
            const api = window.snowboy;
            const calls = {
              connections: () => api.connections.listProfiles(),
              sessions: () => api.sessions.close('none'),
              query: () => api.query.cancel('none'),
              schema: () => api.schema.listDatabases('none'),
              history: () => api.history.list(),
              workspace: () => api.workspace.loadLayout(),
              settings: () => api.settings.get(),
              theme: () => api.theme.get()
            };
            const answers = { bootDataDir: window.snowboySettingsBoot.dataDir };
            for (const [domain, call] of Object.entries(calls)) {
              answers[domain] = await call().then(() => 'answered', (err) => err.message);
            }
            return answers;
          })()`);
        } finally {
          win.destroy();
        }
      }, PRELOAD);

      const { bootDataDir, ...domains } = answers as Record<string, string>;
      // The preload's sendSync boot got null, so it used its fallback instead of hanging.
      expect(bootDataDir).toBe('');
      expect(Object.keys(domains)).toHaveLength(8);
      for (const [domain, answer] of Object.entries(domains)) {
        expect(answer, domain).toContain('Blocked IPC');
      }
    } finally {
      await cleanup();
    }
  });

  test('the window stays on the app when the page tries to navigate away', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const page = await ready(app);
      const appUrl = page.url();
      // Registered after main's own will-navigate handler, so it sees the verdict.
      await app.evaluate(({ BrowserWindow }) => {
        const navigations: Navigation[] = [];
        (globalThis as MainGlobals).navigations = navigations;
        BrowserWindow.getAllWindows()[0]?.webContents.on('will-navigate', (event) => {
          navigations.push({ url: event.url, blocked: event.defaultPrevented });
        });
      });
      const navigations = () => app.evaluate(() => (globalThis as MainGlobals).navigations);

      // A remote page, then a local file: what dropping a file on the window loads.
      await page.evaluate(() => {
        window.location.href = 'https://example.com/';
      });
      await expect.poll(navigations).toEqual([{ url: 'https://example.com/', blocked: true }]);
      await page.evaluate(() => {
        window.location.href = 'file:///etc/hosts';
      });
      await expect.poll(navigations).toEqual([
        { url: 'https://example.com/', blocked: true },
        { url: 'file:///etc/hosts', blocked: true }
      ]);

      // Asked through main: Playwright still counts the cancelled navigations
      // as pending, so its page locators would wait for them forever.
      const shown = await app.evaluate(async ({ BrowserWindow }) => {
        const contents = BrowserWindow.getAllWindows()[0]?.webContents;
        return {
          url: contents?.getURL(),
          heading: await contents?.executeJavaScript('document.querySelector("h1")?.textContent')
        };
      });
      expect(shown).toEqual({ url: appUrl, heading: 'Snowboy' });
    } finally {
      await cleanup();
    }
  });

  test('window.open never opens a window; only docs links reach the system browser', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const page = await ready(app);
      // Record what would be opened, instead of launching the real browser.
      await app.evaluate(({ shell }) => {
        const opened: string[] = [];
        (globalThis as MainGlobals).opened = opened;
        shell.openExternal = async (url: string) => {
          opened.push(url);
        };
      });

      const openedWindows = await page.evaluate(() =>
        [
          'https://docs.snowflake.com/en/user-guide/key-pair-auth',
          'https://example.com/',
          'http://docs.snowflake.com/',
          'file:///etc/hosts'
        ].map((url) => window.open(url) !== null)
      );

      expect(openedWindows).toEqual([false, false, false, false]);
      await expect
        .poll(() => app.evaluate(() => (globalThis as MainGlobals).opened))
        .toEqual(['https://docs.snowflake.com/en/user-guide/key-pair-auth']);
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
      );
    } finally {
      await cleanup();
    }
  });

  test('web permissions are denied, except writing to the clipboard', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const page = await ready(app);
      // Electron grants all of these when the app sets no handlers.
      const permissions = await page.evaluate(async () => {
        const query = async (name: string) =>
          (await navigator.permissions.query({ name: name as PermissionName })).state;
        return {
          clipboardWrite: await query('clipboard-write'),
          geolocation: await query('geolocation'),
          notifications: await Notification.requestPermission()
        };
      });

      expect(permissions).toEqual({
        clipboardWrite: 'granted',
        geolocation: 'denied',
        notifications: 'denied'
      });
    } finally {
      await cleanup();
    }
  });

  test('the built page enforces the production CSP', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const page = await ready(app);
      const source = readFileSync(
        new URL('../../../src/renderer/index.html', import.meta.url),
        'utf8'
      );
      const reviewed = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(source)?.[1];

      const built = await page.evaluate(() =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content')
      );
      expect(reviewed).toBeDefined();
      expect(built).toBe(reviewed);

      const inlineScriptRan = await page.evaluate(() => {
        const script = document.createElement('script');
        script.textContent = 'window.__inlineScriptRan = true;';
        document.head.append(script);
        return (window as unknown as { __inlineScriptRan?: boolean }).__inlineScriptRan === true;
      });
      expect(inlineScriptRan).toBe(false);

      // In a file:// page 'self' matches every local file, so the page may
      // fetch none, not even its own.
      const fetched = await page.evaluate(() =>
        fetch(window.location.href).then(
          () => 'fetched',
          () => 'blocked'
        )
      );
      expect(fetched).toBe('blocked');
    } finally {
      await cleanup();
    }
  });
});
