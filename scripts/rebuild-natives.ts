/**
 * Rebuilds native Node addons against Electron's bundled Node ABI.
 *
 * Why this exists: Electron 32 bundles Node 20.18; the host Bun toolchain
 * uses Node 24. Prebuilt binaries fetched by `bun install` / `npm install`
 * target the host ABI and abort with `NODE_MODULE_VERSION` mismatch errors
 * the first time Electron's main process tries to require them. This script
 * uses `@electron/rebuild` programmatically to recompile every listed native
 * dependency against the locally-installed Electron's headers.
 *
 * Invocation:
 *   bun run rebuild                     (manual)
 *   bun install                         (via the `postinstall` hook)
 *
 * Exits non-zero on any failure so CI surfaces native-build breakage early.
 */

import { rebuild } from '@electron/rebuild';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Native modules that require an Electron-ABI rebuild.
 *
 * `snowflake-sdk` is intentionally absent: as of v2.4.x it is a pure-JS
 * driver with no `*.node` bindings. If a future version reintroduces native
 * bindings (e.g. the experimental `sf_mini_core` NAPI module referenced in
 * its package.json), add it to this list.
 */
const TARGET_MODULES: readonly string[] = ['better-sqlite3'];

async function readElectronVersion(): Promise<string> {
  const pkgPath = resolve(PROJECT_ROOT, 'node_modules', 'electron', 'package.json');
  const raw = await readFile(pkgPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('version' in parsed) ||
    typeof (parsed as { version: unknown }).version !== 'string'
  ) {
    throw new Error(`Could not read Electron version from ${pkgPath}`);
  }
  return (parsed as { version: string }).version;
}

async function main(): Promise<void> {
  const started = Date.now();
  const electronVersion = await readElectronVersion();

  console.log(
    `[rebuild-natives] starting against Electron ${electronVersion} ` +
      `(${process.platform}/${process.arch}, host Node ${process.version})`
  );
  console.log(`[rebuild-natives] target modules: ${TARGET_MODULES.join(', ')}`);

  const task = rebuild({
    buildPath: PROJECT_ROOT,
    electronVersion,
    arch: process.arch,
    force: true,
    buildFromSource: true,
    onlyModules: [...TARGET_MODULES]
  });

  task.lifecycle.on('module-found', (name: string) => {
    console.log(`[rebuild-natives] module-found: ${name}`);
  });
  task.lifecycle.on('module-done', (name: string) => {
    console.log(`[rebuild-natives] module-done:  ${name}`);
  });
  task.lifecycle.on('module-skip', (name: string) => {
    console.log(`[rebuild-natives] module-skip:  ${name}`);
  });

  await task;

  console.log(`[rebuild-natives] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main().catch((err: unknown) => {
  console.error('[rebuild-natives] FAILED');
  console.error(err);
  process.exit(1);
});
