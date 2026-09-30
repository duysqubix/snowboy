/**
 * Visual smoke gate. Asserts the renderer actually mounts — catches the bug
 * class where main-process logs look healthy but the user sees a blank
 * window (404'd renderer URL, broken Svelte mount, JS bundle crash). Do not
 * weaken or skip; every wave touching UI must keep this green.
 */
import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/launch';

test.describe('snowboy boot smoke', () => {
  test('renderer mounts and shows Snowboy heading', async () => {
    const { app, cleanup } = await launchApp();

    try {
      const window = await app.firstWindow({ timeout: 20_000 });
      await window.waitForLoadState('domcontentloaded');

      await expect(window.getByRole('heading', { name: 'Snowboy' })).toBeVisible({
        timeout: 10_000
      });
      await expect(window.getByText(/Ready/i)).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});
