/**
 * Launches the built app with a throwaway userData dir, so e2e never touches
 * the developer's real profile (`~/.config/snowboy` on Linux: snowboy.db,
 * settings.json, and secrets.json with saved passwords). Electron honours
 * Chromium's `--user-data-dir`, and every store in main resolves its path
 * through `app.getPath('userData')`.
 */
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const projectRootRaw = resolve(here, '..', '..', '..');

/**
 * WSL→Windows path bridge. The Electron binary in `node_modules/electron/`
 * is platform-specific: on this checkout it's Windows-native (.exe), so
 * any `/mnt/c/...` path passed as `cwd` makes Windows Electron's require()
 * fail with `Cannot find module '/mnt/c/...'` and pop a JS-error dialog
 * before the test can even start.
 *
 * The naive guard `process.platform === 'win32'` is wrong: when WSL bash
 * runs Node/Bun, `process.platform === 'linux'`, the guard skips, and we
 * fall straight into the broken path. Detect the Windows Electron binary
 * by looking for `electron.exe` in the resolved electron module dir;
 * translate iff present. No-op on macOS/Linux-native Electron checkouts.
 */
function detectWindowsElectron(): boolean {
  try {
    const electronDir = resolve(projectRootRaw, 'node_modules/electron/dist');
    return existsSync(resolve(electronDir, 'electron.exe'));
  } catch {
    return false;
  }
}

const bridgeToWindows = projectRootRaw.startsWith('/mnt/') && detectWindowsElectron();

function toElectronPath(path: string): string {
  if (!bridgeToWindows) return path;
  return path
    .replace(/^\/mnt\/([a-z])\//, (_m, drive: string) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\');
}

function makeUserDataDir(): string {
  if (!bridgeToWindows) return mkdtempSync(join(tmpdir(), 'snowboy-e2e-'));
  // Windows Electron can't resolve WSL's /tmp. Use the checkout's drive,
  // which both sides can reach (and toElectronPath can translate).
  const base = join(projectRootRaw, 'node_modules', '.cache');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, 'snowboy-e2e-'));
}

export interface LaunchedApp {
  app: ElectronApplication;
  /** The throwaway userData dir, as a path on this (test-runner) side. */
  userDataDir: string;
  /** Closes the app, then deletes `userDataDir`. */
  cleanup: () => Promise<void>;
}

export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const userDataDir = makeUserDataDir();
  const removeUserDataDir = (): void => {
    try {
      // Retries ride out a profile Windows still has locked just after exit.
      rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      // Runs in the specs' `finally`: throwing here would fail a passing test
      // or replace a failing test's error. A leftover dir is the lesser harm.
      console.warn(`[e2e] could not remove ${userDataDir}: ${String(err)}`);
    }
  };
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );

  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${toElectronPath(userDataDir)}`],
      cwd: toElectronPath(projectRootRaw),
      env: { ...env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv },
      timeout: 30_000
    });
  } catch (err) {
    removeUserDataDir();
    throw err;
  }

  return {
    app,
    userDataDir,
    cleanup: async () => {
      try {
        await app.close();
      } finally {
        removeUserDataDir();
      }
    }
  };
}
