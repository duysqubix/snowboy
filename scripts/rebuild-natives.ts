/**
 * Installs Electron-ABI builds of native Node addons.
 *
 * Why this exists: Electron 32 bundles Node 20.18; the host Bun toolchain
 * uses Node 24. Prebuilt binaries fetched by `bun install` / `npm install`
 * target the host ABI and abort with `NODE_MODULE_VERSION` mismatch errors
 * the first time Electron's main process tries to require them. This script
 * runs `@electron/rebuild` programmatically for every listed native
 * dependency: it downloads the module's published prebuild for the installed
 * Electron version (better-sqlite3 publishes one per Electron ABI through
 * prebuild-install) and compiles against Electron's headers only when no
 * prebuild exists for this platform or the download fails.
 *
 * Invocation:
 *   bun run rebuild                     (manual)
 *   bun install                         (via the `postinstall` hook)
 *
 * Exits non-zero on any failure so a broken native module fails the install
 * instead of the first app launch.
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
    // Without force, @electron/rebuild skips a module whose build/Release/.forge-meta
    // marker matches this arch and ABI, without checking the binary. better-sqlite3's
    // own install script can swap in a host-ABI binary and leave that marker behind.
    // With a prebuild available, forcing is cheap: prebuild-install re-extracts its
    // cached download.
    force: true,
    buildFromSource: false,
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
