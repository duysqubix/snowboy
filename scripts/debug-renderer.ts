import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(here, '..');

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

const window = await app.firstWindow({ timeout: 20_000 });

window.on('console', (msg) => {
  console.log(`[console.${msg.type()}]`, msg.text());
});
window.on('pageerror', (err) => {
  console.log('[pageerror]', err.message);
  console.log(err.stack);
});

await window.waitForLoadState('domcontentloaded');
await window.waitForTimeout(3000);

const bodyHtml = await window.evaluate(() => document.body.innerHTML);
console.log('[body length]', bodyHtml.length);
console.log('[body first 500 chars]', bodyHtml.slice(0, 500));

await app.close();
