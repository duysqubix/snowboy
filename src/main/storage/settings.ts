/**
 * Flat-JSON settings store for snowboy's main process.
 *
 * Design notes (per Wave 4 v2 plan §T4.3a):
 * - Persisted as a single JSON snapshot at `<userData>/settings.json`.
 *   No SQLite — settings shape is tiny, mostly read at boot, and the
 *   preload script needs to read it synchronously before first paint
 *   to fix the theme FOUC (see hyperplan finding #5).
 * - All I/O is synchronous. This module is called from `ipcMain.on`
 *   handlers (sync IPC) and the production boot path; the file is
 *   small enough that sync reads/writes are fine.
 * - Atomic write protocol: write to `${path}.tmp`, then `renameSync`
 *   onto the destination. On Windows under antivirus / OneDrive the
 *   rename can fail with EPERM / EBUSY transiently; we retry up to
 *   three times with a 50ms busy-wait backoff before giving up. On
 *   final failure the `.tmp` file is intentionally left in place so
 *   the user can recover, and we throw.
 * - Defaults are merged at every read. Future-added fields default
 *   transparently. Every persisted field is clamped on read so a
 *   hand-edited `fontSize: -10` cannot crash the UI; type mismatches
 *   (e.g. `theme: 42`) fall back to the field default with a one-line
 *   `console.warn`.
 * - No JSON-schema validation library. The Settings shape is small;
 *   hand-clamping each field is simpler and avoids the dependency
 *   weight.
 *
 * Test helpers (`__set*ForTesting`) inject a deterministic on-disk
 * path so unit tests can run under `bun test` without dragging in the
 * Electron binary.
 */

import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Settings, ThemeMode } from '../types';

// CommonJS-style require so we can pull `electron.app` synchronously
// from the main process. Inside a packaged Electron app this returns
// the live Electron namespace; from plain Node/Bun the lookup throws
// — but tests always install a path override before that path is
// reached.
const nodeRequire = createRequire(import.meta.url);

const SETTINGS_FILE_NAME = 'settings.json' as const;

const FONT_SIZE_MIN = 10 as const;
const FONT_SIZE_MAX = 24 as const;
const ALLOWED_TAB_WIDTHS = new Set<number>([2, 4, 8]);
const ALLOWED_THEMES = new Set<ThemeMode>(['light', 'dark', 'system']);

const ATOMIC_WRITE_MAX_RETRIES = 3 as const;
const ATOMIC_WRITE_BACKOFF_MS = 50 as const;

let storagePathOverride: string | null = null;
let dataDirOverride: string | null = null;

function loadElectronApp(): { getPath: (name: string) => string } {
  const raw: unknown = nodeRequire('electron');
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(
      '[settings] electron namespace is unavailable (not running inside Electron main process)'
    );
  }
  const ns = raw as { app?: { getPath?: (name: string) => string } };
  if (!ns.app || typeof ns.app.getPath !== 'function') {
    throw new Error(
      '[settings] electron namespace missing app.getPath; cannot resolve userData'
    );
  }
  return ns.app as { getPath: (name: string) => string };
}

function userDataDir(): string {
  if (dataDirOverride !== null) return dataDirOverride;
  return loadElectronApp().getPath('userData');
}

function settingsPath(): string {
  if (storagePathOverride !== null) return storagePathOverride;
  return path.join(userDataDir(), SETTINGS_FILE_NAME);
}

/**
 * Default settings shape. `dataDir` defaults to the resolved userData
 * directory at read time — users who haven't customized it always see
 * the live install path, even if it moves between releases.
 */
function defaultSettings(): Settings {
  return {
    theme: 'system',
    fontSize: 14,
    tabWidth: 2,
    wordWrap: true,
    telemetryEnabled: false,
    dataDir: userDataDir()
  };
}

function clampTheme(v: unknown): ThemeMode {
  if (typeof v === 'string' && (ALLOWED_THEMES as Set<string>).has(v)) {
    return v as ThemeMode;
  }
  if (v !== undefined) {
    console.warn(
      `[settings] theme: unsupported value ${JSON.stringify(v)}; falling back to 'system'`
    );
  }
  return 'system';
}

function clampFontSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    if (v !== undefined) {
      console.warn(
        `[settings] fontSize: not a finite number (${JSON.stringify(v)}); falling back to 14`
      );
    }
    return 14;
  }
  const rounded = Math.round(v);
  if (rounded < FONT_SIZE_MIN) return FONT_SIZE_MIN;
  if (rounded > FONT_SIZE_MAX) return FONT_SIZE_MAX;
  return rounded;
}

function clampTabWidth(v: unknown): 2 | 4 | 8 {
  if (typeof v === 'number' && ALLOWED_TAB_WIDTHS.has(v)) {
    return v as 2 | 4 | 8;
  }
  if (v !== undefined) {
    console.warn(
      `[settings] tabWidth: unsupported value ${JSON.stringify(v)}; falling back to 2`
    );
  }
  return 2;
}

function castBool(v: unknown, defaultValue: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === undefined) return defaultValue;
  // Non-boolean truthy/falsy values are cast — the user clearly meant
  // *something*, and silently dropping their edit is worse than
  // coercing. A warn is emitted so hand-edited JSON anomalies surface
  // in the dev log.
  console.warn(
    `[settings] boolean field received non-boolean ${JSON.stringify(v)}; casting`
  );
  return Boolean(v);
}

function clampDataDir(v: unknown): string {
  if (typeof v === 'string' && v.length > 0) return v;
  if (v !== undefined) {
    console.warn(
      `[settings] dataDir: not a non-empty string (${JSON.stringify(v)}); falling back to userData`
    );
  }
  return userDataDir();
}

/**
 * Apply defaults + clamping to an unknown parsed JSON payload. The
 * input is treated as fully untrusted — it may have arrived from a
 * hand-edited file on disk.
 */
function normalize(parsed: unknown): Settings {
  const obj: Record<string, unknown> =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  return {
    theme: clampTheme(obj['theme']),
    fontSize: clampFontSize(obj['fontSize']),
    tabWidth: clampTabWidth(obj['tabWidth']),
    wordWrap: castBool(obj['wordWrap'], true),
    telemetryEnabled: castBool(obj['telemetryEnabled'], false),
    dataDir: clampDataDir(obj['dataDir'])
  };
}

/**
 * Read settings from disk synchronously. Missing file → defaults.
 * Malformed JSON or unexpected shape → defaults + `console.warn`.
 * Every field is clamped to its allowed range / set on read so a
 * hand-edited corruption cannot propagate into the rest of the app.
 */
export function readSettings(): Settings {
  const filePath = settingsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return defaultSettings();
    }
    console.warn(
      `[settings] failed to read ${filePath}: ${(err as Error).message}; using defaults`
    );
    return defaultSettings();
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return defaultSettings();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    console.warn(
      `[settings] malformed JSON in ${filePath}: ${(err as Error).message}; using defaults`
    );
    return defaultSettings();
  }
  return normalize(parsed);
}

/**
 * Synchronously sleep for ~`ms` milliseconds via a busy-wait. Only
 * called on the rare Windows EPERM/EBUSY retry path; the loop runs
 * at most three times per write, so the cumulative spin is bounded
 * at ~150ms in the worst case.
 */
function spinSleep(ms: number): void {
  const target = Date.now() + ms;
  while (Date.now() < target) {
    // intentional spin; sync context blocks setTimeout
  }
}

/**
 * Atomic write: write the body to `${dest}.tmp`, then
 * `fs.renameSync(tmp, dest)`. On EPERM/EBUSY/EACCES (Windows under
 * AV / OneDrive contention), retry up to three times with a 50ms
 * backoff. If all attempts fail, the `.tmp` is intentionally left
 * on disk so the user can recover the payload manually, and we
 * rethrow the last error.
 */
function atomicWriteSync(dest: string, body: string): void {
  const tmp = `${dest}.tmp`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(tmp, body, { encoding: 'utf8' });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= ATOMIC_WRITE_MAX_RETRIES; attempt++) {
    try {
      fs.renameSync(tmp, dest);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
        // Not a transient Windows contention error; rethrow now and
        // leave the .tmp in place for the user.
        throw err;
      }
      lastErr = err;
      if (attempt < ATOMIC_WRITE_MAX_RETRIES) {
        console.warn(
          `[settings] rename ${tmp} -> ${dest} failed with ${code}; retry ${attempt + 1}/${ATOMIC_WRITE_MAX_RETRIES}`
        );
        spinSleep(ATOMIC_WRITE_BACKOFF_MS);
      }
    }
  }
  console.error(
    `[settings] atomic write failed after ${ATOMIC_WRITE_MAX_RETRIES} retries; leaving ${tmp} for recovery`
  );
  throw lastErr;
}

/**
 * Merge `partial` over the current on-disk settings and persist the
 * result atomically. Returns the full merged settings so callers can
 * broadcast it to renderer windows without an extra read.
 */
export function writeSettings(partial: Partial<Settings>): Settings {
  const current = readSettings();
  const merged: Settings = normalize({ ...current, ...partial });
  const body = JSON.stringify(merged, null, 2);
  atomicWriteSync(settingsPath(), body);
  return merged;
}

// ---------------------------------------------------------------------------
// Test-only helpers. Prefixed with `__` so production callers know they are
// not part of the supported runtime surface.
// ---------------------------------------------------------------------------

/**
 * Override the on-disk JSON path. Pass `null` to revert to
 * `app.getPath('userData') / settings.json`.
 */
export function __setStoragePathForTesting(filePath: string | null): void {
  storagePathOverride = filePath;
}

/**
 * Override the resolved userData directory (used for the `dataDir`
 * default field and as the fallback base for `settingsPath`). Pass
 * `null` to revert to the real `app.getPath('userData')`.
 */
export function __setDataDirForTesting(dir: string | null): void {
  dataDirOverride = dir;
}
