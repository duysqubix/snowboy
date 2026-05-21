/**
 * Visual smoke gate. Asserts the renderer actually mounts — catches the bug
 * class where main-process logs look healthy but the user sees a blank
 * window (404'd renderer URL, broken Svelte mount, JS bundle crash). Do not
 * weaken or skip; every wave touching UI must keep this green.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRootRaw = resolve(here, '..', '..', '..');

/**
 * WSL→Windows path bridge. Only applies when the LAUNCHER (this Node/Bun
 * process) is itself a Windows binary running under WSL bash — in that
 * case `process.cwd()` returns a `/mnt/c/...` path that Windows Electron's
 * require() resolver cannot understand, so we translate to `C:\...`.
 *
 * On Linux launchers (Linux-native Bun under WSL), the `/mnt/c/...` path
 * is the correct form — translating to `C:\...` would make Linux `chdir`
 * fail and the spawn would surface as `ENOENT`. So we skip translation
 * there. WSL Interop handles `.exe` spawn from the Linux side already.
 */
const projectRoot =
  process.platform === 'win32' && projectRootRaw.startsWith('/mnt/')
    ? projectRootRaw.replace(/^\/mnt\/([a-z])\//, (_m, drive: string) => `${drive.toUpperCase()}:\\`).replace(/\//g, '\\')
    : projectRootRaw;

test.describe('snowboy boot smoke', () => {
  test('renderer mounts and shows Snowboy heading', async () => {
    const app = await electron.launch({
      args: ['.'],
      cwd: projectRoot,
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
      },
      timeout: 30_000
    });

    try {
      const window = await app.firstWindow({ timeout: 20_000 });
      await window.waitForLoadState('domcontentloaded');

      await expect(window.getByRole('heading', { name: 'Snowboy' })).toBeVisible({
        timeout: 10_000
      });
      await expect(window.getByText(/Ready/i)).toBeVisible();
    } finally {
      await app.close();
    }
  });
});
