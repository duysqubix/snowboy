/**
 * G1 guard: e2e must run against the launch helper's throwaway userData dir,
 * never the developer's real profile (which also holds saved credentials).
 */
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp } from '../helpers/launch';

test('the app keeps its database in the throwaway userData dir', async () => {
  const { app, userDataDir, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

  try {
    const window = await app.firstWindow({ timeout: 20_000 });
    // The database opens before the window is created, so it exists by now.
    await expect(window.getByRole('heading', { name: 'Snowboy' })).toBeVisible({
      timeout: 10_000
    });
    expect(existsSync(join(userDataDir, 'snowboy.db'))).toBe(true);
  } finally {
    await cleanup();
  }
});
