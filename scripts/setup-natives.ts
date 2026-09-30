/**
 * Readies the native side of a dev install: the Electron binary, and the
 * better-sqlite3 addon that Electron's main process loads.
 *
 * Why this exists:
 * - Since Electron 42 the `electron` package no longer downloads its binary
 *   in a postinstall script: `require('electron')` downloads it on first use.
 *   electron-vite reads `node_modules/electron/path.txt` without triggering
 *   that download, so `bun run dev` fails on a fresh install without this step.
 * - better-sqlite3 13+ is a Node-API addon. Its npm package ships prebuilt
 *   binaries (`prebuilds/<platform>-<arch>.node`) that load in Electron as-is,
 *   so nothing is rebuilt per Electron version. (`@electron/rebuild` would find
 *   no prebuild it recognises and fall back to node-gyp, which needs Python and
 *   a C++ toolchain even though that build is a no-op.) This script loads the
 *   addon in the installed Electron, running as plain Node, and opens an
 *   in-memory database.
 *
 * `snowflake-sdk` is not checked: 2.4.x loads its optional Node-API addon
 * (`sf_mini_core`) inside a try/catch and runs without it.
 *
 * Invocation:
 *   bun run setup:natives               (manual)
 *   bun install                         (via the `postinstall` hook)
 *
 * Exits non-zero on any failure so a missing or broken binary fails the install
 * instead of the first app launch.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const projectRequire = createRequire(import.meta.url);

/** Starts the probe's result line on stdout. */
const PROBE_MARKER = 'better-sqlite3-probe ';

/**
 * Runs inside Electron's Node; `better-sqlite3` resolves from the project root.
 * Keep it free of double quotes and backslashes so it passes through Windows
 * argument quoting unchanged.
 */
const SQLITE_PROBE = `
const Database = require('better-sqlite3');
const db = new Database(':memory:');
const row = db.prepare('select sqlite_version() as version').get();
db.close();
console.log('${PROBE_MARKER}' + JSON.stringify({
  betterSqlite3: require('better-sqlite3/package.json').version,
  sqlite: row.version,
  electron: process.versions.electron,
  node: process.versions.node
}));
`;

interface ProbeResult {
  betterSqlite3: string;
  sqlite: string;
  electron: string;
  node: string;
}

function isProbeResult(value: unknown): value is ProbeResult {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return ['betterSqlite3', 'sqlite', 'electron', 'node'].every(
    (key) => typeof fields[key] === 'string'
  );
}

/** The package's main export is the binary's path; requiring it downloads a missing binary. */
function electronBinary(): string {
  const binary: unknown = projectRequire('electron');
  if (typeof binary !== 'string') {
    throw new Error(`The electron package exported ${typeof binary}, not the binary's path`);
  }
  return binary;
}

function electronVersion(): string {
  const pkg: unknown = projectRequire('electron/package.json');
  if (typeof pkg !== 'object' || pkg === null || !('version' in pkg)) {
    throw new Error('Could not read the version from electron/package.json');
  }
  return String(pkg.version);
}

function main(): void {
  const started = Date.now();
  const electron = electronBinary();
  const expectedVersion = electronVersion();
  console.log(`[setup-natives] Electron ${expectedVersion}: ${electron}`);

  const probe = spawnSync(electron, ['-e', SQLITE_PROBE], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 120_000
  });
  const output = `\nstdout:\n${probe.stdout ?? ''}\nstderr:\n${probe.stderr ?? ''}`;
  if (probe.error) {
    throw new Error(`Could not run the better-sqlite3 probe: ${probe.error.message}${output}`);
  }
  if (probe.status !== 0) {
    throw new Error(
      `better-sqlite3 failed to load in Electron (exit ${probe.status ?? probe.signal})${output}`
    );
  }
  const line = probe.stdout.split('\n').find((l) => l.startsWith(PROBE_MARKER));
  const result: unknown = line === undefined ? null : JSON.parse(line.slice(PROBE_MARKER.length));
  if (!isProbeResult(result)) {
    throw new Error(`The better-sqlite3 probe printed no result${output}`);
  }
  if (result.electron !== expectedVersion) {
    throw new Error(
      `The probe ran in Electron ${result.electron}, not the installed ${expectedVersion}${output}`
    );
  }

  console.log(
    `[setup-natives] better-sqlite3 ${result.betterSqlite3} (SQLite ${result.sqlite}) ` +
      `loads in Electron ${result.electron} (Node ${result.node})`
  );
  console.log(`[setup-natives] done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

try {
  main();
} catch (err: unknown) {
  console.error('[setup-natives] FAILED');
  console.error(err);
  process.exit(1);
}
