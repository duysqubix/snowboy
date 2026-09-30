/**
 * M1.4 startup robustness. A second launch against the same profile leaves it
 * to the running app and exits at once. A startup that fails says why and
 * exits, rather than leaving a process running with no window, while a first
 * load that is reloaded or closed isn't a failure. Closing the last window
 * quits promptly, so the profile's lock is free for the next launch.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUserDataDir, launchApp, runApp } from '../helpers/launch';

const helper = (name: string) => fileURLToPath(new URL(`../helpers/${name}`, import.meta.url));
// Each run loads the error-box stub, so a regression prints the box instead of
// blocking on it until the run times out.
const STUB_ERROR_BOX = helper('stub-error-box.mjs');
const RELOAD_DURING_LOAD = helper('reload-during-load.mjs');
const CLOSE_DURING_LOAD = helper('close-during-load.mjs');

interface MainGlobals {
  focusCalls?: number;
}

test('a second instance exits at once and the first brings its window forward', async () => {
  const { app, userDataDir, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

  try {
    const page = await app.firstWindow({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Snowboy' })).toBeVisible({ timeout: 10_000 });
    // Count focus() calls: WSLg ignores minimize() and refocuses the window by
    // itself, so the window's state can't show whether the app asked.
    await app.evaluate(({ BrowserWindow }) => {
      const globals = globalThis as MainGlobals;
      const win = BrowserWindow.getAllWindows()[0];
      if (win === undefined) throw new Error('no window');
      const focus = win.focus.bind(win);
      globals.focusCalls = 0;
      win.focus = () => {
        globals.focusCalls = (globals.focusCalls ?? 0) + 1;
        focus();
      };
    });

    const second = await runApp(userDataDir, { timeoutMs: 15_000 });

    expect(second.code).toBe(0);
    expect(second.stdout).toContain('[main] Snowboy is already running; exiting');
    expect(second.stdout).not.toContain('[main] storage ready');
    await expect.poll(() => app.evaluate(() => (globalThis as MainGlobals).focusCalls)).toBe(1);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await expect(page.getByRole('heading', { name: 'Snowboy' })).toBeVisible();
  } finally {
    await cleanup();
  }
});

test('closing the last window quits promptly, freeing the profile for a relaunch', async () => {
  const { app, cleanup } = await launchApp({ SNOWBOY_DISABLE_DEVTOOLS: '1' });

  try {
    const page = await app.firstWindow({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Snowboy' })).toBeVisible({ timeout: 10_000 });
    const exitedAt = new Promise<number>((resolve) => {
      app.process().once('exit', () => resolve(Date.now()));
    });

    // On Windows and Linux, closing the only window quits the app. Close from a
    // timer, so no Playwright call is pending while the app exits: the Node
    // inspector would hold the exit until that call's debugger disconnects.
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 100);
    });
    const closedAt = Date.now() + 100;

    // Waiting for a flush that no window is left to send took 2 s.
    expect((await exitedAt) - closedAt).toBeLessThan(1500);
  } finally {
    await cleanup();
  }
});

test('a startup failure is explained and the process exits', async () => {
  const { dir, remove } = createUserDataDir();

  try {
    // Not an SQLite file, so opening the database throws.
    writeFileSync(join(dir, 'snowboy.db'), 'this is not a database');

    const run = await runApp(dir, { requires: [STUB_ERROR_BOX], timeoutMs: 20_000 });

    expect(run.code).toBe(1);
    expect(run.stderr).toContain('[main] startup failed');
    expect(run.stdout).not.toContain('[main] window created');
    const box = /^\[e2e\] error box: (.*)$/m.exec(run.stdout)?.[1];
    expect(box).toBeDefined();
    const { title, content } = JSON.parse(box ?? '{}') as { title: string; content: string };
    expect(title).toBe('Snowboy failed to start');
    expect(content).toContain('file is not a database');
    expect(content).toContain(basename(dir));
  } finally {
    remove();
  }
});

test('a reload before the first load finishes is not a failed start', async () => {
  const { dir, remove } = createUserDataDir();

  try {
    // Electron rejects the window's first load with ERR_ABORTED here.
    const run = await runApp(dir, {
      requires: [STUB_ERROR_BOX, RELOAD_DURING_LOAD],
      timeoutMs: 20_000
    });

    expect(run.stdout).toContain('[e2e] reloading; first load finished: false');
    expect(run.stderr).not.toContain('[main] startup failed');
    expect(run.stdout).not.toContain('[e2e] error box');
    expect(run.code).toBe(0);
  } finally {
    remove();
  }
});

test('closing the window before the first load finishes is not a failed start', async () => {
  const { dir, remove } = createUserDataDir();

  try {
    // Electron rejects the window's first load with ERR_FAILED here.
    const run = await runApp(dir, {
      requires: [STUB_ERROR_BOX, CLOSE_DURING_LOAD],
      timeoutMs: 20_000
    });

    expect(run.stdout).toContain('[e2e] closing; first load finished: false');
    expect(run.stderr).not.toContain('[main] startup failed');
    expect(run.stdout).not.toContain('[e2e] error box');
    expect(run.code).toBe(0);
  } finally {
    remove();
  }
});
