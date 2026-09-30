/**
 * Launches the built app with a throwaway userData dir, so e2e never touches
 * the developer's real profile (`~/.config/snowboy` on Linux: snowboy.db,
 * settings.json, and secrets.json with saved passwords). Electron honours
 * Chromium's `--user-data-dir`, and every store in main resolves its path
 * through `app.getPath('userData')`.
 */
import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
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

/** A throwaway userData dir, and a remover for the specs' `finally` that never throws. */
export function createUserDataDir(): { dir: string; remove: () => void } {
  const dir = makeUserDataDir();
  const remove = (): void => {
    try {
      // Retries ride out a profile Windows still has locked just after exit.
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (err) {
      // Runs in the specs' `finally`: throwing here would fail a passing test
      // or replace a failing test's error. A leftover dir is the lesser harm.
      console.warn(`[e2e] could not remove ${dir}: ${String(err)}`);
    }
  };
  return { dir, remove };
}

function appEnv(extraEnv: Record<string, string>): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  return { ...env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...extraEnv };
}

export interface LaunchedApp {
  app: ElectronApplication;
  /** The throwaway userData dir, as a path on this (test-runner) side. */
  userDataDir: string;
  /** Closes the app, then deletes `userDataDir`. */
  cleanup: () => Promise<void>;
}

export async function launchApp(extraEnv: Record<string, string> = {}): Promise<LaunchedApp> {
  const { dir: userDataDir, remove: removeUserDataDir } = createUserDataDir();

  let app: ElectronApplication;
  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${toElectronPath(userDataDir)}`],
      cwd: toElectronPath(projectRootRaw),
      env: appEnv(extraEnv),
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

export interface AppRun {
  /** The exit code, or null if the run timed out and was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the built app as a plain child process with `userDataDir` as its
 * profile, and resolves when it exits, killing it after `timeoutMs`. For
 * launches Playwright can't drive, such as one that exits before opening a
 * window. `requires` are scripts loaded into the main process before the app
 * (`electron -r`), for example to stub a modal dialog that would block the run.
 */
export function runApp(
  userDataDir: string,
  { requires = [], timeoutMs = 20_000 }: { requires?: string[]; timeoutMs?: number } = {}
): Promise<AppRun> {
  // In Node, the electron package's main export is the binary's path.
  const binary: unknown = createRequire(import.meta.url)('electron');
  if (typeof binary !== 'string') {
    throw new Error(`The electron package exported ${typeof binary}, not the binary's path`);
  }
  const args = [
    ...requires.flatMap((script) => ['-r', toElectronPath(script)]),
    // As Playwright's launcher does, so this needs no more from the host than launchApp.
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    '.',
    `--user-data-dir=${toElectronPath(userDataDir)}`
  ];
  const child = spawn(binary, args, {
    cwd: projectRootRaw,
    env: appEnv({ SNOWBOY_DISABLE_DEVTOOLS: '1' })
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  return new Promise((resolveRun, rejectRun) => {
    child.on('error', (err) => {
      clearTimeout(timer);
      rejectRun(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}
