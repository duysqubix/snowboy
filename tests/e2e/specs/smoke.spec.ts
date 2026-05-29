/**
 * Visual smoke gate. Asserts the renderer actually mounts — catches the bug
 * class where main-process logs look healthy but the user sees a blank
 * window (404'd renderer URL, broken Svelte mount, JS bundle crash). Do not
 * weaken or skip; every wave touching UI must keep this green.
 */
import { test, expect, _electron as electron } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRootRaw = resolve(here, '..', '..', '..');

/**
 * WSL→Windows path bridge. The Electron binary in `node_modules/electron/`
 * is platform-specific: on this checkout it's Windows-native (.exe), so
 * any `/mnt/c/...` path passed as `cwd` makes Windows Electron's require()
 * fail with `Cannot find module '/mnt/c/...'` and pop a JS-error dialog
 * before the test can even start.
 *
 * The naive guard `process.platform === 'win32'` is wrong: when WSL bash
 * runs Node/Bun, `process.platform === 'linux'`, the guard skips, and we
 * fall straight into the broken path. Detect the Windows Electron binary
 * by looking for `electron.exe` in the resolved electron module dir;
 * translate iff present. No-op on macOS/Linux-native Electron checkouts.
 */
function detectWindowsElectron(): boolean {
  try {
    const electronDir = resolve(projectRootRaw, 'node_modules/electron/dist');
    return existsSync(resolve(electronDir, 'electron.exe'));
  } catch {
    return false;
  }
}

const projectRoot =
  projectRootRaw.startsWith('/mnt/') && detectWindowsElectron()
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
