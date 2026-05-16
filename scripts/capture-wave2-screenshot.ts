import { _electron as electron, type Page } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..');
const outDir = resolve(projectRoot, '.sisyphus', 'screenshots');

async function captureUi(window: Page, name: string) {
  const path = resolve(outDir, name);
  await window.screenshot({ path, fullPage: false });
  console.log(`[screenshot] wrote ${path}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const app = await electron.launch({
    args: ['.'],
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      SNOWBOY_DISABLE_DEVTOOLS: '1'
    },
    timeout: 30_000
  });

  try {
    const window = await app.firstWindow({ timeout: 20_000 });
    await window.waitForLoadState('domcontentloaded');
    await window.waitForTimeout(1500);
    await captureUi(window, '01-initial.png');

    await window.keyboard.press('Control+T');
    await window.waitForTimeout(300);
    await window.keyboard.press('Control+T');
    await window.waitForTimeout(300);
    await captureUi(window, '02-three-tabs.png');

    await window.keyboard.press('Control+\\');
    await window.waitForTimeout(300);
    await window.keyboard.press('Control+Shift+\\');
    await window.waitForTimeout(300);
    await captureUi(window, '03-split-panes.png');

    await window.keyboard.press('Control+h');
    await window.waitForTimeout(500);
    await captureUi(window, '04-history-drawer.png');
    await window.keyboard.press('Control+h');
    await window.waitForTimeout(300);

    const connectButton = window.getByRole('button', { name: /connect/i }).first();
    if (await connectButton.isVisible()) {
      await connectButton.click();
      await window.waitForTimeout(500);
      await captureUi(window, '05-connection-dialog.png');
      await window.keyboard.press('Escape');
      await window.waitForTimeout(300);
    }

    console.log('[screenshot] done');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[screenshot] failed:', err);
  process.exit(1);
});
