/**
 * A2 regression: when the root of the pane tree swaps one leaf for another
 * (a new tab, or Ctrl+W on a lone pane), the new pane must get its own
 * WorksheetPane. An unkeyed leaf reused the old instance, whose hydration
 * only runs on mount, so the new pane never showed an editor.
 *
 * Also covers loading: a remount keeps the pane's in-memory text instead of
 * reloading storage, and a failed load never offers an editor that could
 * save an empty body over the stored SQL.
 */
import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp } from '../helpers/launch';

// CHANNELS.workspace.getWorksheet in src/main/ipc/channels.ts.
const GET_WORKSHEET_CHANNEL = 'workspace.get-worksheet';

async function waitForFirstEditor(window: Page): Promise<void> {
  await window.waitForLoadState('domcontentloaded');
  await expect(window.getByRole('heading', { name: 'Snowboy' })).toBeVisible({
    timeout: 10_000
  });
  await expect(window.locator('.cm-editor')).toHaveCount(1, { timeout: 10_000 });
}

/** From now on, loading any worksheet returns a stored copy with `body`. */
async function serveStoredWorksheet(app: ElectronApplication, body: string): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, storedBody }) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, id: string) => ({
        id,
        title: 'Stored',
        body: storedBody,
        createdAt: 0,
        updatedAt: 0
      }));
    },
    { channel: GET_WORKSHEET_CHANNEL, storedBody: body }
  );
}

/** From now on, loading any worksheet fails. */
async function failWorksheetLoads(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => {
      throw new Error('storage unavailable');
    });
  }, GET_WORKSHEET_CHANNEL);
}

test.describe('worksheet tabs and panes', () => {
  test('a new tab shows its own editor and the first tab keeps its text', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const window = await app.firstWindow({ timeout: 20_000 });
      await waitForFirstEditor(window);
      const tabs = window.locator('[title^="Worksheet"]');
      const editor = window.locator('.cm-editor');

      await window.locator('.cm-content').click();
      await window.keyboard.type("select 'tab one';");
      await expect(editor).toContainText('tab one');
      // Storage now disagrees with tab 1's editor, so reloading on remount
      // would replace its text.
      await serveStoredWorksheet(app, "select 'stale';");

      await window.getByRole('button', { name: 'New tab' }).click();
      await expect(tabs).toHaveCount(2);
      // The outgoing editor can't satisfy this, so with the bug (no editor in
      // the new tab) it times out.
      await expect(editor).toContainText('stale');
      await expect(editor).toHaveCount(1);
      await expect(editor).toBeVisible();

      await window.locator('[title="Worksheet 1"]').click();
      await expect(editor).toContainText('tab one');
      await expect(editor).toHaveCount(1);
    } finally {
      await cleanup();
    }
  });

  test('Ctrl+W on a lone pane replaces it with a fresh editor', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const window = await app.firstWindow({ timeout: 20_000 });
      await waitForFirstEditor(window);
      const editor = window.locator('.cm-editor');

      await window.locator('.cm-content').click();
      await window.keyboard.type("select 'pane one';");
      await expect(editor).toContainText('pane one');

      await window.keyboard.press('ControlOrMeta+w');
      await expect(editor).not.toContainText('pane one');
      await expect(editor).toHaveCount(1);
      await expect(editor).toBeVisible();
      // Ctrl+W closed the pane, not the tab (or the window).
      await expect(window.locator('[title^="Worksheet"]')).toHaveCount(1);
    } finally {
      await cleanup();
    }
  });

  test('a worksheet that fails to load offers a retry, not an editor', async () => {
    const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

    try {
      const window = await app.firstWindow({ timeout: 20_000 });
      await waitForFirstEditor(window);
      const editor = window.locator('.cm-editor');
      const loadFailure = window.getByRole('alert').filter({ hasText: 'Failed to load worksheet' });

      await failWorksheetLoads(app);
      await window.getByRole('button', { name: 'New tab' }).click();
      await expect(loadFailure).toBeVisible();
      // Without an editor there is nothing to type into, so an empty body
      // can't be saved over the stored SQL.
      await expect(editor).toHaveCount(0);

      await serveStoredWorksheet(app, "select 'recovered';");
      await loadFailure.getByRole('button', { name: 'Retry' }).click();
      await expect(editor).toContainText('recovered');
      await expect(loadFailure).toHaveCount(0);
    } finally {
      await cleanup();
    }
  });
});
