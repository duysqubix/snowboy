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
 * WSL→Windows path bridge. When running from WSL bash with the Windows
 * bun/electron binaries, `process.cwd()` returns a `/mnt/c/...` path that
 * Windows Electron's require() resolver cannot understand → playwright-core
 * preload load fails with "Cannot find module '/mnt/c/...'". Translate
 * such paths to native `C:\...` so the spawned Windows Electron can
 * resolve modules correctly. No-op on macOS/Linux/native Windows shells.
 */
const projectRoot = projectRootRaw.startsWith('/mnt/')
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
